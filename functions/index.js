const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const admin = require("firebase-admin");
const crypto = require("crypto");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

/* =========================
   SECRETS
========================= */
const MP_TOKEN = defineSecret("MERCADOPAGO_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MERCADOPAGO_WEBHOOK_SECRET");
const RECONCILE_KEY = defineSecret("RECONCILE_KEY");

/* =========================
   HELPERS
========================= */

function nowMinusHours(hours) {
  const ms = Number(hours) * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

async function mpSearchApprovedPaymentByExternalReference(accessToken, externalReference) {
  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("external_reference", String(externalReference));

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const err = new Error("MP payments/search failed");
    err.status = resp.status;
    err.response = { data };
    throw err;
  }

  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;

  // pega o mais recente "approved"
  const approved = results
    .filter((p) => String(p?.status || "") === "approved")
    .sort((a, b) => {
      const da = new Date(a?.date_created || 0).getTime();
      const dbb = new Date(b?.date_created || 0).getTime();
      return dbb - da;
    });

  return approved[0] || null;
}

/**
 * Processa um pagamento aprovado com idempotência e transação:
 * - decrementa stock
 * - incrementa sales / totalRevenueCents
 * - marca order como paid e grava mpPaymentId/mpStatus
 */
async function processApprovedPayment({ orderId, paymentId, mpStatus }) {
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) {
    return { ok: false, reason: "order_not_found" };
  }

  const order = orderSnap.data();

  // idempotência
  if (order.status === "paid") {
    return { ok: true, reason: "already_paid" };
  }

  const productRef = db.collection("products").doc(order.productId);

  await db.runTransaction(async (transaction) => {
    const productSnap = await transaction.get(productRef);
    const freshOrderSnap = await transaction.get(orderRef);

    if (!freshOrderSnap.exists) throw new Error("Pedido não encontrado");
    const freshOrder = freshOrderSnap.data();

    // idempotência dentro da transação (evita corrida)
    if (freshOrder.status === "paid") return;

    if (!productSnap.exists) {
      throw new Error("Produto não encontrado");
    }

    const product = productSnap.data();

    if (Number(product.stock) <= 0) {
      throw new Error("Sem estoque");
    }

    transaction.update(productRef, {
      stock: Number(product.stock) - 1,
      sales: (Number(product.sales) || 0) + 1,
      totalRevenueCents:
        (Number(product.totalRevenueCents) || 0) + Number(freshOrder.priceCents || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.update(orderRef, {
      status: "paid",
      mpPaymentId: String(paymentId || ""),
      mpStatus: String(mpStatus || "approved"),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, reason: "processed" };
}

/* =========================
   CREATE PREFERENCE (com CORS)
========================= */

exports.createPreference = onRequest({ secrets: [MP_TOKEN] }, async (req, res) => {
  // ===== CORS =====
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }
  // =================

  try {
    const { productId } = req.body || {};

    if (!productId) {
      return res.status(400).json({ error: "productId obrigatório" });
    }

    const productRef = db.collection("products").doc(productId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    const product = productSnap.data();

    if (!product.active) {
      return res.status(400).json({ error: "Produto inativo" });
    }

    if (Number(product.stock) <= 0) {
      return res.status(400).json({ error: "Produto sem estoque" });
    }

    // cria pedido pendente
    const orderRef = await db.collection("orders").add({
      productId,
      title: product.title,
      priceCents: Number(product.priceCents),
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const mpClient = new MercadoPagoConfig({
      accessToken: MP_TOKEN.value(),
    });

    const preference = new Preference(mpClient);

    const WEBHOOK_URL = "https://mercadopagowebhook-flf5exmuxa-uc.a.run.app";

    const SUCCESS_URL = "https://giovannaerodrigo.com.br/success.html";
    const FAILURE_URL = "https://giovannaerodrigo.com.br/failure.html";
    const PENDING_URL = "https://giovannaerodrigo.com.br/pending.html";

    // ✅ OPÇÃO A: external_reference = orderId (gancho perfeito pro reconcile)
    const externalReference = orderRef.id;

    const response = await preference.create({
      body: {
        items: [
          {
            id: productId,
            title: product.title,
            quantity: 1,
            currency_id: "BRL",
            unit_price: Number(product.priceCents) / 100,
          },
        ],
        metadata: {
          orderId: orderRef.id,
        },
        external_reference: externalReference,
        back_urls: {
          success: SUCCESS_URL,
          failure: FAILURE_URL,
          pending: PENDING_URL,
        },
        notification_url: WEBHOOK_URL,
        auto_return: "approved",
      },
    });

    const initPoint =
      response?.init_point ||
      response?.body?.init_point ||
      response?.sandbox_init_point ||
      response?.body?.sandbox_init_point;

    const preferenceId = response?.id || response?.body?.id || "";

    // salva vínculo MP ↔ order (útil p/ auditoria e reconcile)
    await orderRef.update({
      mpPreferenceId: String(preferenceId || ""),
      externalReference: String(externalReference),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (!initPoint) {
      console.error(
        "Mercado Pago não retornou init_point:",
        JSON.stringify({ keys: Object.keys(response || {}) })
      );
      return res.status(502).json({ error: "Mercado Pago não retornou init_point" });
    }

    return res.status(200).json({ init_point: initPoint });
  } catch (error) {
    const safe = {
      name: String(error?.name || ""),
      message: String(error?.message || ""),
      status: error?.status,
      code: error?.code,
      mpStatus: error?.response?.status,
      mpMessage: String(error?.response?.data?.message || ""),
    };

    console.error("createPreference failed:", JSON.stringify(safe));
    return res.status(500).json({ error: "Erro interno", debug: safe });
  }
});

/* =========================
   WEBHOOK SEGURO
========================= */

exports.mercadoPagoWebhook = onRequest(
  { secrets: [MP_TOKEN, MP_WEBHOOK_SECRET] },
  async (req, res) => {
    try {
      const signature = req.headers["x-signature"];
      const requestId = req.headers["x-request-id"];

      if (!signature || !requestId) {
        return res.status(400).send("Assinatura ausente");
      }

      const paymentId = req.body?.data?.id;

      if (!paymentId) {
        return res.status(400).send("paymentId ausente");
      }

      const secret = MP_WEBHOOK_SECRET.value();

      // x-signature: "ts=...,v1=..."
      const parts = String(signature).split(",");
      let ts = "";
      let v1 = "";

      for (const part of parts) {
        const [k, v] = part.split("=");
        const key = (k || "").trim();
        const val = (v || "").trim();
        if (key === "ts") ts = val;
        if (key === "v1") v1 = val;
      }

      if (!ts || !v1) {
        return res.status(400).send("Assinatura malformada");
      }

      const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;

      const expected = crypto
        .createHmac("sha256", secret)
        .update(manifest)
        .digest("hex");

      if (expected !== v1) {
        console.error("Webhook signature invalid (ignored):", JSON.stringify({ paymentId, topic: req.body?.type }));
        return res.status(200).send("Assinatura inválida (ignorado)");
      }

      // somente pagamentos
      if (req.body.type !== "payment") {
        return res.status(200).send("Evento ignorado");
      }

      const mpClient = new MercadoPagoConfig({
        accessToken: MP_TOKEN.value(),
      });

      const payment = new Payment(mpClient);
      const paymentData = await payment.get({ id: paymentId });

      if (paymentData.status !== "approved") {
        return res.status(200).send("Pagamento não aprovado");
      }

      const orderId = paymentData.metadata?.orderId || paymentData.external_reference;

      if (!orderId) {
        return res.status(400).send("OrderId ausente");
      }

      const result = await processApprovedPayment({
        orderId: String(orderId),
        paymentId: String(paymentId),
        mpStatus: String(paymentData.status || "approved"),
      });

      return res.status(200).send(result.ok ? "Pagamento processado" : "Pagamento não processado");
    } catch (error) {
      const safe = {
        name: String(error?.name || ""),
        message: String(error?.message || ""),
        status: error?.status,
        code: error?.code,
        mpStatus: error?.response?.status,
        mpMessage: String(error?.response?.data?.message || ""),
      };

      console.error("mercadoPagoWebhook failed:", JSON.stringify(safe));
      return res.status(500).send("Erro interno");
    }
  }
);

/* =========================
   RECONCILE (fallback) - a cada 5 minutos
========================= */

exports.reconcilePendingOrders = onRequest(
  { secrets: [MP_TOKEN, RECONCILE_KEY] },
  async (req, res) => {
    try {
      // Proteção simples por header
      const key = String(req.headers["x-reconcile-key"] || "");
      if (!key || key !== RECONCILE_KEY.value()) {
        return res.status(401).send("Unauthorized");
      }

      const accessToken = MP_TOKEN.value();

      // Config padrão alinhada (48h / 50 / approved-only)
      const cutoff = admin.firestore.Timestamp.fromDate(nowMinusHours(48));
      const q = db
        .collection("orders")
        .where("status", "==", "pending")
        .where("createdAt", ">=", cutoff)
        .orderBy("createdAt", "asc")
        .limit(50);

      const snap = await q.get();

      if (snap.empty) {
        return res.status(200).json({ ok: true, processed: 0, skipped: 0 });
      }

      let processed = 0;
      let skipped = 0;

      for (const doc of snap.docs) {
        const orderId = doc.id;
        const order = doc.data();

        // se já pagou por algum motivo, pula
        if (order.status === "paid") {
          skipped += 1;
          continue;
        }

        // OPÇÃO A: external_reference é o próprio orderId
        const externalRef = order.externalReference || orderId;

        const payment = await mpSearchApprovedPaymentByExternalReference(accessToken, externalRef);

        if (!payment) {
          skipped += 1;
          continue;
        }

        // processa com transação + idempotência
        const r = await processApprovedPayment({
          orderId: String(orderId),
          paymentId: String(payment.id || ""),
          mpStatus: String(payment.status || "approved"),
        });

        if (r.ok && r.reason === "processed") processed += 1;
        else skipped += 1;
      }

      return res.status(200).json({ ok: true, processed, skipped });
    } catch (error) {
      const safe = {
        name: String(error?.name || ""),
        message: String(error?.message || ""),
        status: error?.status,
        code: error?.code,
        mpStatus: error?.response?.status,
        mpMessage: String(error?.response?.data?.message || ""),
      };

      console.error("reconcilePendingOrders failed:", JSON.stringify(safe));
      return res.status(500).json({ ok: false, error: "Erro interno", debug: safe });
    }
  }
);
const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

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

/* =========================
   CREATE PREFERENCE (com CORS)
========================= */

exports.createPreference = onRequest({ secrets: [MP_TOKEN] }, async (req, res) => {
  // ===== CORS (necessário pro browser chamar a function) =====
  // Para teste local, "*" resolve.
  // Em produção, troque por "https://SEU-DOMINIO".
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }
  // ===========================================================

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
    });

    const mpClient = new MercadoPagoConfig({
      accessToken: MP_TOKEN.value(),
    });

    const preference = new Preference(mpClient);

    const WEBHOOK_URL =
      "https://us-central1-giovannaerodrigo-c8404.cloudfunctions.net/mercadoPagoWebhook";

    const SUCCESS_URL = "http://localhost:5500/success.html";
    const FAILURE_URL = "http://localhost:5500/failure.html";
    const PENDING_URL = "http://localhost:5500/pending.html";

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
        back_urls: {
          success: SUCCESS_URL,
          failure: FAILURE_URL,
          pending: PENDING_URL,
        },
        notification_url: WEBHOOK_URL,
        auto_return: "approved",
      },
    });

    const initPoint = response?.init_point || response?.body?.init_point;

    if (!initPoint) {
      // ⚠️ evita logger.error com objeto (estava sendo bloqueado por PolicyAgent)
      console.error(
        "Mercado Pago não retornou init_point:",
        JSON.stringify({ keys: Object.keys(response || {}) })
      );
      return res.status(502).json({ error: "Mercado Pago não retornou init_point" });
    }

    return res.status(200).json({
      init_point: initPoint,
    });
  } catch (error) {
    // ⚠️ evita logger.error com objeto/erro rico (estava sendo bloqueado por PolicyAgent)
    const safe = {
      name: String(error?.name || ""),
      message: String(error?.message || ""),
      status: error?.status,
      code: error?.code,
      mpStatus: error?.response?.status,
      mpMessage: String(error?.response?.data?.message || ""),
    };

    console.error("createPreference failed:", JSON.stringify(safe));
    return res.status(500).json({ error: "Erro interno" });
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

      // x-signature vem tipo: "ts=1700000000,v1=abcdef..."
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

      // manifest conforme doc do MP
      const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;

      const expected = crypto
        .createHmac("sha256", secret)
        .update(manifest)
        .digest("hex");

      if (expected !== v1) {
        return res.status(401).send("Assinatura inválida");
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

      const orderId = paymentData.metadata?.orderId;

      if (!orderId) {
        return res.status(400).send("OrderId ausente");
      }

      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        return res.status(404).send("Pedido não encontrado");
      }

      const order = orderSnap.data();

      if (order.status === "paid") {
        return res.status(200).send("Pedido já processado");
      }

      const productRef = db.collection("products").doc(order.productId);

      await db.runTransaction(async (transaction) => {
        const productSnap = await transaction.get(productRef);

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
            (Number(product.totalRevenueCents) || 0) + Number(order.priceCents),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.update(orderRef, {
          status: "paid",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return res.status(200).send("Pagamento processado");
    } catch (error) {
      // ⚠️ evita logger.error com objeto/erro rico (mesmo problema do PolicyAgent)
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
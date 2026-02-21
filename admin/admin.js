// C:\Users\sique\OneDrive\Área de Trabalho\gr\admin\admin.js

// ============================
// FIREBASE IMPORT (CDN Modular)
// ============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  getDocs,
  where,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================
// CONFIG DO SEU PROJETO
// ============================

const firebaseConfig = {
  apiKey: "AIzaSyBb5Mm2CY8dLOYzinrUPUZNGqGscTfSIbo",
  authDomain: "giovannaerodrigo-c8404.firebaseapp.com",
  projectId: "giovannaerodrigo-c8404",
  storageBucket: "giovannaerodrigo-c8404.firebasestorage.app",
  messagingSenderId: "358915099011",
  appId: "1:358915099011:web:6eabfe5e4d8bed9f5c0eb6",
  measurementId: "G-WM4ZH6X62Z"
};

// ============================
// INICIALIZAÇÃO
// ============================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================
// ADMIN ALLOWLIST (igual às Rules)
// ============================

const ADMIN_EMAILS = new Set([
  "rodrigoh200@icloud.com",
  "giovannabeia@hotmail.com"
]);

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.has(String(email).toLowerCase());
}

function formatBRLFromCents(priceCents) {
  const value = Number(priceCents || 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function priceToCents(priceStrOrNum) {
  // Aceita "199.90" / "199,90" / 199.9
  const raw = String(priceStrOrNum ?? "").replace(",", ".").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function padErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Senha inválida.";
  }
  if (code.includes("auth/user-not-found")) {
    return "Usuário não encontrado.";
  }
  if (code.includes("auth/too-many-requests")) {
    return "Muitas tentativas. Tente novamente em alguns minutos.";
  }
  if (code.includes("auth/network-request-failed")) {
    return "Falha de rede. Verifique sua conexão.";
  }
  return "Não foi possível concluir. Verifique os dados e tente novamente.";
}

// ============================
// LOGIN
// ============================

const loginForm = document.getElementById("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const emailEl = document.getElementById("email");
    const passwordEl = document.getElementById("password");
    const errorEl = document.getElementById("error-message");

    const email = emailEl?.value?.trim() || "";
    const password = passwordEl?.value || "";

    errorEl.textContent = "";

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Guard extra: mesmo logando, só deixa entrar se estiver na allowlist
      const userEmail = cred?.user?.email || "";
      if (!isAdminEmail(userEmail)) {
        await signOut(auth);
        errorEl.textContent = "Acesso negado (conta não autorizada).";
        return;
      }

      window.location.href = "./produtos.html";
    } catch (error) {
      errorEl.textContent = padErrorMessage(error);
    }
  });
}

// ============================
// PAINEL (PRODUTOS)
// ============================

const isProductsPage = window.location.pathname.includes("produtos.html");

if (isProductsPage) {
  const PAGE_SIZE = 6;

  const panelError = document.getElementById("panel-error");

  const tbody = document.getElementById("products-tbody");
  const emptyState = document.getElementById("products-empty");
  const tableSubtitle = document.getElementById("table-subtitle");

  const metricProducts = document.getElementById("metric-products");
  const metricSold = document.getElementById("metric-sold");
  const metricRevenue = document.getElementById("metric-revenue");

  const searchInput = document.getElementById("search-input");

  const btnLogout = document.getElementById("logout");
  const btnOpenModal = document.getElementById("btn-open-modal");
  const btnCloseModal = document.getElementById("btn-close-modal");
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("product-modal");

  const modalTitle = document.getElementById("modal-title");
  const modalError = document.getElementById("modal-error");

  const form = document.getElementById("product-form");
  const productIdEl = document.getElementById("product-id");
  const titleEl = document.getElementById("product-title");
  const priceEl = document.getElementById("product-price");
  const stockEl = document.getElementById("product-stock");
  const imageEl = document.getElementById("product-image");
  const activeEl = document.getElementById("product-active");
  const priorityEl = document.getElementById("product-priority");

  const btnCancelEdit = document.getElementById("btn-cancel-edit");

  // paginação UI
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const pageIndicator = document.getElementById("page-indicator");

  let allProducts = []; // página atual (ou resultados de busca global)
  let filteredProducts = [];
  let searchTimer = null;

  // busca global
  let isSearchMode = false;
  let searchResults = [];

  // cursores
  let currentPage = 1;
  let firstVisible = null;
  let lastVisible = null;
  let canGoPrev = false;
  let canGoNext = false;

  // direção: "initial" | "next" | "prev"
  let direction = "initial";

  // unsubscribe do listener atual
  let pageUnsub = null;

  // unsubscribe do listener de métricas (vendas/receita)
  let metricsUnsub = null;

  // garante estado inicial fechado
  overlay.hidden = true;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");

  function setPanelError(msg) {
    if (!panelError) return;
    panelError.textContent = msg || "";
  }

  function setPaginationUI() {
    if (pageIndicator) pageIndicator.textContent = `Página ${currentPage}`;
    if (btnPrev) btnPrev.disabled = !canGoPrev;
    if (btnNext) btnNext.disabled = !canGoNext;
  }

  function unsubscribePage() {
    if (typeof pageUnsub === "function") {
      pageUnsub();
      pageUnsub = null;
    }
  }

  function unsubscribeMetrics() {
    if (typeof metricsUnsub === "function") {
      metricsUnsub();
      metricsUnsub = null;
    }
  }

  function resetToPage1() {
    direction = "initial";
    currentPage = 1;
    firstVisible = null;
    lastVisible = null;
    canGoPrev = false;
    canGoNext = false;
    setPaginationUI();
  }

  async function refreshActiveCount() {
    // Conta SOMENTE os ativos no banco inteiro
    try {
      const qCount = query(collection(db, "products"), where("active", "==", true));
      const snap = await getCountFromServer(qCount);
      const totalActive = snap.data().count;
      metricProducts.textContent = String(totalActive);
    } catch {
      // se falhar, mantém o que estiver e não quebra UX
    }
  }

  function subscribeSalesMetrics() {
    unsubscribeMetrics();

    // estado inicial (enquanto carrega)
    if (metricSold) metricSold.textContent = "0";
    if (metricRevenue) metricRevenue.textContent = formatBRLFromCents(0);

    // ✅ pedidos pagos (painel em tempo real)
    // Obs: isso pode exigir índice composto (status + paidAt).
    const qPaid = query(
      collection(db, "orders"),
      where("status", "==", "paid"),
      orderBy("paidAt", "desc"),
      limit(2000)
    );

    metricsUnsub = onSnapshot(
      qPaid,
      (snap) => {
        let sold = 0;
        let revenueCents = 0;

        snap.forEach((docSnap) => {
          const o = docSnap.data() || {};
          sold += 1;
          revenueCents += Number(o.priceCents || 0);
        });

        if (metricSold) metricSold.textContent = String(sold);
        if (metricRevenue) metricRevenue.textContent = formatBRLFromCents(revenueCents);
      },
      (err) => {
        console.error("metrics snapshot failed:", err);
        if (metricSold) metricSold.textContent = "—";
        if (metricRevenue) metricRevenue.textContent = "—";
        setPanelError("Não foi possível carregar métricas (vendas/arrecadado).");
      }
    );
  }

  function openModal(mode = "create") {
    modalError.textContent = "";

    if (mode === "create") {
      modalTitle.textContent = "Adicionar produto";
      productIdEl.value = "";
      titleEl.value = "";
      priceEl.value = "";
      stockEl.value = "";
      imageEl.value = "";
      activeEl.checked = true;
      btnCancelEdit.hidden = true;
    }

    overlay.hidden = false;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");

    setTimeout(() => titleEl.focus(), 50);
  }

  function closeModal() {
    modalError.textContent = "";
    overlay.hidden = true;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function renderRows(list) {
    tbody.innerHTML = "";

    if (!list.length) {
      emptyState.hidden = false;
      tableSubtitle.textContent = "0 itens";
      return;
    }

    emptyState.hidden = true;
    tableSubtitle.textContent = `${list.length} item(ns)`;

    const frag = document.createDocumentFragment();

    for (const p of list) {
      const tr = document.createElement("tr");

      const titleTd = document.createElement("td");
      titleTd.textContent = p.title || "(sem nome)";

      const priceTd = document.createElement("td");
      priceTd.textContent = formatBRLFromCents(p.priceCents);

      const stockTd = document.createElement("td");
      stockTd.textContent = String(p.stock ?? 0);

      const statusTd = document.createElement("td");
      const tag = document.createElement("span");
      tag.className = `tag ${p.active ? "tag-on" : "tag-off"}`;
      tag.textContent = p.active ? "Ativo" : "Inativo";
      statusTd.appendChild(tag);

      const actionsTd = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn-mini";
      btnEdit.type = "button";
      btnEdit.textContent = "Editar";
      btnEdit.addEventListener("click", () => {
        modalTitle.textContent = "Editar produto";
        productIdEl.value = p.id;
        titleEl.value = p.title || "";
        priceEl.value = ((Number(p.priceCents || 0) / 100).toFixed(2));
        stockEl.value = String(p.stock ?? 0);
        imageEl.value = p.imageUrl || "";
        activeEl.checked = !!p.active;
        btnCancelEdit.hidden = false;
        openModal("edit");
      });

      const btnToggle = document.createElement("button");
      btnToggle.className = "btn-mini";
      btnToggle.type = "button";
      btnToggle.textContent = p.active ? "Desativar" : "Ativar";
      btnToggle.addEventListener("click", async () => {
        setPanelError("");
        try {
          await updateDoc(doc(db, "products", p.id), {
            active: !p.active,
            updatedAt: serverTimestamp()
          });

          await refreshActiveCount();

          // ✅ se estiver buscando, re-busca e re-renderiza sem refresh
          if (isSearchMode) {
            await enterSearchMode(searchInput?.value || "");
          }
        } catch {
          setPanelError("Não foi possível alterar status.");
        }
      });

      const btnDelete = document.createElement("button");
      btnDelete.className = "btn-mini btn-danger";
      btnDelete.type = "button";
      btnDelete.textContent = "Excluir";
      btnDelete.addEventListener("click", async () => {
        const ok = confirm(`Excluir "${p.title}"? Essa ação não pode ser desfeita.`);
        if (!ok) return;

        setPanelError("");
        try {
          await deleteDoc(doc(db, "products", p.id));

          await refreshActiveCount();

          // ✅ se estiver buscando, re-busca e re-renderiza sem refresh
          if (isSearchMode) {
            await enterSearchMode(searchInput?.value || "");
          }
        } catch {
          setPanelError("Não foi possível excluir o produto.");
        }
      });

      // Removidos: +1 estoque e -1 estoque (conforme pedido)
      actions.append(btnEdit, btnToggle, btnDelete);
      actionsTd.appendChild(actions);

      tr.append(titleTd, priceTd, stockTd, statusTd, actionsTd);
      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
  }

  function applyFilter(term) {
    const t = (term || "").trim().toLowerCase();

    if (!t) {
      filteredProducts = [...allProducts];
    } else {
      filteredProducts = allProducts.filter((p) => {
        const title = String(p.title || "").toLowerCase();
        return title.includes(t);
      });
    }

    renderRows(filteredProducts);
  }

  async function checkNextPageExists() {
    if (!lastVisible) return false;

    try {
      const qNext = query(
        collection(db, "products"),
        orderBy("createdAt", "desc"),
        startAfter(lastVisible),
        limit(1)
      );
      const nextSnap = await getDocs(qNext);
      return !nextSnap.empty;
    } catch {
      return false;
    }
  }

  function subscribePage() {
    unsubscribePage();
    setPanelError("");

    let q;

    if (direction === "initial") {
      q = query(collection(db, "products"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    } else if (direction === "next") {
      if (!lastVisible) {
        resetToPage1();
        return subscribePage();
      }
      q = query(
        collection(db, "products"),
        orderBy("createdAt", "desc"),
        startAfter(lastVisible),
        limit(PAGE_SIZE)
      );
    } else {
      // prev
      if (!firstVisible) {
        resetToPage1();
        return subscribePage();
      }
      q = query(
        collection(db, "products"),
        orderBy("createdAt", "desc"),
        endBefore(firstVisible),
        limitToLast(PAGE_SIZE)
      );
    }

    pageUnsub = onSnapshot(
      q,
      async (snap) => {
        const docs = snap.docs;

        firstVisible = docs[0] || null;
        lastVisible = docs[docs.length - 1] || null;

        allProducts = docs.map((d) => ({ id: d.id, ...d.data() }));
        applyFilter(searchInput?.value || "");

        canGoPrev = currentPage > 1;
        canGoNext = await checkNextPageExists();

        setPaginationUI();
      },
      () => setPanelError("Não foi possível carregar os produtos.")
    );

    setPaginationUI();
  }

  // ============================
  // BUSCA GLOBAL
  // ============================

  async function enterSearchMode(term) {
    const t = (term || "").trim();

    if (!t) return;

    isSearchMode = true;

    unsubscribePage();
    canGoPrev = false;
    canGoNext = false;

    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;

    if (pageIndicator) pageIndicator.textContent = "Resultados";

    try {
      const qAll = query(
        collection(db, "products"),
        orderBy("createdAt", "desc"),
        limit(500)
      );

      const snap = await getDocs(qAll);
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const needle = t.toLowerCase();
      searchResults = all.filter((p) => String(p.title || "").toLowerCase().includes(needle));

      allProducts = searchResults;
      applyFilter("");
    } catch {
      setPanelError("Não foi possível realizar a busca global.");
    }
  }

  function exitSearchMode() {
    isSearchMode = false;
    searchResults = [];

    resetToPage1();
    subscribePage();
  }

  // Modal events
  btnOpenModal?.addEventListener("click", () => openModal("create"));
  btnCloseModal?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (modal && !modal.hidden && e.key === "Escape") closeModal();
  });

  btnCancelEdit?.addEventListener("click", () => {
    closeModal();
    openModal("create");
  });

  // Search (global, com debounce)
  searchInput?.addEventListener("input", (e) => {
    const value = e.target.value;

    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const term = (value || "").trim();

      if (!term) {
        if (isSearchMode) exitSearchMode();
        return;
      }

      await enterSearchMode(term);
    }, 180);
  });

  // Paginação
  btnNext?.addEventListener("click", () => {
    if (isSearchMode) return;
    if (!canGoNext) return;
    direction = "next";
    currentPage += 1;
    subscribePage();
  });

  btnPrev?.addEventListener("click", () => {
    if (isSearchMode) return;
    if (!canGoPrev) return;
    direction = "prev";
    currentPage = Math.max(1, currentPage - 1);
    subscribePage();
  });

  // Logout
  btnLogout?.addEventListener("click", async () => {
    unsubscribePage();
    unsubscribeMetrics();
    await signOut(auth);
    window.location.href = "./login.html";
  });

  // Guard + Load firestore
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const email = user.email || "";
    if (!isAdminEmail(email)) {
      await signOut(auth);
      window.location.href = "./login.html";
      return;
    }

    metricSold.textContent = "—";
    metricRevenue.textContent = "—";

    await refreshActiveCount();
    subscribeSalesMetrics();

    resetToPage1();
    subscribePage();
  });

  // Create / Update product
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    modalError.textContent = "";
    setPanelError("");

    const id = productIdEl.value.trim();
    const title = titleEl.value.trim();
    const priceCents = priceToCents(priceEl.value);
    const stock = Number(String(stockEl.value).trim());
    const imageUrl = imageEl.value.trim();
    const active = !!activeEl.checked;

    if (!title) {
      modalError.textContent = "Informe o nome do produto.";
      return;
    }
    if (priceCents === null || priceCents <= 0) {
      modalError.textContent = "Informe um preço válido (maior que 0).";
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      modalError.textContent = "Informe um estoque válido (0 ou maior).";
      return;
    }

    try {
      if (!id) {
        await addDoc(collection(db, "products"), {
          title,
          priceCents,
          stock,
          active,
          imageUrl: imageUrl || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        closeModal();
        await refreshActiveCount();

        // se estiver em modo busca, re-busca para refletir imediatamente
        if (isSearchMode) {
          await enterSearchMode(searchInput?.value || "");
          return;
        }

        resetToPage1();
        subscribePage();
        return;
      }

      // update
      await updateDoc(doc(db, "products", id), {
        title,
        priceCents,
        stock,
        active,
        imageUrl: imageUrl || "",
        updatedAt: serverTimestamp()
      });

      closeModal();
      await refreshActiveCount();

      // ✅ se estiver em modo busca, re-busca e re-renderiza sem refresh
      if (isSearchMode) {
        await enterSearchMode(searchInput?.value || "");
        return;
      }

      applyFilter(searchInput?.value || "");
    } catch {
      modalError.textContent =
        "Não foi possível salvar. Verifique permissões e tente novamente.";
    }
  });
}
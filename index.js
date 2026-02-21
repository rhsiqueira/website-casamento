// =========================
// MENU MOBILE (HAMBÚRGUER)
// =========================

const body = document.body;

const menuBtn = document.querySelector(".menu-btn");
const closeBtn = document.querySelector(".close-btn");
const mobileMenu = document.querySelector(".mobile-menu");
const overlay = document.querySelector(".overlay");
const mobileLinks = document.querySelectorAll(".mobile-list a");

function openMenu() {
  if (!menuBtn || !overlay || !mobileMenu) return;

  body.classList.add("is-open");
  overlay.hidden = false;

  menuBtn.setAttribute("aria-expanded", "true");
  mobileMenu.setAttribute("aria-hidden", "false");
}

function closeMenu() {
  if (!menuBtn || !overlay || !mobileMenu) return;

  body.classList.remove("is-open");

  menuBtn.setAttribute("aria-expanded", "false");
  mobileMenu.setAttribute("aria-hidden", "true");

  // espera o fade-out terminar pra esconder o overlay
  setTimeout(() => {
    if (!body.classList.contains("is-open")) overlay.hidden = true;
  }, 260);
}

menuBtn?.addEventListener("click", openMenu);
closeBtn?.addEventListener("click", closeMenu);
overlay?.addEventListener("click", closeMenu);

mobileLinks.forEach((link) => {
  link.addEventListener("click", closeMenu);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

// =========================
// CONTAGEM REGRESSIVA
// Evento: 23/05/2026 às 17:30
// =========================

const cdDays = document.getElementById("cd-days");
const cdHours = document.getElementById("cd-hours");
const cdMinutes = document.getElementById("cd-minutes");
const cdSeconds = document.getElementById("cd-seconds");

const EVENT_DATE_STR = "23/05/2026 17:30";

function parseBRDateTime(dateTimeStr) {
  // "DD/MM/YYYY HH:mm"
  const [datePart, timePart] = dateTimeStr.split(" ");
  const [dd, mm, yyyy] = datePart.split("/").map(Number);
  const [hh, min] = timePart.split(":").map(Number);

  // Data local do usuário
  return new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

const targetDate = parseBRDateTime(EVENT_DATE_STR);

function updateCountdown() {
  if (!cdDays || !cdHours || !cdMinutes || !cdSeconds) return;

  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();

  if (diff <= 0) {
    cdDays.textContent = "00";
    cdHours.textContent = "00";
    cdMinutes.textContent = "00";
    cdSeconds.textContent = "00";
    return;
  }

  const totalSeconds = Math.floor(diff / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  cdDays.textContent = pad2(days);
  cdHours.textContent = pad2(hours);
  cdMinutes.textContent = pad2(minutes);
  cdSeconds.textContent = pad2(seconds);
}

updateCountdown();
setInterval(updateCountdown, 1000);

// =====================================================
// PRESENTES - PUXAR DO FIRESTORE + ORDENAR + VER MAIS
// =====================================================
//
// IMPORTANTE:
// Para este trecho funcionar, o index.js precisa ser carregado como MODULE.
// No index.html, troque:
//   <script src="./index.js" defer></script>
// por:
//   <script type="module" src="./index.js"></script>
//
// Se você não trocar, o "import ..." abaixo não funciona.
// =====================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================
// CONFIG DO SEU PROJETO
// (público, ok ficar no front)
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================
// ELEMENTOS DA UI
// ============================

const presentesGrid = document.getElementById("presentes-grid");
const presentesMoreBtn = document.getElementById("presentes-more");
const presentesSort = document.getElementById("presentes-sort");

// ============================
// ENDPOINT BACKEND (Cloud Function)
// ============================
// ✅ Mude SOMENTE se sua URL mudar no Firebase Deploy:
const CREATE_PREFERENCE_URL = "https://createpreference-flf5exmuxa-uc.a.run.app";

// ============================
// ESTADO
// ============================

// ✅ conforme definido:
// - padrão: 6 cards
// - clicar em "Ver mais": +3 cards por clique
const INITIAL_SIZE = 6;
const MORE_SIZE = 3;

const FETCH_BATCH = 30; // busca "um pouco mais" pra filtrar ativos/estoque sem travar

let currentSort = presentesSort?.value || "cheap";
let lastDocCursor = null;
let isLoading = false;
let hasMore = true;

// ✅ controla se é a primeira carga (padrão 6)
let isFirstLoad = true;

// ✅ buffer para não "pular" itens válidos entre cliques
let pendingProducts = [];

// Placeholder transparente (evita ícone de imagem quebrada)
const TRANSPARENT_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function formatBRLFromCents(priceCents) {
  const value = Number(priceCents || 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getOrderForSort(sortKey) {
  switch (sortKey) {
    case "expensive":
      return { field: "priceCents", dir: "desc" };
    case "newest":
      return { field: "createdAt", dir: "desc" };
    case "oldest":
      return { field: "createdAt", dir: "asc" };
    case "cheap":
    default:
      return { field: "priceCents", dir: "asc" };
  }
}

function clearGrid() {
  if (!presentesGrid) return;
  presentesGrid.innerHTML = "";
}

function setMoreEnabled(enabled) {
  if (!presentesMoreBtn) return;
  presentesMoreBtn.disabled = !enabled;
  presentesMoreBtn.style.opacity = enabled ? "1" : "0.6";
  presentesMoreBtn.style.cursor = enabled ? "pointer" : "not-allowed";
}

function createCard(product) {
  const article = document.createElement("article");
  article.className = "presente-card";

  const imgWrap = document.createElement("div");
  imgWrap.className = "presente-card-img";

  const img = document.createElement("img");
  const url = (product.imageUrl || "").trim();
  img.src = url || TRANSPARENT_IMG;
  img.alt = url ? `Imagem do produto: ${product.title || "Presente"}` : "";
  if (!url) img.setAttribute("aria-hidden", "true");

  imgWrap.appendChild(img);

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "presente-card-body";

  const title = document.createElement("h3");
  title.className = "presente-card-title";
  title.textContent = product.title || "(sem nome)";

  const price = document.createElement("p");
  price.className = "presente-card-price";
  price.textContent = formatBRLFromCents(product.priceCents);

  const btn = document.createElement("button");
  btn.className = "presente-card-btn";
  btn.type = "button";
  btn.textContent = "Presentear";

  // ✅ ÚNICA MUDANÇA NECESSÁRIA: chamar o backend e redirecionar pro MP
  btn.addEventListener("click", async () => {
    const originalText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = "Redirecionando...";

      const resp = await fetch(CREATE_PREFERENCE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id })
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        alert(data?.error || "Erro ao iniciar pagamento");
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      if (!data?.init_point) {
        alert("Checkout não retornou o link de pagamento (init_point).");
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      // Redireciona na mesma aba (mais simples e mais confiável no mobile)
      window.location.href = data.init_point;
    } catch (err) {
      console.error(err);
      alert("Erro inesperado ao iniciar pagamento.");
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  bodyDiv.append(title, price, btn);
  article.append(imgWrap, bodyDiv);

  return article;
}

function appendProducts(list) {
  if (!presentesGrid) return;

  const frag = document.createDocumentFragment();
  list.forEach((p) => frag.appendChild(createCard(p)));
  presentesGrid.appendChild(frag);
}

function consumePending(take) {
  if (!pendingProducts.length || take <= 0) return [];
  return pendingProducts.splice(0, take);
}

async function fetchBatchIntoPending() {
  const { field, dir } = getOrderForSort(currentSort);

  let q = query(
    collection(db, "products"),
    orderBy(field, dir),
    limit(FETCH_BATCH)
  );

  if (lastDocCursor) {
    q = query(
      collection(db, "products"),
      orderBy(field, dir),
      startAfter(lastDocCursor),
      limit(FETCH_BATCH)
    );
  }

  const snap = await getDocs(q);

  if (snap.empty) {
    hasMore = false;
    return;
  }

  // atualiza cursor sempre pro último doc do batch
  lastDocCursor = snap.docs[snap.docs.length - 1];

  // filtra: somente ativos e com estoque > 0 (estoque 0 some do site)
  const batch = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const filtered = batch.filter((p) => p.active === true && Number(p.stock || 0) > 0);

  // adiciona no buffer (sem pular itens entre cliques)
  if (filtered.length) pendingProducts.push(...filtered);

  // se veio menos do que o limite, provavelmente acabou o banco
  hasMore = snap.size === FETCH_BATCH;
}

async function fetchNextPage(requestSize) {
  if (!presentesGrid || isLoading) return;

  // Se ainda tem itens no buffer, apenas renderiza o necessário
  const fromBuffer = consumePending(requestSize);
  if (fromBuffer.length) {
    appendProducts(fromBuffer);
    setMoreEnabled(hasMore || pendingProducts.length > 0);
    return;
  }

  // Se não tem mais no banco e buffer vazio, desliga o botão
  if (!hasMore) {
    setMoreEnabled(false);
    return;
  }

  isLoading = true;
  setMoreEnabled(false);

  try {
    // Garante que teremos ao menos requestSize itens válidos no buffer (ou conclui que acabou)
    let tries = 0;
    const MAX_TRIES = 6;

    while (pendingProducts.length < requestSize && hasMore && tries < MAX_TRIES) {
      tries += 1;
      await fetchBatchIntoPending();
    }

    const toRender = consumePending(requestSize);

    if (!toRender.length) {
      // Não encontrou mais itens válidos (ativos + estoque) após tentar buscar
      hasMore = false;
      setMoreEnabled(false);
      return;
    }

    appendProducts(toRender);

    // Botão fica habilitado se ainda há docs no banco OU itens no buffer
    setMoreEnabled(hasMore || pendingProducts.length > 0);
  } catch (err) {
    console.error(err);
    hasMore = false;
    setMoreEnabled(false);
  } finally {
    isLoading = false;
  }
}

async function resetAndLoad() {
  clearGrid();
  lastDocCursor = null;
  hasMore = true;
  pendingProducts = [];
  isFirstLoad = true;
  setMoreEnabled(true);

  // ✅ primeira carga: 6 cards
  await fetchNextPage(INITIAL_SIZE);
  isFirstLoad = false;
}

// Eventos UI
presentesSort?.addEventListener("change", async (e) => {
  currentSort = e.target.value || "cheap";
  await resetAndLoad();
});

presentesMoreBtn?.addEventListener("click", async () => {
  // ✅ clique: +3 cards
  await fetchNextPage(MORE_SIZE);
});

// Inicialização (só se a seção existir na página)
if (presentesGrid) {
  resetAndLoad();
}

// =====================================================
// AJUSTE NECESSÁRIO NO card.html (POR CONTA DO JS)
// =====================================================
//
// O seu card.html atual está com 6 cards fixos.
// Para o JS preencher dinamicamente, ele precisa estar assim:
//
// - o grid precisa ser: <div id="presentes-grid" class="presentes-grid"></div>
// - o botão precisa ter: id="presentes-more"
// - NÃO deve ter cards hardcoded dentro do grid
//
// Obs: seu index.html já está no formato certo.
// =====================================================
(() => {
  const DESKTOP_PHOTOS_PER_PAGE = 9;
  const MOBILE_PHOTOS_PER_PAGE = 6;
  const MOBILE_BREAKPOINT = 768;

  const GALERIA_ARQUIVOS = [
    "GR (4).jpg",
    "GR (17).jpg",
    "GR (18).jpg",
    "GR (19).jpg",
    "GR (20).jpg",
    "GR (21).jpg",
    "GR (22).jpg",
    "GR (23).jpg",
    "GR (24).jpg",
    "GR (26).jpg",
    "GR (27).jpg",
    "GR (28).jpg",
    "GR (34).jpg",
    "GR (35).jpg",
    "GR (36).jpg",
    "GR (37).jpg",
    "GR (38).jpg",
    "GR (39).jpg",
    "GR (40).jpg",
    "GR (41).jpg",
    "GR (45).jpg",
    "GR (46).jpg",
    "GR (53).jpg",
    "GR (55).jpg",
    "GR (65).jpg",
    "GR (72).jpg",
    "GR (73).jpg",
    "GR (74).jpg",
    "GR (75).jpg",
    "GR (79).jpg",
    "GR (81).jpg",
    "GR (82).jpg",
    "GR (86).jpg",
    "GR (88).jpg",
    "GR (89).jpg",
    "GR (92).jpg",
    "GR (94).jpg",
    "GR (96).jpg",
    "GR (97).jpg",
    "GR (99).jpg",
    "GR (100).jpg",
    "GR (116).jpg",
    "GR (122).jpg",
    "GR (123).jpg",
    "GR (124).jpg",
    "GR (125).jpg",
    "GR (143).jpg",
    "GR (144).jpg",
    "GR (145).jpg",
    "GR (146).jpg",
    "GR (147).jpg",
    "GR (148).jpg",
    "GR (149).jpg",
    "GR (150).jpg",
    "GR (151).jpg",
    "GR (152).jpg",
    "GR (153).jpg",
    "GR (157).jpg",
    "GR (159).jpg",
    "GR (160).jpg",
    "GR (166).jpg",
    "GR (167).jpg",
    "GR (175).jpg",
    "GR (176).jpg",
    "GR (178).jpg",
    "GR (179).jpg",
    "GR (182).jpg",
    "GR (184).jpg",
    "GR (185).jpg",
    "GR (192).jpg",
    "GR (193).jpg",
    "GR (194).jpg",
    "GR (195).jpg",
    "GR (197).jpg",
    "GR (198).jpg",
    "GR (201).jpg",
    "GR (202).jpg",
    "GR (207).jpg",
    "GR (209).jpg",
    "GR (213).jpg",
    "GR (214).jpg",
    "GR (219).jpg",
    "GR (221).jpg",
    "GR (223).jpg",
    "GR (224).jpg",
    "GR (248).jpg",
    "GR (249).jpg",
    "GR (254).jpg",
    "GR (259).jpg",
    "GR (260).jpg",
    "GR (263).jpg",
    "GR (264).jpg",
    "GR (265).jpg",
    "GR (269).jpg"
  ];

  const GALERIA_IMAGENS = GALERIA_ARQUIVOS.map((fileName) => ({
    thumb: `./img/galeria/thumbs/${fileName}`,
    full: `./img/galeria/${fileName}`
  }));

  const grid = document.getElementById("galeria-grid");
  const prevBtn = document.getElementById("galeria-prev");
  const nextBtn = document.getElementById("galeria-next");
  const pageIndicator = document.getElementById("galeria-page-indicator");

  const modal = document.getElementById("galeria-modal");
  const modalOverlay = document.getElementById("galeria-modal-overlay");
  const modalImage = document.getElementById("galeria-modal-image");
  const modalCloseBtn = document.getElementById("galeria-modal-close");
  const modalPrevBtn = document.getElementById("galeria-modal-prev");
  const modalNextBtn = document.getElementById("galeria-modal-next");

  if (
    !grid ||
    !prevBtn ||
    !nextBtn ||
    !pageIndicator ||
    !modal ||
    !modalOverlay ||
    !modalImage ||
    !modalCloseBtn ||
    !modalPrevBtn ||
    !modalNextBtn
  ) {
    return;
  }

  const totalPhotos = GALERIA_IMAGENS.length;

  let currentPage = 1;
  let currentModalIndex = 0;
  let lastViewportMode = getViewportMode();

  function getViewportMode() {
    return window.innerWidth <= MOBILE_BREAKPOINT ? "mobile" : "desktop";
  }

  function getPhotosPerPage() {
    return window.innerWidth <= MOBILE_BREAKPOINT
      ? MOBILE_PHOTOS_PER_PAGE
      : DESKTOP_PHOTOS_PER_PAGE;
  }

  function getTotalPages() {
    return Math.ceil(totalPhotos / getPhotosPerPage());
  }

  function getAltText(index) {
    return `Foto ${index + 1} do ensaio de Giovanna e Rodrigo`;
  }

  function createCard(imageData, absoluteIndex) {
    const card = document.createElement("button");
    card.className = "galeria-card";
    card.type = "button";
    card.setAttribute("aria-label", `Ampliar ${getAltText(absoluteIndex)}`);

    const frame = document.createElement("div");
    frame.className = "galeria-card-frame";

    const skeleton = document.createElement("div");
    skeleton.className = "galeria-skeleton";

    const img = document.createElement("img");
    img.className = "galeria-card-img";
    img.alt = getAltText(absoluteIndex);
    img.loading = "lazy";
    img.decoding = "async";

    let skeletonRemoved = false;

    function removeSkeleton() {
      if (skeletonRemoved) return;
      skeletonRemoved = true;
      if (skeleton.parentNode) {
        skeleton.remove();
      }
    }

    img.addEventListener("load", () => {
      img.classList.add("is-loaded");
      removeSkeleton();
    });

    img.addEventListener("error", () => {
      // fallback: se thumb falhar, tenta a imagem full
      if (img.dataset.fallbackApplied === "true") {
        removeSkeleton();
        frame.style.background = "#e8dede";
        return;
      }

      img.dataset.fallbackApplied = "true";
      img.src = imageData.full;
    });

    card.addEventListener("click", () => {
      openModal(absoluteIndex);
    });

    img.src = imageData.thumb;

    frame.appendChild(skeleton);
    frame.appendChild(img);
    card.appendChild(frame);

    return card;
  }

  function renderPage(page) {
    const totalPages = getTotalPages();
    currentPage = Math.max(1, Math.min(page, totalPages));

    grid.innerHTML = "";

    const perPage = getPhotosPerPage();
    const start = (currentPage - 1) * perPage;
    const end = Math.min(start + perPage, totalPhotos);

    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i += 1) {
      fragment.appendChild(createCard(GALERIA_IMAGENS[i], i));
    }

    grid.appendChild(fragment);
    updatePaginationUI();
  }

  function updatePaginationUI() {
    const totalPages = getTotalPages();
    pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
  }

  function updateModalImage() {
    const currentImage = GALERIA_IMAGENS[currentModalIndex];

    modalImage.src = currentImage.full;
    modalImage.alt = getAltText(currentModalIndex);

    modalPrevBtn.disabled = currentModalIndex === 0;
    modalNextBtn.disabled = currentModalIndex === totalPhotos - 1;
  }

  function openModal(index) {
    currentModalIndex = index;
    updateModalImage();

    modal.hidden = false;
    modalOverlay.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("galeria-modal-open");
  }

  function closeModal() {
    modal.hidden = true;
    modalOverlay.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("galeria-modal-open");
  }

  function showPreviousPage() {
    if (currentPage <= 1) return;
    renderPage(currentPage - 1);
  }

  function showNextPage() {
    if (currentPage >= getTotalPages()) return;
    renderPage(currentPage + 1);
  }

  function showPreviousModalImage() {
    if (currentModalIndex <= 0) return;
    currentModalIndex -= 1;
    updateModalImage();
  }

  function showNextModalImage() {
    if (currentModalIndex >= totalPhotos - 1) return;
    currentModalIndex += 1;
    updateModalImage();
  }

  prevBtn.addEventListener("click", showPreviousPage);
  nextBtn.addEventListener("click", showNextPage);

  modalCloseBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", closeModal);
  modalPrevBtn.addEventListener("click", showPreviousModalImage);
  modalNextBtn.addEventListener("click", showNextModalImage);

  document.addEventListener("keydown", (event) => {
    const isModalOpen = !modal.hidden;

    if (event.key === "Escape" && isModalOpen) {
      closeModal();
      return;
    }

    if (event.key === "ArrowLeft" && isModalOpen) {
      showPreviousModalImage();
      return;
    }

    if (event.key === "ArrowRight" && isModalOpen) {
      showNextModalImage();
    }
  });

  window.addEventListener("resize", () => {
    const currentViewportMode = getViewportMode();

    if (currentViewportMode === lastViewportMode) {
      return;
    }

    lastViewportMode = currentViewportMode;

    const totalPages = getTotalPages();
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    renderPage(currentPage);
  });

  renderPage(1);
})();
"use strict";

const PAGE_DIMENSIONS_MM = {
  a4:     { portrait: [210, 297], landscape: [297, 210] },
  letter: { portrait: [216, 279], landscape: [279, 216] },
  legal:  { portrait: [216, 356], landscape: [356, 216] },
};

const MARGIN_MM = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

function toJsPdfOrientation(orientation) {
  return orientation === "landscape" ? "l" : "p";
}

const state = {
  files: [],
  pageSize: "a4",
  orientation: "portrait",
  isConverting: false,
  dragId: null,
};

let nextId = 1;
const uid = () => `img-${nextId++}`;

const $ = (id) => document.getElementById(id);

const dropArea = $("drop-area");
const uploadInput = $("upload");
const optionsSection = $("options");
const previewSection = $("preview");
const previewList = $("preview-list");
const previewCount = $("preview-count");
const clearBtn = $("clear-btn");
const convertBtn = $("convert-btn");
const pageSizeSelect = $("page-size");
const statusEl = $("status");
const itemTemplate = $("preview-item-template");

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.classList.remove("is-error", "is-success");
  if (kind) statusEl.classList.add(`is-${kind}`);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatFromMime(mime) {
  if (mime === "image/png") return "PNG";
  if (mime === "image/webp") return "WEBP";
  return "JPEG";
}

function isImageFile(file) {
  return ACCEPTED_MIMES.has(file.type);
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Gambar tidak valid"));
    img.src = dataUrl;
  });
}

async function ingestFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const incoming = Array.from(fileList);
  const errors = [];
  let added = 0;

  const existingKeys = new Set(
    state.files.map((f) => `${f.name}:${f.size}`)
  );

  for (const file of incoming) {
    if (!isImageFile(file)) {
      errors.push(`${file.name}: format tidak didukung`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name}: ukuran > 20MB`);
      continue;
    }
    const key = `${file.name}:${file.size}`;
    if (existingKeys.has(key)) {
      errors.push(`${file.name}: sudah ada di daftar`);
      continue;
    }
    try {
      const dataUrl = await readAsDataURL(file);
      const { width, height } = await loadImageDimensions(dataUrl);
      state.files.push({
        id: uid(),
        name: file.name,
        size: file.size,
        dataUrl,
        width,
        height,
        format: formatFromMime(file.type),
      });
      existingKeys.add(key);
      added++;
    } catch (err) {
      errors.push(`${file.name}: ${err.message || "gagal membaca"}`);
    }
  }

  render();

  if (errors.length) {
    setStatus(`Sebagian file dilewati: ${errors.join("; ")}`, "error");
  } else if (added > 0) {
    setStatus("");
  }
}

function syncInputFiles() {
  try {
    const dt = new DataTransfer();
    state.files.forEach((entry) => dt.items.add(entry.nativeFile || new File([], entry.name)));
    uploadInput.files = dt.files;
  } catch (_) {
    // older browsers: silently ignore
  }
}

function render() {
  const hasFiles = state.files.length > 0;
  optionsSection.hidden = !hasFiles;
  previewSection.hidden = !hasFiles;
  convertBtn.disabled = !hasFiles || state.isConverting;
  previewCount.textContent = String(state.files.length);
  convertBtn.textContent = state.isConverting ? "Memproses..." : "Convert ke PDF";
  renderList();
}

function renderList() {
  previewList.innerHTML = "";
  state.files.forEach((entry, index) => {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = entry.id;
    if (state.dragId === entry.id) node.classList.add("is-dragging");

    const img = node.querySelector(".preview-item__thumb img");
    img.src = entry.dataUrl;
    img.alt = entry.name;
    node.querySelector(".preview-item__thumb").setAttribute("data-pos", String(index + 1));
    node.querySelector(".preview-item__name").textContent = entry.name;
    node.querySelector(".preview-item__size").textContent = `${fmtBytes(entry.size)} · ${entry.width}×${entry.height}`;
    previewList.appendChild(node);
  });
}

function moveItem(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= state.files.length) return;
  const [item] = state.files.splice(index, 1);
  state.files.splice(target, 0, item);
  render();
}

function removeItem(id) {
  state.files = state.files.filter((entry) => entry.id !== id);
  render();
  if (state.files.length === 0) setStatus("");
}

function clearAll() {
  state.files = [];
  state.dragId = null;
  render();
  setStatus("");
  syncInputFiles();
}

function getPageDims() {
  const dims = PAGE_DIMENSIONS_MM[state.pageSize][state.orientation];
  return { width: dims[0], height: dims[1] };
}

function addImageFitToPage(pdf, entry, pageW, pageH) {
  const availW = pageW - MARGIN_MM * 2;
  const availH = pageH - MARGIN_MM * 2;
  const imgRatio = entry.width / entry.height;
  const availRatio = availW / availH;

  let drawW, drawH;
  if (imgRatio > availRatio) {
    drawW = availW;
    drawH = availW / imgRatio;
  } else {
    drawH = availH;
    drawW = availH * imgRatio;
  }

  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  const compression = entry.format === "PNG" ? "NONE" : "MEDIUM";
  pdf.addImage(entry.dataUrl, entry.format, x, y, drawW, drawH, undefined, compression);
}

async function convertToPDF() {
  if (state.isConverting) return;
  if (state.files.length === 0) {
    setStatus("Pilih minimal satu gambar terlebih dahulu.", "error");
    return;
  }

  state.isConverting = true;
  render();
  setStatus("Membuat PDF...");

  try {
    const { jsPDF } = window.jspdf;
    const { width, height } = getPageDims();
    const orientation = toJsPdfOrientation(state.orientation);
    const pdf = new jsPDF({ unit: "mm", format: state.pageSize, orientation });

    state.files.forEach((entry, index) => {
      if (index > 0) pdf.addPage(state.pageSize, orientation);
      addImageFitToPage(pdf, entry, width, height);
    });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    pdf.save(`image-to-pdf-${ts}.pdf`);
    setStatus(`PDF berhasil diunduh (${state.files.length} halaman).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`Gagal membuat PDF: ${err.message || err}`, "error");
  } finally {
    state.isConverting = false;
    render();
  }
}

function initUploadZone() {
  dropArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      uploadInput.click();
    }
  });

  uploadInput.addEventListener("change", (e) => {
    const files = e.target.files;
    ingestFiles(files);
    e.target.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      dropArea.classList.add("is-dragover");
    });
  });

  ["dragleave", "dragend"].forEach((evt) => {
    dropArea.addEventListener(evt, (e) => {
      if (e.target === dropArea) dropArea.classList.remove("is-dragover");
    });
  });

  dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("is-dragover");
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length) {
      ingestFiles(files);
    }
  });
}

function initPreviewList() {
  previewList.addEventListener("click", (e) => {
    const item = e.target.closest(".preview-item");
    if (!item) return;
    const id = item.dataset.id;
    const index = state.files.findIndex((entry) => entry.id === id);
    if (index === -1) return;

    if (e.target.closest('[data-action="remove"]')) {
      removeItem(id);
      return;
    }
    const moveBtn = e.target.closest(".icon-btn--move");
    if (moveBtn) {
      moveItem(index, parseInt(moveBtn.dataset.dir, 10));
    }
  });

  previewList.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".preview-item");
    if (!item) return;
    state.dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", item.dataset.id); } catch (_) {}
    item.classList.add("is-dragging");
  });

  previewList.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".preview-item");
    if (!item) return;
    previewList.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    if (item.dataset.id !== state.dragId) item.classList.add("is-drop-target");
  });

  previewList.addEventListener("dragleave", (e) => {
    const item = e.target.closest(".preview-item");
    if (item) item.classList.remove("is-drop-target");
  });

  previewList.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetItem = e.target.closest(".preview-item");
    previewList.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    if (!targetItem || !state.dragId) return;

    const fromIndex = state.files.findIndex((entry) => entry.id === state.dragId);
    const toIndex = state.files.findIndex((entry) => entry.id === targetItem.dataset.id);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const [moved] = state.files.splice(fromIndex, 1);
    state.files.splice(toIndex, 0, moved);
    state.dragId = null;
    render();
  });

  previewList.addEventListener("dragend", () => {
    state.dragId = null;
    render();
  });
}

function initOptions() {
  pageSizeSelect.addEventListener("change", (e) => {
    state.pageSize = e.target.value;
  });

  document.querySelectorAll('input[name="orientation"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) state.orientation = e.target.value;
    });
  });

  clearBtn.addEventListener("click", clearAll);
  convertBtn.addEventListener("click", convertToPDF);
}

function init() {
  initUploadZone();
  initPreviewList();
  initOptions();
  initWordTab();
  render();
}

/* ==========================================================================
   Word → PDF Converter
   ========================================================================== */

const wordState = {
  file: null,
  pageSize: "a4",
  orientation: "portrait",
  isConverting: false,
};

const wordDropArea = $("word-drop-area");
const wordUpload = $("word-upload");
const wordInfo = $("word-info");
const wordName = $("word-name");
const wordSize = $("word-size");
const wordRemoveBtn = $("word-remove");
const wordOptions = $("word-options");
const wordConvertBtn = $("word-convert-btn");
const wordPageSizeSelect = $("word-page-size");
const wordStatus = $("word-status");
const panelImage = $("panel-image");
const panelWord = $("panel-word");
const tabImage = $("tab-image");
const tabWord = $("tab-word");

function setWordStatus(message, kind = "") {
  wordStatus.textContent = message || "";
  wordStatus.classList.remove("is-error", "is-success");
  if (kind) wordStatus.classList.add(`is-${kind}`);
}

async function ingestWordFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".docx")) {
    setWordStatus("Hanya file .docx yang didukung.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setWordStatus(`${file.name}: ukuran > 20MB`, "error");
    return;
  }

  wordState.file = file;

  wordName.textContent = file.name;
  wordSize.textContent = fmtBytes(file.size);
  wordInfo.hidden = false;
  wordOptions.hidden = false;
  wordConvertBtn.disabled = false;
  setWordStatus("File siap dikonversi.", "success");
}

function clearWord() {
  wordState.file = null;
  wordInfo.hidden = true;
  wordOptions.hidden = true;
  wordConvertBtn.disabled = true;
  wordUpload.value = "";
  setWordStatus("");
}

async function convertWordToPDF() {
  if (wordState.isConverting) return;
  if (!wordState.file) {
    setWordStatus("Pilih file .docx terlebih dahulu.", "error");
    return;
  }

  wordState.isConverting = true;
  wordConvertBtn.disabled = true;
  wordConvertBtn.textContent = "Memproses...";
  setWordStatus("Mengirim file ke server...");

  try {
    const formData = new FormData();
    formData.append("file", wordState.file);
    formData.append("pageSize", wordState.pageSize);
    formData.append("orientation", wordState.orientation);

    const response = await fetch("/api/word-to-pdf", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Gagal mengonversi (HTTP ${response.status})`;
      try {
        const data = await response.json();
        if (data && data.error) errorMsg = data.error;
      } catch (_) {}
      throw new Error(errorMsg);
    }

    setWordStatus("Mengonversi dengan LibreOffice...");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `${wordState.file.name.replace(/\.docx$/i, "")}-${ts}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setWordStatus("PDF berhasil diunduh.", "success");
  } catch (err) {
    console.error(err);
    if (err && err.message && (err.message.includes("Failed to fetch") || err.message.includes("NetworkError"))) {
      setWordStatus("Tidak dapat terhubung ke server. Pastikan server berjalan di http://localhost:3000", "error");
    } else {
      setWordStatus(`Gagal membuat PDF: ${err.message || err}`, "error");
    }
  } finally {
    wordState.isConverting = false;
    wordConvertBtn.disabled = false;
    wordConvertBtn.textContent = "Convert ke PDF";
  }
}

function initWordTab() {
  tabImage.addEventListener("click", () => switchTab("image"));
  tabWord.addEventListener("click", () => switchTab("word"));

  wordDropArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      wordUpload.click();
    }
  });

  wordUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    ingestWordFile(file);
    e.target.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    wordDropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      wordDropArea.classList.add("is-dragover");
    });
  });

  ["dragleave", "dragend"].forEach((evt) => {
    wordDropArea.addEventListener(evt, (e) => {
      if (e.target === wordDropArea) wordDropArea.classList.remove("is-dragover");
    });
  });

  wordDropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    wordDropArea.classList.remove("is-dragover");
    const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    if (file) ingestWordFile(file);
  });

  wordPageSizeSelect.addEventListener("change", (e) => {
    wordState.pageSize = e.target.value;
  });

  document.querySelectorAll('input[name="word-orientation"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) wordState.orientation = e.target.value;
    });
  });

  wordRemoveBtn.addEventListener("click", clearWord);
  wordConvertBtn.addEventListener("click", convertWordToPDF);
}

function switchTab(target) {
  if (target === "image") {
    tabImage.classList.add("tab-btn--active");
    tabImage.setAttribute("aria-selected", "true");
    tabWord.classList.remove("tab-btn--active");
    tabWord.setAttribute("aria-selected", "false");
    panelImage.hidden = false;
    panelWord.hidden = true;
  } else {
    tabWord.classList.add("tab-btn--active");
    tabWord.setAttribute("aria-selected", "true");
    tabImage.classList.remove("tab-btn--active");
    tabImage.setAttribute("aria-selected", "false");
    panelWord.hidden = false;
    panelImage.hidden = true;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

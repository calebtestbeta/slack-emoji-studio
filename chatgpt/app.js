// Slack Emoji Gen (v1.1 + Dark Mode) - Vanilla JS
// Goals:
// - Real-time rendering (<100ms): batch updates via requestAnimationFrame
// - Export 128x128 PNG
// - Retina preview: preview canvas scales with devicePixelRatio
// - Google Fonts: load on demand, re-render when ready
// - Sticky preview on desktop: handled by CSS position: sticky
// - Dark mode: system + manual override (persisted)

(() => {
  "use strict";

  const EXPORT_SIZE = 128;
  const STORAGE_KEY = "slack-emoji-gen:v1.1";
  const THEME_KEY = "slack-emoji-gen:theme";

  /** @typedef {{
   *   text: string,
   *   fontFamily: string,
   *   fontWeight: string,
   *   fontSize: number,
   *   lineHeight: number,
   *   textColor: string,
   *   bgColor: string,
   *   bgTransparent: boolean,
   *   bgAlpha: number, // 0..1
   *   offsetX: number,
   *   offsetY: number,
   *   align: "center"|"left"|"right",
   *   padding: number
   * }} State
   */

  /** @type {State} */
  const DEFAULT_STATE = {
    text: "早安！\nHello :)",
    fontFamily: "Noto Sans TC",
    fontWeight: "400",
    fontSize: 56,
    lineHeight: 1.15,
    textColor: "#111827",
    bgColor: "#ffffff",
    bgTransparent: true,
    bgAlpha: 1,
    offsetX: 0,
    offsetY: 0,
    align: "center",
    padding: 0,
  };

  /** @returns {State} */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_STATE,
        ...parsed,
        // sanitize types
        fontSize: clampInt(parsed.fontSize ?? DEFAULT_STATE.fontSize, 8, 128),
        lineHeight: clampFloat(parsed.lineHeight ?? DEFAULT_STATE.lineHeight, 0.8, 1.8),
        bgAlpha: clampFloat(parsed.bgAlpha ?? DEFAULT_STATE.bgAlpha, 0, 1),
        offsetX: clampInt(parsed.offsetX ?? 0, -64, 64),
        offsetY: clampInt(parsed.offsetY ?? 0, -64, 64),
        padding: clampInt(parsed.padding ?? 0, 0, 24),
        bgTransparent: Boolean(parsed.bgTransparent ?? DEFAULT_STATE.bgTransparent),
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  /** @param {State} s */
  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }

  function loadTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark" || v === "system") return v;
      return "system";
    } catch {
      return "system";
    }
  }

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === "light") root.setAttribute("data-theme", "light");
    else if (mode === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme"); // system
  }

  function saveTheme(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
  }

  function clampInt(v, min, max) {
    const n = Number.parseInt(String(v), 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function clampFloat(v, min, max) {
    const n = Number.parseFloat(String(v));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function hexToRgb(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function normalizeNewlines(s) {
    return String(s).replace(/\r\n?/g, "\n");
  }

  function safeFileNameFromText(text) {
    const first = normalizeNewlines(text).split("\n")[0].trim();
    if (!first) return "slack-emoji.png";

    // Keep letters/numbers/underscore/hyphen; collapse spaces; limit length.
    // Note: \p{L}\p{N} is not supported in very old browsers, so we fall back.
    let base = first.replace(/\s+/g, "-").replace(/[^a-z0-9_\-\u00A0-\uFFFF]/gi, "");
    base = base.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    if (!base) base = "slack-emoji";
    return `${base}.png`;
  }

  // DOM
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const previewCanvas = /** @type {HTMLCanvasElement} */ ($("previewCanvas"));
  const downloadBtn = /** @type {HTMLButtonElement} */ ($("downloadBtn"));
  const resetBtn = /** @type {HTMLButtonElement} */ ($("resetBtn"));
  const themeSelect = /** @type {HTMLSelectElement} */ ($("themeSelect"));

  const textInput = /** @type {HTMLTextAreaElement} */ ($("textInput"));
  const fontSelect = /** @type {HTMLSelectElement} */ ($("fontSelect"));
  const weightSelect = /** @type {HTMLSelectElement} */ ($("weightSelect"));
  const sizeRange = /** @type {HTMLInputElement} */ ($("sizeRange"));
  const sizeOut = /** @type {HTMLOutputElement} */ ($("sizeOut"));
  const lineRange = /** @type {HTMLInputElement} */ ($("lineRange"));
  const lineOut = /** @type {HTMLOutputElement} */ ($("lineOut"));

  const textColor = /** @type {HTMLInputElement} */ ($("textColor"));
  const textColorHex = /** @type {HTMLInputElement} */ ($("textColorHex"));
  const bgColor = /** @type {HTMLInputElement} */ ($("bgColor"));
  const bgColorHex = /** @type {HTMLInputElement} */ ($("bgColorHex"));
  const bgTransparent = /** @type {HTMLInputElement} */ ($("bgTransparent"));
  const bgAlphaRange = /** @type {HTMLInputElement} */ ($("bgAlphaRange"));
  const bgAlphaOut = /** @type {HTMLOutputElement} */ ($("bgAlphaOut"));

  const offXRange = /** @type {HTMLInputElement} */ ($("offXRange"));
  const offXOut = /** @type {HTMLOutputElement} */ ($("offXOut"));
  const offYRange = /** @type {HTMLInputElement} */ ($("offYRange"));
  const offYOut = /** @type {HTMLOutputElement} */ ($("offYOut"));

  const alignSelect = /** @type {HTMLSelectElement} */ ($("alignSelect"));
  const padRange = /** @type {HTMLInputElement} */ ($("padRange"));
  const padOut = /** @type {HTMLOutputElement} */ ($("padOut"));

  // Canvases
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = EXPORT_SIZE;
  exportCanvas.height = EXPORT_SIZE;

  const exportCtx = /** @type {CanvasRenderingContext2D} */ (exportCanvas.getContext("2d", { alpha: true }));
  const previewCtx = /** @type {CanvasRenderingContext2D} */ (previewCanvas.getContext("2d", { alpha: true }));

  /** @type {State} */
  let state = loadState();

  // RAF batching
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderAll();
    });
  }

  // Font loading: re-render once the font is ready
  let fontLoadToken = 0;
  async function ensureFontLoaded(fontFamily) {
    if (!document.fonts || !document.fonts.load) return;
    const token = ++fontLoadToken;
    try {
      // Any size works; use a small one for quick load
      await document.fonts.load(`16px "${fontFamily}"`);
    } catch {}
    if (token === fontLoadToken) scheduleRender();
  }

  function resizePreviewCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = previewCanvas.getBoundingClientRect();

    // If not visible yet, avoid NaNs.
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));

    previewCanvas.width = Math.round(cssW * dpr);
    previewCanvas.height = Math.round(cssH * dpr);

    // Draw in CSS pixels
    previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    previewCtx.imageSmoothingEnabled = true;
  }

  function applyStateToControls() {
    textInput.value = state.text;
    fontSelect.value = state.fontFamily;
    weightSelect.value = state.fontWeight;

    sizeRange.value = String(state.fontSize);
    sizeOut.value = String(state.fontSize);

    lineRange.value = String(state.lineHeight);
    lineOut.value = state.lineHeight.toFixed(2);

    textColor.value = state.textColor;
    textColorHex.value = state.textColor.toLowerCase();

    bgColor.value = state.bgColor;
    bgColorHex.value = state.bgColor.toLowerCase();

    bgTransparent.checked = state.bgTransparent;
    bgAlphaRange.value = String(Math.round(state.bgAlpha * 100));
    bgAlphaOut.value = `${Math.round(state.bgAlpha * 100)}%`;

    offXRange.value = String(state.offsetX);
    offXOut.value = String(state.offsetX);

    offYRange.value = String(state.offsetY);
    offYOut.value = String(state.offsetY);

    alignSelect.value = state.align;

    padRange.value = String(state.padding);
    padOut.value = String(state.padding);
  }

  function updateBgAlphaUI() {
    const pct = clampInt(bgAlphaRange.value, 0, 100);
    bgAlphaOut.value = `${pct}%`;
  }

  function readControlsIntoState() {
    state.text = normalizeNewlines(textInput.value);

    state.fontFamily = fontSelect.value;
    state.fontWeight = weightSelect.value;

    state.fontSize = clampInt(sizeRange.value, 8, 128);
    sizeOut.value = String(state.fontSize);

    state.lineHeight = clampFloat(lineRange.value, 0.8, 1.8);
    lineOut.value = state.lineHeight.toFixed(2);

    state.textColor = normalizeHex(textColor.value) ?? DEFAULT_STATE.textColor;
    textColorHex.value = state.textColor.toLowerCase();

    state.bgColor = normalizeHex(bgColor.value) ?? DEFAULT_STATE.bgColor;
    bgColorHex.value = state.bgColor.toLowerCase();

    state.bgTransparent = bgTransparent.checked;

    const alphaPct = clampInt(bgAlphaRange.value, 0, 100);
    state.bgAlpha = alphaPct / 100;
    bgAlphaOut.value = `${alphaPct}%`;

    state.offsetX = clampInt(offXRange.value, -64, 64);
    offXOut.value = String(state.offsetX);

    state.offsetY = clampInt(offYRange.value, -64, 64);
    offYOut.value = String(state.offsetY);

    state.align = /** @type {State["align"]} */ (alignSelect.value);

    state.padding = clampInt(padRange.value, 0, 24);
    padOut.value = String(state.padding);

    saveState(state);
  }

  function normalizeHex(v) {
    const m = String(v).trim().match(/^#([0-9a-f]{6})$/i);
    return m ? `#${m[1]}` : null;
  }

  function setColorFromHexInput(hexInputEl, colorInputEl, fallback) {
    const hex = normalizeHex(hexInputEl.value) ?? fallback;
    hexInputEl.value = hex.toLowerCase();
    colorInputEl.value = hex;
  }

  function renderExportCanvas() {
    const ctx = exportCtx;
    ctx.clearRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);

    // Background
    if (!state.bgTransparent) {
      const rgb = hexToRgb(state.bgColor);
      if (rgb) {
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${state.bgAlpha})`;
        ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
      }
    }

    // Text
    const lines = normalizeNewlines(state.text).split("\n");
    const fontSize = state.fontSize;
    const lineHeightPx = fontSize * state.lineHeight;

    // padding shrinks safe text area
    const pad = state.padding;
    const safeLeft = pad;
    const safeRight = EXPORT_SIZE - pad;
    const safeWidth = safeRight - safeLeft;

    ctx.save();
    ctx.fillStyle = state.textColor;

    // Better text quality
    ctx.textRendering = "optimizeLegibility";
    ctx.imageSmoothingEnabled = true;

    // Align
    ctx.textBaseline = "middle";
    ctx.textAlign = state.align;

    const fontFamily = state.fontFamily === "system-ui"
      ? 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans TC", "Noto Sans", sans-serif'
      : `"${state.fontFamily}", "Noto Sans TC", "Noto Sans", system-ui, sans-serif`;

    ctx.font = `${state.fontWeight} ${fontSize}px ${fontFamily}`;

    const totalHeight = lineHeightPx * lines.length;
    const startY = (EXPORT_SIZE / 2) - (totalHeight / 2) + (lineHeightPx / 2) + state.offsetY;

    let x;
    if (state.align === "left") x = safeLeft + state.offsetX;
    else if (state.align === "right") x = safeRight + state.offsetX;
    else x = (EXPORT_SIZE / 2) + state.offsetX;

    // Clip to padded area
    ctx.beginPath();
    ctx.rect(safeLeft, safeLeft, safeWidth, safeWidth);
    ctx.clip();

    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * lineHeightPx;
      const t = lines[i];
      if (!t) continue;
      ctx.fillText(t, x, y);
    }
    ctx.restore();
  }

  function renderPreviewCanvas() {
    // previewCtx is already scaled to CSS pixels via resizePreviewCanvas()
    const rect = previewCanvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    previewCtx.clearRect(0, 0, cssW, cssH);

    // Draw the 128x128 export onto preview, scaled up
    previewCtx.imageSmoothingEnabled = true;
    previewCtx.drawImage(exportCanvas, 0, 0, cssW, cssH);
  }

  function renderAll() {
    renderExportCanvas();
    renderPreviewCanvas();
  }

  // Events: bind input -> read state -> schedule render
  const onAnyInput = () => {
    readControlsIntoState();
    scheduleRender();
  };

  textInput.addEventListener("input", onAnyInput);
  fontSelect.addEventListener("change", () => {
    onAnyInput();
    ensureFontLoaded(fontSelect.value);
  });
  weightSelect.addEventListener("change", onAnyInput);

  sizeRange.addEventListener("input", onAnyInput);
  lineRange.addEventListener("input", onAnyInput);

  textColor.addEventListener("input", onAnyInput);
  bgColor.addEventListener("input", onAnyInput);

  bgTransparent.addEventListener("change", onAnyInput);
  bgAlphaRange.addEventListener("input", () => {
    updateBgAlphaUI();
    onAnyInput();
  });

  offXRange.addEventListener("input", onAnyInput);
  offYRange.addEventListener("input", onAnyInput);
  alignSelect.addEventListener("change", onAnyInput);
  padRange.addEventListener("input", onAnyInput);

  // Hex inputs
  textColorHex.addEventListener("input", () => {
    setColorFromHexInput(textColorHex, textColor, DEFAULT_STATE.textColor);
    onAnyInput();
  });
  bgColorHex.addEventListener("input", () => {
    setColorFromHexInput(bgColorHex, bgColor, DEFAULT_STATE.bgColor);
    onAnyInput();
  });

  // Theme select (system/light/dark)
  let themeMode = loadTheme();
  applyTheme(themeMode);
  if (themeSelect) themeSelect.value = themeMode;

  if (themeSelect) {
    themeSelect.addEventListener("change", () => {
      themeMode = themeSelect.value;
      applyTheme(themeMode);
      saveTheme(themeMode);
    });
  }

  // Keep in sync with system changes when in 'system'
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", () => {
      if (themeMode === "system") applyTheme("system");
    });
  }

  // Download
  downloadBtn.addEventListener("click", async () => {
    // Ensure the latest render is used
    renderExportCanvas();

    const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileNameFromText(state.text);
    document.body.appendChild(a);
    a.click();
    a.remove();

    // cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });

  // Reset
  resetBtn.addEventListener("click", () => {
    state = { ...DEFAULT_STATE };
    saveState(state);
    applyStateToControls();
    ensureFontLoaded(state.fontFamily);
    scheduleRender();
  });

  // Resize
  window.addEventListener("resize", () => {
    resizePreviewCanvas();
    scheduleRender();
  });

  // Init
  applyStateToControls();
  updateBgAlphaUI();
  resizePreviewCanvas();
  ensureFontLoaded(state.fontFamily);

  // Render once fonts are ready (best-effort)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scheduleRender()).catch(() => scheduleRender());
  } else {
    scheduleRender();
  }
})();

/**
 * A small popover color picker with a saturation/value square, hue slider,
 * alpha slider and hex field. One instance is shared by the whole app.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface PickerState {
  anchor: HTMLElement;
  h: number;
  s: number;
  v: number;
  a: number;
  onChange: (hex: string, alpha: number) => void;
  onClose?: () => void;
}

interface PickerEls {
  sv: HTMLElement;
  svThumb: HTMLElement;
  hue: HTMLElement;
  hueThumb: HTMLElement;
  alpha: HTMLElement;
  alphaFill: HTMLElement;
  alphaThumb: HTMLElement;
  hex: HTMLInputElement;
  alphaNum: HTMLInputElement;
}

let root: HTMLDivElement | null = null;
let current: PickerState | null = null;
let els: PickerEls;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  // One row per 60° sextant of the hue wheel.
  const sextants: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = sextants[Math.min(5, Math.max(0, Math.floor(h / 60)))]!;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function q<T extends HTMLElement>(parent: HTMLElement, sel: string): T {
  const el = parent.querySelector<T>(sel);
  if (!el) throw new Error(`Color picker markup is missing ${sel}`);
  return el;
}

function build(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "color-popover hidden";
  el.innerHTML = `
    <div class="cp-sv"><div class="cp-sv-thumb"></div></div>
    <div class="cp-slider cp-hue"><div class="cp-thumb"></div></div>
    <div class="cp-slider cp-alpha"><div class="cp-alpha-fill"></div><div class="cp-thumb"></div></div>
    <div class="cp-row">
      <input type="text" class="cp-hex" maxlength="7" spellcheck="false" />
      <input type="number" class="cp-alpha-num" min="0" max="100" step="1" />
      <span class="cp-pct">%</span>
    </div>
  `;
  document.body.appendChild(el);
  els = {
    sv: q(el, ".cp-sv"),
    svThumb: q(el, ".cp-sv-thumb"),
    hue: q(el, ".cp-hue"),
    hueThumb: q(el, ".cp-hue .cp-thumb"),
    alpha: q(el, ".cp-alpha"),
    alphaFill: q(el, ".cp-alpha-fill"),
    alphaThumb: q(el, ".cp-alpha .cp-thumb"),
    hex: q<HTMLInputElement>(el, ".cp-hex"),
    alphaNum: q<HTMLInputElement>(el, ".cp-alpha-num"),
  };

  // Clicks inside the popover must not reach the document-level "close menus" handler.
  el.addEventListener("click", (e) => e.stopPropagation());

  drag(els.sv, (x, y) => {
    if (!current) return;
    current.s = x;
    current.v = 1 - y;
    emit();
  });
  drag(els.hue, (x) => {
    if (!current) return;
    current.h = x * 360;
    emit();
  });
  drag(els.alpha, (x) => {
    if (!current) return;
    current.a = x;
    emit();
  });
  els.hex.addEventListener("change", () => {
    if (!current) return;
    const v = els.hex.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) {
      const hsv = rgbToHsv(hexToRgb(v.startsWith("#") ? v : "#" + v));
      current.h = hsv.h || current.h;
      current.s = hsv.s;
      current.v = hsv.v;
      emit();
    } else {
      sync();
    }
  });
  els.alphaNum.addEventListener("change", () => {
    if (!current) return;
    current.a = clamp01((parseFloat(els.alphaNum.value) || 0) / 100);
    emit();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!current || !root || root.classList.contains("hidden")) return;
      const target = e.target as Node;
      if (root.contains(target) || current.anchor.contains(target)) return;
      closeColorPicker();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) closeColorPicker();
  });
  return el;
}

function drag(el: HTMLElement, onMove: (x: number, y: number) => void): void {
  const handle = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    handle(e);
    const move = (ev: PointerEvent) => handle(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

function currentHex(): string {
  if (!current) return "#000000";
  return rgbToHex(hsvToRgb(current.h, current.s, current.v));
}

function sync(): void {
  if (!current) return;
  const hex = currentHex();
  const hueRgb = rgbToHex(hsvToRgb(current.h, 1, 1));
  els.sv.style.background = `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${hueRgb})`;
  els.svThumb.style.left = `${current.s * 100}%`;
  els.svThumb.style.top = `${(1 - current.v) * 100}%`;
  els.hueThumb.style.left = `${(current.h / 360) * 100}%`;
  els.alphaFill.style.background = `linear-gradient(to right, transparent, ${hex})`;
  els.alphaThumb.style.left = `${current.a * 100}%`;
  if (document.activeElement !== els.hex) els.hex.value = hex;
  if (document.activeElement !== els.alphaNum) {
    els.alphaNum.value = String(Math.round(current.a * 100));
  }
}

function emit(): void {
  if (!current) return;
  sync();
  current.onChange(currentHex(), Math.round(current.a * 1000) / 1000);
}

function position(anchor: HTMLElement): void {
  if (!root) return;
  const r = anchor.getBoundingClientRect();
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  root.style.left = `${Math.max(8, left)}px`;
  root.style.top = `${top}px`;
}

export interface OpenPickerOptions {
  anchor: HTMLElement;
  color: string;
  alpha?: number;
  onChange: (hex: string, alpha: number) => void;
  onClose?: () => void;
}

/** Opens the shared picker next to `anchor`; `onChange` fires continuously while editing. */
export function openColorPicker({
  anchor,
  color,
  alpha = 1,
  onChange,
  onClose,
}: OpenPickerOptions): void {
  if (!root) root = build();
  const hsv = rgbToHsv(hexToRgb(color));
  const prevHue = current && current.anchor === anchor ? current.h : hsv.h;
  current = {
    anchor,
    h: hsv.s && hsv.v ? hsv.h : prevHue,
    s: hsv.s,
    v: hsv.v,
    a: clamp01(alpha),
    onChange,
    onClose,
  };
  root.classList.remove("hidden");
  sync();
  position(anchor);
}

export function closeColorPicker(): void {
  if (root) root.classList.add("hidden");
  const onClose = current?.onClose;
  current = null;
  onClose?.();
}

export function isColorPickerOpenFor(anchor: HTMLElement): boolean {
  return !!current && current.anchor === anchor && !!root && !root.classList.contains("hidden");
}

import { getState } from "./state.js";
import { renderRulers, setRulerOffset } from "./rulers.js";
import { isCoarsePointer } from "./pointer.js";
import { writeSessionView, savedView } from "./session.js";
import { byId, bySelector } from "@workbench/ui";

/** Where the layout turns into the phone one. Keep in step with the media query in styles.css. */
const NARROW = "(max-width: 720px), (pointer: coarse) and (max-width: 800px)";
const narrowQuery = window.matchMedia(NARROW);
const toolGroup = byId("tool-group-tools");

/**
 * The tools are one element, moved between the top bar and the bottom bar - never duplicated.
 * Snap rides with them: it is a drawing aid, so on a phone it belongs under the thumb rather
 * than up among the view controls.
 */
function placeTools(): void {
  const home = narrowQuery.matches ? byId("tool-bar") : byId("tool-slot");
  if (toolGroup.parentElement !== home) home.appendChild(toolGroup);
}
placeTools();
narrowQuery.addEventListener("change", () => {
  placeTools();
  if (!docPanel.classList.contains("hidden")) setHelpVisible(false);
  layoutPanels();
});

/* ---------- Document panel: docked left, full height, toggled by its button ---------- */
const docPanel = byId("menu-document");
const docBtn = byId("menu-document-btn");
const helpPanel = byId("help-panel");
const helpBtn = byId("btn-help");

function layoutPanels(): void {
  // On a phone an open panel covers the canvas: the rulers go, and the bar joins the panel.
  const anyOpen = !docPanel.classList.contains("hidden") || !helpPanel.classList.contains("hidden");
  document.body.classList.toggle("panel-open", narrowQuery.matches && anyOpen);
  const top = bySelector<HTMLElement>(".top-bar").getBoundingClientRect().bottom;
  docPanel.style.top = `${top}px`;
  helpPanel.style.top = `${top}px`;
  setRulerOffset(docPanel.classList.contains("hidden") ? 0 : docPanel.offsetWidth);
  renderRulers(getState());
}

/**
 * On a phone either panel covers the canvas and the two would sit on top of each other, so opening
 * one closes the other. On a wider screen they dock on opposite sides and can both stay open.
 */
function setDocPanelVisible(visible: boolean): void {
  if (visible && narrowQuery.matches) setHelpVisible(false);
  docPanel.classList.toggle("hidden", !visible);
  docBtn.setAttribute("aria-expanded", String(visible));
  writeSessionView({ docPanel: visible });
  layoutPanels();
}

function setHelpVisible(visible: boolean): void {
  if (visible && narrowQuery.matches) setDocPanelVisible(false);
  helpPanel.classList.toggle("hidden", !visible);
  helpBtn.setAttribute("aria-expanded", String(visible));
  writeSessionView({ help: visible });
  layoutPanels();
}

docBtn.addEventListener("click", () => setDocPanelVisible(docPanel.classList.contains("hidden")));
window.addEventListener("resize", layoutPanels);

helpBtn.addEventListener("click", () => {
  setHelpVisible(helpPanel.classList.contains("hidden"));
});

/** Reopens what was open when the page was last shown. Needs the rulers and render set up. */
export function restoreLayout(): void {
  if (savedView.docPanel) setDocPanelVisible(true);
  if (savedView.help) setHelpVisible(true);
}

/**
 * Help answers for the pointer you are using. The starting side is the one detected, but it is a
 * switch rather than a rule: a laptop with a touch screen is both, and the other side is often
 * exactly what you wanted to read.
 */
const helpBody = byId("help-body");

function setHelpMode(mode: "mouse" | "touch"): void {
  helpBody.classList.toggle("help--mouse", mode === "mouse");
  helpBody.classList.toggle("help--touch", mode === "touch");
  helpBody.scrollTop = 0;
  document.querySelectorAll<HTMLElement>("[data-help-mode]").forEach((btn) => {
    const on = btn.dataset.helpMode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

document.querySelectorAll<HTMLElement>("[data-help-mode]").forEach((btn) => {
  btn.addEventListener("click", () =>
    setHelpMode(btn.dataset.helpMode === "touch" ? "touch" : "mouse")
  );
});
setHelpMode(isCoarsePointer() ? "touch" : "mouse");

/* Collapsible sections (remembered). */
const SECTIONS_KEY = "vellum.sections";
const sectionOpen: Record<string, boolean> = {
  documents: true,
  images: false,
  svg: true,
  primitives: true,
};
try {
  Object.assign(sectionOpen, JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}"));
} catch {
  /* defaults */
}

function applySections(): void {
  docPanel.querySelectorAll<HTMLElement>(".doc-section").forEach((sec) => {
    sec.classList.toggle("collapsed", !sectionOpen[sec.dataset.section ?? ""]);
  });
}

export function setSectionOpen(key: string, open: boolean): void {
  sectionOpen[key] = open;
  applySections();
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionOpen));
  } catch {
    /* not remembered */
  }
}

docPanel.querySelectorAll<HTMLElement>(".doc-toggle").forEach((btn) => {
  const key = btn.closest<HTMLElement>(".doc-section")?.dataset.section;
  if (key) btn.addEventListener("click", () => setSectionOpen(key, !sectionOpen[key]));
});
applySections();

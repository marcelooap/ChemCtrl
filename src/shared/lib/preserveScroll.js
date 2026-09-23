import { useLayoutEffect } from "react";

const OVERFLOW_SCROLL = /(auto|scroll|overlay)/;

let installed = false;
let locked = false;
/** @type {{ el: Element, top: number, left: number }[]} */
let anchor = [];

function isScrollable(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) {
    return false;
  }
  const style = getComputedStyle(el);
  return (
    OVERFLOW_SCROLL.test(style.overflowY) ||
    OVERFLOW_SCROLL.test(style.overflowX) ||
    OVERFLOW_SCROLL.test(style.overflow)
  );
}

export function captureScrollPositions() {
  const entries = [];
  const root = document.scrollingElement;
  if (root && (root.scrollTop > 0 || root.scrollLeft > 0)) {
    entries.push({ el: root, top: root.scrollTop, left: root.scrollLeft });
  }
  for (const el of document.querySelectorAll("body *")) {
    if (!isScrollable(el)) continue;
    if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
    entries.push({ el, top: el.scrollTop, left: el.scrollLeft });
  }
  return entries;
}

export function restoreScrollPositions(entries) {
  if (!entries?.length) return;
  for (const { el, top, left } of entries) {
    if (!el.isConnected) continue;
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  }
}

export function scheduleScrollRestore(entries) {
  if (!entries?.length) return;
  const apply = () => restoreScrollPositions(entries);
  apply();
  requestAnimationFrame(apply);
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 80);
  window.setTimeout(apply, 220);
}

function rememberAnchor() {
  if (locked) return;
  anchor = captureScrollPositions();
}

/** Mantém a âncora do scroll enquanto um diálogo está aberto. */
export function installScrollAnchor() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerdown", rememberAnchor, true);
  document.addEventListener("keydown", rememberAnchor, true);
  document.addEventListener("scroll", rememberAnchor, true);
}

export function peekScrollAnchor() {
  return anchor.map((item) => ({ ...item }));
}

export function lockScrollAnchor() {
  if (!locked) {
    if (anchor.length === 0) anchor = captureScrollPositions();
    locked = true;
  }
}

export function restoreScrollAnchor() {
  const snap = anchor;
  const apply = () => restoreScrollPositions(snap);
  apply();
  requestAnimationFrame(apply);
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 80);
  window.setTimeout(apply, 220);
  window.setTimeout(() => {
    locked = false;
    anchor = captureScrollPositions();
  }, 260);
}

/** Trava o scroll ao abrir um diálogo e devolve a posição ao fechar. */
export function usePreserveScrollWhileMounted() {
  useLayoutEffect(() => {
    lockScrollAnchor();
    return () => restoreScrollAnchor();
  }, []);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Guarda alterações não salvas:
 * - beforeunload (fechar aba / refresh)
 * - interceptação de cliques em <a> internos (sidebar / navegação in-app)
 *
 * Usa BrowserRouter (sem useBlocker). O caller renderiza um ConfirmDialog
 * com `discardDialog` e chama `confirmDiscard` / `cancelDiscard`.
 *
 * @param {boolean} dirty
 * @param {{ enabled?: boolean }} [options]
 */
export function useUnsavedChangesGuard(dirty, { enabled = true } = {}) {
  const navigate = useNavigate();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && enabled;

  const [discardDialog, setDiscardDialog] = useState({
    open: false,
    href: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onBeforeUnload = (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    const onClickCapture = (e) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = e.target?.closest?.('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      // Links externos / nova aba
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      let url;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      const nextPath = `${url.pathname}${url.search}${url.hash}`;
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextPath === currentPath) return;

      e.preventDefault();
      e.stopPropagation();
      setDiscardDialog({ open: true, href: nextPath });
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [enabled]);

  const confirmDiscard = useCallback(() => {
    const href = discardDialog.href;
    setDiscardDialog({ open: false, href: null });
    if (href) navigate(href);
  }, [discardDialog.href, navigate]);

  const cancelDiscard = useCallback(() => {
    setDiscardDialog({ open: false, href: null });
  }, []);

  /**
   * Intercepta troca de seleção (ex.: outro cliente).
   * Se dirty, abre o diálogo e retorna false; caso contrário retorna true.
   * @param {() => void} proceed
   */
  const requestProceed = useCallback((proceed) => {
    if (!dirtyRef.current) {
      proceed?.();
      return true;
    }
    setDiscardDialog({
      open: true,
      href: null,
      onConfirm: proceed,
    });
    return false;
  }, []);

  const confirmDiscardOrProceed = useCallback(() => {
    const { href, onConfirm } = discardDialog;
    setDiscardDialog({ open: false, href: null });
    if (typeof onConfirm === 'function') {
      onConfirm();
      return;
    }
    if (href) navigate(href);
  }, [discardDialog, navigate]);

  return {
    discardDialog,
    confirmDiscard: confirmDiscardOrProceed,
    cancelDiscard,
    requestProceed,
  };
}

export default useUnsavedChangesGuard;

/**
 * Guarda síncrona contra duplo submit (ref + estado).
 * Preferir a `disabled={saving}` sozinho — setState é assíncrono.
 */
import { useCallback, useRef, useState } from 'react';

export function useSubmitGuard() {
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn) => {
    if (runningRef.current) return undefined;
    runningRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

export default useSubmitGuard;

import { useCallback, useRef, useState } from 'react';

/**
 * Anti double-submit reutilizável para botões críticos (Salvar, Excluir, Criar OP,
 * Finalizar OP, Liberar OP, Cadastrar...). Enquanto uma execução está em andamento,
 * novas chamadas a `run` são ignoradas — o mesmo `fn` nunca corre duas vezes em paralelo.
 *
 * Uso:
 *   const { busy, run } = useSubmitGuard();
 *   <Button disabled={busy} onClick={() => run(handleSave)}>...</Button>
 */
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

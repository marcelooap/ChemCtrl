/**
 * Acesso tolerante a falhas ao Web Storage.
 *
 * Em navegação privada do iOS Safari, WebViews de tablets corporativos e
 * navegadores com cookies/armazenamento bloqueados, qualquer acesso a
 * `localStorage`/`sessionStorage` lança `SecurityError`/`QuotaExceededError`.
 * Sem esta camada, a exceção sobe até o React e derruba a tela inteira.
 *
 * Quando o storage nativo não está disponível, usa um fallback em memória:
 * a sessão funciona normalmente até o fechamento da aba.
 */

const memoryStores = new Map();

function memoryStore(kind) {
  if (!memoryStores.has(kind)) memoryStores.set(kind, new Map());
  return memoryStores.get(kind);
}

function nativeStore(kind) {
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__chemctrl_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function createStorage(kind) {
  let native;
  const resolve = () => {
    if (native === undefined) native = nativeStore(kind);
    return native;
  };

  return {
    getItem(key) {
      const store = resolve();
      if (!store) return memoryStore(kind).get(key) ?? null;
      try {
        return store.getItem(key);
      } catch {
        return memoryStore(kind).get(key) ?? null;
      }
    },
    setItem(key, value) {
      const store = resolve();
      if (store) {
        try {
          store.setItem(key, value);
          return;
        } catch {
          /* cai para o fallback em memória */
        }
      }
      memoryStore(kind).set(key, String(value));
    },
    removeItem(key) {
      const store = resolve();
      if (store) {
        try {
          store.removeItem(key);
        } catch {
          /* ignora */
        }
      }
      memoryStore(kind).delete(key);
    },
  };
}

export const safeLocalStorage = createStorage('local');
export const safeSessionStorage = createStorage('session');

import { Component } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { safeSessionStorage } from '@/lib/safeStorage';

const SELF_HEAL_KEY = 'chemctrl_module_reload';

/** Mensagens de falha de import dinâmico variam por navegador (Chrome/Safari/Firefox/WebView). */
const DYNAMIC_IMPORT_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk|Loading CSS chunk|Importing a module script failed|expected a JavaScript(-or-Wasm)? module/i;

/**
 * Um deploy novo invalida os nomes com hash dos chunks. Em dispositivos com o
 * PWA instalado, o Service Worker pode servir um index.html antigo que aponta
 * para chunks inexistentes. Limpamos os caches e recarregamos uma única vez.
 */
async function selfHealStaleCache() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((reg) => reg.unregister().catch(() => {})));
  } catch {
    /* segue para o reload mesmo assim */
  }
  window.location.reload();
}

/**
 * Captura falhas de carregamento do módulo (lazy import / runtime)
 * para evitar tela em branco no React.
 *
 * Props:
 * - title?: string
 * - homeTo?: string  (rota de recuperação)
 * - onError?: (error, info) => void
 */
export default class ModuleErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const payload = {
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
      title: this.props.title || null,
      ts: new Date().toISOString(),
      href: typeof window !== 'undefined' ? window.location.href : null,
    };

    try {
      // Telemetria leve: console estruturado (substitui por Sentry/etc. depois)
      console.error('[ChemCtrl ErrorBoundary]', payload);
      if (typeof window !== 'undefined') {
        const key = 'chemctrl_error_log';
        const prev = JSON.parse(safeSessionStorage.getItem(key) || '[]');
        prev.push(payload);
        safeSessionStorage.setItem(key, JSON.stringify(prev.slice(-30)));
      }
    } catch {
      // ignore telemetry failures
    }

    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, info);
      } catch {
        // ignore
      }
    }

    if (!DYNAMIC_IMPORT_FAILURE.test(payload.message)) return;
    if (safeSessionStorage.getItem(SELF_HEAL_KEY) === '1') return;

    safeSessionStorage.setItem(SELF_HEAL_KEY, '1');
    selfHealStaleCache();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isDynamicImportFailure = DYNAMIC_IMPORT_FAILURE.test(error?.message || '');

    // Nunca expor detalhes internos (tabelas, PostgREST, stacks) ao usuário
    const safeMessage = isDynamicImportFailure
      ? 'Falha ao carregar um módulo atualizado. Recarregue a página.'
      : 'Ocorreu um erro inesperado. Você pode tentar novamente ou voltar ao início.';

    const handleRetry = () => {
      if (isDynamicImportFailure) {
        safeSessionStorage.removeItem(SELF_HEAL_KEY);
        selfHealStaleCache();
        return;
      }
      this.setState({ error: null });
    };

    const homeTo = this.props.homeTo || '/painel/home';

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-lg w-full rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">
                {this.props.title || 'Não foi possível carregar o módulo'}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground break-words">{safeMessage}</p>
              {isDynamicImportFailure && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Isso costuma acontecer após um deploy. Confirme a conexão e
                  recarregue a página.
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Tentar novamente
                </button>
                <Link
                  to={homeTo}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

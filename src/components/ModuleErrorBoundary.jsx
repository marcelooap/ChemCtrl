import { Component } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

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
        const prev = JSON.parse(sessionStorage.getItem(key) || '[]');
        prev.push(payload);
        sessionStorage.setItem(key, JSON.stringify(prev.slice(-30)));
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
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const rawMessage = error?.message || '';
    const isDynamicImportFailure =
      /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(
        rawMessage
      );

    // Nunca expor detalhes internos (tabelas, PostgREST, stacks) ao usuário
    const safeMessage = isDynamicImportFailure
      ? 'Falha ao carregar um módulo atualizado. Recarregue a página.'
      : 'Ocorreu um erro inesperado. Você pode tentar novamente ou voltar ao início.';

    const handleRetry = () => {
      if (isDynamicImportFailure) {
        window.location.reload();
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

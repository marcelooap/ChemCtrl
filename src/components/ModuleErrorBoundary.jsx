import { Component } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

/**
 * Captura falhas de carregamento do módulo (lazy import / runtime)
 * para evitar tela em branco no React.
 */
export default class ModuleErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const message =
      error?.message ||
      'Ocorreu um erro inesperado ao carregar o módulo.';

    const isDynamicImportFailure =
      /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(
        message
      );

    const handleRetry = () => {
      // Lazy imports rejeitados ficam em cache no React; reload limpa o estado.
      if (isDynamicImportFailure) {
        window.location.reload();
        return;
      }
      this.setState({ error: null });
    };

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
              <p className="mt-2 text-sm text-muted-foreground break-words">{message}</p>
              {isDynamicImportFailure && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Isso costuma acontecer se o servidor de desenvolvimento reiniciou.
                  Confirme que o <code className="text-foreground">npm run dev</code> está
                  ativo e recarregue a página.
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
                  to="/"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar ao ChemCtrl
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

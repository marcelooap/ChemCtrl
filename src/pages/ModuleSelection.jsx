import { useEffect, useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Factory, ArrowRightLeft, ArrowRight, LogOut, LayoutGrid } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getAccessibleModules } from '@/lib/modules/access';
import { MODULE_IDS } from '@/lib/modules/catalog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';

const ICONS = {
  Factory,
  ArrowRightLeft,
  [MODULE_IDS.INDUSTRIALIZACAO]: Factory,
  [MODULE_IDS.TRANSBORDO]: ArrowRightLeft,
};

function resolveIcon(mod) {
  return ICONS[mod.icon] || ICONS[mod.id] || LayoutGrid;
}

/**
 * Tela pós-login: seleção de módulo autorizado.
 * Auto-redireciona se houver exatamente um módulo (ou usuário externo).
 */
export default function ModuleSelection() {
  const { t } = useTranslation();
  const { user, logout } = useInternalAuth();
  const navigate = useNavigate();

  const modules = useMemo(() => getAccessibleModules(user), [user]);

  useEffect(() => {
    if (!user) return;
    if (user.tipo === 'externo') {
      navigate('/tela-clientes', { replace: true });
      return;
    }
    if (modules.length === 1) {
      navigate(modules[0].route, { replace: true });
    }
  }, [user, modules, navigate]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Enquanto redireciona (1 módulo / externo)
  if (user.tipo === 'externo' || modules.length === 1) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/icons/chemctrl-logo.svg"
            alt="ChemCtrl"
            className="w-9 h-9 rounded-full object-cover shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">ChemCtrl</p>
            <p className="text-xs text-muted-foreground truncate">
              {user.nome || user.full_name || user.usuario}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={logout}
          className="shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">{t('moduleSelection.logout')}</span>
        </Button>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-10 sm:py-14">
        <div className="w-full max-w-4xl space-y-8">
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {t('moduleSelection.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('moduleSelection.subtitle')}
            </p>
          </div>

          {modules.length === 0 ? (
            <Card className="max-w-lg mx-auto">
              <CardHeader>
                <CardTitle className="text-lg">{t('moduleSelection.emptyTitle')}</CardTitle>
                <CardDescription>{t('moduleSelection.emptyDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="outline" onClick={logout}>
                  <LogOut className="w-4 h-4" />
                  {t('moduleSelection.logout')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
              {modules.map((mod) => {
                const Icon = resolveIcon(mod);
                return (
                  <Link
                    key={mod.id}
                    to={mod.route}
                    className="group block min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
                  >
                    <Card className="h-full transition-colors group-hover:border-[#2575D1]/40 group-hover:bg-accent/30">
                      <CardHeader className="pb-3 pt-6 px-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <CardTitle className="text-xl">{t(mod.titleKey)}</CardTitle>
                            <CardDescription className="mt-2 text-sm leading-relaxed">
                              {t(mod.descriptionKey)}
                            </CardDescription>
                          </div>
                          <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: mod.accent }}
                          >
                            <Icon className="w-6 h-6 text-white" />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-6 pb-6">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            {t('moduleSelection.accessGranted')}
                          </span>
                          <span
                            className="inline-flex items-center gap-1.5 text-sm font-medium"
                            style={{ color: mod.accent }}
                          >
                            {t('moduleSelection.openModule')}
                            <ArrowRight className="w-4 h-4" />
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

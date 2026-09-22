import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import {
  confirmOrdemTransbordoOperator,
  listOrdemTransbordoOperators,
} from "@painel/lib/operadorOrdemAuth";

const ERROR_KEYS = {
  invalid_credentials: "invalidCredentials",
  inactive: "inactive",
  forbidden: "forbidden",
  session: "session",
  unavailable: "unavailable",
  rate_limited: "rateLimited",
  network: "network",
  load: "loadError",
  required: "required",
};

export default function OperadorOrdemAuthDialog({ open, onOpenChange, onAuthenticated }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [password, setPassword] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setUserQuery("");
      setPassword("");
      setErrorCode("");
      setSubmitting(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingUsers(true);
    setErrorCode("");
    listOrdemTransbordoOperators()
      .then((result) => {
        if (cancelled) return;
        setUsers(result.users || []);
        if (result.errorCode) setErrorCode(result.errorCode);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  const optionLabel = (user) => `${user.nome} (${user.usuario})`;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const text = userQuery.trim();
    if (!text || !password) {
      setErrorCode("required");
      return;
    }

    const fromList =
      users.find((user) => optionLabel(user) === text) ||
      users.find((user) => user.usuario === text);
    const username = fromList?.usuario || text;

    setSubmitting(true);
    setErrorCode("");
    try {
      const result = await confirmOrdemTransbordoOperator(username, password);
      if (!result.operator) {
        setErrorCode(result.errorCode || "invalid_credentials");
        setPassword("");
        return;
      }
      setPassword("");
      onAuthenticated(result.operator);
    } finally {
      setSubmitting(false);
    }
  };

  const errorKey = ERROR_KEYS[errorCode];
  const errorMessage = errorKey
    ? t(`painel.operacional.ordemTransbordo.operatorAuth.${errorKey}`)
    : "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("painel.operacional.ordemTransbordo.operatorAuth.title")}
          </DialogTitle>
          <DialogDescription>
            {t("painel.operacional.ordemTransbordo.operatorAuth.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMessage && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {errorMessage}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ordem-operador-usuario">
              {t("painel.operacional.ordemTransbordo.operatorAuth.user")}
            </Label>
            <SearchableSelect
              value={userQuery}
              onChange={(text) => {
                setUserQuery(text || "");
                setErrorCode("");
              }}
              options={users}
              getOptionLabel={optionLabel}
              getOptionValue={(user) => user.id}
              placeholder={
                loadingUsers
                  ? t("painel.operacional.ordemTransbordo.operatorAuth.loadingUsers")
                  : t("painel.operacional.ordemTransbordo.operatorAuth.userPlaceholder")
              }
              disabled={submitting}
              inputClassName="bg-white"
            />
            {!loadingUsers && users.length === 0 && !errorMessage && (
              <p className="text-xs text-muted-foreground">
                {t("painel.operacional.ordemTransbordo.operatorAuth.emptyUsers")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ordem-operador-senha">
              {t("painel.operacional.ordemTransbordo.operatorAuth.password")}
            </Label>
            <Input
              id="ordem-operador-senha"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorCode("");
              }}
              placeholder={t("painel.operacional.ordemTransbordo.operatorAuth.passwordPlaceholder")}
              disabled={submitting}
              className="bg-white"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={submitting}>
              {t("painel.operacional.ordemTransbordo.operatorAuth.cancel")}
            </Button>
            <Button type="submit" className="gap-2" disabled={submitting || !userQuery.trim() || !password}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("painel.operacional.ordemTransbordo.operatorAuth.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

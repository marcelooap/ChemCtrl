import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import {
  DESTINO_EM_BRANCO,
  getDestinoOptionsFromList,
  listDestinosAtivosNomes,
} from "@transbordo/lib/saidaDestinos";

/**
 * Seletor de Destino da carga (lista suspensa).
 * Mesmo componente na Solicitação de Saída e no Check List de Expedição.
 * Opções vêm do cadastro (Painel → Configuração → Destino Carregamentos).
 *
 * @param {{
 *   value: string,
 *   onChange: (destino: string) => void,
 *   allowBlank?: boolean,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   ariaLabel?: string,
 *   inputClassName?: string,
 *   excludeDestinoKeys?: string[],
 * }} props `onChange` recebe "" para "Em branco".
 */
export default function SaidaDestinoSelect({
  value,
  onChange,
  allowBlank = true,
  disabled = false,
  placeholder = "Selecione o destino...",
  ariaLabel = "Destino",
  inputClassName,
  excludeDestinoKeys,
}) {
  const [destinos, setDestinos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const nomes = await listDestinosAtivosNomes();
        if (!cancelled) setDestinos(nomes);
      } catch (err) {
        console.error("[SaidaDestinoSelect] load destinos:", err);
        if (!cancelled) setDestinos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const base = getDestinoOptionsFromList(destinos, {
      allowBlank,
      excludeDestinoKeys,
    });
    // Mantém valor histórico (destino removido do cadastro) visível na edição.
    const current = String(value || "").trim();
    if (current && !base.some((o) => o.nome === current || o.id === current)) {
      return [...base, { id: current, nome: current }];
    }
    return base;
  }, [destinos, allowBlank, excludeDestinoKeys, value]);

  return (
    <SearchableSelect
      key={`destinos-${destinos.length}-${allowBlank ? 1 : 0}-${loading ? "loading" : "ready"}`}
      selectOnly
      value={value || ""}
      onChange={(_label, option) => {
        if (!option) return;
        onChange(option.id === DESTINO_EM_BRANCO ? "" : option.nome);
      }}
      options={options}
      getOptionLabel={(o) => o.nome}
      getOptionValue={(o) => o.id}
      placeholder={loading ? "Carregando destinos..." : placeholder}
      disabled={disabled || loading}
      ariaLabel={ariaLabel}
      inputClassName={inputClassName}
    />
  );
}

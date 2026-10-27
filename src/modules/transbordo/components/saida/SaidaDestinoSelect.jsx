import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import {
  DESTINO_EM_BRANCO,
  DESTINOS_SAIDA,
  getDestinoOptions,
} from "@transbordo/lib/saidaDestinos";

/**
 * Seletor de Destino da carga (lista suspensa).
 * Mesmo componente na Solicitação de Saída e no Check List de Expedição.
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
  const options = getDestinoOptions({ allowBlank, excludeDestinoKeys });

  return (
    <SearchableSelect
      key={`destinos-${DESTINOS_SAIDA.length}-${allowBlank ? 1 : 0}`}
      selectOnly
      value={value || ""}
      onChange={(_label, option) => {
        if (!option) return;
        onChange(option.id === DESTINO_EM_BRANCO ? "" : option.nome);
      }}
      options={options}
      getOptionLabel={(o) => o.nome}
      getOptionValue={(o) => o.id}
      placeholder={placeholder}
      disabled={disabled}
      ariaLabel={ariaLabel}
      inputClassName={inputClassName}
    />
  );
}

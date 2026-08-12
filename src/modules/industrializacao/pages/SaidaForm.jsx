import SaidaForm from '@transbordo/pages/SaidaForm';
import { ORIGEM_INDUSTRIALIZACAO } from '@transbordo/lib/saidaOrigem';

const BASE_PATH = '/saida';

/** Formulário nova/editar saída (Industrialização). */
export default function IndSaidaForm() {
  return (
    <SaidaForm
      basePath={BASE_PATH}
      lockedOrigem={ORIGEM_INDUSTRIALIZACAO}
    />
  );
}

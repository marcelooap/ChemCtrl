import { useOutletContext } from 'react-router-dom';
import Filtracao from '@transbordo/pages/Filtracao';
import { getUserClient } from '@industrializacao/lib/permissions';

export default function ClienteFiltracao() {
  const { user } = useOutletContext();
  const cliente = getUserClient(user);

  if (!cliente) {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Filtração</h1>
        <p className="text-sm text-muted-foreground">
          Este usuário não está vinculado a um cliente.
        </p>
      </div>
    );
  }

  return <Filtracao readOnly lockedCliente={cliente} />;
}

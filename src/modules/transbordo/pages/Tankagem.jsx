import { useState, useEffect, useMemo } from "react";
import { entities } from "@transbordo/services/entities";
import { Search } from "lucide-react";
import { Input } from "@shared/components/ui/input";
import TankSilo from "@transbordo/components/tankagem/TankSilo";
import TankagemViewDialog from "@transbordo/components/tankagem/TankagemViewDialog";
import { formatVolume, roundVolume } from "@transbordo/lib/format";
import {
  computeTankaSaldo,
  buildTankaDetalhe,
} from "@transbordo/lib/tankaVolume";

const PRODUCT_COLORS = [
  "#90EE90", "#87CEEB", "#DDA0DD", "#F0E68C", "#FFB6C1",
  "#E6E6FA", "#98FB98", "#FABD74", "#B0E0E6", "#DEB887",
  "#BC8F8F", "#AED581", "#4FC3F7", "#FFD54F", "#FF8A65",
  "#BA68C8", "#7986CB", "#4DB6AC", "#F06292", "#81C784",
];

export default function Tankagem() {
  const [isotanques, setIsotanques] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewDetalhe, setViewDetalhe] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [isot, trans] = await Promise.all([
          entities.isotanques.list(),
          entities.transbordos.list(),
        ]);
        setIsotanques(isot);
        setTransbordos(trans);
      } catch {
        setIsotanques([]);
        setTransbordos([]);
      }
      setLoading(false);
    };
    loadData();
  }, []);

  const tanksWithVolume = useMemo(() => {
    return isotanques.map((iso) => {
      const tankaCodigo = iso.tanka || iso.codigo_itku || "";
      const volume = computeTankaSaldo({
        isotanqueId: iso.id,
        tankaCodigo,
        transbordos,
      });

      const fillings = transbordos
        .filter((t) =>
          (t.destinos || []).some(
            (d) =>
              d.tipo_embalagem === "Tankagem" &&
              (d.tanka_id === iso.id || d.tanka_codigo === tankaCodigo)
          )
        )
        .sort(
          (a, b) =>
            new Date(b.created_at || b.created_date || b.data || 0) -
            new Date(a.created_at || a.created_date || a.data || 0)
        );

      const latestFilling = fillings[0];

      return {
        ...iso,
        volumeAtual: roundVolume(volume),
        produto: iso.produto_nome || latestFilling?.produto_nome || "",
        cliente_nome: iso.cliente_nome || latestFilling?.cliente_nome || "",
      };
    });
  }, [isotanques, transbordos]);

  const sortedTanks = useMemo(() => {
    return [...tanksWithVolume].sort((a, b) => {
      const ta = (a.tanka || a.codigo_itku || "").toString();
      const tb = (b.tanka || b.codigo_itku || "").toString();
      return ta.localeCompare(tb, undefined, { numeric: true });
    });
  }, [tanksWithVolume]);

  const filteredTanks = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sortedTanks;
    return sortedTanks.filter((tank) => {
      const tanka = String(tank.tanka || tank.codigo_itku || "").toLowerCase();
      const produto = String(tank.produto || "").toLowerCase();
      const cliente = String(tank.cliente_nome || "").toLowerCase();
      return (
        tanka.includes(q) ||
        produto.includes(q) ||
        cliente.includes(q)
      );
    });
  }, [sortedTanks, search]);

  const productColorMap = useMemo(() => {
    const map = {};
    let colorIndex = 0;
    filteredTanks.forEach((tank) => {
      const prod = tank.produto || "";
      if (prod && !(prod in map)) {
        map[prod] = PRODUCT_COLORS[colorIndex % PRODUCT_COLORS.length];
        colorIndex++;
      }
    });
    return map;
  }, [filteredTanks]);

  const groupedByClient = useMemo(() => {
    return filteredTanks.reduce((acc, tank) => {
      const cliente = tank.cliente_nome || "Sem cliente";
      if (!acc[cliente]) acc[cliente] = [];
      acc[cliente].push(tank);
      return acc;
    }, {});
  }, [filteredTanks]);

  const handleView = (tank) => {
    const detalhe = buildTankaDetalhe({
      isotanque: tank,
      transbordos,
    });
    setViewDetalhe(detalhe);
    setViewOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tankagem</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isotanques.length} isotanque(s) cadastrado(s)
        </p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por tanka, produto ou cliente..."
            className="pl-10 bg-card"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-border border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : Object.entries(groupedByClient).length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          {search.trim()
            ? "Nenhum isotanque encontrado para a busca."
            : "Nenhum isotanque cadastrado."}
        </div>
      ) : (
        Object.entries(groupedByClient).map(([cliente, tanks]) => {
          const totalVolume = tanks.reduce(
            (sum, t) => sum + t.volumeAtual,
            0
          );
          return (
            <div
              key={cliente}
              className="bg-card rounded-xl border border-border shadow-sm p-6"
            >
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border flex-wrap">
                <span className="w-3 h-3 rounded-full bg-primary/100 flex-shrink-0" />
                <h2 className="text-lg font-bold text-foreground">
                  {cliente}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {tanks.length} tanka(s)
                </span>
                <span className="text-sm font-medium text-foreground/80 ml-auto">
                  {formatVolume(totalVolume)} L
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {tanks.map((tank) => (
                  <TankSilo
                    key={tank.id}
                    tanka={tank.tanka || tank.codigo_itku}
                    capacidade={tank.capacidade || 0}
                    volume={tank.volumeAtual}
                    produto={tank.produto}
                    fillColor={
                      tank.produto ? productColorMap[tank.produto] : null
                    }
                    onView={() => handleView(tank)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <TankagemViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewDetalhe(null);
        }}
        detalhe={viewDetalhe}
      />
    </div>
  );
}

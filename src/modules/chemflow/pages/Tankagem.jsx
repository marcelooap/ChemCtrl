import { useState, useEffect } from "react";
import { entities } from '@chemflow/services/entities';
import TankSilo from "@chemflow/components/tankagem/TankSilo";
import { formatVolume, roundVolume } from "@chemflow/lib/format";

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
      }
      setLoading(false);
    };
    loadData();
  }, []);

  // Calculate current volume for each isotank from transbordo destinos
  const tanksWithVolume = isotanques.map((iso) => {
    const fillings = transbordos
      .filter(
        (t) =>
          (t.destinos || []).some(
            (d) =>
              d.tanka_id === iso.id || d.tanka_codigo === iso.tanka
          )
      )
      .sort(
        (a, b) =>
          new Date(b.created_at || b.created_date || 0) -
          new Date(a.created_at || a.created_date || 0)
      );

    const volumeEntrada = fillings.reduce((sum, t) => {
      const destinosMatch = (t.destinos || []).filter(
        (d) =>
          d.tanka_id === iso.id || d.tanka_codigo === iso.tanka
      );
      return (
        sum +
        destinosMatch.reduce(
          (s, d) => s + roundVolume(d.volume_total || d.volume || 0),
          0
        )
      );
    }, 0);

    // Volume retirado quando esta tanka é usada como origem
    const volumeSaida = transbordos.reduce((sum, t) => {
      const origensMatch = (t.origens || []).filter(
        (o) => o.tipo_origem === "tanka" && o.entrada_id === iso.id
      );
      return (
        sum +
        origensMatch.reduce((s, o) => s + roundVolume(o.volume_retirado || 0), 0)
      );
    }, 0);

    const volume = roundVolume(volumeEntrada - volumeSaida);

    const latestFilling = fillings[0];
    const lote = latestFilling?.origens?.[0]?.lote || "";

    return {
      ...iso,
      volumeAtual: volume,
      produto: iso.produto_nome || latestFilling?.produto_nome || "",
      lote,
    };
  });

  // Sort tanks ascending by tanka name
  const sortedTanks = [...tanksWithVolume].sort((a, b) => {
    const ta = (a.tanka || a.codigo_itku || "").toString();
    const tb = (b.tanka || b.codigo_itku || "").toString();
    return ta.localeCompare(tb, undefined, { numeric: true });
  });

  // Assign unique color per product
  const productColorMap = {};
  let colorIndex = 0;
  sortedTanks.forEach((tank) => {
    const prod = tank.produto || "";
    if (prod && !(prod in productColorMap)) {
      productColorMap[prod] = PRODUCT_COLORS[colorIndex % PRODUCT_COLORS.length];
      colorIndex++;
    }
  });

  // Group by client
  const groupedByClient = sortedTanks.reduce((acc, tank) => {
    const cliente = tank.cliente_nome || "Sem cliente";
    if (!acc[cliente]) acc[cliente] = [];
    acc[cliente].push(tank);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tankagem</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isotanques.length} isotanque(s) cadastrado(s)
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-border border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : Object.entries(groupedByClient).length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          Nenhum isotanque cadastrado.
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
              {/* Client Header */}
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
              {/* Tanks Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {tanks.map((tank) => (
                  <TankSilo
                    key={tank.id}
                    tanka={tank.tanka || tank.codigo_itku}
                    capacidade={tank.capacidade || 0}
                    volume={tank.volumeAtual}
                    produto={tank.produto}
                    lote={tank.lote}
                    fillColor={tank.produto ? productColorMap[tank.produto] : null}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
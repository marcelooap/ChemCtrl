import { jsPDF } from "jspdf";
import { buildEntradaRecebimentoViewModel } from "@transbordo/lib/entradaRecebimentoViewData";
import {
  drawMainHeader,
  addInfoCards,
  drawSectionTitle,
  drawSoftTable,
  paintFooter,
  setPdfFooter,
} from "@transbordo/lib/pdfReportLayout";
import { drawOrgaoControladoBanner } from "@transbordo/lib/pdfOrgaoControladoBanner";

export async function buildEntradaRecebimentoPdfDoc(input = {}) {
  const view = buildEntradaRecebimentoViewModel(input);
  if (!view) return null;

  const doc = new jsPDF({ format: "a4", orientation: "portrait", unit: "mm" });
  doc.setProperties({ title: view.pdfTitle });
  setPdfFooter(doc, { center: view.entradaId });

  let y = drawMainHeader(doc, {
    title: view.pdfTitle,
    subtitle: view.dataEntrada,
    badge: view.entradaId !== "-" ? view.entradaId : "",
  });

  y = addInfoCards(
    doc,
    y,
    [
      ["ID de Entrada", view.entradaId],
      ["Data de Entrada", view.dataEntrada],
    ],
    2
  );

  if (view.controle.banner) {
    y = await drawOrgaoControladoBanner(doc, y, view.controle.banner);
  }

  y = drawSectionTitle(doc, y, "Produtos Recebidos");
  const prodHeaders = ["Cód", "Produto", "Nota Fiscal", "Quantidade", "Unidade", "Lote"];
  const prodWidths = [16, 52, 28, 24, 22, 22];
  if (view.controle.mostrarPorProduto) {
    prodHeaders.push("Órgão");
    prodWidths[1] -= 8;
    prodWidths.push(26);
  }
  y = drawSoftTable(doc, y, {
    headers: prodHeaders,
    widths: prodWidths,
    rows: view.produtosRows.map((r) => {
      const row = [
        r.codigo,
        r.produto,
        r.notaFiscal,
        r.quantidade,
        r.unidade,
        r.lote,
      ];
      if (view.controle.mostrarPorProduto) row.push(r.orgaoLabel);
      return row;
    }),
  });

  y = drawSectionTitle(doc, y, "Controle de Qualidade");
  y = drawSoftTable(doc, y, {
    headers: ["Lote", "Fabricação", "Validade", "Densidade"],
    widths: [38, 38, 38, 38],
    rows: view.qualidadeRows.map((r) => [
      r.lote,
      r.fabricacao,
      r.validade,
      r.densidade,
    ]),
  });

  if (view.pesagem) {
    const p = view.pesagem;
    y = drawSectionTitle(doc, y, "Pesagem");
    const pesHeaders = ["Peso Bruto (kg)", "Peso Líquido (kg)", "Tara (kg)"];
    const pesWidths = [38, 38, 38];
    const pesRow = [p.pesoBruto, p.pesoLiquido, p.tara];
    if (p.showDiferencaCol) {
      pesHeaders.push("Diferença");
      pesWidths.push(38);
      pesRow.push(p.diferenca);
    }
    pesHeaders.push("Margem");
    pesWidths.push(38);
    pesRow.push(p.margem);

    y = drawSoftTable(doc, y, {
      headers: pesHeaders,
      widths: pesWidths,
      rows: [pesRow],
    });

    if (p.alertaNotaFiscal) {
      y = addInfoCards(
        doc,
        y,
        [
          [
            "Nota Fiscal",
            `Quantidade a ser considerada na Nota Fiscal: ${p.alertaNotaFiscal}`,
            2,
            true,
          ],
        ],
        2
      );
    }
  }

  if (view.transbordo) {
    y = drawSectionTitle(doc, y, "Transbordo");
    const rows = view.transbordo.rows.map((r) => [
      r.op,
      r.destino,
      r.volume,
      r.massa,
    ]);
    rows.push(["Total", "", view.transbordo.totalVolume, view.transbordo.totalMassa]);
    y = drawSoftTable(doc, y, {
      headers: ["OP", "Destino", "Volume (L)", "Massa (kg)"],
      widths: [28, 78, 34, 34],
      rows,
    });
  }

  paintFooter(doc);
  return { doc, view };
}

export async function downloadEntradaRecebimentoPdf(input = {}) {
  const built = await buildEntradaRecebimentoPdfDoc(input);
  if (!built) return;
  built.doc.save(built.view.fileName);
}

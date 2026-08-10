import { jsPDF } from "jspdf";
import { formatNum } from "@transbordo/lib/format";

const BLUE_DARK = [28, 53, 91];
const BLUE_MID = [37, 99, 195];
const GRAY_LABEL = [130, 140, 155];
const GRAY_BORDER = [220, 224, 230];
const BLACK = [30, 30, 30];

function setColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function fmtDate(d) {
  if (!d) return "-";
  const raw = String(d);
  const date = raw.includes("T") ? new Date(raw) : new Date(raw + "T00:00:00");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function fmtNum(n, decimals = 0) {
  if (n == null || n === "") return formatNum(0, decimals);
  return formatNum(n, decimals);
}

/**
 * Gera boleta de envase em PDF (A4 paisagem, duas vias idênticas).
 * Layout idêntico ao relatório de boleta do ChemCtrl (`generateBoletaPDF`).
 */
export function generateBoletaPDF(vasilhame) {
  if (!vasilhame) return;

  const doc = new jsPDF({ orientation: "landscape" });
  const PH_L = 210;
  const HALF = 297 / 2;

  const client = vasilhame.cliente_nome || "-";
  const regId =
    vasilhame.codigo != null && vasilhame.codigo !== ""
      ? String(vasilhame.codigo).padStart(2, "0")
      : vasilhame.id != null
        ? String(vasilhame.id).slice(0, 8)
        : "-";
  const envaseDate = fmtDate(
    vasilhame.created_at || vasilhame.created_date || vasilhame.data_saida
  );
  const tara = vasilhame.tara;
  const netWeight = vasilhame.peso_liquido;
  const grossWeight = vasilhame.peso_bruto;
  const volume = vasilhame.volume;

  function drawSide(offsetX) {
    const bM = offsetX + 8;
    const bW = HALF - 16;

    setDraw(doc, [160, 160, 160]);
    doc.setLineWidth(0.6);
    doc.rect(offsetX + 4, 4, HALF - 8, PH_L - 8);

    setFill(doc, BLUE_DARK);
    doc.rect(offsetX + 4, 4, HALF - 8, 16, "F");
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    setColor(doc, [255, 255, 255]);
    doc.text(client, bM + 2, 14);
    doc.setFontSize(12);
    doc.text("ID " + regId, bM + bW, 14, { align: "right" });

    let y = 26;
    const s1H = 22;
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.rect(bM, y, bW, s1H);
    const colW = bW / 3;
    doc.line(bM + colW, y, bM + colW, y + s1H);
    doc.line(bM + colW * 2, y, bM + colW * 2, y + s1H);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, GRAY_LABEL);
    doc.text("N PLACA", bM + colW * 0.5, y + 5, { align: "center" });
    doc.text("N BARRIL", bM + colW * 1.5, y + 5, { align: "center" });
    doc.text("DATA", bM + colW * 2.5, y + 5, { align: "center" });
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    doc.text(String(vasilhame.placa || "-"), bM + colW * 0.5, y + 16, {
      align: "center",
    });
    doc.text(String(vasilhame.barril || "-"), bM + colW * 1.5, y + 16, {
      align: "center",
    });
    doc.text(envaseDate, bM + colW * 2.5, y + 16, { align: "center" });

    y += s1H + 4;
    const s2H = 26;
    const s2rowH = s2H / 2;
    doc.rect(bM, y, bW, s2H);
    doc.line(bM, y + s2rowH, bM + bW, y + s2rowH);
    const r1cy = y + s2rowH / 2;
    const r2cy = y + s2rowH + s2rowH / 2;
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, GRAY_LABEL);
    doc.text("PRODUTO", bM + 3, r1cy - 2);
    doc.text("CLIENTE", bM + 3, r2cy - 2);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    doc.text(String(vasilhame.produto_nome || "-"), bM + bW / 2, r1cy + 2.5, {
      align: "center",
    });
    doc.text(String(client), bM + bW / 2, r2cy + 2.5, { align: "center" });

    y += s2H + 4;
    const s3H = 42;
    doc.rect(bM, y, bW, s3H);
    doc.line(bM + bW * 0.5, y, bM + bW * 0.5, y + s3H);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, GRAY_LABEL);
    doc.text("LACRES", bM + 2, y + 5);
    const seals = String(vasilhame.lacres || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(doc, BLACK);
    if (seals.length === 0) {
      doc.text("-", bM + 2, y + 12);
    } else {
      seals.slice(0, 6).forEach((s, i) => {
        doc.text(s, bM + 2, y + 12 + i * 4.5);
      });
    }
    const rightCellX = bM + bW * 0.5;
    const rightCellW = bW * 0.5;
    const rightCX = rightCellX + rightCellW / 2;
    const s3RowH = s3H / 3;
    const rightItems = [
      { label: "ESLINGA", value: String(vasilhame.eslinga || "-") },
      { label: "GPS", value: String(vasilhame.gps || "-") },
      {
        label: "MENOR TESTE",
        value: vasilhame.menor_teste ? fmtDate(vasilhame.menor_teste) : "-",
      },
    ];
    rightItems.forEach((item, i) => {
      const rowY = y + i * s3RowH;
      if (i > 0) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.2);
        doc.line(rightCellX, rowY, rightCellX + rightCellW, rowY);
      }
      const cy = rowY + s3RowH / 2;
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(doc, GRAY_LABEL);
      doc.text(item.label, rightCX, cy - 2, { align: "center" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      setColor(doc, BLACK);
      doc.text(item.value, rightCX, cy + 3, { align: "center" });
    });

    y += s3H + 4;
    const s4H = 34;
    doc.rect(bM, y, bW, s4H);
    doc.line(bM + bW * 0.38, y, bM + bW * 0.38, y + s4H);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, GRAY_LABEL);
    doc.text("RESPONSÁVEL", bM + 2, y + 5);
    setFill(doc, [245, 245, 245]);
    doc.rect(bM + 2, y + 8, bW * 0.38 - 4, 22, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    doc.text(String(vasilhame.responsavel || "-"), bM + bW * 0.19, y + 22, {
      align: "center",
    });
    const wCellX = bM + bW * 0.38;
    const wCellW = bW * 0.62;
    const wCX = wCellX + wCellW / 2;
    const wRowH = s4H / 3;
    const weightRows = [
      { label: "TARA", value: fmtNum(tara, 3) + " kg" },
      { label: "PESO LÍQUIDO", value: fmtNum(netWeight, 0) + " kg" },
      { label: "PESO BRUTO", value: fmtNum(grossWeight, 0) + " kg" },
    ];
    weightRows.forEach((r, i) => {
      const rowY = y + i * wRowH;
      if (i > 0) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.2);
        doc.line(wCellX, rowY, wCellX + wCellW, rowY);
      }
      const cy = rowY + wRowH / 2;
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(doc, GRAY_LABEL);
      doc.text(r.label, wCX, cy - 2, { align: "center" });
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      setColor(doc, BLACK);
      doc.text(r.value, wCX, cy + 3, { align: "center" });
    });

    y += s4H + 4;
    const s5H = 20;
    setFill(doc, [240, 245, 255]);
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.4);
    doc.rect(bM, y, bW, s5H, "FD");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLUE_DARK);
    doc.text("QUANTIDADE ENVASADA", bM + 4, y + 8);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    doc.text(fmtNum(volume, 0) + " L", bM + bW - 4, y + 13, {
      align: "right",
    });
  }

  drawSide(0);
  drawSide(HALF);

  const fileBase =
    vasilhame.placa || vasilhame.codigo || vasilhame.id || "vasilhame";
  doc.save(`${fileBase} - Boleta.pdf`);
}

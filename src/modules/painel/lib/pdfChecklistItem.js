import { jsPDF } from 'jspdf';
import {
  CHECK_ANSWER,
  CHECKLIST_KIND,
  checksForKind,
  normalizeCheckValue,
} from '@painel/lib/carregamentoChecklistConfig';

const M = 14;
const PW = 210;
const PH = 297;
const CW = PW - 2 * M;
const FOTOS_POR_PAGINA = 2;

const BLUE_DARK = [28, 53, 91];
const BLUE_MID = [37, 99, 195];
const GRAY_LABEL = [130, 140, 155];
const GRAY_ROW = [248, 249, 251];
const GRAY_BORDER = [220, 224, 230];
const BLACK = [30, 30, 30];
const GREEN = [4, 120, 87];
const RED = [185, 28, 28];
const SLATE = [71, 85, 105];

function setColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function fmtDate(d, language = 'pt-BR') {
  if (!d) return '-';
  const raw = String(d);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtDateTime(d, language = 'pt-BR') {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safePdfFilenamePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY_LABEL);
  doc.text(subtitle || '', M, 29);
  setDraw(doc, BLUE_MID);
  doc.setLineWidth(0.6);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.2);
  return 40;
}

function addFooter(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 13, PW - M, PH - 13);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text('ChemCtrl - Sistema de Controle de Produção', M, PH - 8);
    doc.text(`Página ${i} de ${pages}`, PW - M, PH - 8, { align: 'right' });
  }
}

function addSectionTitle(doc, y, title) {
  setFill(doc, BLUE_MID);
  doc.rect(M, y, 2.5, 7, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(title, M + 5, y + 5.5);
  setColor(doc, BLACK);
  return y + 11;
}

function addInfoGrid(doc, y, pairs, cols = 3) {
  const colW = CW / cols;
  const rowsData = [];
  let currentRow = [];
  let usedCols = 0;
  for (const p of pairs) {
    const span = p[2] || 1;
    if (usedCols + span > cols && currentRow.length > 0) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
    currentRow.push({ label: p[0], value: p[1], span });
    usedCols += span;
    if (usedCols >= cols) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
  }
  if (currentRow.length > 0) rowsData.push(currentRow);

  const rowHeights = rowsData.map((row) => {
    let maxH = 14;
    row.forEach((cell) => {
      const cellW = colW * cell.span - 6;
      const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), cellW);
      const textH = 5 + lines.length * 4.5 + 4;
      if (textH > maxH) maxH = textH;
    });
    return maxH;
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  setDraw(doc, GRAY_BORDER);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, totalH);

  let yy = y;
  rowsData.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    let x = M;
    row.forEach((cell) => {
      const cellW = colW * cell.span;
      if (x > M) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.3);
        doc.line(x, yy, x, yy + rowH);
      }
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(doc, GRAY_LABEL);
      doc.text(String(cell.label).toUpperCase(), x + 3, yy + 4.5);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, BLACK);
      const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), cellW - 6);
      doc.text(lines, x + 3, yy + 10);
      x += cellW;
    });
    if (ri < rowsData.length - 1) {
      setDraw(doc, GRAY_BORDER);
      doc.setLineWidth(0.3);
      doc.line(M, yy + rowH, M + CW, yy + rowH);
    }
    yy += rowH;
  });

  setColor(doc, BLACK);
  return y + totalH + 5;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PH - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

function addSimpleTable(doc, y, headers, rows, colWidths) {
  const widths = colWidths || headers.map(() => CW / headers.length);
  const hdrH = 8;
  const rowH = 8;

  const drawHeader = (yy) => {
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, hdrH, 'F');
    let x = M;
    headers.forEach((h, i) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      setColor(doc, [255, 255, 255]);
      doc.text(String(h), x + widths[i] / 2, yy + hdrH / 2, {
        align: 'center',
        baseline: 'middle',
      });
      x += widths[i];
    });
    return yy + hdrH;
  };

  y = drawHeader(y);

  rows.forEach((row, ri) => {
    if (y + rowH > PH - 20) {
      doc.addPage();
      y = 20;
      y = drawHeader(y);
    }
    if (ri % 2 === 0) {
      setFill(doc, GRAY_ROW);
      doc.rect(M, y, CW, rowH, 'F');
    }
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);
    let x = M;
    row.forEach((cell, i) => {
      const isAnswer = i === 1;
      const answer = String(cell?.value ?? cell ?? '-');
      const color = cell?.color || BLACK;
      doc.setFont('helvetica', isAnswer ? 'bold' : 'normal');
      doc.setFontSize(8);
      setColor(doc, color);
      const text = String(isAnswer ? answer : cell?.value ?? cell ?? '-');
      const align = isAnswer ? 'center' : 'left';
      const tx = isAnswer ? x + widths[i] / 2 : x + 3;
      doc.text(text, tx, y + rowH / 2, { align, baseline: 'middle' });
      x += widths[i];
    });
    y += rowH;
  });

  setColor(doc, BLACK);
  return y + 4;
}

function answerMeta(answer, t) {
  if (answer === CHECK_ANSWER.APROVADO) {
    return {
      label: t('painel.comercial.agendamentos.checklist.answers.aprovado'),
      color: GREEN,
    };
  }
  if (answer === CHECK_ANSWER.REPROVADO) {
    return {
      label: t('painel.comercial.agendamentos.checklist.answers.reprovado'),
      color: RED,
    };
  }
  if (answer === CHECK_ANSWER.NAO_SE_APLICA) {
    return {
      label: t('painel.comercial.agendamentos.checklist.answers.naoSeAplica'),
      color: SLATE,
    };
  }
  return { label: '-', color: GRAY_LABEL };
}

function statusLabel(status, t) {
  const key =
    {
      aprovado: 'aprovado',
      reprovado: 'reprovado',
      em_conferencia: 'emConferencia',
      pendente: 'pendente',
    }[status] || 'pendente';
  return t(`painel.comercial.agendamentos.checklist.status.${key}`);
}

async function urlToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, mime: blob.type || '' });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function imageFormatFromMime(mime, dataUrl) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png') || String(dataUrl).startsWith('data:image/png')) return 'PNG';
  if (m.includes('webp')) return 'WEBP';
  return 'JPEG';
}

/**
 * Gera PDF A4 retrato do checklist do item (mesmo layout visual dos relatórios ChemCtrl).
 * Página 1: dados + verificações. Fotos a partir da página 2 (2 por folha).
 */
export async function generateChecklistItemPDF({
  item,
  saida,
  fotoUrls = [],
  t,
  language = 'pt-BR',
} = {}) {
  if (!item) return;

  const saidaCodigo = saida?.codigo || item.saida_codigo || '';
  const itemLabel = item.label || item.produto || '';
  const title =
    saidaCodigo && itemLabel
      ? `Checklist — ${saidaCodigo}`
      : 'Checklist de carregamento';
  const subtitle = itemLabel || t('painel.logistica.carregamentos.checklistItemTitle');

  const doc = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' });
  let y = addPageTitle(doc, title, subtitle);

  // Status
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const st = String(item.status || 'pendente');
  const stColor =
    st === 'aprovado' ? GREEN : st === 'reprovado' ? RED : st === 'em_conferencia' ? [146, 64, 14] : GRAY_LABEL;
  setColor(doc, stColor);
  doc.text(statusLabel(item.status, t).toUpperCase(), M, y);
  setColor(doc, BLACK);
  y += 6;

  const infoPairs = [
    [t('painel.comercial.agendamentos.checklist.fields.produto'), item.produto || '-'],
    [t('painel.comercial.agendamentos.checklist.fields.tipo'), item.tipo_label || '-'],
    [t('painel.comercial.agendamentos.checklist.fields.lote'), item.lote || '-'],
    [t('painel.comercial.agendamentos.checklist.fields.quantidade'), item.quantidade || '-'],
    [
      t('painel.comercial.agendamentos.checklist.fields.fabricacao'),
      fmtDate(item.data_fabricacao, language),
    ],
    [
      t('painel.comercial.agendamentos.checklist.fields.validade'),
      fmtDate(item.data_validade, language),
    ],
  ];

  if (item.kind === CHECKLIST_KIND.CONVENCIONAL) {
    infoPairs.push([
      t('painel.comercial.agendamentos.checklist.fields.tanque'),
      [item.vasilhame_placa, item.vasilhame_barril].filter(Boolean).join(' / ') || '-',
    ]);
  }

  y = addInfoGrid(doc, y, infoPairs, 3);

  if (item.kind === CHECKLIST_KIND.CONVENCIONAL && Array.isArray(item.lacres) && item.lacres.length) {
    y = ensureSpace(doc, y, 24);
    y = addSectionTitle(
      doc,
      y,
      t('painel.comercial.agendamentos.checklist.sections.lacres')
    );
    const lacresText = item.lacres.map((l) => l.numero).filter(Boolean).join('   ·   ') || '-';
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    const lines = doc.splitTextToSize(lacresText, CW);
    doc.text(lines, M, y);
    y += lines.length * 5 + 4;
  }

  const checkDefs = checksForKind(item.kind);
  const sections = [...new Set(checkDefs.map((c) => c.section))];

  for (const section of sections) {
    y = ensureSpace(doc, y, 28);
    y = addSectionTitle(
      doc,
      y,
      t(`painel.comercial.agendamentos.checklist.sections.${section}`, {
        defaultValue: section,
      })
    );
    const rows = checkDefs
      .filter((c) => c.section === section)
      .map((c) => {
        const answer = normalizeCheckValue(item.checks?.[c.key]);
        const meta = answerMeta(answer, t);
        return [{ value: t(c.labelKey) }, { value: meta.label, color: meta.color }];
      });
    y = addSimpleTable(
      doc,
      y,
      ['Verificação', 'Resultado'],
      rows,
      [CW * 0.68, CW * 0.32]
    );
  }

  if (item.conferido_em) {
    y = ensureSpace(doc, y, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text(
      t('painel.comercial.agendamentos.checklist.itemValidatedAt', {
        date: fmtDateTime(item.conferido_em, language),
        operador: item.conferido_por_nome || '—',
      }),
      M,
      y
    );
    y += 6;
  }

  const urls = (fotoUrls || []).filter(Boolean);
  if (urls.length === 0) {
    y = ensureSpace(doc, y, 20);
    y = addSectionTitle(
      doc,
      y,
      t('painel.comercial.agendamentos.checklist.sections.fotos')
    );
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text(t('painel.logistica.carregamentos.checklistNoPhotos'), M, y);
  } else {
    const loaded = [];
    for (const url of urls) {
      try {
        const img = await urlToDataUrl(url);
        loaded.push(img);
      } catch {
        // ignora foto que falhou ao carregar
      }
    }

    const totalPages = Math.ceil(loaded.length / FOTOS_POR_PAGINA) || 1;
    for (let pageIndex = 0; pageIndex < loaded.length; pageIndex += FOTOS_POR_PAGINA) {
      doc.addPage();
      let py = addPageTitle(
        doc,
        t('painel.comercial.agendamentos.checklist.sections.fotos'),
        totalPages > 1
          ? `${saidaCodigo} — ${pageIndex / FOTOS_POR_PAGINA + 1}/${totalPages}`
          : String(saidaCodigo || itemLabel)
      );

      const pair = loaded.slice(pageIndex, pageIndex + FOTOS_POR_PAGINA);
      const gap = 8;
      const usableH = PH - py - 20 - gap;
      const slotH = usableH / FOTOS_POR_PAGINA;

      pair.forEach((img, i) => {
        const slotY = py + i * (slotH + gap);
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(M, slotY, CW, slotH, 2, 2, 'S');

        const pad = 4;
        const maxW = CW - pad * 2;
        const maxH = slotH - pad * 2;
        const format = imageFormatFromMime(img.mime, img.dataUrl);

        // Mantém proporção aproximada 4:3 dentro do slot
        let imgW = maxW;
        let imgH = maxW * 0.75;
        if (imgH > maxH) {
          imgH = maxH;
          imgW = maxH / 0.75;
        }
        const imgX = M + (CW - imgW) / 2;
        const imgY = slotY + (slotH - imgH) / 2;

        try {
          doc.addImage(img.dataUrl, format, imgX, imgY, imgW, imgH, undefined, 'FAST');
        } catch {
          try {
            doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, imgW, imgH, undefined, 'FAST');
          } catch {
            doc.setFontSize(8);
            setColor(doc, GRAY_LABEL);
            doc.text('Não foi possível renderizar a foto', M + pad, slotY + 10);
          }
        }
      });
    }
  }

  addFooter(doc);

  const fileBase =
    safePdfFilenamePart(saidaCodigo) ||
    safePdfFilenamePart(item.produto) ||
    'checklist';
  doc.save(`${fileBase} - Checklist.pdf`);
}
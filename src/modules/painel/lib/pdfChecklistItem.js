import { jsPDF } from 'jspdf';
import {
  CHECK_ANSWER,
  CHECKLIST_KIND,
  ESLINGA_COLOR_SECTION,
  VALIDADE_TESTES_SECTION,
  checkDefLabel,
  checkDefsForItem,
  normalizeCheckValue,
} from '@painel/lib/carregamentoChecklistConfig';
import { formatDataLimiteTestes } from '@painel/lib/validadeTestesTanque';

const M = 14;
const PW = 210;
const PH = 297;
const CW = PW - 2 * M;
const FOOTER_Y = PH - 18;
const CONTENT_BOTTOM = PH - 20;

const CARD_R = 2.5;
const CARD_GAP = 3;
const CARD_PAD = 4;
const COL_GAP = 3;

const BLUE = [40, 100, 215];
const BLUE_DARK = [29, 53, 87];
const BG_SOFT = [245, 247, 250];
const BORDER = [220, 227, 237];
const TEXT = [31, 41, 55];
const MUTED = [100, 116, 139];
const WHITE = [255, 255, 255];

const GREEN_BG = [220, 252, 231];
const GREEN_FG = [22, 101, 52];
const RED_BG = [254, 226, 226];
const RED_FG = [153, 27, 27];
const AMBER_BG = [254, 243, 199];
const AMBER_FG = [146, 64, 14];
const NEUTRAL_BG = [241, 245, 249];
const NEUTRAL_FG = [71, 85, 105];

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

function hexFallback(t, key, fallback, vars) {
  if (typeof t !== 'function') return fallback;
  const value = t(key, { defaultValue: fallback, ...(vars || {}) });
  return value == null || value === key ? fallback : value;
}

function statusMeta(status, t) {
  const st = String(status || 'pendente');
  if (st === 'aprovado') {
    return {
      label: hexFallback(t, 'painel.comercial.agendamentos.checklist.status.aprovado', 'Aprovado'),
      bg: GREEN_BG,
      fg: GREEN_FG,
      icon: 'check',
    };
  }
  if (st === 'reprovado') {
    return {
      label: hexFallback(t, 'painel.comercial.agendamentos.checklist.status.reprovado', 'Reprovado'),
      bg: RED_BG,
      fg: RED_FG,
      icon: 'x',
    };
  }
  if (st === 'em_conferencia') {
    return {
      label: hexFallback(
        t,
        'painel.comercial.agendamentos.checklist.status.emConferencia',
        'Em conferência'
      ),
      bg: AMBER_BG,
      fg: AMBER_FG,
      icon: 'dot',
    };
  }
  return {
    label: hexFallback(t, 'painel.comercial.agendamentos.checklist.status.pendente', 'Pendente'),
    bg: NEUTRAL_BG,
    fg: NEUTRAL_FG,
    icon: 'dot',
  };
}

function answerMeta(answer, t) {
  if (answer === CHECK_ANSWER.APROVADO) {
    return {
      label: hexFallback(
        t,
        'painel.comercial.agendamentos.checklist.answers.aprovado',
        'Aprovado'
      ),
      bg: GREEN_BG,
      fg: GREEN_FG,
      icon: 'check',
    };
  }
  if (answer === CHECK_ANSWER.REPROVADO) {
    return {
      label: hexFallback(
        t,
        'painel.comercial.agendamentos.checklist.answers.reprovado',
        'Reprovado'
      ),
      bg: RED_BG,
      fg: RED_FG,
      icon: 'x',
    };
  }
  if (answer === CHECK_ANSWER.NAO_SE_APLICA) {
    return {
      label: hexFallback(
        t,
        'painel.comercial.agendamentos.checklist.answers.naoSeAplica',
        'Não se aplica'
      ),
      bg: NEUTRAL_BG,
      fg: NEUTRAL_FG,
      icon: 'dash',
    };
  }
  return {
    label: hexFallback(t, 'painel.comercial.agendamentos.checklist.status.pendente', 'Pendente'),
    bg: AMBER_BG,
    fg: AMBER_FG,
    icon: 'dot',
  };
}

/**
 * Rótulo da verificação de validade dos testes com destino, prazo e data limite
 * usados na conferência (snapshot gravado no item).
 */
function validadeTestesLabel(base, validade, t, language) {
  const prefix = 'painel.comercial.agendamentos.checklist.validadeTestes';
  const parts = [];
  if (validade.destino) parts.push(`${t(`${prefix}.destino`)}: ${validade.destino}`);
  if (validade.configurado === false || validade.dias == null) {
    parts.push(t(`${prefix}.naoConfigurado`));
  } else {
    parts.push(t(`${prefix}.prazoDias`, { dias: validade.dias }));
    parts.push(
      `${t(`${prefix}.limiteCurto`)} ${formatDataLimiteTestes(validade.data_limite, language)}`
    );
  }
  return `${base} (${parts.join(' · ')})`;
}

function eslingaColorLabel(base, colorCod, t) {
  if (!colorCod) return base;
  const name = hexFallback(
    t,
    `painel.configuracao.checklistExpedicao.validadeTestes.destinos.colorOptions.${colorCod}`,
    colorCod
  );
  return `${base} (${name})`;
}

function drawIcon(doc, type, x, y, size, rgb) {
  setDraw(doc, rgb);
  doc.setLineWidth(0.45);
  const s = size;
  if (type === 'check') {
    doc.line(x, y, x + s * 0.35, y + s * 0.35);
    doc.line(x + s * 0.35, y + s * 0.35, x + s, y - s * 0.45);
  } else if (type === 'x') {
    doc.line(x, y - s * 0.35, x + s, y + s * 0.35);
    doc.line(x, y + s * 0.35, x + s, y - s * 0.35);
  } else if (type === 'dash') {
    doc.line(x, y, x + s, y);
  } else {
    setFill(doc, rgb);
    doc.circle(x + s / 2, y, s * 0.28, 'F');
  }
  doc.setLineWidth(0.2);
}

function drawPillBadge(doc, x, y, label, { bg, fg, icon }, opts = {}) {
  const fontSize = opts.fontSize || 7.5;
  const padX = opts.padX || 3.2;
  const h = opts.height || 6.2;
  const iconSize = opts.iconSize || 2.2;
  const iconGap = opts.iconGap || 1.6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const textW = doc.getTextWidth(String(label).toUpperCase());
  const iconW = icon ? iconSize + iconGap : 0;
  const w = Math.max(opts.minWidth || 0, padX * 2 + iconW + textW);
  const r = h / 2;

  setFill(doc, bg);
  setDraw(doc, bg);
  doc.roundedRect(x, y, w, h, r, r, 'F');

  if (icon) {
    drawIcon(doc, icon, x + padX, y + h / 2, iconSize, fg);
  }
  setColor(doc, fg);
  doc.text(String(label).toUpperCase(), x + padX + iconW, y + h / 2, {
    baseline: 'middle',
  });
  setColor(doc, TEXT);
  return w;
}

function measurePillWidth(doc, label, opts = {}) {
  const fontSize = opts.fontSize || 7.5;
  const padX = opts.padX || 3.2;
  const iconSize = opts.iconSize || 2.2;
  const iconGap = opts.iconGap || 1.6;
  const withIcon = opts.withIcon !== false;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const textW = doc.getTextWidth(String(label).toUpperCase());
  const iconW = withIcon ? iconSize + iconGap : 0;
  return Math.max(opts.minWidth || 0, padX * 2 + iconW + textW);
}

function drawCard(doc, x, y, w, h, { fill = WHITE, stroke = BORDER } = {}) {
  setFill(doc, fill);
  setDraw(doc, stroke);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, CARD_R, CARD_R, 'FD');
  doc.setLineWidth(0.2);
}

function drawSectionTitle(doc, y, title) {
  setFill(doc, BLUE);
  doc.roundedRect(M, y + 0.5, 2, 6, 0.6, 0.6, 'F');
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(String(title), M + 5, y + 5);
  setColor(doc, TEXT);
  return y + 10;
}

function buildPageCtx(item, saida, t, language) {
  const saidaCodigo = saida?.codigo || item.saida_codigo || '';
  const itemLabel = item.label || item.produto || '';
  const subtitleParts = [saidaCodigo, itemLabel].filter(Boolean);
  return {
    title: hexFallback(
      t,
      'painel.comercial.agendamentos.checklist.pdf.documentTitle',
      'Checklist de Conferência de Carga'
    ),
    subtitle: subtitleParts.join(' · '),
    saidaCodigo,
    itemLabel,
    status: statusMeta(item.status, t),
    conferidoEm: item.conferido_em ? fmtDateTime(item.conferido_em, language) : '',
    conferidoPor: item.conferido_por_nome || '',
    conferidoLine: item.conferido_em
      ? hexFallback(
          t,
          'painel.comercial.agendamentos.checklist.itemValidatedAt',
          `Conferido em ${fmtDateTime(item.conferido_em, language)} por ${item.conferido_por_nome || '—'}`,
          {
            date: fmtDateTime(item.conferido_em, language),
            operador: item.conferido_por_nome || '—',
          }
        )
      : '',
    t,
    language,
  };
}

function drawMainHeader(doc, ctx) {
  let y = 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(doc, MUTED);
  doc.text('ChemCtrl', M, y + 4);

  const badgeW = measurePillWidth(doc, ctx.status.label, { fontSize: 7, height: 5.8 });
  drawPillBadge(doc, PW - M - badgeW, y, ctx.status.label, ctx.status, {
    fontSize: 7,
    height: 5.8,
  });

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  setColor(doc, BLUE_DARK);
  doc.text(ctx.title, M, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setColor(doc, MUTED);
  const subtitle = ctx.subtitle || '—';
  doc.text(subtitle, M, y);

  if (ctx.conferidoLine) {
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(ctx.conferidoLine, CW * 0.42);
    doc.text(lines, PW - M, y, { align: 'right' });
  }

  y += 5;
  setDraw(doc, BLUE);
  doc.setLineWidth(0.5);
  doc.line(M, y, PW - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 6;
}

function drawContinuedHeader(doc, ctx) {
  let y = 12;
  const badgeW = measurePillWidth(doc, ctx.status.label, {
    fontSize: 6.5,
    height: 5.2,
    padX: 2.6,
    iconSize: 1.8,
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setColor(doc, MUTED);
  const leftMax = CW - badgeW - 6;
  const left = doc.splitTextToSize(
    `${ctx.title} · ${ctx.subtitle || ''}`.trim(),
    Math.max(40, leftMax)
  )[0];
  doc.text(left, M, y + 3);
  drawPillBadge(doc, PW - M - badgeW, y, ctx.status.label, ctx.status, {
    fontSize: 6.5,
    height: 5.2,
    padX: 2.6,
    iconSize: 1.8,
  });
  y += 8;
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(M, y, PW - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 5;
}

function ensureSpace(doc, y, needed, ctx) {
  if (y + needed <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return drawContinuedHeader(doc, ctx);
}

function addFooter(doc, ctx) {
  const pages = doc.internal.getNumberOfPages();
  const footerText = hexFallback(
    ctx.t,
    'pdf.footer',
    'ChemCtrl - Sistema de Controle de Produção'
  );
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(doc, BORDER);
    doc.setLineWidth(0.25);
    doc.line(M, FOOTER_Y, PW - M, FOOTER_Y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setColor(doc, MUTED);
    doc.text(footerText, M, FOOTER_Y + 5);

    const center = [ctx.conferidoLine, ctx.saidaCodigo].filter(Boolean).join(' · ');
    if (center) {
      const clipped = doc.splitTextToSize(center, CW * 0.42)[0] || center;
      doc.text(clipped, PW / 2, FOOTER_Y + 5, { align: 'center' });
    }

    const pageLabel = hexFallback(ctx.t, 'pdf.page', `Página ${i} de ${pages}`, {
      current: i,
      total: pages,
    });
    doc.text(pageLabel, PW - M, FOOTER_Y + 5, { align: 'right' });
  }
  setColor(doc, TEXT);
}

function addInfoCards(doc, y, pairs, cols, ctx) {
  const colW = (CW - COL_GAP * (cols - 1)) / cols;
  const labelFs = 6.5;
  const valueFs = 9.5;
  const lineH = 4;
  const padTop = 3.2;
  const padLabelGap = 4.8;
  const padBottom = 3.2;

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
    currentRow.push({
      label: p[0],
      value: p[1],
      span,
      emphasize: Boolean(p[3]),
    });
    usedCols += span;
    if (usedCols >= cols) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
  }
  if (currentRow.length > 0) rowsData.push(currentRow);

  const measureLines = (text, width, emphasize) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(emphasize ? 11 : valueFs);
    return doc.splitTextToSize(String(text != null && text !== '' ? text : '-'), Math.max(8, width));
  };

  for (const row of rowsData) {
    const spanSum = row.reduce((acc, cell) => acc + cell.span, 0);
    // Linha incompleta: redistribui a largura igualmente entre os cards da linha.
    const stretch = spanSum < cols;
    const unitW = stretch
      ? (CW - COL_GAP * (row.length - 1)) / spanSum
      : colW;

    let maxH = padTop + padLabelGap + lineH + padBottom;
    row.forEach((cell) => {
      const cellW = unitW * cell.span + (stretch ? 0 : COL_GAP * (cell.span - 1));
      const lines = measureLines(cell.value, cellW - CARD_PAD * 2, cell.emphasize);
      const textH = padTop + padLabelGap + lines.length * lineH + padBottom;
      if (textH > maxH) maxH = textH;
    });

    y = ensureSpace(doc, y, maxH + CARD_GAP, ctx);

    let x = M;
    row.forEach((cell) => {
      const cellW = unitW * cell.span + (stretch ? 0 : COL_GAP * (cell.span - 1));
      drawCard(doc, x, y, cellW, maxH, {
        fill: cell.emphasize ? BG_SOFT : WHITE,
      });

      doc.setFontSize(labelFs);
      doc.setFont('helvetica', 'bold');
      setColor(doc, MUTED);
      doc.text(String(cell.label).toUpperCase(), x + CARD_PAD, y + padTop + 1.5);

      const lines = measureLines(cell.value, cellW - CARD_PAD * 2, cell.emphasize);
      setColor(doc, TEXT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(cell.emphasize ? 11 : valueFs);
      doc.text(lines, x + CARD_PAD, y + padTop + padLabelGap);
      x += cellW + COL_GAP;
    });

    y += maxH + CARD_GAP;
  }

  setColor(doc, TEXT);
  return y + 1;
}

function addLacresSection(doc, y, lacres, title, ctx) {
  const numbers = (lacres || []).map((l) => l.numero).filter(Boolean);
  if (!numbers.length) return y;

  const chipPadX = 2.8;
  const chipH = 7;
  const chipGap = 2.2;
  const chipFs = 9;
  const titleH = 8;
  const pad = CARD_PAD;

  doc.setFont('courier', 'bold');
  doc.setFontSize(chipFs);
  const chipWidths = numbers.map(
    (n) => doc.getTextWidth(String(n)) + chipPadX * 2
  );

  const lines = [];
  let current = [];
  let used = 0;
  const innerW = CW - pad * 2;
  chipWidths.forEach((w, i) => {
    const next = used === 0 ? w : used + chipGap + w;
    if (next > innerW && current.length) {
      lines.push(current);
      current = [i];
      used = w;
    } else {
      current.push(i);
      used = next;
    }
  });
  if (current.length) lines.push(current);

  const bodyH = lines.length * chipH + Math.max(0, lines.length - 1) * chipGap;
  const totalH = pad + titleH + bodyH + pad;

  y = ensureSpace(doc, y, totalH + 2, ctx);
  drawCard(doc, M, y, CW, totalH);

  setFill(doc, BLUE);
  doc.roundedRect(M + pad, y + pad + 0.4, 1.8, 5.2, 0.5, 0.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setColor(doc, BLUE_DARK);
  doc.text(String(title), M + pad + 4, y + pad + 4.5);

  let cy = y + pad + titleH;
  lines.forEach((idxs) => {
    let cx = M + pad;
    idxs.forEach((i) => {
      const w = chipWidths[i];
      setFill(doc, BG_SOFT);
      setDraw(doc, BORDER);
      doc.setLineWidth(0.2);
      doc.roundedRect(cx, cy, w, chipH, 1.6, 1.6, 'FD');
      doc.setFont('courier', 'bold');
      doc.setFontSize(chipFs);
      setColor(doc, TEXT);
      doc.text(String(numbers[i]), cx + chipPadX, cy + chipH / 2, {
        baseline: 'middle',
      });
      cx += w + chipGap;
    });
    cy += chipH + chipGap;
  });

  setColor(doc, TEXT);
  return y + totalH + CARD_GAP + 1;
}

function measureCheckCard(doc, label, meta) {
  const badgeW = measurePillWidth(doc, meta.label, {
    fontSize: 7,
    padX: 2.8,
    iconSize: 2,
  });
  const textMaxW = CW - CARD_PAD * 2 - badgeW - 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const lines = doc.splitTextToSize(String(label || '-'), Math.max(20, textMaxW));
  const textH = Math.max(lines.length * 3.8, 5);
  const h = Math.max(11, CARD_PAD + 3.2 + textH + CARD_PAD);
  return { h, lines, badgeW, textMaxW };
}

function addCheckCard(doc, y, index, label, meta, ctx) {
  const measured = measureCheckCard(doc, label, meta);
  y = ensureSpace(doc, y, measured.h + 1.5, ctx);

  drawCard(doc, M, y, CW, measured.h);

  const num = String(index).padStart(2, '0');
  const numLabel = hexFallback(
    ctx.t,
    'painel.comercial.agendamentos.checklist.pdf.verification',
    `Verificação ${num}`,
    { n: num }
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  setColor(doc, MUTED);
  doc.text(numLabel, M + CARD_PAD, y + CARD_PAD + 1.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setColor(doc, TEXT);
  doc.text(measured.lines, M + CARD_PAD, y + CARD_PAD + 5.2);

  const badgeH = 5.8;
  const badgeX = M + CW - CARD_PAD - measured.badgeW;
  const badgeY = y + (measured.h - badgeH) / 2;
  drawPillBadge(doc, badgeX, badgeY, meta.label, meta, {
    fontSize: 7,
    height: badgeH,
    padX: 2.8,
    iconSize: 2,
  });

  return y + measured.h + 2;
}

function addPhotosSection(doc, y, loaded, title, emptyMessage, ctx) {
  y = ensureSpace(doc, y, 24, ctx);
  y = drawSectionTitle(doc, y, title);

  if (!loaded.length) {
    y = ensureSpace(doc, y, 12, ctx);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MUTED);
    doc.text(emptyMessage, M, y + 3);
    setColor(doc, TEXT);
    return y + 8;
  }

  const cols = 2;
  const gap = COL_GAP;
  const cellW = (CW - gap * (cols - 1)) / cols;
  const maxImgH = 95;
  const pad = 3.5;

  for (let i = 0; i < loaded.length; i += cols) {
    const pair = loaded.slice(i, i + cols);
    const sizes = pair.map((img) => {
      const ratio = img.width > 0 && img.height > 0 ? img.height / img.width : 0.75;
      const innerW = cellW - pad * 2;
      let imgW = innerW;
      let imgH = innerW * ratio;
      if (imgH > maxImgH) {
        imgH = maxImgH;
        imgW = maxImgH / ratio;
      }
      const cardH = imgH + pad * 2;
      return { imgW, imgH, cardH, format: imageFormatFromMime(img.mime, img.dataUrl) };
    });
    const rowH = Math.max(...sizes.map((s) => s.cardH));

    y = ensureSpace(doc, y, rowH + CARD_GAP, ctx);

    pair.forEach((img, idx) => {
      const size = sizes[idx];
      const x = M + idx * (cellW + gap);
      drawCard(doc, x, y, cellW, rowH);

      const imgX = x + (cellW - size.imgW) / 2;
      const imgY = y + (rowH - size.imgH) / 2;
      try {
        doc.addImage(img.dataUrl, size.format, imgX, imgY, size.imgW, size.imgH, undefined, 'FAST');
      } catch {
        try {
          doc.addImage(img.dataUrl, 'JPEG', imgX, imgY, size.imgW, size.imgH, undefined, 'FAST');
        } catch {
          doc.setFontSize(8);
          setColor(doc, MUTED);
          doc.text('Não foi possível renderizar a foto', x + pad, y + 10);
          setColor(doc, TEXT);
        }
      }
    });

    y += rowH + CARD_GAP;
  }

  return y;
}

/** Maior lado da foto no PDF (px): mantém boa nitidez sem inflar o arquivo. */
const FOTO_MAX_PX = 1800;
const FOTO_JPEG_QUALITY = 0.85;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Decodifica o blob já aplicando a orientação EXIF (fotos de celular vêm
 * "deitadas" com a rotação só no metadado, que o jsPDF ignora).
 */
async function decodeUprightImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // cai no fallback via <img>
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Baixa a foto e a normaliza para JPEG na orientação correta, devolvendo também
 * as dimensões reais para preservar a proporção no PDF.
 * Se não for possível decodificar, usa o arquivo original sem dimensões.
 */
async function urlToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();

  try {
    const source = await decodeUprightImage(blob);
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    if (!srcW || !srcH) throw new Error('Imagem sem dimensões');

    const scale = Math.min(1, FOTO_MAX_PX / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    source.close?.();

    return {
      dataUrl: canvas.toDataURL('image/jpeg', FOTO_JPEG_QUALITY),
      mime: 'image/jpeg',
      width,
      height,
    };
  } catch {
    return { dataUrl: await blobToDataUrl(blob), mime: blob.type || '', width: 0, height: 0 };
  }
}

function imageFormatFromMime(mime, dataUrl) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png') || String(dataUrl).startsWith('data:image/png')) return 'PNG';
  if (m.includes('webp')) return 'WEBP';
  return 'JPEG';
}

/**
 * Gera PDF A4 retrato do checklist do item (layout moderno em cards).
 * Conteúdo flui naturalmente; fotos em grade de 2 colunas sem forçar nova página.
 */
export async function generateChecklistItemPDF({
  item,
  saida,
  fotoUrls = [],
  t,
  language = 'pt-BR',
} = {}) {
  if (!item) return;

  const ctx = buildPageCtx(item, saida, t, language);
  const doc = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' });
  let y = drawMainHeader(doc, ctx);

  const infoPairs = [
    [
      t('painel.comercial.agendamentos.checklist.fields.produto'),
      item.produto || '-',
      3,
      true,
    ],
    [t('painel.comercial.agendamentos.checklist.fields.tipo'), item.tipo_label || '-'],
    [t('painel.comercial.agendamentos.checklist.fields.lote'), item.lote || '-'],
    [
      t('painel.comercial.agendamentos.checklist.fields.quantidade'),
      item.quantidade || '-',
      1,
      true,
    ],
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
      3,
      true,
    ]);
  }

  y = addInfoCards(doc, y, infoPairs, 3, ctx);

  if (item.kind === CHECKLIST_KIND.CONVENCIONAL && Array.isArray(item.lacres) && item.lacres.length) {
    y = addLacresSection(
      doc,
      y,
      item.lacres,
      t('painel.comercial.agendamentos.checklist.sections.lacres'),
      ctx
    );
  }

  const checkDefs = checkDefsForItem(item);
  const sections = [...new Set(checkDefs.map((c) => c.section))];
  let checkIndex = 0;

  for (const section of sections) {
    const defs = checkDefs.filter((c) => c.section === section);
    if (!defs.length) continue;

    const resolveLabel = (def) => {
      if (section === VALIDADE_TESTES_SECTION && item.validade_testes) {
        return validadeTestesLabel(checkDefLabel(def, t), item.validade_testes, t, language);
      }
      if (section === ESLINGA_COLOR_SECTION && item.validade_testes?.color_cod) {
        return eslingaColorLabel(checkDefLabel(def, t), item.validade_testes.color_cod, t);
      }
      return checkDefLabel(def, t);
    };

    const firstLabel = resolveLabel(defs[0]);
    const firstMeta = answerMeta(normalizeCheckValue(item.checks?.[defs[0].key]), t);
    const firstH = measureCheckCard(doc, firstLabel, firstMeta).h;

    y = ensureSpace(doc, y, 10 + firstH, ctx);
    y = drawSectionTitle(
      doc,
      y,
      t(`painel.comercial.agendamentos.checklist.sections.${section}`, {
        defaultValue: section,
      })
    );

    for (const c of defs) {
      checkIndex += 1;
      const answer = normalizeCheckValue(item.checks?.[c.key]);
      const meta = answerMeta(answer, t);
      y = addCheckCard(doc, y, checkIndex, resolveLabel(c), meta, ctx);
    }

    y += 1;
  }

  const urls = (fotoUrls || []).filter(Boolean);
  const photosTitle = hexFallback(
    t,
    'painel.comercial.agendamentos.checklist.pdf.photosTitle',
    hexFallback(t, 'painel.comercial.agendamentos.checklist.sections.fotos', 'Fotos')
  );
  const emptyPhotos = hexFallback(
    t,
    'painel.logistica.carregamentos.checklistNoPhotos',
    'Nenhuma foto registrada para este item.'
  );

  const loaded = [];
  for (const url of urls) {
    try {
      const img = await urlToDataUrl(url);
      loaded.push(img);
    } catch {
      // ignora foto que falhou ao carregar
    }
  }

  y = addPhotosSection(doc, y, loaded, photosTitle, emptyPhotos, ctx);

  addFooter(doc, ctx);

  const fileBase =
    safePdfFilenamePart(ctx.saidaCodigo) ||
    safePdfFilenamePart(item.produto) ||
    'checklist';
  doc.save(`${fileBase} - Checklist.pdf`);
}

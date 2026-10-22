import {
  M,
  CW,
  CARD_R,
  CARD_GAP,
  setColor,
  setFill,
  setDraw,
  ensurePdfSpace,
} from "@transbordo/lib/pdfReportLayout";

/** Cores alinhadas ao `OrgaoControladoBanner` (Tailwind amber/orange). */
const BANNER_BG = [255, 251, 235];
const BANNER_BORDER = [251, 191, 36];
const ICON_RING_BG = [254, 243, 199];
const ICON_RING_BORDER = [252, 211, 77];
const TEXT_KICKER = [146, 64, 14];
const TEXT_TITLE = [69, 26, 3];
const TEXT_SUB = [120, 53, 15];

const FEDERAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1B5E20" d="M12 2L3 6v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"/><path fill="#F9A825" d="M12 4.2L5.5 7.1v3.7c0 4.2 2.9 8.2 6.5 9.3 3.6-1.1 6.5-5.1 6.5-9.3V7.1L12 4.2z"/><path fill="#1B5E20" d="M12 7.2c-1.7 0-3 1.1-3 2.6 0 1 .5 1.8 1.3 2.2L9.5 16h5l-.8-4c.8-.4 1.3-1.2 1.3-2.2 0-1.5-1.3-2.6-3-2.6z"/></svg>`;

const EXERCITO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2E4A1E"/><circle cx="12" cy="12" r="8.2" fill="#3D5C28" stroke="#C9A227" stroke-width="1.2"/><path fill="#C9A227" d="M12 5.5l1.2 3.6h3.8l-3 2.2 1.1 3.6L12 12.9 8.9 14.9l1.1-3.6-3-2.2h3.8L12 5.5z"/></svg>`;

function orgaoHasDualLogos(orgao) {
  const text = String(orgao || "").trim();
  return text.includes("Exército") && text.includes("Federal");
}

function logoSvgForOrgao(orgao) {
  const text = String(orgao || "").trim();
  if (orgaoHasDualLogos(orgao)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 24">
      <circle cx="12" cy="12" r="10" fill="#2E4A1E"/>
      <circle cx="12" cy="12" r="8.2" fill="#3D5C28" stroke="#C9A227" stroke-width="1.2"/>
      <path fill="#C9A227" d="M12 5.5l1.2 3.6h3.8l-3 2.2 1.1 3.6L12 12.9 8.9 14.9l1.1-3.6-3-2.2h3.8L12 5.5z"/>
      <path fill="#1B5E20" transform="translate(28,0)" d="M12 2L3 6v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"/>
      <path fill="#F9A825" transform="translate(28,0)" d="M12 4.2L5.5 7.1v3.7c0 4.2 2.9 8.2 6.5 9.3 3.6-1.1 6.5-5.1 6.5-9.3V7.1L12 4.2z"/>
      <path fill="#1B5E20" transform="translate(28,0)" d="M12 7.2c-1.7 0-3 1.1-3 2.6 0 1 .5 1.8 1.3 2.2L9.5 16h5l-.8-4c.8-.4 1.3-1.2 1.3-2.2 0-1.5-1.3-2.6-3-2.6z"/>
    </svg>`;
  }
  if (text === "Federal" || text.includes("Federal")) return FEDERAL_SVG;
  if (text === "Exército" || text.includes("Exército")) return EXERCITO_SVG;
  return FEDERAL_SVG;
}

function svgToDataUrl(svgMarkup, widthPx, heightPx) {
  if (typeof document === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, widthPx, heightPx);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Banner “Produto controlado” — mesmo layout/cores do modal (`OrgaoControladoBanner`).
 */
export async function drawOrgaoControladoBanner(doc, y, { orgao, label } = {}) {
  if (!orgao) return y;

  const padX = 3.5;
  const padY = 2.5;
  const gap = 3;
  const iconOuter = 9;
  const iconInner = 5;

  const textX = M + padX + iconOuter + gap;
  const textW = CW - padX * 2 - iconOuter - gap;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const kickerLines = doc.splitTextToSize("PRODUTO CONTROLADO", textW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  const titleLines = doc.splitTextToSize(`Órgão regulamentador: ${orgao}`, textW);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.25);
  const subLines = doc.splitTextToSize(String(label || ""), textW);

  const lineH = (fs) => fs * 0.38;
  const textH =
    kickerLines.length * lineH(7.5) +
    0.8 +
    titleLines.length * lineH(10.5) +
    0.5 +
    subLines.length * lineH(8.25);
  const boxH = Math.max(iconOuter, textH) + padY * 2;

  y = ensurePdfSpace(doc, y, boxH + CARD_GAP);

  const x = M;
  setFill(doc, BANNER_BG);
  setDraw(doc, BANNER_BORDER);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, CW, boxH, CARD_R, CARD_R, "FD");
  doc.setLineWidth(0.2);

  const iconCy = y + boxH / 2;
  const iconCx = x + padX + iconOuter / 2;
  setFill(doc, ICON_RING_BG);
  setDraw(doc, ICON_RING_BORDER);
  doc.setLineWidth(0.25);
  doc.circle(iconCx, iconCy, iconOuter / 2, "FD");
  doc.setLineWidth(0.2);

  const svg = logoSvgForOrgao(orgao);
  const dual = orgaoHasDualLogos(orgao);
  const dataUrl = await svgToDataUrl(svg, dual ? 104 : 48, 48);
  if (dataUrl) {
    const w = dual ? iconInner * 1.35 : iconInner;
    doc.addImage(
      dataUrl,
      "PNG",
      iconCx - w / 2,
      iconCy - iconInner / 2,
      w,
      iconInner
    );
  }

  let ty = y + padY + lineH(7.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setColor(doc, TEXT_KICKER);
  doc.text(kickerLines, textX, ty);
  ty += kickerLines.length * lineH(7.5) + 0.8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  setColor(doc, TEXT_TITLE);
  doc.text(titleLines, textX, ty);
  ty += titleLines.length * lineH(10.5) + 0.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.25);
  setColor(doc, TEXT_SUB);
  doc.text(subLines, textX, ty);

  return y + boxH + CARD_GAP;
}

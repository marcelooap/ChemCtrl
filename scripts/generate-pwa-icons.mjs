/**
 * Gera ícones PWA a partir do SVG vetorial oficial (public/icons/chemctrl-logo.svg).
 * - Fundo sólido em tela cheia (sem cantos brancos/transparentes)
 * - Logo centralizado ocupando ~92% da área (ícones "any")
 * - Maskable com logo em ~90% da zona segura Android (80%)
 *
 * Uso: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
const publicDir = join(root, 'public');
const svgMaster = join(iconsDir, 'chemctrl-logo.svg');

const BG = '#223f56';
const LOGO_SCALE_ANY = 0.92;
const LOGO_SCALE_MASKABLE = 0.72; // ~90% da zona segura de 80%

function hexPoints(cx, cy, radius) {
  const angles = [-90, -30, 30, 90, 150, 210];
  return angles
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x = cx + radius * Math.cos(rad);
      const y = cy + radius * Math.sin(rad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function buildSvg(logoScale) {
  const S = 512;
  const cx = S / 2;
  const cy = S / 2;
  const r = (S * logoScale) / 2;
  const waveY1 = cy - r * 0.08;
  const waveY2 = cy + r * 0.08;
  const waveX1 = cx - r * 0.59;
  const waveX2 = cx + r * 0.59;
  const waveMid = cx;
  const waveAmp = r * 0.085;
  const stroke = Math.max(12, r * 0.047);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="none">
  <defs>
    <linearGradient id="hexGrad" x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#37bcc2"/>
      <stop offset="52%" stop-color="#2a89a5"/>
      <stop offset="100%" stop-color="#225480"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="${BG}"/>
  <polygon fill="url(#hexGrad)" points="${hexPoints(cx, cy, r)}"/>
  <path d="M ${waveX1} ${waveY1} C ${waveX1 + r * 0.21} ${waveY1 - waveAmp}, ${waveMid - r * 0.1} ${waveY1 + waveAmp}, ${waveMid} ${waveY1} C ${waveMid + r * 0.1} ${waveY1 - waveAmp}, ${waveX2 - r * 0.21} ${waveY1 + waveAmp}, ${waveX2} ${waveY1}"
    stroke="#46e9e1" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M ${waveX1} ${waveY2} C ${waveX1 + r * 0.21} ${waveY2 - waveAmp}, ${waveMid - r * 0.1} ${waveY2 + waveAmp}, ${waveMid} ${waveY2} C ${waveMid + r * 0.1} ${waveY2 - waveAmp}, ${waveX2 - r * 0.21} ${waveY2 + waveAmp}, ${waveX2} ${waveY2}"
    stroke="#46e9e1" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function renderPng(svgContent, size, output) {
  const density = Math.max(192, Math.ceil((size / 512) * 384));
  await sharp(Buffer.from(svgContent), { density })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
}

async function writeFaviconIco(svgContent) {
  const sizes = [16, 32, 48];
  const pngBuffers = await Promise.all(
    sizes.map(async (size) => {
      const density = Math.max(96, size * 6);
      return sharp(Buffer.from(svgContent), { density })
        .resize(size, size, { fit: 'fill' })
        .png()
        .toBuffer();
    })
  );

  const { default: toIco } = await import('to-ico');
  const ico = await toIco(pngBuffers);
  await writeFile(join(publicDir, 'favicon.ico'), ico);
}

async function verifyIcon(filePath, size) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  let whiteCorners = 0;
  const corners = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
  ];
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) whiteCorners++;
  }

  let transparent = 0;
  for (let p = 3; p < data.length; p += 4) {
    if (data[p] < 16) transparent++;
  }

  const edgeSamples = [];
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 8))) {
    edgeSamples.push(data[x * 4], data[x * 4 + 1], data[x * 4 + 2]);
  }

  return {
    file: filePath.replace(root + '\\', '').replace(root + '/', ''),
    size: `${w}x${h}`,
    whiteCorners,
    transparentPct: ((transparent / (w * h)) * 100).toFixed(2),
    edgeRgb: `rgb(${edgeSamples[0]},${edgeSamples[1]},${edgeSamples[2]})`,
    ok: whiteCorners === 0 && parseFloat(((transparent / (w * h)) * 100).toFixed(2)) < 0.5,
  };
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const masterExists = await readFile(svgMaster).then(() => true).catch(() => false);
  if (!masterExists) {
    console.error('Arquivo não encontrado: public/icons/chemctrl-logo.svg');
    process.exit(1);
  }

  const svgAny = buildSvg(LOGO_SCALE_ANY);
  const svgMaskable = buildSvg(LOGO_SCALE_MASKABLE);

  await writeFile(svgMaster, svgAny);

  const outputs = [];

  const tasks = [
    ['icon-1024x1024.png', 1024, svgAny],
    ['favicon-16x16.png', 16, svgAny],
    ['favicon-32x32.png', 32, svgAny],
    ['apple-touch-icon.png', 180, svgAny],
    ['icon-192x192.png', 192, svgAny],
    ['icon-512x512.png', 512, svgAny],
    ['icon-192x192-maskable.png', 192, svgMaskable],
    ['icon-512x512-maskable.png', 512, svgMaskable],
  ];

  for (const [filename, size, svg] of tasks) {
    const out = join(iconsDir, filename);
    await renderPng(svg, size, out);
    outputs.push(out);
    console.log(`✓ ${filename}`);
  }

  await writeFaviconIco(svgAny);
  console.log('✓ favicon.ico');

  console.log('\n── Verificação de margens/cantos ──');
  let allOk = true;
  for (const file of outputs) {
    const result = await verifyIcon(file);
    const status = result.ok ? 'OK' : 'FALHA';
    if (!result.ok) allOk = false;
    console.log(
      `${status}  ${result.file}  cantos-brancos=${result.whiteCorners}  transparente=${result.transparentPct}%  borda=${result.edgeRgb}`
    );
  }

  if (!allOk) {
    console.error('\nAlguns ícones falharam na verificação.');
    process.exit(1);
  }

  console.log('\nÍcones PWA gerados com sucesso (sem bordas brancas).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

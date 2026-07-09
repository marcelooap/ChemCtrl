/**
 * Gera todos os ícones PWA a partir de public/icons/icon-source.png
 * Uso: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
const source = join(iconsDir, 'icon-source.png');
const THEME = '#0f3455';

function parseHexColor(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    alpha: 1,
  };
}

async function resizeIcon(size, output, { maskable = false } = {}) {
  if (!maskable) {
    await sharp(source)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(output);
    return;
  }

  const inner = Math.round(size * 0.8);
  const icon = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: parseHexColor(THEME),
    },
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(output);
}

async function writeFaviconIco() {
  const sizes = [16, 32, 48];
  const pngBuffers = await Promise.all(
    sizes.map((size) =>
      sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer()
    )
  );

  const { default: toIco } = await import('to-ico');
  const ico = await toIco(pngBuffers);
  await writeFile(join(root, 'public', 'favicon.ico'), ico);
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const sourceExists = await readFile(source).then(() => true).catch(() => false);
  if (!sourceExists) {
    console.error('Arquivo não encontrado: public/icons/icon-source.png');
    process.exit(1);
  }

  const tasks = [
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-192x192.png', 192],
    ['icon-256x256.png', 256],
    ['icon-512x512.png', 512],
  ];

  for (const [filename, size] of tasks) {
    await resizeIcon(size, join(iconsDir, filename));
    console.log(`✓ ${filename}`);
  }

  const maskableTasks = [
    ['icon-192x192-maskable.png', 192],
    ['icon-256x256-maskable.png', 256],
    ['icon-512x512-maskable.png', 512],
  ];

  for (const [filename, size] of maskableTasks) {
    await resizeIcon(size, join(iconsDir, filename), { maskable: true });
    console.log(`✓ ${filename} (maskable)`);
  }

  await writeFaviconIco();
  console.log('✓ favicon.ico');

  console.log('\nÍcones PWA gerados com sucesso.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

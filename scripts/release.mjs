/**
 * Incrementa a versão do app (+1 no último segmento) e atualiza todos os artefatos.
 * Uso: npm run release → git commit → git push
 */
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { incrementAppVersion } from './version-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkgPath = join(root, 'package.json');
const versionPath = join(root, 'public', 'version.json');
const swPath = join(root, 'public', 'sw.js');
const envBuildPath = join(root, '.env.build');

async function main() {
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const current = (pkg.version || '1.0.0').trim();
  const next = incrementAppVersion(current);

  pkg.version = next;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  let versionData = { version: next };
  try {
    versionData = { ...JSON.parse(await readFile(versionPath, 'utf8')), version: next };
  } catch {
    /* version.json ausente ou inválido */
  }
  await writeFile(versionPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

  let swContent = await readFile(swPath, 'utf8');
  if (swContent.includes('const APP_VERSION =')) {
    swContent = swContent.replace(
      /const APP_VERSION = '[^']*';/,
      `const APP_VERSION = '${next}';`
    );
  } else {
    swContent = `const APP_VERSION = '${next}';\n` + swContent;
  }
  await writeFile(swPath, swContent, 'utf8');

  await writeFile(envBuildPath, `VITE_APP_VERSION=${next}\n`, 'utf8');

  console.log(`✓ Versão atualizada: ${current} → ${next}`);
  console.log('  Arquivos atualizados: package.json, public/version.json, public/sw.js, .env.build');
  console.log('  Próximo passo: git add, commit e push');
}

main().catch((err) => {
  console.error('release failed:', err);
  process.exit(1);
});

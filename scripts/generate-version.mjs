/**
 * Gera version.json e injeta versão no Service Worker antes do build.
 * Compatível com GitHub → Vercel (usa VERCEL_GIT_COMMIT_SHA quando disponível).
 */
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');
const swPath = join(publicDir, 'sw.js');
const versionPath = join(publicDir, 'version.json');
const envBuildPath = join(root, '.env.build');

function getGitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function resolveBuildId() {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);
  return getGitShortSha() || Date.now().toString(36);
}

async function main() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const buildId = resolveBuildId();
  const builtAt = new Date().toISOString();

  const version =
    process.env.VITE_APP_VERSION?.trim() ||
    pkg.version ||
    '1.0.0';

  const versionData = { version, buildId, builtAt };

  await writeFile(versionPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

  let swContent = await readFile(swPath, 'utf8');
  const cacheVersion = `chemctrl-${buildId}`;

  if (swContent.includes('const CACHE_VERSION =')) {
    swContent = swContent.replace(
      /const CACHE_VERSION = '[^']*';/,
      `const CACHE_VERSION = '${cacheVersion}';`
    );
  } else {
    swContent = `const CACHE_VERSION = '${cacheVersion}';\n` + swContent;
  }

  if (swContent.includes('const APP_VERSION =')) {
    swContent = swContent.replace(
      /const APP_VERSION = '[^']*';/,
      `const APP_VERSION = '${version}';`
    );
  } else {
    swContent = swContent.replace(
      /const CACHE_VERSION = '[^']*';/,
      `const CACHE_VERSION = '${cacheVersion}';\nconst APP_VERSION = '${version}';`
    );
  }

  await writeFile(swPath, swContent, 'utf8');
  await writeFile(envBuildPath, `VITE_APP_VERSION=${version}\n`, 'utf8');

  console.log(`✓ version.json → ${version} (build: ${buildId})`);
  console.log(`✓ sw.js CACHE_VERSION → ${cacheVersion}`);
}

main().catch((err) => {
  console.error('generate-version failed:', err);
  process.exit(1);
});

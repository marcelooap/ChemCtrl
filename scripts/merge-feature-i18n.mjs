import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/i18n');

const featureKeys = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'feature-i18n-keys.json'), 'utf8')
);

for (const locale of ['en', 'es', 'fr', 'pt-BR']) {
  const filePath = path.join(i18nDir, `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const patch = featureKeys[locale];
  if (!patch) continue;

  function deepMerge(target, source) {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = deepMerge(target[key] ?? {}, value);
      } else {
        target[key] = value;
      }
    }
    return target;
  }

  deepMerge(data, patch);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Merged feature keys into ${locale}.json`);
}

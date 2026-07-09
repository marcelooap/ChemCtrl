/**
 * Migra cores hardcoded para tokens semânticos (dark mode).
 * Uso: node scripts/migrate-dark-colors.mjs
 */
import { readFile, writeFile } from 'fs/promises';
import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';

const ROOT = join(import.meta.dirname, '..', 'src');

const REPLACEMENTS = [
  [" style={{ color: '#1A1A2E' }}", ''],
  ['bg-[#F5F5F7]', 'bg-background'],
  ['border-gray-200', 'border-border'],
  ['border-gray-100', 'border-border'],
  ['bg-white rounded-xl', 'bg-card rounded-xl'],
  ['bg-white rounded-2xl', 'bg-card rounded-2xl'],
  ['bg-white rounded-lg', 'bg-card rounded-lg'],
  ['hover:bg-gray-50/50', 'hover:bg-accent/30'],
  ['hover:bg-gray-50', 'hover:bg-accent/50'],
  ['bg-gray-50', 'bg-muted/50'],
  ['bg-gray-100', 'bg-muted'],
  ['text-gray-900', 'text-foreground'],
  [" style={{ color: '#333' }}", ''],
  [" style={{ color: '#888' }}", ''],
  ['text-gray-700', 'text-foreground'],
  ['border border-border bg-white ', 'border border-border bg-card '],
  ['overflow-hidden bg-white', 'overflow-hidden bg-card'],
  ['rounded-xl border border-border bg-white', 'rounded-xl border border-border bg-card'],
  ['fixed bottom-0 left-0 right-0 z-30 bg-white border-t', 'fixed bottom-0 left-0 right-0 z-30 bg-card border-t'],
  ['p-4 bg-white border-2', 'p-4 bg-card border-2'],
  ['bg-white rounded px-3', 'bg-card rounded px-3'],
  ['py-2 bg-white', 'py-2 bg-card'],
];

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) files.push(...(await walk(full)));
    else if (['.jsx', '.tsx'].includes(extname(entry))) files.push(full);
  }
  return files;
}

const files = await walk(ROOT);
let changed = 0;

for (const file of files) {
  let content = await readFile(file, 'utf8');
  const original = content;
  for (const [from, to] of REPLACEMENTS) {
    content = content.split(from).join(to);
  }
  if (content !== original) {
    await writeFile(file, content, 'utf8');
    changed++;
  }
}

console.log(`Migrated ${changed} files.`);

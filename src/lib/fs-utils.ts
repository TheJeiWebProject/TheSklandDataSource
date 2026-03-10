import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function resolvePathMaybeAbsolute(repoRoot: string, inputPath: string): string {
  if (!inputPath) return '';
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(repoRoot, inputPath);
}

export function updatePackIndex(repoRoot: string, packId: string, displayName: string): void {
  const p = path.join(repoRoot, 'public', 'packs', 'index.json');
  if (!fs.existsSync(p)) return;
  const json = readJson<{ packs?: Array<{ packId?: string; label?: string }> }>(p);
  const packs = Array.isArray(json?.packs) ? json.packs : [];
  const idx = packs.findIndex((it) => it?.packId === packId);
  const entry = { packId, label: displayName };
  if (idx >= 0) packs[idx] = entry;
  else packs.push(entry);
  writeJson(p, { packs });
}

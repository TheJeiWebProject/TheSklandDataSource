import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './fs-utils.ts';
import type { InfoFileEntry, MethodPayload } from './types.ts';

interface IndexedInfoFile {
  itemId?: string | number;
  mainName?: string;
  subName?: string;
  categoryPath?: string;
  path?: string;
}

export function listInfoFiles(infoRoot: string): InfoFileEntry[] {
  const indexPath = path.join(infoRoot, 'index.json');
  if (fs.existsSync(indexPath)) {
    const indexJson = readJson<{ files?: IndexedInfoFile[] }>(indexPath);
    const files = Array.isArray(indexJson?.files) ? indexJson.files : [];
    return files
      .map((f) => ({
        itemId: String(f?.itemId ?? ''),
        mainName: String(f?.mainName || ''),
        subName: String(f?.subName || ''),
        categoryPath: String(f?.categoryPath || ''),
        relPath: String(f?.path || ''),
      }))
      .filter((f) => f.itemId && f.relPath)
      .map((f) => ({
        ...f,
        absPath: path.join(infoRoot, f.relPath),
      }))
      .filter((f) => fs.existsSync(f.absPath));
  }

  const out: InfoFileEntry[] = [];
  const stack: string[] = [infoRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      if (entry.name.toLowerCase() === 'index.json') continue;
      const relPath = path.relative(infoRoot, absPath);
      const itemId = entry.name.match(/^id(\d+)\.json$/i)?.[1] || '';
      out.push({
        itemId,
        mainName: '',
        subName: '',
        categoryPath: path.dirname(relPath),
        relPath,
        absPath,
      });
    }
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

interface MethodsIndexFile {
  itemId?: string | number;
  path?: string;
}

export function loadMethodsByItemId(methodsRoot: string): Map<string, MethodPayload> {
  const out = new Map<string, MethodPayload>();
  const indexPath = path.join(methodsRoot, 'index.json');
  if (!fs.existsSync(indexPath)) return out;
  const index = readJson<{ files?: MethodsIndexFile[] }>(indexPath);
  const files = Array.isArray(index?.files) ? index.files : [];
  for (const fileInfo of files) {
    const itemId = String(fileInfo?.itemId ?? '').trim();
    const rel = String(fileInfo?.path ?? '').trim();
    if (!itemId || !rel) continue;
    const abs = path.join(methodsRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      out.set(itemId, readJson<MethodPayload>(abs));
    } catch {
      // Ignore bad json.
    }
  }
  return out;
}

interface MethodRecipeRecord {
  ingredients?: unknown[];
  outputs?: unknown[];
  machine?: unknown;
  duration?: unknown;
  context?: unknown;
  itemId?: string | number;
}

export function loadMethodRecipes(methodsRoot: string): MethodRecipeRecord[] {
  const p = path.join(methodsRoot, 'recipes.json');
  if (!fs.existsSync(p)) return [];
  const json = readJson<{ recipes?: MethodRecipeRecord[] }>(p);
  return Array.isArray(json?.recipes) ? json.recipes : [];
}

export type { MethodRecipeRecord };

import { createHash } from 'node:crypto';
import type { MethodPayload } from './types.ts';

export function sanitizePathSegment(v: unknown, fallback = 'unknown'): string {
  const raw = String(v ?? '').trim() || fallback;
  let s = raw
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0 || code > 31;
    })
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = fallback;
  return s;
}

export function toPackItemId(gameId: string, numericId: string): string {
  const core = String(numericId).trim();
  const suffix = /^\d+$/.test(core)
    ? `item_${core}`
    : `item_ref_${sanitizePathSegment(core, 'unknown')}`;
  return `${gameId}.wiki.${suffix}`;
}

export function parseAmount(v: unknown): number {
  const raw = String(v ?? '').trim();
  if (!raw) return 1;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

export function parseDurationSeconds(v: unknown): number | null {
  const raw = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const m = raw.match(/^(\d+(?:\.\d+)?)(ms|s|sec|m|min|h|hr)?$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1] ?? '');
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 's').toLowerCase();
  if (unit === 'ms') return n / 1000;
  if (unit === 'm' || unit === 'min') return n * 60;
  if (unit === 'h' || unit === 'hr') return n * 3600;
  return n;
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s ?? '').trim()).filter(Boolean);
}

export function buildItemDescription(methodPayload: MethodPayload | undefined): string {
  const acquisitionMethods = asStringArray(methodPayload?.acquisition?.methods);
  const usageMethods = asStringArray(methodPayload?.usage?.methods);
  const lines: string[] = [];
  if (acquisitionMethods.length) {
    lines.push('获取方式:');
    lines.push(...acquisitionMethods.slice(0, 6));
  }
  if (usageMethods.length) {
    if (lines.length) lines.push('');
    lines.push('用途:');
    lines.push(...usageMethods.slice(0, 6));
  }
  return lines.join('\n').trim();
}

export function normalizeMachineName(v: unknown): string {
  let s = String(v ?? '').trim();
  if (!s) return '未知来源';
  s = s.replace(/^\[+/, '').replace(/\]+$/, '').trim();
  return s || '未知来源';
}

export function hashShort(v: unknown): string {
  return createHash('sha1').update(String(v)).digest('hex').slice(0, 12);
}

export function makeTypeSlug(v: unknown, fallback = 'type'): string {
  const normalized = sanitizePathSegment(v, fallback)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function buildSlots(maxIn: number, maxOut: number) {
  const slots: Array<{
    slotId: string;
    io: 'input' | 'output';
    accept: Array<'item' | 'tag'>;
    x: number;
    y: number;
    label: string;
  }> = [];
  const inCols = Math.max(1, Math.min(4, maxIn || 1));
  for (let i = 0; i < maxIn; i += 1) {
    slots.push({
      slotId: `in${i + 1}`,
      io: 'input',
      accept: ['item', 'tag'],
      x: i % inCols,
      y: Math.floor(i / inCols),
      label: 'In',
    });
  }
  const outCols = Math.max(1, Math.min(4, maxOut || 1));
  const outX0 = inCols + 1;
  for (let i = 0; i < maxOut; i += 1) {
    slots.push({
      slotId: `out${i + 1}`,
      io: 'output',
      accept: ['item'],
      x: outX0 + (i % outCols),
      y: Math.floor(i / outCols),
      label: 'Out',
    });
  }
  return slots;
}

export function numericThenLexicalCompare(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  const aFinite = Number.isFinite(an);
  const bFinite = Number.isFinite(bn);
  if (aFinite && bFinite) return an - bn;
  if (aFinite) return -1;
  if (bFinite) return 1;
  return a.localeCompare(b);
}

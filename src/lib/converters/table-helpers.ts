import { hashShort, parseDurationSeconds, sanitizePathSegment } from '../helpers.ts';
import type { RecipeStack, EntryRef, CellData } from './types.ts';
import { normalizeHeaderLabel } from './wiki-parse.ts';
import type { ConverterContext } from './context.ts';
import {
  DERIVED_CONTAINER_BLACKLIST,
  DERIVED_CONTAINER_WHITELIST,
} from '../rules/skland-rules.ts';

export function findColumnIndexes(
  headers: string[],
  matcher: (header: string) => boolean,
): number[] {
  const out: number[] = [];
  headers.forEach((header, idx) => {
    if (matcher(normalizeHeaderLabel(header))) out.push(idx);
  });
  return out;
}

export function firstColumnIndex(headers: string[], matcher: (header: string) => boolean): number {
  return findColumnIndexes(headers, matcher)[0] ?? -1;
}

function compactStacks(stacks: RecipeStack[]): RecipeStack[] {
  const map = new Map<string, RecipeStack>();
  for (const stack of stacks) {
    const existing = map.get(stack.id);
    if (existing) {
      existing.amount += stack.amount;
    } else {
      map.set(stack.id, { ...stack });
    }
  }
  return Array.from(map.values());
}

function stackFromEntry(
  ctx: ConverterContext,
  entry: EntryRef,
  options: { allowZeroCount: boolean },
): RecipeStack | null {
  if (!options.allowZeroCount && entry.count <= 0) return null;
  const amount = entry.count > 0 ? entry.count : 1;
  const nameHint = ctx.getItemNameByWikiId(entry.id);
  const stack = ctx.createStackFromEntry({ id: entry.id, count: amount }, nameHint);
  return stack;
}

export function collectStacksFromColumns(
  ctx: ConverterContext,
  row: CellData[],
  indexes: number[],
  options: { allowZeroCount: boolean },
): RecipeStack[] {
  const stacks: RecipeStack[] = [];
  for (const idx of indexes) {
    const cell = row[idx];
    if (!cell) continue;
    for (const entry of cell.entries) {
      const stack = stackFromEntry(ctx, entry, options);
      if (stack) stacks.push(stack);
    }
  }
  return compactStacks(stacks);
}

function normalizeCellText(text: string): string {
  return text.replace(/\s+/g, '');
}

function normalizeMatchText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function matchesKeywordList(value: string, keywords: readonly string[]): boolean {
  if (!keywords.length) return false;
  const normalized = normalizeMatchText(value);
  return keywords.some((kw) => normalized.includes(normalizeMatchText(kw)));
}

function allowDerivedContainer(containerName: string): boolean {
  const name = String(containerName ?? '').trim();
  if (!name) return false;
  if (matchesKeywordList(name, DERIVED_CONTAINER_BLACKLIST)) return false;
  if (!DERIVED_CONTAINER_WHITELIST.length) return true;
  return matchesKeywordList(name, DERIVED_CONTAINER_WHITELIST);
}

function toSafeIdSegment(value: string, fallback: string): string {
  let s = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  return s;
}

function buildLiquidContainerStacks(
  ctx: ConverterContext,
  cell: CellData,
  keywords: readonly string[] | undefined,
): RecipeStack[] | null {
  const liquidEntries = cell.entries.filter((entry) => entry.count <= 0);
  if (!liquidEntries.length) return null;
  const containerEntries = cell.entries.filter((entry) => entry.count > 0);
  const allowByKeywords =
    !!keywords?.length &&
    keywords.some((kw) => normalizeCellText(cell.text).includes(normalizeCellText(kw)));
  const allowByWhitelist =
    !!containerEntries.length &&
    containerEntries.some((container) => {
      const containerName = ctx.getItemNameByWikiId(container.id) || `容器${container.id}`;
      return allowDerivedContainer(containerName);
    });
  if (!allowByKeywords && !allowByWhitelist) return null;
  const stacks: RecipeStack[] = [];
  for (const liquid of liquidEntries) {
    const liquidName = ctx.getItemNameByWikiId(liquid.id) || `液体${liquid.id}`;
    const liquidTags = ctx.getItemTagsByWikiId(liquid.id);
    if (containerEntries.length) {
      for (const container of containerEntries) {
        const containerName = ctx.getItemNameByWikiId(container.id) || `容器${container.id}`;
        if (!allowDerivedContainer(containerName)) {
          const stack = stackFromEntry(ctx, container, { allowZeroCount: true });
          if (stack) stacks.push(stack);
          continue;
        }
        const containerIcon = ctx.getItemIconByWikiId(container.id);
        const containerTags = ctx.getItemTagsByWikiId(container.id);
        const name = `${containerName}(${liquidName})`;
        const safe = toSafeIdSegment(name, `container_${container.id}__liquid_${liquid.id}`);
        const derivedId = `derived_liquid_container__${safe}__${hashShort(name)}`;
        const mergedTags = Array.from(new Set([...containerTags, ...liquidTags]));
        const extra: { icon?: string; tags?: string[] } = {};
        if (containerIcon) extra.icon = containerIcon;
        if (mergedTags.length) extra.tags = mergedTags;
        stacks.push(
          ctx.createDerivedStack(derivedId, name, Math.max(1, container.count || 1), 'derived', extra),
        );
      }
    } else {
      const name = `容器(${liquidName})`;
      const safe = toSafeIdSegment(name, `container__liquid_${liquid.id}`);
      const derivedId = `derived_liquid_container__${safe}__${hashShort(name)}`;
      const extra: { icon?: string; tags?: string[] } = {};
      if (liquidTags.length) extra.tags = liquidTags;
      stacks.push(
        ctx.createDerivedStack(derivedId, name, 1, 'derived', extra),
      );
    }
  }
  return stacks.length ? stacks : null;
}

export function collectStacksFromColumnsWithKeywords(
  ctx: ConverterContext,
  row: CellData[],
  indexes: number[],
  options: { allowZeroCount: boolean; zeroCountAsOneKeywords?: readonly string[] },
): RecipeStack[] {
  const stacks: RecipeStack[] = [];
  for (const idx of indexes) {
    const cell = row[idx];
    if (!cell) continue;
    const derivedStacks = buildLiquidContainerStacks(ctx, cell, options.zeroCountAsOneKeywords);
    if (derivedStacks?.length) {
      stacks.push(...derivedStacks);
      continue;
    }
    for (const entry of cell.entries) {
      if (entry.count > 0) {
        const stack = stackFromEntry(ctx, entry, { allowZeroCount: true });
        if (stack) stacks.push(stack);
        continue;
      }
      if (!options.allowZeroCount) continue;
      const stack = stackFromEntry(ctx, entry, { allowZeroCount: true });
      if (stack) stacks.push(stack);
    }
  }
  return compactStacks(stacks);
}

export function parseDurationFromColumns(
  row: CellData[],
  indexes: number[],
): { time?: number; timeText?: string } {
  for (const idx of indexes) {
    const cell = row[idx];
    if (!cell) continue;
    const text = cell.text.trim();
    if (!text) continue;
    const time = parseDurationSeconds(text);
    if (time != null) return { time };
    return { timeText: text };
  }
  return {};
}

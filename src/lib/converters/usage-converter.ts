import type { ItemRecord } from '../types.ts';
import { buildSlotContents, ConverterContext } from './context.ts';
import { makeDocParams, uniqueRelatedStacks } from './wiki-doc-helper.ts';
import { extractEntriesFromDoc, extractWikiDocRefs } from './wiki-parse.ts';
import type { ConverterResult, RecipeStack, WikiDocRef } from './types.ts';
import {
  PLANNER_PRIORITY,
  TYPE_PREFIX,
  USAGE_EXCLUDE_WIDGET_TITLES,
  USAGE_KEYWORDS,
  USAGE_PATTERN_PLANNER_PRIORITY,
  USAGE_PATTERN_DISPLAY_NAMES,
  includesAny,
  type UsagePattern,
} from '../rules/skland-rules.ts';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function isUsageRef(ref: WikiDocRef): boolean {
  if (USAGE_EXCLUDE_WIDGET_TITLES.some((title) => title === ref.widgetTitle)) return false;
  const haystack = [ref.chapterTitle, ref.widgetTitle, ref.tabTitle].join('|');
  return includesAny(haystack, USAGE_KEYWORDS);
}

function getDocShape(doc: Record<string, unknown>): {
  hasTable: boolean;
  hasList: boolean;
  hasText: boolean;
  entryCount: number;
} {
  const blockMap =
    doc && typeof doc.blockMap === 'object' && doc.blockMap && !Array.isArray(doc.blockMap)
      ? (doc.blockMap as Record<string, unknown>)
      : {};
  let hasTable = false;
  let hasList = false;
  let hasText = false;

  Object.values(blockMap).forEach((blockRaw) => {
    const block =
      blockRaw && typeof blockRaw === 'object' && !Array.isArray(blockRaw)
        ? (blockRaw as Record<string, unknown>)
        : {};
    const kind = asString(block.kind);
    if (kind === 'table') hasTable = true;
    if (kind === 'list') hasList = true;
    if (kind === 'text') hasText = true;
  });

  return {
    hasTable,
    hasList,
    hasText,
    entryCount: extractEntriesFromDoc(doc).length,
  };
}

function classifyUsagePattern(doc: Record<string, unknown>): {
  pattern: UsagePattern;
  displayName: string;
} {
  const shape = getDocShape(doc);
  const hasEntry = shape.entryCount > 0;
  if (shape.hasTable && hasEntry)
    return { pattern: 'table_entry', displayName: USAGE_PATTERN_DISPLAY_NAMES.table_entry };
  if (shape.hasTable)
    return { pattern: 'table_text', displayName: USAGE_PATTERN_DISPLAY_NAMES.table_text };
  if (shape.hasList && hasEntry)
    return { pattern: 'list_entry', displayName: USAGE_PATTERN_DISPLAY_NAMES.list_entry };
  if (shape.hasList)
    return { pattern: 'list_text', displayName: USAGE_PATTERN_DISPLAY_NAMES.list_text };
  if (shape.hasText && hasEntry)
    return { pattern: 'text_entry', displayName: USAGE_PATTERN_DISPLAY_NAMES.text_entry };
  return { pattern: 'text_only', displayName: USAGE_PATTERN_DISPLAY_NAMES.text_only };
}

export function runUsageConverter(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConverterResult {
  const touchedTypes = new Set<string>();
  let recipes = 0;

  for (const rec of itemRecords) {
    const targetPackId = ctx.getItemPackIdByWikiId(rec.itemId);
    if (!targetPackId) continue;

    const refs = extractWikiDocRefs(rec, {}).filter(isUsageRef);
    for (const ref of refs) {
      const { pattern, displayName } = classifyUsagePattern(ref.doc);
      const typeKey = `${ctx.args.gameId}:${TYPE_PREFIX.usage}/${pattern}`;

      const related = uniqueRelatedStacks(ctx, extractEntriesFromDoc(ref.doc), ref.itemId, 12);
      const inputs: RecipeStack[] = [{ kind: 'item', id: targetPackId, amount: 1 }];
      const slotContents = buildSlotContents(inputs, related);

      ctx.registerType(
        {
          key: typeKey,
          displayName,
          renderer: 'wiki_doc_panel',
          plannerPriority: USAGE_PATTERN_PLANNER_PRIORITY[pattern] ?? PLANNER_PRIORITY.usageFallback,
        },
        1,
        related.length,
      );

      ctx.addRecipe({
        id: ctx.nextRecipeId(`${TYPE_PREFIX.usage}/${ref.itemId}`),
        type: typeKey,
        slotContents,
        params: {
          ...makeDocParams('usage', ref),
          usagePattern: pattern,
        },
      });
      touchedTypes.add(typeKey);
      recipes += 1;
    }
  }

  return {
    name: 'usage_doc',
    recipeTypes: touchedTypes.size,
    recipes,
  };
}

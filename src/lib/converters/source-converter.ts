import type { ItemRecord } from '../types.ts';
import { buildSlotContents, ConverterContext } from './context.ts';
import { makeDocParams, uniqueRelatedStacks } from './wiki-doc-helper.ts';
import {
  extractBriefDescriptionDoc,
  extractEntriesFromDoc,
  extractWikiDocRefs,
} from './wiki-parse.ts';
import type { ConverterResult, RecipeStack, WikiDocRef } from './types.ts';
import {
  PLANNER_PRIORITY,
  SOURCE_KEYWORDS,
  SOURCE_PATTERN_PLANNER_PRIORITY,
  SOURCE_PATTERN_DISPLAY_NAMES,
  TYPE_PREFIX,
  includesAny,
  type SourcePattern,
} from '../rules/skland-rules.ts';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function isSourceRef(ref: WikiDocRef): boolean {
  const haystack = [ref.chapterTitle, ref.widgetTitle, ref.tabTitle].join('|');
  return includesAny(haystack, SOURCE_KEYWORDS);
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

function classifySourcePattern(doc: Record<string, unknown>): {
  pattern: SourcePattern;
  displayName: string;
} {
  const shape = getDocShape(doc);
  const hasEntry = shape.entryCount > 0;
  if (shape.hasTable && hasEntry)
    return { pattern: 'table_entry', displayName: SOURCE_PATTERN_DISPLAY_NAMES.table_entry };
  if (shape.hasTable)
    return { pattern: 'table_text', displayName: SOURCE_PATTERN_DISPLAY_NAMES.table_text };
  if (shape.hasList && hasEntry)
    return { pattern: 'list_entry', displayName: SOURCE_PATTERN_DISPLAY_NAMES.list_entry };
  if (shape.hasList)
    return { pattern: 'list_text', displayName: SOURCE_PATTERN_DISPLAY_NAMES.list_text };
  if (shape.hasText && hasEntry)
    return { pattern: 'text_entry', displayName: SOURCE_PATTERN_DISPLAY_NAMES.text_entry };
  return { pattern: 'text_only', displayName: SOURCE_PATTERN_DISPLAY_NAMES.text_only };
}

function makeBriefFallbackRef(rec: ItemRecord): WikiDocRef | null {
  const doc = extractBriefDescriptionDoc(rec);
  if (!doc) return null;
  const item = rec.payload as Record<string, unknown>;
  const data = item.data as Record<string, unknown>;
  const wikiItem = (data?.item || {}) as Record<string, unknown>;
  return {
    itemId: rec.itemId,
    itemName: asString(wikiItem.name),
    chapterTitle: '简介回退',
    widgetTitle: 'brief.description',
    widgetType: 'fallback',
    tabId: 'brief',
    tabTitle: 'brief',
    docId: 'brief.description',
    sourceKind: 'content',
    doc,
    itemRecord: rec,
  };
}

export function runSourceConverter(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConverterResult {
  const touchedTypes = new Set<string>();
  let recipes = 0;

  for (const rec of itemRecords) {
    const targetPackId = ctx.getItemPackIdByWikiId(rec.itemId);
    if (!targetPackId) continue;

    const allRefs = extractWikiDocRefs(rec, {});
    let sourceRefs = allRefs.filter(isSourceRef);
    if (!sourceRefs.length) {
      const fallback = makeBriefFallbackRef(rec);
      if (fallback) sourceRefs = [fallback];
    }

    let builtForItem = 0;
    for (const ref of sourceRefs) {
      const { pattern, displayName } = classifySourcePattern(ref.doc);
      const typeKey = `${ctx.args.gameId}:${TYPE_PREFIX.source}/${pattern}`;
      const related = uniqueRelatedStacks(ctx, extractEntriesFromDoc(ref.doc), ref.itemId, 12);
      const outputs: RecipeStack[] = [{ kind: 'item', id: targetPackId, amount: 1 }];
      const slotContents = buildSlotContents(related, outputs);

      ctx.registerType(
        {
          key: typeKey,
          displayName,
          renderer: 'wiki_doc_panel',
          plannerPriority: SOURCE_PATTERN_PLANNER_PRIORITY[pattern] ?? PLANNER_PRIORITY.sourceFallback,
        },
        related.length,
        1,
      );

      ctx.addRecipe({
        id: ctx.nextRecipeId(`${TYPE_PREFIX.source}/${ref.itemId}`),
        type: typeKey,
        slotContents,
        params: {
          ...makeDocParams('source', ref),
          sourcePattern: pattern,
        },
      });
      touchedTypes.add(typeKey);
      recipes += 1;
      builtForItem += 1;
    }

    if (builtForItem === 0) {
      const fallbackTypeKey = `${ctx.args.gameId}:${TYPE_PREFIX.source}/text_only`;
      ctx.registerType(
        {
          key: fallbackTypeKey,
          displayName: SOURCE_PATTERN_DISPLAY_NAMES.text_only,
          renderer: 'wiki_doc_panel',
          plannerPriority: PLANNER_PRIORITY.sourceFallback,
        },
        0,
        1,
      );

      ctx.addRecipe({
        id: ctx.nextRecipeId(`${TYPE_PREFIX.source}/fallback/${rec.itemId}`),
        type: fallbackTypeKey,
        slotContents: buildSlotContents([], [{ kind: 'item', id: targetPackId, amount: 1 }]),
        params: {
          sectionType: 'source',
          title: '来源/回退条目',
          context: {
            groupTitle: '来源回退',
            widgetTitle: '未匹配章节',
            panelTitle: '',
          },
          methods: ['未匹配到结构化来源章节，使用回退条目。'],
          sourcePattern: 'fallback',
        },
      });
      touchedTypes.add(fallbackTypeKey);
      recipes += 1;
    }
  }

  return {
    name: 'source_doc',
    recipeTypes: touchedTypes.size,
    recipes,
  };
}

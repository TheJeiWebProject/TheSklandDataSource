import type { ItemRecord } from '../types.ts';
import { makeTypeSlug } from '../helpers.ts';
import { buildSlotContents, ConverterContext } from './context.ts';
import { extractTablesFromDoc, extractWikiDocRefs, normalizeTextLabel } from './wiki-parse.ts';
import {
  collectStacksFromColumnsWithKeywords,
  findColumnIndexes,
  firstColumnIndex,
} from './table-helpers.ts';
import type { ConverterResult, CellData } from './types.ts';
import {
  HEADER_RULES,
  LIQUID_CONTAINER_KEYWORDS,
  PLANNER_PRIORITY,
  TYPE_PREFIX,
  headerIncludesAny,
} from '../rules/skland-rules.ts';

function resolveCraftTypeName(row: CellData[], typeColumnIdx: number): string {
  if (typeColumnIdx < 0 || !row[typeColumnIdx]) return '简易制作';
  const cell = row[typeColumnIdx];
  const direct = normalizeTextLabel(cell.text);
  if (direct) return direct;
  const firstEntry = cell.entries[0];
  if (firstEntry?.id) return `类型${firstEntry.id}`;
  return '简易制作';
}

export function runSimpleConverter(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConverterResult {
  const touchedTypes = new Set<string>();
  let recipes = 0;

  for (const rec of itemRecords) {
    const refs = extractWikiDocRefs(rec, {
      chapterTitles: ['参与配方'],
      widgetTitles: ['简易制作'],
    });

    for (const ref of refs) {
      const tables = extractTablesFromDoc(ref.doc);
      for (const table of tables) {
        const typeIdx = firstColumnIndex(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.simpleTypeHeaders),
        );
        const inputIdxs = findColumnIndexes(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.inputHeaders),
        );
        const outputIdxs = findColumnIndexes(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.outputHeaders),
        );

        if (!inputIdxs.length || !outputIdxs.length) continue;

        table.rows.slice(1).forEach((row) => {
          const craftTypeName = resolveCraftTypeName(row, typeIdx);
          const typeKey = `${ctx.args.gameId}:${TYPE_PREFIX.simple}/${makeTypeSlug(craftTypeName)}`;

          const inputs = collectStacksFromColumnsWithKeywords(ctx, row, inputIdxs, {
            allowZeroCount: false,
            zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
          });
          const outputs = collectStacksFromColumnsWithKeywords(ctx, row, outputIdxs, {
            allowZeroCount: false,
            zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
          });
          if (!outputs.length) return;

          ctx.registerType(
            {
              key: typeKey,
              displayName: craftTypeName,
              renderer: 'slot_layout',
              paramSchema: {
                usage: { displayName: 'Usage' },
                cost: { displayName: 'Cost' },
              },
              defaults: {
                speed: 1,
                moduleSlots: 0,
                beaconSlots: 0,
              },
              plannerPriority: PLANNER_PRIORITY.simple,
            },
            inputs.length,
            outputs.length,
          );

          ctx.addRecipe({
            id: ctx.nextRecipeId(`${TYPE_PREFIX.simple}/${craftTypeName}`),
            type: typeKey,
            slotContents: buildSlotContents(inputs, outputs),
            params: {
              craftType: craftTypeName,
              sourceItemId: ref.itemId,
              sourceItemName: ref.itemName,
              chapterTitle: ref.chapterTitle,
              widgetTitle: ref.widgetTitle,
              tabTitle: ref.tabTitle,
            },
          });
          touchedTypes.add(typeKey);
          recipes += 1;
        });
      }
    }
  }

  return {
    name: 'simple',
    recipeTypes: touchedTypes.size,
    recipes,
  };
}

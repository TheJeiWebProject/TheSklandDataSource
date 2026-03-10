import type { ItemRecord } from '../types.ts';
import { makeTypeSlug } from '../helpers.ts';
import type { ConverterContext } from './context.ts';
import { buildSlotContents } from './context.ts';
import { extractTablesFromDoc, extractWikiDocRefs } from './wiki-parse.ts';
import {
  collectStacksFromColumnsWithKeywords,
  findColumnIndexes,
  parseDurationFromColumns,
} from './table-helpers.ts';
import type { ConverterResult } from './types.ts';
import {
  HEADER_RULES,
  LIQUID_CONTAINER_KEYWORDS,
  PLANNER_PRIORITY,
  TYPE_PREFIX,
  headerIncludesAny,
  resolveMachinePlannerPriority,
} from '../rules/skland-rules.ts';

export function runDeviceRecipeConverter(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConverterResult {
  const touchedTypes = new Set<string>();
  let recipes = 0;

  for (const rec of itemRecords) {
    const refs = extractWikiDocRefs(rec, {
      chapterTitles: ['使用方式'],
      widgetTitles: ['相关配方'],
    });

    for (const ref of refs) {
      const machinePackId = ctx.getItemPackIdByWikiId(ref.itemId);
      if (!machinePackId) continue;
      const machineName =
        ref.itemName || ctx.getItemNameByWikiId(ref.itemId) || `设备${ref.itemId}`;
      const typeKey = `${ctx.args.gameId}:${TYPE_PREFIX.industrial}/${makeTypeSlug(machineName)}`;

      const tables = extractTablesFromDoc(ref.doc);
      for (const table of tables) {
        const inputIdxs = findColumnIndexes(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.inputHeaders),
        );
        const outputIdxs = findColumnIndexes(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.outputHeaders),
        );
        const timeIdxs = findColumnIndexes(table.headers, (header) =>
          headerIncludesAny(header, HEADER_RULES.timeHeaders),
        );

        if (!inputIdxs.length || !outputIdxs.length) continue;

        table.rows.slice(1).forEach((row) => {
          const inputs = collectStacksFromColumnsWithKeywords(ctx, row, inputIdxs, {
            allowZeroCount: false,
            zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
          });
          const outputs = collectStacksFromColumnsWithKeywords(ctx, row, outputIdxs, {
            allowZeroCount: false,
            zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
          });
          if (!outputs.length) return;

          const duration = parseDurationFromColumns(row, timeIdxs);

          ctx.registerType(
            {
              key: typeKey,
              displayName: machineName,
              renderer: 'slot_layout',
              machine: {
                id: machinePackId,
                name: machineName,
              },
              paramSchema: {
                time: { displayName: 'Time', unit: 's', format: 'duration' },
                usage: { displayName: 'Usage' },
                cost: { displayName: 'Cost' },
              },
              defaults: {
                speed: 1,
                moduleSlots: 0,
                beaconSlots: 0,
              },
              plannerPriority: resolveMachinePlannerPriority(machineName, PLANNER_PRIORITY.machine),
            },
            inputs.length,
            outputs.length,
          );

          ctx.addRecipe({
            id: ctx.nextRecipeId(`${TYPE_PREFIX.industrial}/${machineName}`),
            type: typeKey,
            slotContents: buildSlotContents(inputs, outputs),
            ...(Object.keys(duration).length ? { params: duration } : {}),
          });
          touchedTypes.add(typeKey);
          recipes += 1;
        });
      }
    }
  }

  return {
    name: 'device_recipe',
    recipeTypes: touchedTypes.size,
    recipes,
  };
}

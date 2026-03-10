import type { ItemRecord } from '../types.ts';
import { makeTypeSlug } from '../helpers.ts';
import type { ConverterContext } from './context.ts';
import { buildSlotContents } from './context.ts';
import { extractTablesFromDoc, extractWikiDocRefs, normalizeTextLabel } from './wiki-parse.ts';
import {
  collectStacksFromColumnsWithKeywords,
  findColumnIndexes,
  firstColumnIndex,
} from './table-helpers.ts';
import type { ConverterResult, CellData, WikiDocRef } from './types.ts';
import {
  HEADER_RULES,
  LIQUID_CONTAINER_KEYWORDS,
  PLANNER_PRIORITY,
  TYPE_PREFIX,
  headerIncludesAny,
  resolveMachinePlannerPriority,
} from '../rules/skland-rules.ts';

interface MachineBinding {
  typeKey: string;
  displayName: string;
  machinePackId?: string;
}

function resolveMachineBinding(
  ctx: ConverterContext,
  row: CellData[],
  machineIdx: number,
  fallback: MachineBinding | null,
): MachineBinding | null {
  if (machineIdx < 0 || !row[machineIdx]) return fallback;
  const machineCell = row[machineIdx];

  const firstEntry = machineCell.entries[0];
  if (firstEntry?.id) {
    const machineName =
      ctx.getItemNameByWikiId(firstEntry.id) ||
      normalizeTextLabel(machineCell.text) ||
      `设备${firstEntry.id}`;
    const machinePackId = ctx.ensureItemPackId(firstEntry.id, machineName);
    const slug = makeTypeSlug(machineName || `machine_${firstEntry.id}`);
    return {
      typeKey: `${ctx.args.gameId}:${TYPE_PREFIX.industrial}/${slug}`,
      displayName: machineName,
      machinePackId,
    };
  }

  const machineNameText = normalizeTextLabel(machineCell.text);
  if (!machineNameText) return fallback;
  const slug = makeTypeSlug(machineNameText);
  return {
    typeKey: `${ctx.args.gameId}:${TYPE_PREFIX.industrial}/${slug}`,
    displayName: machineNameText,
  };
}

function convertFragment(
  ctx: ConverterContext,
  fragment: WikiDocRef,
): { recipes: number; typeKeys: Set<string> } {
  const tables = extractTablesFromDoc(fragment.doc);
  const touchedTypes = new Set<string>();
  let recipes = 0;

  for (const table of tables) {
    const machineIdx = firstColumnIndex(table.headers, (header) =>
      headerIncludesAny(header, HEADER_RULES.machineHeaders),
    );
    const inputIdxs = findColumnIndexes(table.headers, (header) =>
      headerIncludesAny(header, HEADER_RULES.inputHeaders),
    );
    const outputIdxs = findColumnIndexes(table.headers, (header) =>
      headerIncludesAny(header, HEADER_RULES.outputHeaders),
    );

    if (!inputIdxs.length || !outputIdxs.length) continue;

    let activeMachine: MachineBinding | null = null;
    table.rows.slice(1).forEach((row) => {
      activeMachine = resolveMachineBinding(ctx, row, machineIdx, activeMachine);
      if (!activeMachine) return;

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
          key: activeMachine.typeKey,
          displayName: activeMachine.displayName,
          renderer: 'slot_layout',
          ...(activeMachine.machinePackId
            ? {
              machine: {
                id: activeMachine.machinePackId,
                name: activeMachine.displayName,
              },
            }
            : {}),
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
          plannerPriority: resolveMachinePlannerPriority(
            activeMachine.displayName,
            PLANNER_PRIORITY.machine,
          ),
        },
        inputs.length,
        outputs.length,
      );

      const recipeId = ctx.nextRecipeId(`${TYPE_PREFIX.industrial}/${activeMachine.displayName}`);
      ctx.addRecipe({
        id: recipeId,
        type: activeMachine.typeKey,
        slotContents: buildSlotContents(inputs, outputs),
        params: {
          sourceItemId: fragment.itemId,
          sourceItemName: fragment.itemName,
          chapterTitle: fragment.chapterTitle,
          widgetTitle: fragment.widgetTitle,
          tabTitle: fragment.tabTitle,
        },
      });
      touchedTypes.add(activeMachine.typeKey);
      recipes += 1;
    });
  }

  return { recipes, typeKeys: touchedTypes };
}

export function runIndustrialConverter(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConverterResult {
  const typeKeys = new Set<string>();
  let recipes = 0;

  for (const rec of itemRecords) {
    const refs = extractWikiDocRefs(rec, {
      chapterTitles: ['参与配方'],
      widgetTitles: ['工业合成'],
    });
    for (const ref of refs) {
      const result = convertFragment(ctx, ref);
      recipes += result.recipes;
      result.typeKeys.forEach((key) => typeKeys.add(key));
    }
  }

  return {
    name: 'industrial',
    recipeTypes: typeKeys.size,
    recipes,
  };
}

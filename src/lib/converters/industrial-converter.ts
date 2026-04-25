import type { ItemRecord } from '../types.ts';
import { makeTypeSlug } from '../helpers.ts';
import type { ConverterContext } from './context.ts';
import { buildSlotContents } from './context.ts';
import { extractTablesFromDoc, extractWikiDocRefs, normalizeTextLabel } from './wiki-parse.ts';
import {
  collectStacksFromColumnsWithKeywords,
  createLiquidContainerStack,
  findColumnIndexes,
  firstColumnIndex,
  isDerivedContainerEntry,
  stackFromEntry,
} from './table-helpers.ts';
import type { ConverterResult, CellData, EntryRef, RecipeStack, WikiDocRef } from './types.ts';
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

function registerIndustrialType(
  ctx: ConverterContext,
  activeMachine: MachineBinding,
  inputCount: number,
  outputCount: number,
): void {
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
    inputCount,
    outputCount,
  );
}

function addIndustrialRecipe(
  ctx: ConverterContext,
  fragment: WikiDocRef,
  activeMachine: MachineBinding,
  inputs: RecipeStack[],
  outputs: RecipeStack[],
  extraParams?: Record<string, unknown>,
): void {
  registerIndustrialType(ctx, activeMachine, inputs.length, outputs.length);

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
      ...extraParams,
    },
  });
}

function normalizedCellText(cell: CellData): string {
  return String(cell.text || '').replace(/\s+/g, '');
}

function cellHasContainer(ctx: ConverterContext, cell: CellData): boolean {
  return cell.entries.some((entry) => isDerivedContainerEntry(ctx, entry));
}

function cellHasNonContainerEntry(ctx: ConverterContext, cell: CellData): boolean {
  return cell.entries.some((entry) => !isDerivedContainerEntry(ctx, entry));
}

function dedupeEntriesById(entries: EntryRef[]): EntryRef[] {
  const seen = new Set<string>();
  const out: EntryRef[] = [];
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

function containerEntriesFromCells(ctx: ConverterContext, cells: CellData[]): EntryRef[] {
  return dedupeEntriesById(
    cells.flatMap((cell) => cell.entries.filter((entry) => isDerivedContainerEntry(ctx, entry))),
  );
}

function firstLiquidEntry(ctx: ConverterContext, cells: CellData[]): EntryRef | null {
  const entries = cells.flatMap((cell) =>
    cell.entries.filter((entry) => !isDerivedContainerEntry(ctx, entry)),
  );
  return entries.find((entry) => entry.count > 0) || entries[0] || null;
}

function convertLiquidContainerRow(
  ctx: ConverterContext,
  fragment: WikiDocRef,
  activeMachine: MachineBinding,
  row: CellData[],
  machineIdx: number,
): number {
  const normalizedRow = row.map((cell) => normalizedCellText(cell)).join('');
  if (!normalizedRow.includes('任意一种容器') || !normalizedRow.includes('盛装')) return 0;

  const liquid = firstLiquidEntry(
    ctx,
    row.filter((cell, idx) => idx !== machineIdx && !cellHasContainer(ctx, cell)),
  );
  if (!liquid) return 0;

  const emptyContainerCells = row.filter((cell) => {
    if (!cellHasContainer(ctx, cell)) return false;
    const text = normalizedCellText(cell);
    if (text.includes('空容器')) return true;
    if (text.includes('以上任意一种容器')) return true;
    return text.includes('任意一种容器') && !text.includes('盛装');
  });
  const filledContainerCells = row.filter((cell) => {
    if (!cellHasContainer(ctx, cell) || !cellHasNonContainerEntry(ctx, cell)) return false;
    return normalizedCellText(cell).includes('盛装');
  });

  if (activeMachine.displayName.includes('灌装机')) {
    const containers = containerEntriesFromCells(
      ctx,
      emptyContainerCells.length ? emptyContainerCells : filledContainerCells,
    );
    let added = 0;
    for (const container of containers) {
      const liquidStack = stackFromEntry(ctx, liquid, { allowZeroCount: true });
      const containerStack = stackFromEntry(ctx, container, { allowZeroCount: true });
      if (!liquidStack || !containerStack) continue;
      const filledStack = createLiquidContainerStack(ctx, container, liquid, 1);
      addIndustrialRecipe(
        ctx,
        fragment,
        activeMachine,
        [liquidStack, containerStack],
        [filledStack],
        { containerRule: 'liquid_container_fill' },
      );
      added += 1;
    }
    return added;
  }

  if (activeMachine.displayName.includes('拆解机')) {
    const containers = containerEntriesFromCells(
      ctx,
      filledContainerCells.length ? filledContainerCells : emptyContainerCells,
    );
    let added = 0;
    for (const container of containers) {
      const filledStack = createLiquidContainerStack(ctx, container, liquid, 1);
      const liquidStack = stackFromEntry(ctx, liquid, { allowZeroCount: true });
      const containerStack = stackFromEntry(ctx, container, { allowZeroCount: true });
      if (!liquidStack || !containerStack) continue;
      addIndustrialRecipe(
        ctx,
        fragment,
        activeMachine,
        [filledStack],
        [liquidStack, containerStack],
        { containerRule: 'liquid_container_drain' },
      );
      added += 1;
    }
    return added;
  }

  return 0;
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

      const specialRecipes = convertLiquidContainerRow(
        ctx,
        fragment,
        activeMachine,
        row,
        machineIdx,
      );
      if (specialRecipes > 0) {
        touchedTypes.add(activeMachine.typeKey);
        recipes += specialRecipes;
        return;
      }

      const inputs = collectStacksFromColumnsWithKeywords(ctx, row, inputIdxs, {
        allowZeroCount: false,
        zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
      });
      const outputs = collectStacksFromColumnsWithKeywords(ctx, row, outputIdxs, {
        allowZeroCount: false,
        zeroCountAsOneKeywords: LIQUID_CONTAINER_KEYWORDS,
      });
      if (!outputs.length) return;

      addIndustrialRecipe(ctx, fragment, activeMachine, inputs, outputs);
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

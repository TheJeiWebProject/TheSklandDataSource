import fs from 'node:fs';
import path from 'node:path';
import type { BuildArgs } from './types.ts';
import type { RecipeDef } from './converters/types.ts';
import { MACHINE_PROFILE_OVERRIDES } from './rules/machine-profile-rules.ts';

interface PostprocessInput {
  repoRoot: string;
  args: BuildArgs;
  recipeTypes: Array<Record<string, unknown>>;
  recipes: RecipeDef[];
}

export interface PostprocessResult {
  recipeTypes: Array<Record<string, unknown>>;
  recipes: RecipeDef[];
  stats: {
    dedupedRecipes: number;
    machineTypesPatched: number;
    machineTemplatesMatched: number;
  };
}

interface MachineTemplate {
  slots?: Array<Record<string, unknown>>;
  paramSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

const NON_FUNCTIONAL_PARAM_KEYS = new Set([
  'sourceItemId',
  'sourceItemName',
  'chapterTitle',
  'widgetTitle',
  'tabTitle',
  'sectionType',
  'title',
  'context',
  'methods',
  'wikiDoc',
  'sourcePattern',
  'usagePattern',
]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b));
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',');
  return `{${body}}`;
}

function normalizeStackSignature(stack: unknown): string {
  const rec = asRecord(stack);
  return [
    String(rec.kind ?? ''),
    String(rec.id ?? ''),
    String(rec.amount ?? ''),
    String(rec.meta ?? ''),
    stableStringify(rec.nbt),
    String(rec.unit ?? ''),
  ].join('|');
}

function normalizeSlotValueSignature(slotValue: unknown): string {
  if (Array.isArray(slotValue)) {
    const sigs = slotValue
      .map((s) => normalizeStackSignature(s))
      .sort((a, b) => a.localeCompare(b));
    return `[${sigs.join(';')}]`;
  }
  return normalizeStackSignature(slotValue);
}

function normalizeSlotContentsSignature(slotContents: Record<string, unknown>): string {
  const inputs: string[] = [];
  const outputs: string[] = [];
  const others: string[] = [];

  Object.keys(slotContents).forEach((slotId) => {
    const valueSig = normalizeSlotValueSignature(slotContents[slotId]);
    if (/^in\d+$/i.test(slotId)) {
      inputs.push(valueSig);
      return;
    }
    if (/^out\d+$/i.test(slotId)) {
      outputs.push(valueSig);
      return;
    }
    others.push(`${slotId}=${valueSig}`);
  });

  inputs.sort((a, b) => a.localeCompare(b));
  outputs.sort((a, b) => a.localeCompare(b));
  others.sort((a, b) => a.localeCompare(b));

  return `in:${inputs.join(',')}|out:${outputs.join(',')}|other:${others.join(',')}`;
}

function normalizeFunctionalParamsSignature(params: unknown): string {
  const rec = asRecord(params);
  const filtered: Record<string, unknown> = {};
  Object.keys(rec).forEach((key) => {
    if (NON_FUNCTIONAL_PARAM_KEYS.has(key)) return;
    filtered[key] = rec[key];
  });
  return stableStringify(filtered);
}

function isSlotLayoutType(typeDef: Record<string, unknown> | undefined): boolean {
  return String(typeDef?.renderer ?? '') === 'slot_layout';
}

function dedupeRecipes(
  recipes: RecipeDef[],
  recipeTypesByKey: Map<string, Record<string, unknown>>,
): { recipes: RecipeDef[]; deduped: number } {
  const passthrough: Array<{ order: number; recipe: RecipeDef }> = [];
  const bucketByBaseKey = new Map<
    string,
    Map<
      string,
      {
        order: number;
        recipe: RecipeDef;
      }
    >
  >();
  let deduped = 0;

  recipes.forEach((recipe, order) => {
    const typeDef = recipeTypesByKey.get(recipe.type);
    if (!isSlotLayoutType(typeDef)) {
      passthrough.push({ order, recipe });
      return;
    }

    const slotSig = normalizeSlotContentsSignature(asRecord(recipe.slotContents));
    const paramSig = normalizeFunctionalParamsSignature(recipe.params);
    const baseKey = `${recipe.type}|${slotSig}`;

    const paramMap =
      bucketByBaseKey.get(baseKey) ||
      new Map<
        string,
        {
          order: number;
          recipe: RecipeDef;
        }
      >();

    if (paramMap.has(paramSig)) {
      deduped += 1;
      return;
    }
    paramMap.set(paramSig, { order, recipe });
    bucketByBaseKey.set(baseKey, paramMap);
  });

  const kept: Array<{ order: number; recipe: RecipeDef }> = [...passthrough];
  bucketByBaseKey.forEach((paramMap) => {
    const entries = Array.from(paramMap.entries());
    const hasFunctionalVariant = entries.some(([paramSig]) => paramSig !== '{}');
    entries
      .sort((a, b) => a[1].order - b[1].order)
      .forEach(([paramSig, entry]) => {
        if (hasFunctionalVariant && paramSig === '{}') {
          deduped += 1;
          return;
        }
        kept.push(entry);
      });
  });

  kept.sort((a, b) => a.order - b.order);
  return {
    recipes: kept.map((entry) => entry.recipe),
    deduped,
  };
}

function loadAefMachineTemplates(repoRoot: string): Map<string, MachineTemplate> {
  const out = new Map<string, MachineTemplate>();
  const p = path.join(repoRoot, 'public', 'packs', 'aef', 'recipeTypes.json');
  if (!fs.existsSync(p)) return out;

  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : [];
    arr.forEach((entry) => {
      const rec = asRecord(entry);
      if (String(rec.renderer ?? '') !== 'slot_layout') return;
      const displayName = String(rec.displayName ?? '').trim();
      if (!displayName) return;
      out.set(displayName, {
        ...(Array.isArray(rec.slots) ? { slots: rec.slots.map((slot) => asRecord(slot)) } : {}),
        ...(rec.paramSchema && typeof rec.paramSchema === 'object'
          ? { paramSchema: asRecord(rec.paramSchema) }
          : {}),
        ...(rec.defaults && typeof rec.defaults === 'object'
          ? { defaults: asRecord(rec.defaults) }
          : {}),
      });
    });
  } catch {
    // Ignore invalid template file.
  }
  return out;
}

function applyMachineTypeProfiles(
  recipeTypes: Array<Record<string, unknown>>,
  gameId: string,
  templateMap: Map<string, MachineTemplate>,
): {
  recipeTypes: Array<Record<string, unknown>>;
  patched: number;
  matchedTemplates: number;
} {
  const out: Array<Record<string, unknown>> = [];
  let patched = 0;
  let matchedTemplates = 0;

  for (const typeDef of recipeTypes) {
    const key = String(typeDef.key ?? '');
    const renderer = String(typeDef.renderer ?? '');
    if (!key.startsWith(`${gameId}:industrial/`) || renderer !== 'slot_layout') {
      out.push(typeDef);
      continue;
    }

    const machine = asRecord(typeDef.machine);
    const machineName = String(machine.name ?? typeDef.displayName ?? '').trim();
    const override = MACHINE_PROFILE_OVERRIDES[machineName];
    const templateName = String(override?.useTemplate || machineName).trim();
    const template = templateMap.get(templateName);

    const next = deepClone(typeDef);
    let changed = false;

    const slotsFrom =
      override?.slots !== undefined
        ? override.slots
        : template?.slots !== undefined
          ? template.slots
          : null;
    if (slotsFrom) {
      next.slots = deepClone(slotsFrom);
      changed = true;
    }

    const paramSchemaFrom =
      override?.paramSchema !== undefined
        ? override.paramSchema
        : template?.paramSchema !== undefined
          ? template.paramSchema
          : null;
    if (paramSchemaFrom) {
      next.paramSchema = deepClone(paramSchemaFrom);
      changed = true;
    }

    const currentDefaults = asRecord(next.defaults);
    const templateDefaults = template?.defaults ? asRecord(template.defaults) : {};
    const overrideDefaults = override?.defaults ? asRecord(override.defaults) : {};
    const mergedDefaults = {
      ...currentDefaults,
      ...templateDefaults,
      ...overrideDefaults,
    };
    if (Object.keys(mergedDefaults).length) {
      next.defaults = mergedDefaults;
      changed = true;
    }

    if (changed) {
      patched += 1;
      if (template) matchedTemplates += 1;
    }
    out.push(next);
  }

  return { recipeTypes: out, patched, matchedTemplates };
}

export function runPostprocess(input: PostprocessInput): PostprocessResult {
  const templateMap = loadAefMachineTemplates(input.repoRoot);
  const profileResult = applyMachineTypeProfiles(input.recipeTypes, input.args.gameId, templateMap);

  const recipeTypesByKey = new Map<string, Record<string, unknown>>();
  profileResult.recipeTypes.forEach((typeDef) => {
    const key = String(typeDef.key ?? '').trim();
    if (key) recipeTypesByKey.set(key, typeDef);
  });

  const dedupeResult = dedupeRecipes(input.recipes, recipeTypesByKey);

  return {
    recipeTypes: profileResult.recipeTypes,
    recipes: dedupeResult.recipes,
    stats: {
      dedupedRecipes: dedupeResult.deduped,
      machineTypesPatched: profileResult.patched,
      machineTemplatesMatched: profileResult.matchedTemplates,
    },
  };
}

import { buildSlots, makeTypeSlug, parseAmount, toPackItemId } from '../helpers.ts';
import type { RecipeDef, RecipeStack, DynamicRecipeType, ConverterContextInit } from './types.ts';

export class ConverterContext {
  readonly args;
  private readonly itemIdToPackId;
  private readonly itemNameById;
  private readonly itemIconById;
  private readonly itemTagsById;
  private readonly extraItemsById;
  private readonly recipeTypes = new Map<string, DynamicRecipeType>();
  private readonly recipes: RecipeDef[] = [];
  private seq = 0;

  constructor(init: ConverterContextInit) {
    this.args = init.args;
    this.itemIdToPackId = init.itemIdToPackId;
    this.itemNameById = init.itemNameById;
    this.itemIconById = init.itemIconById;
    this.itemTagsById = init.itemTagsById;
    this.extraItemsById = init.extraItemsById;
  }

  getItemPackIdByWikiId(wikiItemId: string): string | null {
    return this.itemIdToPackId.get(String(wikiItemId).trim()) || null;
  }

  getItemNameByWikiId(wikiItemId: string): string {
    return this.itemNameById.get(String(wikiItemId).trim()) || '';
  }

  getItemIconByWikiId(wikiItemId: string): string {
    return this.itemIconById.get(String(wikiItemId).trim()) || '';
  }

  getItemTagsByWikiId(wikiItemId: string): string[] {
    const tags = this.itemTagsById.get(String(wikiItemId).trim()) || [];
    return tags.length ? [...tags] : [];
  }

  ensureItemPackId(wikiItemId: string, nameHint = ''): string {
    const rawId = String(wikiItemId || '').trim();
    if (!rawId) return '';
    const existing = this.itemIdToPackId.get(rawId);
    if (existing) return existing;

    const packItemId = toPackItemId(this.args.gameId, rawId);
    this.itemIdToPackId.set(rawId, packItemId);

    const resolvedName = nameHint || this.itemNameById.get(rawId) || `条目${rawId}`;
    this.extraItemsById.set(rawId, {
      key: { id: packItemId },
      name: resolvedName,
      source: 'wiki/entry',
    });
    return packItemId;
  }

  ensureDerivedItemPackId(
    derivedId: string,
    name: string,
    source: string,
    extra?: { icon?: string; tags?: string[] },
  ): string {
    const rawId = String(derivedId || '').trim();
    if (!rawId) return '';
    const existing = this.itemIdToPackId.get(rawId);
    if (existing) {
      const existingDef = this.extraItemsById.get(rawId);
      if (existingDef && extra) {
        if (!existingDef.icon && extra.icon) existingDef.icon = extra.icon;
        if (Array.isArray(extra.tags) && extra.tags.length) {
          const currentTags = Array.isArray(existingDef.tags) ? existingDef.tags : [];
          const merged = Array.from(new Set([...currentTags, ...extra.tags]));
          if (merged.length) existingDef.tags = merged;
        }
      }
      return existing;
    }

    const packItemId = toPackItemId(this.args.gameId, rawId);
    this.itemIdToPackId.set(rawId, packItemId);
    if (name) this.itemNameById.set(rawId, name);

    const resolvedName = name || this.itemNameById.get(rawId) || `派生${rawId}`;
    this.extraItemsById.set(rawId, {
      key: { id: packItemId },
      name: resolvedName,
      ...(extra?.icon ? { icon: extra.icon } : {}),
      ...(extra?.tags?.length ? { tags: extra.tags } : {}),
      source,
    });
    return packItemId;
  }

  createDerivedStack(
    derivedId: string,
    name: string,
    amount: number,
    source: string,
    extra?: { icon?: string; tags?: string[] },
  ): RecipeStack {
    const packId = this.ensureDerivedItemPackId(derivedId, name, source, extra);
    return {
      kind: 'item',
      id: packId,
      amount: Math.max(1, amount || 1),
    };
  }

  createStackFromEntry(
    entry: { id?: string; count?: string | number },
    nameHint = '',
  ): RecipeStack | null {
    const wikiId = String(entry?.id || '').trim();
    if (!wikiId) return null;
    const packId = this.ensureItemPackId(wikiId, nameHint || this.getItemNameByWikiId(wikiId));
    if (!packId) return null;
    return {
      kind: 'item',
      id: packId,
      amount: parseAmount(entry?.count),
    };
  }

  nextRecipeId(prefix: string): string {
    this.seq += 1;
    const slug = makeTypeSlug(prefix || 'recipe');
    return `${this.args.gameId}:r/${slug}/${this.seq}`;
  }

  registerType(
    partial: Omit<DynamicRecipeType, 'maxIn' | 'maxOut'>,
    inCount: number,
    outCount: number,
  ): void {
    const current = this.recipeTypes.get(partial.key);
    if (!current) {
      this.recipeTypes.set(partial.key, {
        ...partial,
        maxIn: Math.max(0, inCount),
        maxOut: Math.max(0, outCount),
      });
      return;
    }

    current.maxIn = Math.max(current.maxIn, Math.max(0, inCount));
    current.maxOut = Math.max(current.maxOut, Math.max(0, outCount));
    if (!current.displayName && partial.displayName) current.displayName = partial.displayName;
    if (!current.machine && partial.machine) current.machine = partial.machine;
    if (!current.paramSchema && partial.paramSchema) current.paramSchema = partial.paramSchema;
    if (!current.defaults && partial.defaults) current.defaults = partial.defaults;
    if (
      typeof partial.plannerPriority === 'number' &&
      Number.isFinite(partial.plannerPriority) &&
      (typeof current.plannerPriority !== 'number' ||
        !Number.isFinite(current.plannerPriority) ||
        partial.plannerPriority > current.plannerPriority)
    ) {
      current.plannerPriority = partial.plannerPriority;
    }
  }

  addRecipe(recipe: RecipeDef): void {
    this.recipes.push(recipe);
  }

  getRecipes(): RecipeDef[] {
    return this.recipes;
  }

  getRecipeTypes(): Array<Record<string, unknown>> {
    const out = Array.from(this.recipeTypes.values()).map((type) => ({
      key: type.key,
      displayName: type.displayName,
      renderer: type.renderer,
      ...(type.machine ? { machine: type.machine } : {}),
      slots: buildSlots(Math.max(1, type.maxIn), Math.max(1, type.maxOut)),
      ...(type.paramSchema ? { paramSchema: type.paramSchema } : {}),
      ...(type.defaults ? { defaults: type.defaults } : {}),
      ...(typeof type.plannerPriority === 'number' && Number.isFinite(type.plannerPriority)
        ? { plannerPriority: type.plannerPriority }
        : {}),
    }));

    out.sort((a, b) => String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')));
    return out;
  }
}

export function buildSlotContents(
  inputs: RecipeStack[],
  outputs: RecipeStack[],
): Record<string, RecipeStack> {
  const out: Record<string, RecipeStack> = {};
  inputs.forEach((stack, idx) => {
    out[`in${idx + 1}`] = stack;
  });
  outputs.forEach((stack, idx) => {
    out[`out${idx + 1}`] = stack;
  });
  return out;
}

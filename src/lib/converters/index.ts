import type { ItemRecord } from '../types.ts';
import { ConverterContext } from './context.ts';
import { runDeviceRecipeConverter } from './device-recipe-converter.ts';
import { runIndustrialConverter } from './industrial-converter.ts';
import { runSimpleConverter } from './simple-converter.ts';
import { runSourceConverter } from './source-converter.ts';
import { runUsageConverter } from './usage-converter.ts';
import type { ConverterResult, RecipeDef } from './types.ts';

export interface ConversionRunResult {
  recipeTypes: Array<Record<string, unknown>>;
  recipes: RecipeDef[];
  converterStats: ConverterResult[];
}

export function runAllConverters(
  ctx: ConverterContext,
  itemRecords: ItemRecord[],
): ConversionRunResult {
  const converterStats: ConverterResult[] = [];

  converterStats.push(runIndustrialConverter(ctx, itemRecords));
  converterStats.push(runSimpleConverter(ctx, itemRecords));
  converterStats.push(runDeviceRecipeConverter(ctx, itemRecords));
  converterStats.push(runSourceConverter(ctx, itemRecords));
  converterStats.push(runUsageConverter(ctx, itemRecords));

  return {
    recipeTypes: ctx.getRecipeTypes(),
    recipes: ctx.getRecipes(),
    converterStats,
  };
}

export { ConverterContext };

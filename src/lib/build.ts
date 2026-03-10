import fs from 'node:fs';
import path from 'node:path';
import {
  collectImageUrls,
  downloadAssets,
  prepareImageHandling,
  rewriteUrlsDeep,
} from './assets.ts';
import {
  ensureDir,
  readJson,
  resolvePathMaybeAbsolute,
  updatePackIndex,
  writeJson,
} from './fs-utils.ts';
import {
  buildItemDescription,
  numericThenLexicalCompare,
  sanitizePathSegment,
  toPackItemId,
} from './helpers.ts';
import { listInfoFiles, loadMethodsByItemId } from './input.ts';
import { ConverterContext, runAllConverters } from './converters/index.ts';
import { runPostprocess } from './postprocess.ts';
import type { BuildArgs, BuildSummary, ItemRecord, JsonObject } from './types.ts';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface WikiTagNode {
  id?: string | number;
  name?: string;
  value?: string;
  children?: WikiTagNode[];
}

interface ItemRarityInfo {
  stars: number;
  label: string;
  color: string;
  token?: string;
  tagId?: string;
}

const RARITY_COLOR_BY_STARS: Record<number, string> = {
  1: '#9e9e9e',
  2: '#42a5f5',
  3: '#66bb6a',
  4: '#ffa726',
  5: '#fb8c00',
  6: '#bd1c1c',
};
const DEFAULT_TARGET_RATE_PRESETS = {
  halfPerMinute: 3,
  fullPerMinute: 6,
};

function flattenTagNodes(nodes: WikiTagNode[] | undefined): WikiTagNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: WikiTagNode[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    out.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i] as WikiTagNode);
  }
  return out;
}

function parseStars(value: string): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const fromRarity = raw.match(/rarity[_-]?(\d+)/i);
  if (fromRarity?.[1]) return Number.parseInt(fromRarity[1], 10) || 0;
  const fromStar = raw.match(/(\d+)\s*星/);
  if (fromStar?.[1]) return Number.parseInt(fromStar[1], 10) || 0;
  const fromNumber = raw.match(/(\d+)/);
  if (fromNumber?.[1]) return Number.parseInt(fromNumber[1], 10) || 0;
  return 0;
}

function extractItemRarity(item: Record<string, unknown>): ItemRarityInfo | null {
  const brief = asRecord(item.brief);
  const subType = asRecord(item.subType);
  const subTypeList = Array.isArray(brief.subTypeList)
    ? (brief.subTypeList as Array<Record<string, unknown>>)
    : [];
  const filterTagTree = Array.isArray(subType.filterTagTree)
    ? (subType.filterTagTree as WikiTagNode[])
    : [];
  const tagIds = Array.isArray(item.tagIds) ? item.tagIds.map((id) => String(id)) : [];

  const groups = flattenTagNodes(filterTagTree).filter((node) => Array.isArray(node.children));
  const rarityGroup = groups.find((node) => {
    const name = asString(node.name);
    const value = asString(node.value);
    if (name.includes('星')) return true;
    if (/rarity/i.test(value)) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    return children.some(
      (child) => parseStars(`${asString(child.name)} ${asString(child.value)}`) > 0,
    );
  });
  if (!rarityGroup) return null;

  const groupId = asString(rarityGroup.id);
  const childNodes = (
    Array.isArray(rarityGroup.children) ? rarityGroup.children : []
  );
  if (!childNodes.length) return null;

  let selectedChild: WikiTagNode | undefined;
  const subTypeEntry = subTypeList.find((entry) => asString(entry.subTypeId) === groupId);
  if (subTypeEntry) {
    const selectedValue = asString(subTypeEntry.value);
    selectedChild = childNodes.find((child) => asString(child.id) === selectedValue);
  }
  if (!selectedChild) {
    selectedChild = childNodes.find((child) => tagIds.includes(asString(child.id)));
  }
  if (!selectedChild) return null;

  const label = asString(selectedChild.name);
  const token = asString(selectedChild.value);
  const stars = parseStars(`${label} ${token}`);
  if (!stars) return null;

  return {
    stars,
    label: label || `${stars}星`,
    color: RARITY_COLOR_BY_STARS[stars] ?? RARITY_COLOR_BY_STARS[1] ?? '#9e9e9e',
    ...(token ? { token } : {}),
    ...(asString(selectedChild.id) ? { tagId: asString(selectedChild.id) } : {}),
  };
}

export async function buildSklandPack(args: BuildArgs, repoRoot: string): Promise<BuildSummary> {
  const infoRootAbs = resolvePathMaybeAbsolute(repoRoot, args.infoRoot);
  const methodsRootAbs = resolvePathMaybeAbsolute(repoRoot, args.methodsRoot);
  const outDirAbs = resolvePathMaybeAbsolute(repoRoot, args.outDir);

  if (!infoRootAbs || !fs.existsSync(infoRootAbs)) {
    throw new Error(`info root not found: ${infoRootAbs || args.infoRoot}`);
  }
  ensureDir(outDirAbs);

  const version = args.version || new Date().toISOString().slice(0, 10);

  console.log('== Skland Pack Builder ==');
  console.log(`info root: ${infoRootAbs}`);
  console.log(`methods root: ${methodsRootAbs}`);
  console.log(`output: ${outDirAbs}`);
  console.log(`packId/gameId: ${args.packId}/${args.gameId}`);

  const infoFiles = listInfoFiles(infoRootAbs);
  const methodsByItemId = loadMethodsByItemId(methodsRootAbs);

  const itemRecords: ItemRecord[] = [];
  for (const f of infoFiles) {
    let payload: JsonObject;
    try {
      payload = readJson<JsonObject>(f.absPath);
    } catch {
      continue;
    }

    const item = asRecord(asRecord(payload.data).item);
    if (!Object.keys(item).length) continue;

    const itemId = asString(item.itemId || f.itemId);
    if (!itemId) continue;

    const mainName = asString(asRecord(item.mainType).name) || f.mainName;
    const subName = asString(asRecord(item.subType).name) || f.subName;
    const categoryPath =
      f.categoryPath ||
      path.join(
        sanitizePathSegment(mainName || 'unknown-main'),
        sanitizePathSegment(subName || 'unknown-sub'),
      );

    itemRecords.push({
      itemId,
      mainName,
      subName,
      categoryPath,
      relPath: f.relPath.replaceAll('\\', '/'),
      absPath: f.absPath,
      payload,
    });
  }

  itemRecords.sort((a, b) => numericThenLexicalCompare(a.itemId, b.itemId));
  console.log(`items loaded: ${itemRecords.length}`);

  const itemIdToPackId = new Map<string, string>();
  const itemNameById = new Map<string, string>();
  const itemIconById = new Map<string, string>();
  const itemTagsById = new Map<string, string[]>();
  for (const rec of itemRecords) {
    const wikiItem = asRecord(asRecord(rec.payload.data).item);
    const name = asString(wikiItem.name || asRecord(wikiItem.brief).name);
    if (name) itemNameById.set(rec.itemId, name);
    itemIdToPackId.set(rec.itemId, toPackItemId(args.gameId, rec.itemId));
  }

  const imageUrlSet = new Set<string>();
  if (args.downloadAssets) {
    for (const rec of itemRecords) collectImageUrls(rec.payload, imageUrlSet);
  }
  console.log(`image urls found: ${imageUrlSet.size}`);
  const imageHandling = prepareImageHandling(Array.from(imageUrlSet), args, repoRoot);
  if (imageHandling.mode !== 'origin') {
    console.log(
      `image mode: ${imageHandling.mode}${imageHandling.configPath ? ` (config=${imageHandling.configPath})` : ''}`,
    );
  }
  const downloadedImageUrlMap = await downloadAssets(Array.from(imageUrlSet), args, outDirAbs, {
    fetchUrlByOriginal: imageHandling.fetchUrlByOriginal,
    requestHeaders: imageHandling.requestHeaders,
  });
  const imageUrlMap = new Map<string, string>(imageHandling.rewriteUrlByOriginal);
  downloadedImageUrlMap.forEach((localUrl, originalUrl) => {
    imageUrlMap.set(originalUrl, localUrl);
  });

  const items: Record<string, unknown>[] = [];
  const itemsLite: Record<string, unknown>[] = [];
  const itemFiles: string[] = [];

  for (const rec of itemRecords) {
    const payload = deepClone(rec.payload);
    rewriteUrlsDeep(payload, imageUrlMap);

    const wikiItem = asRecord(asRecord(payload.data).item);
    const brief = asRecord(wikiItem.brief);
    const itemId = rec.itemId;
    const keyId = itemIdToPackId.get(itemId);
    if (!keyId) continue;

    const cover = asString(brief.cover);
    const methodPayload = methodsByItemId.get(itemId);
    const description = buildItemDescription(methodPayload);
    const rarity = extractItemRarity(wikiItem);
    const tags: string[] = [];
    if (rec.mainName) tags.push(`main:${rec.mainName}`);
    if (rec.subName) tags.push(`sub:${rec.subName}`);
    if (rarity) tags.push(`rarity:${rarity.stars}`);
    if (cover) itemIconById.set(itemId, cover);
    if (tags.length) itemTagsById.set(itemId, tags);

    const itemDef: Record<string, unknown> = {
      key: { id: keyId },
      name: asString(wikiItem.name) || asString(brief.name) || `Item ${itemId}`,
      ...(cover ? { icon: cover } : {}),
      ...(description ? { description } : {}),
      ...(rarity ? { rarity } : {}),
      ...(tags.length ? { tags } : {}),
      source: rec.relPath,
      wiki: payload,
    };

    const rel = path.join('items', rec.categoryPath, `id${itemId}.json`).replaceAll('\\', '/');
    writeJson(path.join(outDirAbs, rel), itemDef);
    itemFiles.push(rel);
    items.push(itemDef);

    const liteItemDef = { ...itemDef };
    delete liteItemDef.wiki;
    delete liteItemDef.recipes;
    itemsLite.push({
      ...liteItemDef,
      detailPath: rel,
    });
  }

  const extraItemsById = new Map<string, Record<string, unknown>>();
  const converterContext = new ConverterContext({
    args,
    itemIdToPackId,
    itemNameById,
    itemIconById,
    itemTagsById,
    extraItemsById,
  });

  const conversionResult = runAllConverters(converterContext, itemRecords);
  const postprocessResult = runPostprocess({
    repoRoot,
    args,
    recipeTypes: conversionResult.recipeTypes,
    recipes: conversionResult.recipes,
  });

  for (const [rawId, itemDef] of extraItemsById.entries()) {
    const rel = path.join('items', '_extra', `id${rawId}.json`).replaceAll('\\', '/');
    writeJson(path.join(outDirAbs, rel), itemDef);
    itemFiles.push(rel);
    items.push(itemDef);
    itemsLite.push({
      ...itemDef,
      detailPath: rel,
    });
  }

  const recipeTypes = postprocessResult.recipeTypes;
  const recipes = postprocessResult.recipes;

  itemFiles.sort((a, b) => a.localeCompare(b));
  itemsLite.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  writeJson(path.join(outDirAbs, 'itemsIndex.json'), itemFiles);
  writeJson(path.join(outDirAbs, 'itemsLite.json'), itemsLite);
  writeJson(path.join(outDirAbs, 'recipeTypes.json'), recipeTypes);
  writeJson(path.join(outDirAbs, 'recipes.json'), recipes);
  writeJson(path.join(outDirAbs, 'manifest.json'), {
    packId: args.packId,
    gameId: args.gameId,
    displayName: args.displayName,
    version,
    files: {
      items: 'items/',
      itemsIndex: 'itemsIndex.json',
      itemsLite: 'itemsLite.json',
      recipeTypes: 'recipeTypes.json',
      recipes: 'recipes.json',
    },
    planner: {
      targetRatePresets: DEFAULT_TARGET_RATE_PRESETS,
    },
    startupDialog: {
      id: 'skland-data-notice-v1',
      title: '重要说明',
      message: '请注意：本工具中显示的物品 ID（如 endfield.xxx）仅供本站内部索引与配方关联使用，并非游戏内的真实物品 ID。请勿将其作为游戏内控制台代码或其他修改工具的参考依据。\n\n合成表数据来自Wiki，可能存在错误或与游戏实际不符，请以游戏内数据为准。',
      confirmText: '我知道了',
    },
    ...(imageHandling.manifestImageProxy ? { imageProxy: imageHandling.manifestImageProxy } : {}),
  });

  const summary: BuildSummary = {
    generatedAt: new Date().toISOString(),
    input: {
      infoRoot: infoRootAbs,
      methodsRoot: methodsRootAbs,
    },
    output: outDirAbs,
    pack: {
      packId: args.packId,
      gameId: args.gameId,
      displayName: args.displayName,
      version,
    },
    stats: {
      items: items.length,
      baseItems: itemRecords.length,
      extraItems: extraItemsById.size,
      recipeTypes: recipeTypes.length,
      recipes: recipes.length,
      docRecipes: conversionResult.converterStats
        .filter((s) => s.name.includes('doc'))
        .reduce((sum, s) => sum + s.recipes, 0),
      downloadedImages: downloadedImageUrlMap.size,
      dedupedRecipes: postprocessResult.stats.dedupedRecipes,
      machineTypesPatched: postprocessResult.stats.machineTypesPatched,
      machineTemplatesMatched: postprocessResult.stats.machineTemplatesMatched,
    },
  };

  writeJson(path.join(outDirAbs, 'build-summary.json'), {
    ...summary,
    converterStats: conversionResult.converterStats,
    postprocess: postprocessResult.stats,
  });

  if (args.registerPackIndex) {
    updatePackIndex(repoRoot, args.packId, args.displayName);
  }

  console.log('Done.');
  console.log(`items: ${items.length} (base=${itemRecords.length}, extra=${extraItemsById.size})`);
  console.log(`recipeTypes: ${recipeTypes.length}, recipes: ${recipes.length}`);
  for (const stat of conversionResult.converterStats) {
    console.log(`  - ${stat.name}: recipeTypes=${stat.recipeTypes}, recipes=${stat.recipes}`);
  }
  console.log(
    `postprocess: dedupedRecipes=${postprocessResult.stats.dedupedRecipes}, machineTypesPatched=${postprocessResult.stats.machineTypesPatched}, machineTemplatesMatched=${postprocessResult.stats.machineTemplatesMatched}`,
  );
  console.log(
    `images: rewritten=${imageHandling.rewriteUrlByOriginal.size}, downloaded=${downloadedImageUrlMap.size}`,
  );

  return summary;
}

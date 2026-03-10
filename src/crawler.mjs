import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULTS = {
  outRoot: 'temp',
  catalogDir: 'catalog',
  infoDir: 'info',
  rankDir: 'contribute',
  catalogUrl: 'https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=&typeSubId=',
  infoUrlTemplate: 'https://zonai.skland.com/web/v1/wiki/item/info?id={itemId}',
  rankUrlTemplate: 'https://zonai.skland.com/web/v1/wiki/contribute/rank?itemId={itemId}',
  concurrency: 6,
  retries: 3,
  retryDelayMs: 800,
  timeoutMs: 25000,
  sleepMs: 0,
  includeRank: false,
  expandCatalog: true,
  saveCatalogShards: false,
  overwrite: false,
  limit: 0,
  only: [],
  proxyEndpoint: '',
  proxyMethodHeader: 'x-method',
  proxyUrlHeader: 'x-url',
  userAgent: 'jei-web-scraper/1.0 (+https://wiki.skland.com/endfield)',
  categoryDirStyle: 'name',
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--help' || key === '-h') {
      args.help = true;
      continue;
    }
    if (key === '--out-root' && next) {
      args.outRoot = next;
      i += 1;
      continue;
    }
    if (key === '--catalog-dir' && next) {
      args.catalogDir = next;
      i += 1;
      continue;
    }
    if (key === '--info-dir' && next) {
      args.infoDir = next;
      i += 1;
      continue;
    }
    if (key === '--rank-dir' && next) {
      args.rankDir = next;
      i += 1;
      continue;
    }
    if (key === '--catalog-url' && next) {
      args.catalogUrl = next;
      i += 1;
      continue;
    }
    if (key === '--info-url-template' && next) {
      args.infoUrlTemplate = next;
      i += 1;
      continue;
    }
    if (key === '--rank-url-template' && next) {
      args.rankUrlTemplate = next;
      i += 1;
      continue;
    }
    if (key === '--concurrency' && next) {
      args.concurrency = Math.max(1, Number.parseInt(next, 10) || DEFAULTS.concurrency);
      i += 1;
      continue;
    }
    if (key === '--retries' && next) {
      args.retries = Math.max(1, Number.parseInt(next, 10) || DEFAULTS.retries);
      i += 1;
      continue;
    }
    if (key === '--retry-delay-ms' && next) {
      args.retryDelayMs = Math.max(0, Number.parseInt(next, 10) || DEFAULTS.retryDelayMs);
      i += 1;
      continue;
    }
    if (key === '--timeout-ms' && next) {
      args.timeoutMs = Math.max(1000, Number.parseInt(next, 10) || DEFAULTS.timeoutMs);
      i += 1;
      continue;
    }
    if (key === '--sleep-ms' && next) {
      args.sleepMs = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
      continue;
    }
    if (key === '--limit' && next) {
      args.limit = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
      continue;
    }
    if (key === '--only' && next) {
      args.only = String(next)
        .split(/[,\s]+/)
        .map((v) => v.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (key === '--with-rank') {
      args.includeRank = true;
      continue;
    }
    if (key === '--no-expand-catalog') {
      args.expandCatalog = false;
      continue;
    }
    if (key === '--save-catalog-shards') {
      args.saveCatalogShards = true;
      continue;
    }
    if (key === '--overwrite') {
      args.overwrite = true;
      continue;
    }
    if (key === '--proxy-endpoint' && next) {
      args.proxyEndpoint = next;
      i += 1;
      continue;
    }
    if (key === '--proxy-method-header' && next) {
      args.proxyMethodHeader = next;
      i += 1;
      continue;
    }
    if (key === '--proxy-url-header' && next) {
      args.proxyUrlHeader = next;
      i += 1;
      continue;
    }
    if (key === '--user-agent' && next) {
      args.userAgent = next;
      i += 1;
      continue;
    }
    if (key === '--category-dir-style' && next) {
      const mode = String(next).toLowerCase();
      if (mode === 'name' || mode === 'id' || mode === 'name-id') {
        args.categoryDirStyle = mode;
      }
      i += 1;
      continue;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Skland wiki crawler

Usage:
  node scripts/crawl-skland-wiki.mjs [options]

Options:
  --out-root <path>            Output root directory (relative or absolute path)
  --category-dir-style <mode>  Category folders: name | id | name-id (default: name)
  --proxy-endpoint <url>       Use local proxy endpoint, e.g. http://127.0.0.1:12345/proxy-request
  (info/rank files are stored by category, e.g. 终末地百科/设备/id752.json)
  --with-rank                  Also fetch /wiki/contribute/rank?itemId=...
  --no-expand-catalog          Do not request catalog by each (mainId, subId)
  --save-catalog-shards        Save per-category catalog responses to temp/catalog/by-type
  --overwrite                  Re-fetch files even if they already exist
  --limit <n>                  Only crawl first n itemIds after filtering
  --only <ids>                 Comma/space separated itemId list, e.g. --only 7,752,1002
  --concurrency <n>            Parallel item requests (default: 6)
  --timeout-ms <ms>            Request timeout in ms (default: 25000)

Examples:
  node scripts/crawl-skland-wiki.mjs --proxy-endpoint http://127.0.0.1:12345/proxy-request --with-rank
  node scripts/crawl-skland-wiki.mjs --proxy-endpoint http://127.0.0.1:12345/proxy-request --only 7,752 --with-rank --overwrite
  node scripts/crawl-skland-wiki.mjs --proxy-endpoint http://127.0.0.1:12345/proxy-request --limit 50 --save-catalog-shards
`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function resolveOutPaths(args) {
  const root = path.resolve(repoRoot, args.outRoot);
  const catalog = path.join(root, args.catalogDir);
  const info = path.join(root, args.infoDir);
  const rank = path.join(root, args.rankDir);
  return { root, catalog, info, rank };
}

function buildCatalogUrlByType(baseUrl, mainId, subId) {
  const u = new URL(baseUrl);
  u.searchParams.set('typeMainId', String(mainId ?? ''));
  u.searchParams.set('typeSubId', String(subId ?? ''));
  return u.toString();
}

function fillItemId(template, itemId) {
  return template.replaceAll('{itemId}', encodeURIComponent(String(itemId)));
}

function makeUrlWithParam(url, key, value) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

function buildInfoUrlCandidates(args, itemId) {
  const id = String(itemId);
  const primary = fillItemId(args.infoUrlTemplate, id);
  const set = new Set([primary]);
  try {
    const u = new URL(primary);
    if (u.searchParams.has('itemId')) {
      set.add(makeUrlWithParam(primary, 'id', id));
    } else if (u.searchParams.has('id')) {
      set.add(makeUrlWithParam(primary, 'itemId', id));
    } else {
      set.add(makeUrlWithParam(primary, 'id', id));
      set.add(makeUrlWithParam(primary, 'itemId', id));
    }
  } catch {
    // Keep primary only on malformed template.
  }
  return Array.from(set);
}

function hasItemInfo(payload) {
  return !!(payload && payload.data && payload.data.item);
}

async function fetchItemInfoWithFallback(args, itemId) {
  const candidates = buildInfoUrlCandidates(args, itemId);
  let lastPayload = null;
  for (const url of candidates) {
    const raw = await requestJsonWithRetry(url, args, `item/info ${itemId}`);
    const payload = unwrapProxyPayload(raw, `item/info ${itemId}`);
    assertSklandOk(payload, `item/info ${itemId}`);
    lastPayload = payload;
    if (hasItemInfo(payload)) {
      return payload;
    }
  }
  return lastPayload;
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.slice(0, 240).replace(/\s+/g, ' ');
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${snippet}`);
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON (${url}): ${String(err)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

async function requestJson(targetUrl, args) {
  if (isNonEmptyString(args.proxyEndpoint)) {
    const headers = {
      Accept: 'application/json',
      [args.proxyMethodHeader]: 'GET',
      [args.proxyUrlHeader]: targetUrl,
    };
    if (isNonEmptyString(args.userAgent)) headers['User-Agent'] = args.userAgent;
    return fetchJson(args.proxyEndpoint, { method: 'GET', headers }, args.timeoutMs);
  }
  const headers = { Accept: 'application/json' };
  if (isNonEmptyString(args.userAgent)) headers['User-Agent'] = args.userAgent;
  return fetchJson(targetUrl, { method: 'GET', headers }, args.timeoutMs);
}

async function requestJsonWithRetry(url, args, label) {
  let lastError = null;
  for (let i = 1; i <= args.retries; i += 1) {
    try {
      return await requestJson(url, args);
    } catch (err) {
      lastError = err;
      const canRetry = i < args.retries;
      console.warn(`[retry ${i}/${args.retries}] ${label} failed: ${String(err)}`);
      if (!canRetry) break;
      await sleep(args.retryDelayMs * i);
    }
  }
  throw lastError;
}

function unwrapProxyPayload(payload, label) {
  if (!payload || typeof payload !== 'object') return payload;
  if ('success' in payload) {
    if (payload.success === true && payload.data && typeof payload.data === 'object') {
      return payload.data;
    }
    const errMsg = payload.error || payload.message || 'proxy request failed';
    throw new Error(`${label} proxy error: ${String(errMsg)}`);
  }
  return payload;
}

function assertSklandOk(payload, label) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${label} returned non-object payload`);
  }
  const code = payload.code ?? payload.errCode ?? null;
  if (code != null && Number(code) !== 0) {
    const message = payload.message ?? payload.msg ?? 'unknown error';
    throw new Error(`${label} returned code=${code}, message=${String(message)}`);
  }
}

function collectFromCatalog(catalogPayload, itemMap, pairs) {
  const catalog = catalogPayload?.data?.catalog;
  if (!Array.isArray(catalog)) return;
  for (const main of catalog) {
    const mainId = String(main?.id ?? '');
    const subArr = Array.isArray(main?.typeSub) ? main.typeSub : [];
    for (const sub of subArr) {
      const subId = String(sub?.id ?? '');
      if (mainId && subId) pairs.add(`${mainId}::${subId}`);
      const items = Array.isArray(sub?.items) ? sub.items : [];
      for (const it of items) {
        const itemId = String(it?.itemId ?? '').trim();
        if (!itemId) continue;
        if (!itemMap.has(itemId)) {
          itemMap.set(itemId, {
            itemId,
            name: it?.name ?? it?.brief?.name ?? '',
            mainId,
            mainName: main?.name ?? '',
            subId,
            subName: sub?.name ?? '',
          });
        }
      }
    }
  }
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function sortIdsNumeric(a, b) {
  const na = Number(a.itemId);
  const nb = Number(b.itemId);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.itemId).localeCompare(String(b.itemId));
}

function sanitizePathSegment(v, fallback) {
  const raw = String(v ?? '').trim();
  const source = raw || String(fallback ?? '');
  let s = source
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = String(fallback ?? 'unknown');
  return s;
}

function buildCategoryRelDir(item, categoryDirStyle = 'name') {
  const mainId = sanitizePathSegment(item?.mainId, 'unknown');
  const subId = sanitizePathSegment(item?.subId, 'unknown');
  const mainName = sanitizePathSegment(item?.mainName, `main_${mainId}`);
  const subName = sanitizePathSegment(item?.subName, `sub_${subId}`);

  if (categoryDirStyle === 'id') {
    return path.join(`main_${mainId}`, `sub_${subId}`);
  }
  if (categoryDirStyle === 'name-id') {
    return path.join(`${mainName}(${mainId})`, `${subName}(${subId})`);
  }
  return path.join(mainName, subName);
}

function makeIndexEntry(item, dirPath, relPath) {
  const normalizedRelPath = relPath.replaceAll('\\', '/');
  const filePath = path.join(dirPath, relPath);
  return {
    itemId: String(item.itemId),
    id: String(item.itemId),
    name: path.basename(relPath),
    path: normalizedRelPath,
    categoryPath: path.dirname(normalizedRelPath).replaceAll('\\', '/'),
    mainId: String(item.mainId ?? ''),
    mainName: String(item.mainName ?? ''),
    subId: String(item.subId ?? ''),
    subName: String(item.subName ?? ''),
    exists: fs.existsSync(filePath),
  };
}

function formatCategoryText(item) {
  const mainName = String(item?.mainName || 'unknown-main');
  const subName = String(item?.subName || 'unknown-sub');
  const mainId = String(item?.mainId || 'unknown');
  const subId = String(item?.subId || 'unknown');
  return `${mainName}(${mainId})/${subName}(${subId})`;
}

function formatDisplayName(item, infoPayload) {
  const fromInfo = infoPayload?.data?.item?.name;
  const fromCatalog = item?.name;
  const resolved = fromInfo || fromCatalog || `item-${item?.itemId ?? 'unknown'}`;
  return String(resolved);
}

function logFileSuccess(kind, source, item, relPath, absolutePath, displayName) {
  const p = String(relPath).replaceAll('\\', '/');
  const category = formatCategoryText(item);
  const abs = path.resolve(absolutePath);
  console.log(
    `[ok/${kind}] ${source} | 分类: ${category} | 名称: ${displayName} | id: ${item.itemId} | 文件: ${p} | 绝对路径: ${abs}`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const out = resolveOutPaths(args);
  ensureDir(out.catalog);
  ensureDir(out.info);
  if (args.includeRank) ensureDir(out.rank);

  console.log('== Skland Wiki Crawler ==');
  console.log(`Proxy mode: ${isNonEmptyString(args.proxyEndpoint) ? `ON (${args.proxyEndpoint})` : 'OFF (direct)'}`);
  console.log(`Output: ${out.root}`);

  const itemMap = new Map();
  const pairSet = new Set();
  const catalogIndexFiles = [];

  const fullCatalogRaw = await requestJsonWithRetry(args.catalogUrl, args, 'catalog/full');
  const fullCatalog = unwrapProxyPayload(fullCatalogRaw, 'catalog/full');
  assertSklandOk(fullCatalog, 'catalog/full');
  const fullCatalogPath = path.join(out.catalog, 'full.json');
  writeJson(fullCatalogPath, fullCatalog);
  catalogIndexFiles.push({ name: 'full.json', path: 'full.json' });
  collectFromCatalog(fullCatalog, itemMap, pairSet);

  if (args.expandCatalog) {
    const pairs = Array.from(pairSet).map((s) => {
      const [mainId, subId] = s.split('::');
      return { mainId, subId };
    });
    console.log(`Catalog pairs: ${pairs.length}`);
    await mapLimit(pairs, Math.min(args.concurrency, 8), async (pair) => {
      const url = buildCatalogUrlByType(args.catalogUrl, pair.mainId, pair.subId);
      const payloadRaw = await requestJsonWithRetry(url, args, `catalog/${pair.mainId}-${pair.subId}`);
      const payload = unwrapProxyPayload(payloadRaw, `catalog/${pair.mainId}-${pair.subId}`);
      assertSklandOk(payload, `catalog/${pair.mainId}-${pair.subId}`);
      collectFromCatalog(payload, itemMap, pairSet);
      if (args.saveCatalogShards) {
        const rel = path.join('by-type', `main_${pair.mainId}_sub_${pair.subId}.json`);
        const abs = path.join(out.catalog, rel);
        writeJson(abs, payload);
        catalogIndexFiles.push({ name: rel.replaceAll('\\', '/'), path: rel.replaceAll('\\', '/') });
      }
      if (args.sleepMs > 0) await sleep(args.sleepMs);
    });
  }

  let items = Array.from(itemMap.values()).sort(sortIdsNumeric);
  if (args.only.length > 0) {
    const onlySet = new Set(args.only.map((v) => String(v)));
    items = items.filter((it) => onlySet.has(String(it.itemId)));
  }
  if (args.limit > 0) {
    items = items.slice(0, args.limit);
  }

  console.log(`Items to fetch: ${items.length}`);
  if (items.length === 0) {
    writeJson(path.join(out.catalog, 'index.json'), { files: catalogIndexFiles });
    writeJson(path.join(out.info, 'index.json'), { files: [] });
    if (args.includeRank) writeJson(path.join(out.rank, 'index.json'), { files: [] });
    console.log('No items matched. Finished.');
    return;
  }

  let done = 0;
  const failedInfo = [];
  const failedRank = [];
  const infoFiles = [];
  const rankFiles = [];

  await mapLimit(items, args.concurrency, async (item) => {
    const itemId = item.itemId;
    const infoFile = `id${itemId}.json`;
    const infoRelPath = path.join(buildCategoryRelDir(item, args.categoryDirStyle), infoFile);
    const infoPath = path.join(out.info, infoRelPath);

    try {
      if (!args.overwrite && fs.existsSync(infoPath)) {
        infoFiles.push(makeIndexEntry(item, out.info, infoRelPath));
        logFileSuccess('info', 'cached', item, infoRelPath, infoPath, formatDisplayName(item, null));
      } else {
        const infoJson = await fetchItemInfoWithFallback(args, itemId);
        writeJson(infoPath, infoJson);
        infoFiles.push(makeIndexEntry(item, out.info, infoRelPath));
        logFileSuccess('info', 'fetched', item, infoRelPath, infoPath, formatDisplayName(item, infoJson));
      }
    } catch (err) {
      failedInfo.push({ itemId, error: String(err) });
    }

    if (args.includeRank) {
      const rankFile = `id${itemId}.json`;
      const rankRelPath = path.join(buildCategoryRelDir(item, args.categoryDirStyle), rankFile);
      const rankPath = path.join(out.rank, rankRelPath);
      try {
        if (!args.overwrite && fs.existsSync(rankPath)) {
          rankFiles.push(makeIndexEntry(item, out.rank, rankRelPath));
          logFileSuccess('rank', 'cached', item, rankRelPath, rankPath, formatDisplayName(item, null));
        } else {
          const rankUrl = fillItemId(args.rankUrlTemplate, itemId);
          const rankJsonRaw = await requestJsonWithRetry(rankUrl, args, `contribute/rank ${itemId}`);
          const rankJson = unwrapProxyPayload(rankJsonRaw, `contribute/rank ${itemId}`);
          assertSklandOk(rankJson, `contribute/rank ${itemId}`);
          writeJson(rankPath, rankJson);
          rankFiles.push(makeIndexEntry(item, out.rank, rankRelPath));
          logFileSuccess('rank', 'fetched', item, rankRelPath, rankPath, formatDisplayName(item, null));
        }
      } catch (err) {
        failedRank.push({ itemId, error: String(err) });
      }
    }

    done += 1;
    if (done % 20 === 0 || done === items.length) {
      console.log(`Progress: ${done}/${items.length}`);
    }
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  });

  infoFiles.sort((a, b) => Number(a.itemId) - Number(b.itemId));
  rankFiles.sort((a, b) => Number(a.itemId) - Number(b.itemId));

  writeJson(path.join(out.catalog, 'index.json'), { files: catalogIndexFiles });
  writeJson(path.join(out.info, 'index.json'), { files: infoFiles });
  if (args.includeRank) writeJson(path.join(out.rank, 'index.json'), { files: rankFiles });

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      includeRank: args.includeRank,
      expandCatalog: args.expandCatalog,
      concurrency: args.concurrency,
      retries: args.retries,
      overwrite: args.overwrite,
      proxyEndpoint: args.proxyEndpoint || null,
      categoryDirStyle: args.categoryDirStyle,
    },
    stats: {
      catalogItemsDiscovered: itemMap.size,
      requestedItems: items.length,
      infoSaved: infoFiles.length,
      rankSaved: args.includeRank ? rankFiles.length : 0,
      infoFailed: failedInfo.length,
      rankFailed: failedRank.length,
    },
    failedInfo,
    failedRank,
  };

  writeJson(path.join(out.root, 'crawl-summary.json'), summary);

  console.log('Done.');
  console.log(`info saved: ${infoFiles.length}, info failed: ${failedInfo.length}`);
  if (args.includeRank) {
    console.log(`rank saved: ${rankFiles.length}, rank failed: ${failedRank.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULTS = {
  inputRoot: 'temp/info',
  catalog: 'temp/catalog/full.json',
  outDir: 'temp/skland-methods',
  includeEmpty: false,
};

const SYNTH_RE = /(\u5408\u6210|\u914d\u65b9|\u5236\u9020|\u5236\u4f5c|\u952d\u9020|\u5de5\u4e1a\u5408\u6210|\u7b80\u6613\u5236\u4f5c|\u76f8\u5173\u914d\u65b9|\u53c2\u4e0e\u914d\u65b9|\u539f\u6599\u9700\u6c42|\u5408\u6210\u4ea7\u7269|\u5236\u4f5c\u4ea7\u7269|\u6d88\u8017\u65f6\u957f|\u8017\u65f6)/;
const ACQUIRE_RE = /(\u83b7\u53d6|\u6765\u6e90|\u6389\u843d|\u4ea7\u51fa|\u83b7\u53d6\u65b9\u5f0f|\u7269\u54c1\u6765\u6e90|\u76f8\u5173\u6765\u6e90|\u6240\u5c5e\u533a\u57df|\u914d\u65b9\u6765\u6e90|\u91ce\u5916\u91c7\u96c6)/;
const USAGE_RE = /(\u7528\u9014|\u4f7f\u7528|\u6548\u679c|\u88c5\u5907|\u6218\u672f\u7269\u54c1|\u4ed3\u50a8|\u88c5\u7bb1|\u6d88\u8017|\u76f8\u5173\u7528\u9014|\u7269\u54c1\u7528\u9014)/;

const INGREDIENT_HEADER_RE = /(\u539f\u6599|\u6750\u6599|\u9700\u6c42|\u6d88\u8017|\u6295\u5165)/;
const OUTPUT_HEADER_RE = /(\u4ea7\u7269|\u4ea7\u51fa|\u7ed3\u679c|\u5408\u6210\u4ea7\u7269|\u5236\u4f5c\u4ea7\u7269|\u83b7\u5f97)/;
const DURATION_HEADER_RE = /(\u8017\u65f6|\u65f6\u957f|\u65f6\u95f4)/;
const MACHINE_HEADER_RE = /(\u8bbe\u5907|\u5de5\u4f5c\u53f0|\u673a\u5668|\u5408\u6210\u8bbe\u5907)/;

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--input-root' && next) {
      args.inputRoot = next;
      i += 1;
      continue;
    }
    if (key === '--catalog' && next) {
      args.catalog = next;
      i += 1;
      continue;
    }
    if (key === '--out-dir' && next) {
      args.outDir = next;
      i += 1;
      continue;
    }
    if (key === '--include-empty') {
      args.includeEmpty = true;
      continue;
    }
    if (key === '--help' || key === '-h') {
      args.help = true;
      continue;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Skland wiki method extractor

Usage:
  node scripts/extract-skland-methods.mjs [options]

Options:
  --input-root <path>   Wiki info root directory (default: temp/info)
  --catalog <path>      Catalog full.json for id->name mapping (default: temp/catalog/full.json)
  --out-dir <path>      Output directory (default: temp/skland-methods)
  --include-empty       Also output items without synthesis/acquisition/usage hits

Examples:
  node scripts/extract-skland-methods.mjs --input-root D:\\data\\skland\\info --catalog D:\\data\\skland\\catalog\\full.json --out-dir D:\\data\\skland\\converted
  node scripts/extract-skland-methods.mjs --input-root temp/info --catalog temp/catalog/full.json --out-dir temp/skland-methods
`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolvePathMaybeAbsolute(inputPath) {
  if (!inputPath) return '';
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(repoRoot, inputPath);
}

function sanitizePathSegment(v, fallback = 'unknown') {
  const raw = String(v ?? '').trim() || fallback;
  let s = raw
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0 || code > 31;
    })
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = fallback;
  return s;
}

function listInfoFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      if (entry.name.toLowerCase() === 'index.json') continue;
      out.push(abs);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function buildCatalogMap(catalogPath) {
  const map = new Map();
  if (!catalogPath || !fs.existsSync(catalogPath)) return map;
  let data = null;
  try {
    data = readJson(catalogPath);
  } catch {
    return map;
  }
  const catalogList = data?.data?.catalog || [];
  for (const main of catalogList) {
    for (const sub of main?.typeSub || []) {
      for (const item of sub?.items || []) {
        const itemId = String(item?.itemId ?? '').trim();
        if (!itemId) continue;
        const name = String(item?.name || item?.brief?.name || itemId);
        map.set(itemId, {
          id: itemId,
          name,
          cover: String(item?.brief?.cover || ''),
        });
      }
    }
  }
  return map;
}

function buildItemNameMapFromInfoFiles(infoFiles) {
  const map = new Map();
  for (const infoFile of infoFiles) {
    let payload = null;
    try {
      payload = readJson(infoFile);
    } catch {
      continue;
    }
    const itemId = String(payload?.data?.item?.itemId ?? '').trim();
    if (!itemId) continue;
    const name = String(payload?.data?.item?.name || payload?.data?.item?.brief?.name || '').trim();
    if (!name) continue;
    map.set(itemId, name);
  }
  return map;
}

function entryRefFromInline(inline, catalogMap) {
  const id = String(inline?.entry?.id ?? '').trim();
  if (!id) return null;
  const countRaw = String(inline?.entry?.count ?? '').trim();
  const count = countRaw && countRaw !== '0' ? countRaw : '';
  const mapped = catalogMap.get(id);
  return {
    id,
    count,
    showType: String(inline?.entry?.showType || ''),
    name: mapped?.name || '',
  };
}

function inlineText(inline, catalogMap) {
  if (!inline) return '';
  if (inline.kind === 'text') return String(inline.text?.text || '');
  if (inline.kind === 'entry') {
    const entry = entryRefFromInline(inline, catalogMap);
    if (!entry) return '';
    const label = entry.name || entry.id;
    return entry.count ? `[${label}x${entry.count}]` : `[${label}]`;
  }
  return '';
}

function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = `${e.id}|${e.count}|${e.showType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function collectEntriesFromBlock(block, blockMap, catalogMap, out) {
  if (!block) return;
  if (block.kind === 'text') {
    for (const inline of block.text?.inlineElements || []) {
      if (inline?.kind !== 'entry') continue;
      const ref = entryRefFromInline(inline, catalogMap);
      if (ref) out.push(ref);
    }
    return;
  }
  if (block.kind === 'list') {
    for (const itemId of block.list?.itemIds || []) {
      for (const childId of block.list?.itemMap?.[itemId]?.childIds || []) {
        collectEntriesFromBlock(blockMap?.[childId], blockMap, catalogMap, out);
      }
    }
    return;
  }
  if (block.kind === 'quote') {
    for (const childId of block.quote?.childIds || []) {
      collectEntriesFromBlock(blockMap?.[childId], blockMap, catalogMap, out);
    }
    return;
  }
  if (block.kind === 'table') {
    for (const rowId of block.table?.rowIds || []) {
      for (const colId of block.table?.columnIds || []) {
        const cell = block.table?.cellMap?.[`${rowId}_${colId}`];
        for (const childId of cell?.childIds || []) {
          collectEntriesFromBlock(blockMap?.[childId], blockMap, catalogMap, out);
        }
      }
    }
  }
}

function blockToPlainText(block, blockMap, catalogMap) {
  if (!block) return '';
  if (block.kind === 'text') {
    return (block.text?.inlineElements || []).map((inline) => inlineText(inline, catalogMap)).join('');
  }
  if (block.kind === 'list') {
    const lines = [];
    for (const itemId of block.list?.itemIds || []) {
      const item = block.list?.itemMap?.[itemId];
      const parts = [];
      for (const childId of item?.childIds || []) {
        const text = blockToPlainText(blockMap?.[childId], blockMap, catalogMap);
        if (text) parts.push(text);
      }
      if (parts.length) lines.push(parts.join(' '));
    }
    return lines.join(' ');
  }
  if (block.kind === 'quote') {
    return (block.quote?.childIds || [])
      .map((childId) => blockToPlainText(blockMap?.[childId], blockMap, catalogMap))
      .filter(Boolean)
      .join(' ');
  }
  if (block.kind === 'table') {
    const rows = [];
    for (const rowId of block.table?.rowIds || []) {
      const cells = [];
      for (const colId of block.table?.columnIds || []) {
        const cell = block.table?.cellMap?.[`${rowId}_${colId}`];
        const cellText = (cell?.childIds || [])
          .map((childId) => blockToPlainText(blockMap?.[childId], blockMap, catalogMap))
          .filter(Boolean)
          .join('');
        cells.push(cellText);
      }
      if (cells.some((cell) => cell.trim())) rows.push(cells.join(' | '));
    }
    return rows.join('\n');
  }
  return '';
}

function inlineToMarkdown(inline, catalogMap) {
  if (!inline) return '';
  if (inline.kind === 'text') return String(inline.text?.text || '');
  if (inline.kind === 'entry') {
    const entry = entryRefFromInline(inline, catalogMap);
    if (!entry) return '';
    const label = entry.name || entry.id;
    return entry.count ? `[${label}x${entry.count}]` : `[${label}]`;
  }
  return '';
}

function blockToMarkdownLines(block, blockMap, catalogMap, indent = 0) {
  if (!block) return [];

  if (block.kind === 'text') {
    const content = (block.text?.inlineElements || []).map((inline) => inlineToMarkdown(inline, catalogMap)).join('');
    return content ? [content] : [];
  }

  if (block.kind === 'list') {
    const rows = [];
    const prefix = block.list?.kind === 'ordered' ? (index) => `${index + 1}. ` : () => '- ';
    const itemIds = block.list?.itemIds || [];
    for (let i = 0; i < itemIds.length; i += 1) {
      const itemId = itemIds[i];
      const item = block.list?.itemMap?.[itemId];
      const childLines = [];
      for (const childId of item?.childIds || []) {
        childLines.push(...blockToMarkdownLines(blockMap?.[childId], blockMap, catalogMap, indent + 1));
      }
      if (!childLines.length) continue;
      const pad = '  '.repeat(indent);
      rows.push(`${pad}${prefix(i)}${childLines[0]}`.trimEnd());
      for (const extra of childLines.slice(1)) {
        rows.push(`${'  '.repeat(indent + 1)}${extra}`.trimEnd());
      }
    }
    return rows;
  }

  if (block.kind === 'quote') {
    return (block.quote?.childIds || [])
      .flatMap((childId) => blockToMarkdownLines(blockMap?.[childId], blockMap, catalogMap, indent))
      .filter(Boolean)
      .map((line) => `> ${line}`);
  }

  if (block.kind === 'table') {
    const rows = [];
    const rowIds = block.table?.rowIds || [];
    const colIds = block.table?.columnIds || [];
    for (const rowId of rowIds) {
      const cells = [];
      for (const colId of colIds) {
        const cell = block.table?.cellMap?.[`${rowId}_${colId}`];
        const text = (cell?.childIds || [])
          .flatMap((childId) => blockToMarkdownLines(blockMap?.[childId], blockMap, catalogMap))
          .join(' ')
          .trim();
        cells.push(text || ' ');
      }
      rows.push(cells);
    }
    if (!rows.length) return [];
    const header = rows[0];
    const sep = header.map(() => '---');
    const out = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
    ];
    for (const row of rows.slice(1)) {
      out.push(`| ${row.join(' | ')} |`);
    }
    return out;
  }

  if (block.kind === 'image') {
    const url = String(block.image?.url || '').trim();
    if (!url) return [];
    const alt = String(block.image?.description || '').trim();
    return [`![${alt}](${url})`];
  }

  if (block.kind === 'horizontalLine') {
    return ['---'];
  }

  return [];
}

function documentToMarkdown(doc, catalogMap) {
  const blockMap = doc?.blockMap || {};
  const lines = [];
  for (const blockId of doc?.blockIds || []) {
    const block = blockMap[blockId];
    if (!block) continue;
    const sectionLines = blockToMarkdownLines(block, blockMap, catalogMap);
    if (!sectionLines.length) continue;
    lines.push(...sectionLines);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function textLinesFromDocument(doc, catalogMap) {
  const lines = [];
  const blockMap = doc?.blockMap || {};
  for (const blockId of doc?.blockIds || []) {
    const block = blockMap[blockId];
    if (!block) continue;
    const text = blockToPlainText(block, blockMap, catalogMap).trim();
    if (!text) continue;
    const entries = [];
    collectEntriesFromBlock(block, blockMap, catalogMap, entries);
    lines.push({
      text,
      kind: block.kind,
      entries: dedupeEntries(entries),
    });
  }
  return lines;
}

function tableRowsFromBlock(block, blockMap, catalogMap) {
  if (!block || block.kind !== 'table') return [];
  const rows = [];
  for (const rowId of block.table?.rowIds || []) {
    const row = [];
    for (const colId of block.table?.columnIds || []) {
      const cell = block.table?.cellMap?.[`${rowId}_${colId}`];
      const cellEntries = [];
      for (const childId of cell?.childIds || []) {
        collectEntriesFromBlock(blockMap?.[childId], blockMap, catalogMap, cellEntries);
      }
      const text = (cell?.childIds || [])
        .map((childId) => blockToPlainText(blockMap?.[childId], blockMap, catalogMap))
        .join('')
        .trim();
      row.push({
        text,
        entries: dedupeEntries(cellEntries),
      });
    }
    rows.push(row);
  }
  return rows;
}

function findHeaderIndex(headerCells, re) {
  for (let i = 0; i < headerCells.length; i += 1) {
    if (re.test(headerCells[i] || '')) return i;
  }
  return -1;
}

function buildRecipeFromTableRow(cells, indices) {
  const allEntries = cells.flatMap((cell) => cell.entries || []);
  if (!allEntries.length) return null;
  const hasExplicitHeader =
    indices.ingredient >= 0 ||
    indices.output >= 0 ||
    indices.duration >= 0 ||
    indices.machine >= 0;

  const ingredients =
    indices.ingredient >= 0
      ? cells[indices.ingredient]?.entries || []
      : [];
  const outputs =
    indices.output >= 0
      ? cells[indices.output]?.entries || []
      : [];
  const machine =
    indices.machine >= 0
      ? String(cells[indices.machine]?.text || '')
      : '';
  const duration =
    indices.duration >= 0
      ? String(cells[indices.duration]?.text || '')
      : '';

  let resolvedIngredients = ingredients;
  let resolvedOutputs = outputs;
  if (!hasExplicitHeader && (!resolvedIngredients.length || !resolvedOutputs.length)) {
    const entryCells = cells.filter((cell) => (cell.entries || []).length > 0);
    if (entryCells.length >= 2) {
      const left = entryCells.slice(0, -1).flatMap((cell) => cell.entries || []);
      const right = entryCells[entryCells.length - 1]?.entries || [];
      if (!resolvedIngredients.length) resolvedIngredients = left;
      if (!resolvedOutputs.length) resolvedOutputs = right;
    }
  }

  if (!resolvedIngredients.length || !resolvedOutputs.length) return null;

  return {
    ingredients: dedupeEntries(resolvedIngredients),
    outputs: dedupeEntries(resolvedOutputs),
    machine,
    duration,
    rawRow: cells.map((cell) => cell.text).join(' | '),
  };
}

function recipesFromTableRows(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => String(cell.text || ''));
  const indices = {
    ingredient: findHeaderIndex(header, INGREDIENT_HEADER_RE),
    output: findHeaderIndex(header, OUTPUT_HEADER_RE),
    duration: findHeaderIndex(header, DURATION_HEADER_RE),
    machine: findHeaderIndex(header, MACHINE_HEADER_RE),
  };
  const hasHeader = Object.values(indices).some((idx) => idx >= 0);
  const recipeRows = hasHeader ? rows.slice(1) : rows;
  const recipes = [];
  for (const row of recipeRows) {
    const recipe = buildRecipeFromTableRow(row, indices);
    if (recipe) recipes.push(recipe);
  }
  return recipes;
}

function recipesFromTextBlock(block, catalogMap) {
  if (!block || block.kind !== 'text') return [];
  const inlines = block.text?.inlineElements || [];
  let side = 'left';
  let sawArrow = false;
  const left = [];
  const right = [];
  for (const inline of inlines) {
    if (inline.kind === 'text') {
      const t = String(inline.text?.text || '');
      if (/(→|->|=>|⇒)/.test(t)) {
        side = 'right';
        sawArrow = true;
      }
      continue;
    }
    if (inline.kind !== 'entry') continue;
    const ref = entryRefFromInline(inline, catalogMap);
    if (!ref) continue;
    if (side === 'left') left.push(ref);
    else right.push(ref);
  }
  if (!sawArrow || !left.length || !right.length) return [];
  return [
    {
      ingredients: dedupeEntries(left),
      outputs: dedupeEntries(right),
      machine: '',
      duration: '',
      rawRow: inlines.map((inline) => inlineText(inline, catalogMap)).join(''),
    },
  ];
}

function recipesFromDocument(doc, catalogMap) {
  const out = [];
  const blockMap = doc?.blockMap || {};
  for (const blockId of doc?.blockIds || []) {
    const block = blockMap[blockId];
    if (!block) continue;
    if (block.kind === 'table') {
      const rows = tableRowsFromBlock(block, blockMap, catalogMap);
      out.push(...recipesFromTableRows(rows));
      continue;
    }
    if (block.kind === 'text') {
      out.push(...recipesFromTextBlock(block, catalogMap));
    }
  }
  const seen = new Set();
  return out.filter((recipe) => {
    const key = JSON.stringify({
      ingredients: recipe.ingredients.map((e) => [e.id, e.count]),
      outputs: recipe.outputs.map((e) => [e.id, e.count]),
      machine: recipe.machine,
      duration: recipe.duration,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPanels(widgetCommon) {
  if (!widgetCommon) return [];
  const tabList = widgetCommon.tabList || [];
  const tabDataMap = widgetCommon.tabDataMap || {};
  if (tabList.length > 0) {
    return tabList.map((tab, index) => {
      const data = tabDataMap[tab.tabId] || {};
      const title = tab.title || data?.intro?.name || data?.intro?.type || `Tab ${index + 1}`;
      return {
        key: tab.tabId,
        title,
        introDescriptionId: data?.intro?.description || '',
        contentId: data?.content || '',
      };
    });
  }
  const keys = Object.keys(tabDataMap);
  return keys.map((key, index) => {
    const data = tabDataMap[key] || {};
    const title = data?.intro?.name || data?.intro?.type || `Panel ${index + 1}`;
    return {
      key,
      title,
      introDescriptionId: data?.intro?.description || '',
      contentId: data?.content || '',
    };
  });
}

function contextToString(context) {
  return [context.groupTitle, context.widgetTitle, context.panelTitle, context.docRole]
    .filter(Boolean)
    .join(' / ');
}

function shouldMarkSynthesis(contextText, recipes) {
  if (SYNTH_RE.test(contextText)) return true;
  if (recipes.length > 0) return true;
  return false;
}

function shouldMarkAcquisition(contextText, lines) {
  const lineText = lines.map((line) => line.text).join(' ');
  return ACQUIRE_RE.test(`${contextText} ${lineText}`);
}

function shouldMarkUsage(contextText, lines) {
  const lineText = lines.map((line) => line.text).join(' ');
  return USAGE_RE.test(`${contextText} ${lineText}`);
}

function analyzeDoc(doc, context, catalogMap) {
  const lines = textLinesFromDocument(doc, catalogMap);
  const recipes = recipesFromDocument(doc, catalogMap);
  if (lines.length === 0 && recipes.length === 0) return null;
  const contextText = contextToString(context);
  const isSynthesis = shouldMarkSynthesis(contextText, recipes);
  const isAcquisition = shouldMarkAcquisition(contextText, lines);
  const isUsage = shouldMarkUsage(contextText, lines);
  if (!isSynthesis && !isAcquisition && !isUsage) return null;

  const entries = dedupeEntries(lines.flatMap((line) => line.entries || []));
  const methods = lines.map((line) => line.text).filter(Boolean);
  const markdown = documentToMarkdown(doc, catalogMap);
  return {
    context,
    isSynthesis,
    isAcquisition,
    isUsage,
    methods,
    entries,
    recipes,
    markdown,
    wikiDoc: doc,
  };
}

function dedupeMethods(methods) {
  const seen = new Set();
  const out = [];
  for (const m of methods) {
    const key = m.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function dedupeRecipes(recipes) {
  const seen = new Set();
  const out = [];
  for (const recipe of recipes) {
    const key = JSON.stringify({
      in: recipe.ingredients.map((e) => [e.id, e.count]),
      out: recipe.outputs.map((e) => [e.id, e.count]),
      m: recipe.machine,
      d: recipe.duration,
      c: contextToString(recipe.context || {}),
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(recipe);
  }
  return out;
}

function analyzeItem(item, sourceFileAbs, sourceFileRel, catalogMap) {
  const chapterGroup = item?.document?.chapterGroup || [];
  const widgetCommonMap = item?.document?.widgetCommonMap || {};
  const documentMap = item?.document?.documentMap || {};

  const sections = [];
  for (const group of chapterGroup) {
    const groupTitle = String(group?.title || '');
    for (const widget of group?.widgets || []) {
      const widgetTitle = String(widget?.title || '');
      const widgetCommon = widgetCommonMap[widget.id];
      if (!widgetCommon) continue;
      const panels = buildPanels(widgetCommon);
      for (const panel of panels) {
        const panelTitle = String(panel?.title || '');
        if (panel.introDescriptionId) {
          const doc = documentMap[panel.introDescriptionId];
          if (doc) {
            const analyzed = analyzeDoc(
              doc,
              {
                groupTitle,
                widgetTitle,
                panelTitle,
                docRole: 'intro',
                docId: panel.introDescriptionId,
              },
              catalogMap,
            );
            if (analyzed) sections.push(analyzed);
          }
        }
        if (panel.contentId) {
          const doc = documentMap[panel.contentId];
          if (doc) {
            const analyzed = analyzeDoc(
              doc,
              {
                groupTitle,
                widgetTitle,
                panelTitle,
                docRole: 'content',
                docId: panel.contentId,
              },
              catalogMap,
            );
            if (analyzed) sections.push(analyzed);
          }
        }
      }
    }
  }

  const synthesisSections = sections.filter((section) => section.isSynthesis);
  const acquisitionSections = sections.filter((section) => section.isAcquisition);
  const usageSections = sections.filter((section) => section.isUsage);

  const synthesisMethods = dedupeMethods(synthesisSections.flatMap((section) => section.methods));
  const acquisitionMethods = dedupeMethods(acquisitionSections.flatMap((section) => section.methods));
  const usageMethods = dedupeMethods(usageSections.flatMap((section) => section.methods));
  const synthesisEntries = dedupeEntries(synthesisSections.flatMap((section) => section.entries));
  const acquisitionEntries = dedupeEntries(acquisitionSections.flatMap((section) => section.entries));
  const usageEntries = dedupeEntries(usageSections.flatMap((section) => section.entries));
  const synthesisRecipes = dedupeRecipes(
    synthesisSections.flatMap((section) =>
      (section.recipes || []).map((recipe) => ({
        ...recipe,
        context: section.context,
      })),
    ),
  );
  const acquisitionRecipes = dedupeRecipes(
    acquisitionSections.flatMap((section) =>
      (section.recipes || []).map((recipe) => ({
        ...recipe,
        context: section.context,
      })),
    ),
  );
  const usageRecipes = dedupeRecipes(
    usageSections.flatMap((section) =>
      (section.recipes || []).map((recipe) => ({
        ...recipe,
        context: section.context,
      })),
    ),
  );

  return {
    meta: {
      itemId: String(item?.itemId ?? ''),
      name: String(item?.name || item?.brief?.name || ''),
      mainTypeId: String(item?.mainType?.id || ''),
      mainTypeName: String(item?.mainType?.name || ''),
      subTypeId: String(item?.subType?.id || ''),
      subTypeName: String(item?.subType?.name || ''),
      sourceFileRelative: sourceFileRel.replaceAll('\\', '/'),
      sourceFileAbsolute: sourceFileAbs,
    },
    synthesis: {
      sections: synthesisSections,
      methods: synthesisMethods,
      entries: synthesisEntries,
      recipes: synthesisRecipes,
    },
    acquisition: {
      sections: acquisitionSections,
      methods: acquisitionMethods,
      entries: acquisitionEntries,
      recipes: acquisitionRecipes,
    },
    usage: {
      sections: usageSections,
      methods: usageMethods,
      entries: usageEntries,
      recipes: usageRecipes,
    },
  };
}

function incrementCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, n = 30) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function toCategoryPath(meta) {
  const mainName = sanitizePathSegment(meta.mainTypeName || `main_${meta.mainTypeId || 'unknown'}`);
  const subName = sanitizePathSegment(meta.subTypeName || `sub_${meta.subTypeId || 'unknown'}`);
  return path.join(mainName, subName);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const inputRootAbs = resolvePathMaybeAbsolute(args.inputRoot);
  const catalogAbs = resolvePathMaybeAbsolute(args.catalog);
  const outDirAbs = resolvePathMaybeAbsolute(args.outDir);

  if (!inputRootAbs || !fs.existsSync(inputRootAbs)) {
    throw new Error(`input root not found: ${inputRootAbs || args.inputRoot}`);
  }

  ensureDir(outDirAbs);
  const outItemsDir = path.join(outDirAbs, 'items');
  ensureDir(outItemsDir);

  console.log('== Skland Method Extractor ==');
  console.log(`Input: ${inputRootAbs}`);
  console.log(`Catalog: ${catalogAbs || '(none)'}`);
  console.log(`Output: ${outDirAbs}`);

  const infoFiles = listInfoFiles(inputRootAbs);
  console.log(`Info files: ${infoFiles.length}`);
  const catalogMap = buildCatalogMap(catalogAbs);
  const itemNameMap = buildItemNameMapFromInfoFiles(infoFiles);
  for (const [id, name] of itemNameMap.entries()) {
    if (!catalogMap.has(id)) {
      catalogMap.set(id, { id, name, cover: '' });
    }
  }

  const groupTitleCount = new Map();
  const widgetTitleCount = new Map();
  const itemFiles = [];
  const allRecipes = [];
  const allAcquisitionMethods = [];
  const allUsageMethods = [];

  let processed = 0;
  let included = 0;
  let withSynthesis = 0;
  let withAcquisition = 0;
  let withUsage = 0;

  for (const infoFileAbs of infoFiles) {
    let payload = null;
    try {
      payload = readJson(infoFileAbs);
    } catch {
      continue;
    }
    const item = payload?.data?.item;
    if (!item) continue;
    processed += 1;

    for (const group of item?.document?.chapterGroup || []) {
      incrementCount(groupTitleCount, String(group?.title || ''));
      for (const widget of group?.widgets || []) {
        incrementCount(widgetTitleCount, String(widget?.title || ''));
      }
    }

    const sourceFileRel = path.relative(inputRootAbs, infoFileAbs);
    const converted = analyzeItem(item, infoFileAbs, sourceFileRel, catalogMap);
    const hasSynthesis = converted.synthesis.sections.length > 0;
    const hasAcquisition = converted.acquisition.sections.length > 0;
    const hasUsage = converted.usage.sections.length > 0;
    if (!args.includeEmpty && !hasSynthesis && !hasAcquisition && !hasUsage) continue;

    included += 1;
    if (hasSynthesis) withSynthesis += 1;
    if (hasAcquisition) withAcquisition += 1;
    if (hasUsage) withUsage += 1;

    const categoryDir = toCategoryPath(converted.meta);
    const outRel = path.join(categoryDir, `id${converted.meta.itemId}.json`);
    const outAbs = path.join(outItemsDir, outRel);
    writeJson(outAbs, converted);

    itemFiles.push({
      itemId: converted.meta.itemId,
      name: converted.meta.name,
      mainTypeName: converted.meta.mainTypeName,
      subTypeName: converted.meta.subTypeName,
      hasSynthesis,
      hasAcquisition,
      hasUsage,
      recipeCount: converted.synthesis.recipes.length,
      synthesisMethodCount: converted.synthesis.methods.length,
      acquisitionMethodCount: converted.acquisition.methods.length,
      usageMethodCount: converted.usage.methods.length,
      path: path.join('items', outRel).replaceAll('\\', '/'),
      absolutePath: outAbs,
      sourceFile: converted.meta.sourceFileRelative,
      sourceAbsolutePath: converted.meta.sourceFileAbsolute,
    });

    for (const recipe of converted.synthesis.recipes) {
      allRecipes.push({
        itemId: converted.meta.itemId,
        itemName: converted.meta.name,
        mainTypeName: converted.meta.mainTypeName,
        subTypeName: converted.meta.subTypeName,
        context: recipe.context,
        ingredients: recipe.ingredients,
        outputs: recipe.outputs,
        machine: recipe.machine,
        duration: recipe.duration,
        rawRow: recipe.rawRow,
      });
    }

    for (const method of converted.acquisition.methods) {
      allAcquisitionMethods.push({
        itemId: converted.meta.itemId,
        itemName: converted.meta.name,
        mainTypeName: converted.meta.mainTypeName,
        subTypeName: converted.meta.subTypeName,
        text: method,
      });
    }

    for (const method of converted.usage.methods) {
      allUsageMethods.push({
        itemId: converted.meta.itemId,
        itemName: converted.meta.name,
        mainTypeName: converted.meta.mainTypeName,
        subTypeName: converted.meta.subTypeName,
        text: method,
      });
    }

    if (included % 100 === 0) {
      console.log(`Progress: ${included} items converted`);
    }
  }

  itemFiles.sort((a, b) => Number(a.itemId) - Number(b.itemId));

  writeJson(path.join(outDirAbs, 'index.json'), { files: itemFiles });
  writeJson(path.join(outDirAbs, 'recipes.json'), { recipes: allRecipes });
  writeJson(path.join(outDirAbs, 'acquisition.json'), { methods: allAcquisitionMethods });
  writeJson(path.join(outDirAbs, 'usage.json'), { methods: allUsageMethods });

  const summary = {
    generatedAt: new Date().toISOString(),
    inputRoot: inputRootAbs,
    catalog: catalogAbs || null,
    outputDir: outDirAbs,
    stats: {
      processedItems: processed,
      convertedItems: included,
      withSynthesis,
      withAcquisition,
      withUsage,
      synthesisRecipes: allRecipes.length,
      acquisitionMethods: allAcquisitionMethods.length,
      usageMethods: allUsageMethods.length,
    },
    topGroupTitles: topEntries(groupTitleCount, 50),
    topWidgetTitles: topEntries(widgetTitleCount, 80),
  };
  writeJson(path.join(outDirAbs, 'summary.json'), summary);

  console.log('Done.');
  console.log(`processed: ${processed}, converted: ${included}`);
  console.log(`with synthesis: ${withSynthesis}, with acquisition: ${withAcquisition}, with usage: ${withUsage}`);
  console.log(`recipes: ${allRecipes.length}, acquisition methods: ${allAcquisitionMethods.length}, usage methods: ${allUsageMethods.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

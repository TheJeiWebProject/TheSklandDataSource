import type { ItemRecord } from '../types.ts';
import type { EntryRef, CellData, TableData, WikiDocRef } from './types.ts';
import { HEADER_RULES } from '../rules/skland-rules.ts';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function toEntryRef(entry: Record<string, unknown>): EntryRef | null {
  const id = asString(entry.id);
  if (!id) return null;
  const rawCount = asString(entry.count || '0');
  const n = Number.parseFloat(rawCount);
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  return {
    id,
    count,
    rawCount,
    showType: asString(entry.showType),
  };
}

interface BlockParseResult {
  text: string;
  entries: EntryRef[];
}

function parseInline(inline: Record<string, unknown>): BlockParseResult {
  const kind = asString(inline.kind);
  if (kind === 'entry') {
    const entry = toEntryRef(asRecord(inline.entry));
    if (!entry) return { text: '', entries: [] };
    return {
      text: `[[entry:${entry.id}x${entry.rawCount || '0'}]]`,
      entries: [entry],
    };
  }
  if (kind === 'text') {
    return {
      text: asString(asRecord(inline.text).text),
      entries: [],
    };
  }
  if (kind === 'link') {
    const link = asRecord(inline.link);
    return {
      text: asString(link.text || link.link),
      entries: [],
    };
  }
  if (kind === 'pronunciation') {
    return {
      text: asString(asRecord(inline.pronunciation).content),
      entries: [],
    };
  }
  return { text: '', entries: [] };
}

function mergeResults(parts: BlockParseResult[], joiner: string): BlockParseResult {
  return {
    text: parts
      .map((p) => p.text)
      .filter(Boolean)
      .join(joiner)
      .trim(),
    entries: parts.flatMap((p) => p.entries),
  };
}

function parseBlock(blockId: string, blockMap: Record<string, unknown>): BlockParseResult {
  const block = asRecord(blockMap[blockId]);
  if (!Object.keys(block).length) return { text: '', entries: [] };

  const kind = asString(block.kind);
  if (kind === 'text') {
    const textObj = asRecord(block.text);
    const inlineElements = Array.isArray(textObj.inlineElements) ? textObj.inlineElements : [];
    const results = inlineElements.map((inline) => parseInline(asRecord(inline)));
    return mergeResults(results, '');
  }

  if (kind === 'list') {
    const list = asRecord(block.list);
    const itemIds = Array.isArray(list.itemIds) ? list.itemIds : [];
    const itemMap = asRecord(list.itemMap);
    const lines: BlockParseResult[] = [];
    for (const itemIdRaw of itemIds) {
      const itemId = asString(itemIdRaw);
      const childIds = Array.isArray(asRecord(itemMap[itemId]).childIds)
        ? (asRecord(itemMap[itemId]).childIds as unknown[])
        : [];
      const parts = childIds.map((cid) => parseBlock(asString(cid), blockMap));
      const merged = mergeResults(parts, ' ');
      if (merged.text) {
        lines.push({
          text: `- ${merged.text}`,
          entries: merged.entries,
        });
      } else if (merged.entries.length) {
        lines.push(merged);
      }
    }
    return mergeResults(lines, '\n');
  }

  if (kind === 'quote') {
    const quote = asRecord(block.quote);
    const childIds = Array.isArray(quote.childIds) ? quote.childIds : [];
    const parts = childIds.map((cid) => parseBlock(asString(cid), blockMap));
    return mergeResults(parts, '\n');
  }

  if (kind === 'table') {
    const table = asRecord(block.table);
    const rowIds = Array.isArray(table.rowIds) ? table.rowIds : [];
    const colIds = Array.isArray(table.columnIds) ? table.columnIds : [];
    const cellMap = asRecord(table.cellMap);

    const lines: BlockParseResult[] = [];
    for (const rowIdRaw of rowIds) {
      const rowId = asString(rowIdRaw);
      const cells: string[] = [];
      const entries: EntryRef[] = [];
      for (const colIdRaw of colIds) {
        const colId = asString(colIdRaw);
        const cell = asRecord(cellMap[`${rowId}_${colId}`]);
        const childIds = Array.isArray(cell.childIds) ? cell.childIds : [];
        const parsedChildren = childIds.map((cid) => parseBlock(asString(cid), blockMap));
        const merged = mergeResults(parsedChildren, ' ');
        cells.push(merged.text);
        entries.push(...merged.entries);
      }
      if (cells.some(Boolean)) {
        lines.push({
          text: `| ${cells.join(' | ')} |`,
          entries,
        });
      } else if (entries.length) {
        lines.push({ text: '', entries });
      }
    }
    return mergeResults(lines, '\n');
  }

  return { text: '', entries: [] };
}

export function getWikiItemRecord(itemRecord: ItemRecord): Record<string, unknown> {
  return asRecord(asRecord(itemRecord.payload.data).item);
}

interface ExtractDocRefsOptions {
  chapterTitles?: string[];
  widgetTitles?: string[];
}

export function extractWikiDocRefs(
  itemRecord: ItemRecord,
  options: ExtractDocRefsOptions,
): WikiDocRef[] {
  const item = getWikiItemRecord(itemRecord);
  const itemId = asString(item.itemId || itemRecord.itemId);
  const itemName = asString(item.name);
  const document = asRecord(item.document);
  const documentMap = asRecord(document.documentMap);
  const chapterGroup = Array.isArray(document.chapterGroup) ? document.chapterGroup : [];
  const widgetCommonMap = asRecord(document.widgetCommonMap);

  const chapterSet = options.chapterTitles?.length ? new Set(options.chapterTitles) : null;
  const widgetSet = options.widgetTitles?.length ? new Set(options.widgetTitles) : null;

  const refs: WikiDocRef[] = [];
  const dedupe = new Set<string>();

  for (const groupRaw of chapterGroup) {
    const group = asRecord(groupRaw);
    const chapterTitle = asString(group.title);
    if (chapterSet && !chapterSet.has(chapterTitle)) continue;

    const widgets = Array.isArray(group.widgets) ? group.widgets : [];
    for (const widgetRaw of widgets) {
      const widget = asRecord(widgetRaw);
      const widgetTitle = asString(widget.title);
      if (widgetSet && !widgetSet.has(widgetTitle)) continue;

      const widgetId = asString(widget.id);
      const widgetData = asRecord(widgetCommonMap[widgetId]);
      if (!Object.keys(widgetData).length) continue;
      const widgetType = asString(widgetData.type || 'common');
      const tabDataMap = asRecord(widgetData.tabDataMap);
      const tabList = Array.isArray(widgetData.tabList) ? widgetData.tabList : [];

      for (const [tabId, tabRaw] of Object.entries(tabDataMap)) {
        const tab = asRecord(tabRaw);
        const tabTitle = asString(
          asRecord(tabList.find((tabInfo) => asString(asRecord(tabInfo).tabId) === tabId)).title,
        );

        const candidates: Array<{ docId: string; sourceKind: 'content' | 'intro' }> = [];
        const contentId = asString(tab.content);
        if (contentId) candidates.push({ docId: contentId, sourceKind: 'content' });
        const introDescId = asString(asRecord(tab.intro).description);
        if (introDescId) candidates.push({ docId: introDescId, sourceKind: 'intro' });

        for (const candidate of candidates) {
          const doc = asRecord(documentMap[candidate.docId]);
          if (!Object.keys(doc).length) continue;
          const key = `${candidate.docId}|${chapterTitle}|${widgetTitle}|${tabId}|${candidate.sourceKind}`;
          if (dedupe.has(key)) continue;
          dedupe.add(key);

          refs.push({
            itemId,
            itemName,
            chapterTitle,
            widgetTitle,
            widgetType,
            tabId,
            tabTitle,
            docId: candidate.docId,
            sourceKind: candidate.sourceKind,
            doc,
            itemRecord,
          });
        }
      }
    }
  }

  return refs;
}

export function extractEntriesFromDoc(doc: Record<string, unknown>): EntryRef[] {
  const blockMap = asRecord(doc.blockMap);
  const blockIds = Array.isArray(doc.blockIds) ? doc.blockIds : [];
  const out: EntryRef[] = [];

  for (const blockIdRaw of blockIds) {
    const parsed = parseBlock(asString(blockIdRaw), blockMap);
    out.push(...parsed.entries);
  }

  return out;
}

export function extractDocTextLines(doc: Record<string, unknown>, maxLines = 12): string[] {
  const blockMap = asRecord(doc.blockMap);
  const blockIds = Array.isArray(doc.blockIds) ? doc.blockIds : [];
  const lines: string[] = [];

  for (const blockIdRaw of blockIds) {
    const parsed = parseBlock(asString(blockIdRaw), blockMap);
    if (!parsed.text) continue;
    parsed.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => lines.push(line));
    if (lines.length >= maxLines) break;
  }

  return lines.slice(0, maxLines);
}

function parseCell(cell: Record<string, unknown>, blockMap: Record<string, unknown>): CellData {
  const childIds = Array.isArray(cell.childIds) ? cell.childIds : [];
  const parts = childIds.map((cid) => parseBlock(asString(cid), blockMap));
  const merged = mergeResults(parts, ' ');
  return {
    text: merged.text.replace(/\s+/g, ' ').trim(),
    entries: merged.entries,
  };
}

const HEADER_KEYWORDS = [
  ...HEADER_RULES.machineHeaders,
  ...HEADER_RULES.simpleTypeHeaders,
  ...HEADER_RULES.inputHeaders,
  ...HEADER_RULES.outputHeaders,
  ...HEADER_RULES.timeHeaders,
].map((kw) => normalizeHeaderLabel(kw));

function detectHeaderRowIndex(rows: CellData[][]): number {
  let bestIdx = 0;
  let bestMatches = 0;
  rows.forEach((row, idx) => {
    let matches = 0;
    row.forEach((cell) => {
      const text = normalizeHeaderLabel(cell.text);
      if (!text) return;
      if (HEADER_KEYWORDS.some((kw) => text.includes(kw))) matches += 1;
    });
    if (matches > bestMatches) {
      bestMatches = matches;
      bestIdx = idx;
    }
  });
  if (bestMatches >= 2) return bestIdx;
  return 0;
}

export function extractTablesFromDoc(doc: Record<string, unknown>): TableData[] {
  const blockMap = asRecord(doc.blockMap);
  const blockIds = Array.isArray(doc.blockIds) ? doc.blockIds : [];
  const out: TableData[] = [];

  for (const blockIdRaw of blockIds) {
    const block = asRecord(blockMap[asString(blockIdRaw)]);
    if (asString(block.kind) !== 'table') continue;
    const table = asRecord(block.table);
    const rowIds = Array.isArray(table.rowIds) ? table.rowIds : [];
    const columnIds = Array.isArray(table.columnIds) ? table.columnIds : [];
    const cellMap = asRecord(table.cellMap);
    if (!rowIds.length || !columnIds.length) continue;

    const rows: CellData[][] = [];
    for (const rowIdRaw of rowIds) {
      const rowId = asString(rowIdRaw);
      const row: CellData[] = [];
      for (const columnIdRaw of columnIds) {
        const columnId = asString(columnIdRaw);
        const cell = asRecord(cellMap[`${rowId}_${columnId}`]);
        row.push(parseCell(cell, blockMap));
      }
      rows.push(row);
    }

    const headerRowIndex = detectHeaderRowIndex(rows);
    const headerRow = rows[headerRowIndex] ?? [];
    const headers = headerRow.map((cell) => cell.text || '');
    const orderedRows =
      headerRowIndex === 0 ? rows : [headerRow, ...rows.filter((_, idx) => idx !== headerRowIndex)];
    out.push({
      headers,
      rows: orderedRows,
      rowCount: orderedRows.length,
      columnCount: columnIds.length,
    });
  }

  return out;
}

export function normalizeHeaderLabel(label: string): string {
  return asString(label).replace(/\s+/g, '');
}

export function normalizeTextLabel(label: string): string {
  return asString(label)
    .replace(/\[\[entry:[^\]]+\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapByWikiId(itemRecords: ItemRecord[]): Map<string, ItemRecord> {
  const out = new Map<string, ItemRecord>();
  for (const rec of itemRecords) out.set(rec.itemId, rec);
  return out;
}

export function extractBriefDescriptionDoc(itemRecord: ItemRecord): Record<string, unknown> | null {
  const item = getWikiItemRecord(itemRecord);
  const brief = asRecord(item.brief);
  const description = asRecord(brief.description);
  if (!Object.keys(description).length) return null;
  if (!Array.isArray(description.blockIds)) return null;
  if (!asRecord(description.blockMap) || !Object.keys(asRecord(description.blockMap)).length) {
    return null;
  }
  return description;
}

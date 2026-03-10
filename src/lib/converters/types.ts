import type { BuildArgs, ItemRecord } from '../types.ts';

export interface EntryRef {
  id: string;
  count: number;
  rawCount: string;
  showType: string;
}

export interface CellData {
  text: string;
  entries: EntryRef[];
}

export interface TableData {
  headers: string[];
  rows: CellData[][];
  rowCount: number;
  columnCount: number;
}

export interface WikiDocRef {
  itemId: string;
  itemName: string;
  chapterTitle: string;
  widgetTitle: string;
  widgetType: string;
  tabId: string;
  tabTitle: string;
  docId: string;
  sourceKind: 'content' | 'intro';
  doc: Record<string, unknown>;
  itemRecord: ItemRecord;
}

export interface RecipeStack {
  kind: 'item' | 'tag';
  id: string;
  amount: number;
}

export interface DynamicRecipeType {
  key: string;
  displayName: string;
  renderer: 'slot_layout' | 'wiki_doc_panel';
  plannerPriority?: number;
  machine?: {
    id: string;
    name: string;
  };
  paramSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  maxIn: number;
  maxOut: number;
}

export interface RecipeDef {
  id: string;
  type: string;
  slotContents: Record<string, RecipeStack>;
  params?: Record<string, unknown>;
}

export interface ConverterResult {
  name: string;
  recipeTypes: number;
  recipes: number;
}

export interface ConverterContextInit {
  args: BuildArgs;
  itemIdToPackId: Map<string, string>;
  itemNameById: Map<string, string>;
  itemIconById: Map<string, string>;
  itemTagsById: Map<string, string[]>;
  extraItemsById: Map<string, Record<string, unknown>>;
}

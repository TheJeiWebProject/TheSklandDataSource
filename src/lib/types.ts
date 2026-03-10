export interface BuildArgs {
  infoRoot: string;
  methodsRoot: string;
  outDir: string;
  packId: string;
  gameId: string;
  displayName: string;
  version: string;
  imageMode: 'origin' | 'proxy' | 'dev';
  imageConfig: string;
  downloadAssets: boolean;
  assetConcurrency: number;
  assetTimeoutMs: number;
  registerPackIndex: boolean;
  help?: boolean;
}

export interface InfoFileEntry {
  itemId: string;
  mainName: string;
  subName: string;
  categoryPath: string;
  relPath: string;
  absPath: string;
}

export interface ItemRecord extends InfoFileEntry {
  payload: JsonObject;
}

export interface MachineGroup {
  key: string;
  displayName: string;
  machineItemId: string;
  maxIn: number;
  maxOut: number;
}

export interface SlotStack {
  kind: 'item' | 'tag';
  id: string;
  amount: number;
}

export interface MethodEntry {
  id?: string | number;
  count?: string | number;
  name?: string;
}

export interface MethodSection {
  entries?: MethodEntry[];
  markdown?: string;
  html?: string;
  methods?: unknown;
  wikiDoc?: unknown;
  context?: unknown;
}

export interface MethodPayload {
  acquisition?: {
    methods?: unknown;
    sections?: MethodSection[];
  };
  usage?: {
    methods?: unknown;
    sections?: MethodSection[];
  };
}

export type JsonObject = Record<string, unknown>;

export interface BuildSummary {
  generatedAt: string;
  input: {
    infoRoot: string;
    methodsRoot: string;
  };
  output: string;
  pack: {
    packId: string;
    gameId: string;
    displayName: string;
    version: string;
  };
  stats: {
    items: number;
    baseItems: number;
    extraItems: number;
    recipeTypes: number;
    recipes: number;
    docRecipes: number;
    downloadedImages: number;
    dedupedRecipes: number;
    machineTypesPatched: number;
    machineTemplatesMatched: number;
  };
}

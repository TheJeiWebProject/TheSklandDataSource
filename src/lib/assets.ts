import fs from 'node:fs';
import path from 'node:path';
import type { BuildArgs } from './types.ts';
import { ensureDir, readJson, resolvePathMaybeAbsolute } from './fs-utils.ts';
import { hashShort } from './helpers.ts';

function likelyImageUrl(key: string, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^https?:\/\//i.test(value)) return false;
  const keyLower = String(key || '').toLowerCase();
  const vLower = value.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i.test(vLower)) return true;
  if (/bbs\.hycdn\.cn\/image\//i.test(vLower)) return true;
  if (/(cover|icon|img|illustration|avatar|thumb|poster|banner|url)$/.test(keyLower)) {
    return true;
  }
  return false;
}

export function collectImageUrls(value: unknown, out: Set<string>, keyName = ''): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const v of value) collectImageUrls(v, out, keyName);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      if (likelyImageUrl(k || keyName, v)) out.add(v);
      continue;
    }
    collectImageUrls(v, out, k);
  }
}

export function rewriteUrlsDeep<T>(value: T, urlMap: Map<string, string>): T {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = rewriteUrlsDeep(value[i], urlMap);
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return (urlMap.get(value) || value) as T;
    return value;
  }
  for (const [k, v] of Object.entries(value)) {
    (value as Record<string, unknown>)[k] = rewriteUrlsDeep(v, urlMap);
  }
  return value;
}

interface ProxyEndpointConfig {
  baseUrl?: string;
  imagePath?: string;
  urlTemplate?: string;
  domains?: string[];
}

interface FrontendTokenQueryConfig {
  enabled?: boolean;
  accessTokenStorageKey?: string;
  anonymousTokenStorageKey?: string;
  frameworkTokenStorageKey?: string;
  accessTokenParam?: string;
  anonymousTokenParam?: string;
  frameworkTokenParam?: string;
  anonymousTokenEndpoint?: string;
  anonymousTokenMethod?: 'GET' | 'POST';
  anonymousTokenHeaders?: Record<string, string>;
  anonymousTokenRequestBody?: Record<string, unknown>;
  anonymousTokenResponsePath?: string;
}

interface FrontendProxyConfig {
  enabled?: boolean;
  urlTemplate?: string;
  devUrlTemplate?: string;
  domains?: string[];
  tokenQuery?: FrontendTokenQueryConfig;
}

interface ImageSourceConfig {
  apiBaseUrl?: string;
  proxyImagePath?: string;
  proxyDomains?: string[];
  runtimeProxy?: ProxyEndpointConfig;
  downloadProxy?: ProxyEndpointConfig;
  frontendProxy?: FrontendProxyConfig;
  accessToken?: string;
  anonymousToken?: string;
  frameworkToken?: string;
  headers?: Record<string, string>;
}

interface ResolvedProxyEndpoint {
  baseUrl: string;
  imagePath: string;
  urlTemplate: string;
  domains: string[];
}

export interface ManifestImageProxyConfig {
  enabled?: boolean;
  urlTemplate: string;
  devUrlTemplate?: string;
  domains?: string[];
  tokenQuery?: {
    enabled?: boolean;
    accessTokenStorageKey?: string;
    anonymousTokenStorageKey?: string;
    frameworkTokenStorageKey?: string;
    accessTokenParam?: string;
    anonymousTokenParam?: string;
    frameworkTokenParam?: string;
    anonymousTokenEndpoint?: string;
    anonymousTokenMethod?: 'GET' | 'POST';
    anonymousTokenHeaders?: Record<string, string>;
    anonymousTokenRequestBody?: Record<string, unknown>;
    anonymousTokenResponsePath?: string;
  };
}

export interface PreparedImageHandling {
  rewriteUrlByOriginal: Map<string, string>;
  fetchUrlByOriginal: Map<string, string>;
  requestHeaders: Record<string, string>;
  mode: 'origin' | 'proxy' | 'dev';
  configPath: string;
  manifestImageProxy?: ManifestImageProxyConfig;
}

interface DownloadAssetsOptions {
  fetchUrlByOriginal?: Map<string, string>;
  requestHeaders?: Record<string, string>;
}

const DEFAULT_PROXY_DOMAINS = ['bbs.hycdn.cn', 'ak.hycdn.cn', 'web.hycdn.cn'];
const DEFAULT_RUNTIME_PROXY_BASE = 'https://end-api.shallow.ink';
const DEFAULT_DEV_PROXY_BASE = 'http://127.0.0.1:8787';
const DEFAULT_PROXY_IMAGE_PATH = '/api/proxy/image';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v)).filter(Boolean);
}

function stripTrailingSlash(input: string): string {
  return input.replace(/\/+$/g, '');
}

function normalizeImagePath(input: string): string {
  const s = input.trim();
  if (!s) return DEFAULT_PROXY_IMAGE_PATH;
  return s.startsWith('/') ? s : `/${s}`;
}

function normalizeUrlTemplate(input: string): string {
  const s = input.trim();
  if (!s) return '';
  return s;
}

function buildEndpointUrlTemplate(endpoint: ResolvedProxyEndpoint): string {
  if (endpoint.urlTemplate.includes('{url}')) return endpoint.urlTemplate;
  return `${endpoint.baseUrl}${endpoint.imagePath}?url={url}`;
}

function isProxyTarget(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function toProxyImageUrl(originalUrl: string, endpoint: ResolvedProxyEndpoint): string {
  if (!isProxyTarget(originalUrl, endpoint.domains)) return originalUrl;
  if (endpoint.urlTemplate.includes('{url}')) {
    return endpoint.urlTemplate.replaceAll('{url}', encodeURIComponent(originalUrl));
  }
  return `${endpoint.baseUrl}${endpoint.imagePath}?url=${encodeURIComponent(originalUrl)}`;
}

function loadImageSourceConfig(
  repoRoot: string,
  args: BuildArgs,
): {
  config: ImageSourceConfig;
  configPath: string;
} {
  const configPathAbs = resolvePathMaybeAbsolute(repoRoot, args.imageConfig);
  if (!configPathAbs || !fs.existsSync(configPathAbs)) {
    return { config: {}, configPath: '' };
  }
  try {
    const parsed = readJson<ImageSourceConfig>(configPathAbs);
    return { config: parsed || {}, configPath: configPathAbs };
  } catch {
    return { config: {}, configPath: configPathAbs };
  }
}

function resolveEndpoint(
  raw: ProxyEndpointConfig | undefined,
  fallbackBaseUrl: string,
  fallbackImagePath: string,
  fallbackDomains: string[],
): ResolvedProxyEndpoint {
  return {
    baseUrl: stripTrailingSlash(asString(raw?.baseUrl) || fallbackBaseUrl),
    imagePath: normalizeImagePath(asString(raw?.imagePath) || fallbackImagePath),
    urlTemplate: normalizeUrlTemplate(asString(raw?.urlTemplate)),
    domains: asStringArray(raw?.domains).length ? asStringArray(raw?.domains) : fallbackDomains,
  };
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
    const key = asString(k);
    const val = asString(v);
    if (!key || !val) return;
    out[key] = val;
  });
  return out;
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildManifestImageProxyConfig(
  config: ImageSourceConfig,
  runtimeEndpoint: ResolvedProxyEndpoint,
): ManifestImageProxyConfig | undefined {
  const frontend = config.frontendProxy;
  if (frontend && frontend.enabled === false) return undefined;

  const urlTemplate =
    normalizeUrlTemplate(asString(frontend?.urlTemplate)) || buildEndpointUrlTemplate(runtimeEndpoint);
  if (!urlTemplate) return undefined;
  const devUrlTemplate =
    normalizeUrlTemplate(asString(frontend?.devUrlTemplate)) ||
    normalizeUrlTemplate(asString(config.downloadProxy?.urlTemplate)) ||
    '';

  const domains = asStringArray(frontend?.domains).length
    ? asStringArray(frontend?.domains)
    : runtimeEndpoint.domains;

  const tokenQueryRaw = asUnknownRecord(frontend?.tokenQuery);
  const tokenQueryEnabledRaw = tokenQueryRaw.enabled;
  const tokenQueryEnabled =
    typeof tokenQueryEnabledRaw === 'boolean' ? tokenQueryEnabledRaw : false;
  const anonymousTokenMethod: 'GET' | 'POST' =
    asString(tokenQueryRaw.anonymousTokenMethod).toUpperCase() === 'POST' ? 'POST' : 'GET';
  const tokenQuery: ManifestImageProxyConfig['tokenQuery'] = tokenQueryEnabled
    ? {
        enabled: tokenQueryEnabled,
        accessTokenStorageKey: asString(tokenQueryRaw.accessTokenStorageKey) || 'access_token',
        anonymousTokenStorageKey:
          asString(tokenQueryRaw.anonymousTokenStorageKey) || 'anonymous_token',
        frameworkTokenStorageKey:
          asString(tokenQueryRaw.frameworkTokenStorageKey) || 'framework_token',
        accessTokenParam: asString(tokenQueryRaw.accessTokenParam) || 'access_token',
        anonymousTokenParam:
          asString(tokenQueryRaw.anonymousTokenParam) || 'anonymous_token',
        frameworkTokenParam:
          asString(tokenQueryRaw.frameworkTokenParam) || 'framework_token',
        anonymousTokenEndpoint: asString(tokenQueryRaw.anonymousTokenEndpoint) || '',
        anonymousTokenMethod,
        anonymousTokenHeaders: asStringRecord(tokenQueryRaw.anonymousTokenHeaders),
        anonymousTokenRequestBody: asUnknownRecord(tokenQueryRaw.anonymousTokenRequestBody),
        anonymousTokenResponsePath:
          asString(tokenQueryRaw.anonymousTokenResponsePath) || 'data.token',
      }
    : {
        enabled: false,
      };

  return {
    enabled: true,
    urlTemplate,
    ...(devUrlTemplate ? { devUrlTemplate } : {}),
    ...(domains.length ? { domains } : {}),
    ...(tokenQuery ? { tokenQuery } : {}),
  };
}

function buildRequestHeaders(config: ImageSourceConfig): Record<string, string> {
  const out: Record<string, string> = {};
  const accessToken = asString(config.accessToken);
  const anonymousToken = asString(config.anonymousToken);
  const frameworkToken = asString(config.frameworkToken);

  if (accessToken) out.Authorization = `Bearer ${accessToken}`;
  else if (anonymousToken) out['X-Anonymous-Token'] = anonymousToken;
  if (frameworkToken) out['X-Framework-Token'] = frameworkToken;

  const customHeaders =
    config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
      ? config.headers
      : {};
  Object.entries(customHeaders).forEach(([k, v]) => {
    const key = asString(k);
    const val = asString(v);
    if (!key || !val) return;
    out[key] = val;
  });
  return out;
}

export function prepareImageHandling(
  urls: string[],
  args: BuildArgs,
  repoRoot: string,
): PreparedImageHandling {
  const rewriteUrlByOriginal = new Map<string, string>();
  const fetchUrlByOriginal = new Map<string, string>();
  const { config, configPath } = loadImageSourceConfig(repoRoot, args);
  const fallbackDomains = asStringArray(config.proxyDomains).length
    ? asStringArray(config.proxyDomains)
    : DEFAULT_PROXY_DOMAINS;
  const fallbackBase = asString(config.apiBaseUrl) || DEFAULT_RUNTIME_PROXY_BASE;
  const fallbackImagePath = asString(config.proxyImagePath) || DEFAULT_PROXY_IMAGE_PATH;

  const runtimeEndpoint = resolveEndpoint(
    config.runtimeProxy,
    fallbackBase,
    fallbackImagePath,
    fallbackDomains,
  );
  const downloadEndpoint = resolveEndpoint(
    config.downloadProxy,
    args.imageMode === 'dev' ? DEFAULT_DEV_PROXY_BASE : runtimeEndpoint.baseUrl,
    runtimeEndpoint.imagePath,
    runtimeEndpoint.domains,
  );
  const manifestImageProxy = buildManifestImageProxyConfig(config, runtimeEndpoint);

  for (const originalUrl of urls) {
    const fetchUrl =
      args.downloadAssets && (args.imageMode === 'proxy' || args.imageMode === 'dev')
        ? toProxyImageUrl(originalUrl, downloadEndpoint)
        : originalUrl;
    if (fetchUrl !== originalUrl) fetchUrlByOriginal.set(originalUrl, fetchUrl);
  }

  return {
    rewriteUrlByOriginal,
    fetchUrlByOriginal,
    requestHeaders: args.downloadAssets ? buildRequestHeaders(config) : {},
    mode: args.imageMode,
    configPath,
    ...(manifestImageProxy ? { manifestImageProxy } : {}),
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item === undefined) return;
      out[idx] = await worker(item, idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function extFromContentType(ct: string): string {
  const s = String(ct || '').toLowerCase();
  if (s.includes('image/png')) return '.png';
  if (s.includes('image/jpeg')) return '.jpg';
  if (s.includes('image/webp')) return '.webp';
  if (s.includes('image/gif')) return '.gif';
  if (s.includes('image/svg+xml')) return '.svg';
  if (s.includes('image/bmp')) return '.bmp';
  return '';
}

function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname || '').toLowerCase();
    if (/^\.(png|jpg|jpeg|webp|gif|svg|bmp)$/.test(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch {
    // Ignore malformed URLs.
  }
  return '';
}

async function fetchArrayBufferWithTimeout(
  url: string,
  timeoutMs: number,
  requestHeaders: Record<string, string> = {},
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'image/*,*/*',
        'User-Agent': 'jei-web-skland-pack-builder/1.0',
        ...requestHeaders,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    const body = await res.arrayBuffer();
    return { body, contentType: ct };
  } finally {
    clearTimeout(t);
  }
}

export async function downloadAssets(
  urls: string[],
  args: BuildArgs,
  outDirAbs: string,
  options: DownloadAssetsOptions = {},
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  if (!args.downloadAssets || urls.length === 0) return urlMap;
  const assetsDirAbs = path.join(outDirAbs, 'assets', 'images');
  ensureDir(assetsDirAbs);

  let ok = 0;
  let fail = 0;
  await mapLimit(urls, args.assetConcurrency, async (url, idx) => {
    try {
      const fetchUrl = options.fetchUrlByOriginal?.get(url) || url;
      const { body, contentType } = await fetchArrayBufferWithTimeout(
        fetchUrl,
        args.assetTimeoutMs,
        options.requestHeaders || {},
      );
      const ext = extFromContentType(contentType) || extFromUrl(url) || '.bin';
      if (ext === '.bin' && !/^image\//i.test(contentType)) {
        fail += 1;
        return;
      }
      const name = `${hashShort(url)}${ext}`;
      const rel = path.join('assets', 'images', name).replaceAll('\\', '/');
      const abs = path.join(outDirAbs, rel);
      if (!fs.existsSync(abs)) {
        ensureDir(path.dirname(abs));
        fs.writeFileSync(abs, Buffer.from(body));
      }
      const localUrl = `/packs/${encodeURIComponent(args.packId)}/${rel}`;
      urlMap.set(url, localUrl);
      ok += 1;
      if ((idx + 1) % 50 === 0 || idx + 1 === urls.length) {
        console.log(`[assets] progress ${idx + 1}/${urls.length} (ok=${ok}, fail=${fail})`);
      }
    } catch {
      fail += 1;
    }
  });
  console.log(`[assets] done: ${ok} downloaded, ${fail} failed`);
  return urlMap;
}

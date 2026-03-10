# aef-skland Pack Build Notes

This note describes how the `aef-skland` data pack is generated in this repository.

## Data Source

- Primary source: https://wiki.skland.com/endfield (Skland Wiki / 森空岛Wiki)
- Raw item data is stored as JSON files under an info directory (for example: `D:\data\skland\info`).

## Scripts Used

- Crawl wiki data:
  - `pnpm run crawl:wiki`
  - script: `scripts/crawl-skland-wiki.mjs`
- Extract methods from crawled wiki content:
  - `pnpm run extract:wiki:methods`
  - script: `scripts/extract-skland-methods.mjs`
- Build JEI-web pack:
  - `pnpm run build:skland-pack -- <args>`
  - entry: `scripts/generate-skland-pack.mjs`
  - implementation: `scripts/generate-skland-pack.ts` and `scripts/skland-pack/*`

## Current Build Command (used for `public/packs/aef-skland`)

```bash
pnpm run build:skland-pack -- \
  --info-root D:\data\skland\info \
  --methods-root D:\data\skland\converted-methods \
  --out-dir public/packs/aef-skland \
  --pack-id aef-skland \
  --game-id aef-skland \
  --display-name "Skland Wiki" \
  --image-mode origin \
  --image-config scripts/skland-pack/image-source.config.example.json \
  --register-pack-index
```

## Output Files

Generated into `public/packs/aef-skland/`:

- `manifest.json`
- `items/` (item detail JSON files)
- `itemsIndex.json`
- `itemsLite.json`
- `recipeTypes.json`
- `recipes.json`
- `build-summary.json`

## Image Handling (Current)

- Build uses `--image-mode origin`: item JSON keeps original wiki image URLs.
- Runtime proxy URL is written into manifest from:
  - `scripts/skland-pack/image-source.config.example.json`
- Current runtime proxy template:
  - `https://end-api.shallow.ink/api/proxy/image?url={url}`

## Notes

- If `--register-pack-index` is used, `public/packs/index.json` is updated.
- Pack conversion and post-processing logic is split into TypeScript modules under `scripts/skland-pack/`.

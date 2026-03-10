# Skland Wiki Data Source

This repository contains the scripts to generate the Skland Wiki data pack for JEI-Web.

## Usage

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run All Steps:**
    ```bash
    npm run all
    ```

    This will:
    1.  Crawl data from Skland Wiki (`npm run crawl`)
    2.  Extract structured data (`npm run extract`)
    3.  Build the final pack (`npm run build`)

    The output will be in the `dist` directory (configurable).

## Directory Structure

- `src/crawler.mjs`: Fetches raw data.
- `src/extractor.mjs`: Extracts methods and recipes.
- `src/pack-builder.ts`: Generates the final JEI pack.
- `src/lib/`: Helper libraries for pack building.
- `docs/`: Documentation on data formats.

## License

MIT

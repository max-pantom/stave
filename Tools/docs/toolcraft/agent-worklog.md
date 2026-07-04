# Implementation Worklog

## Status

Mode: product

Micrographics Grid Composer is a Toolcraft product app for seeded vector layouts. The later screenshot reference was used only to understand grid/randomness behavior, not as artwork to recreate. Users provide SVG symbols and words, tune an invisible grid, constrain colors to the supplied palette, allow random multi-cell spans, and export a PNG.

## Decision Trail

### Iteration 1 — Product App Build

- Request: Build a creative tool inspired by the supplied micrographics image where SVGs and words are randomly arranged on a seedable invisible grid.
- Task type: Schema, controls, renderer, export, acceptance, and performance.
- User-visible result: A Toolcraft app with SVG upload/paste source controls, seed/density/grid/span controls, allowed palette controls, word placement, live vector preview, and PNG export.
- Source/reference checked: Prompt image and attached Figma-style color JSON.
- Reference inputs: Image shows dense mono-line archival micrographics with text modules, rings, nodes, bars, technical labels, and varied scales. Color JSON yielded swatches #C2FE0C, #EA027E, #3601FB, #FF5500, #01FFFF, #29324F, #EA0049, #0E111B, #2BDBC8, #ECEB14, #DFFF00.
- Docs/contracts read: `AGENTS.md`, `workflow.md`, `schema-reference.md`, `renderer-technique.md`, plus acceptance/performance metadata contracts.
- Contract rules applied: Runtime shell required, `canvasContent` product output only, editable output canvas sizing, controls mapped through schema, product output export through sticky `panelActions`, explicit persistence, renderer technique inventory, performance workload coverage.
- Decision: Use SVG for live preview to keep vector text and symbol fidelity; use Canvas 2D only for PNG export through Toolcraft's standard export helper.
- Alternatives rejected: DOM output was rejected because SVG transforms and export alignment are cleaner in SVG. WebGL/WebGPU were rejected because this is vector/text output at a bounded node count rather than shader or pixel workload.
- State/output mapping: Runtime values under `source.*`, `grid.*`, `span.*`, `appearance.*`, and `export.*` drive deterministic layout and product rendering; `mediaAssets` with `source.svgFiles` supplies uploaded SVGs; `panelActions` invokes PNG export.
- Files changed: `src/app/app-schema.ts`, `src/app/micrographics-renderer.tsx`, `src/routes/index.tsx`, `src/styles.css`, `src/app/app-acceptance.ts`, `src/app/app-performance.ts`, `src/app/app-schema.test.ts`, this worklog.
- Verification: `pnpm typecheck` and `pnpm build` pass after implementation.
- Skipped checks: None yet.
- Risks: Uploaded SVG files render exactly in preview via SVG image embedding; PNG export uses a canvas-safe symbolic fallback for uploaded SVGs, so uploaded artwork may not rasterize identically in exported PNG until an async SVG image raster pass is added.

### Iteration 2 — Recovered SVG Library

- Request: Use the supplied screenshot only to understand seeded grid/randomness behavior, not to recreate the screenshot's image blocks.
- Asset recovery: Restored 28 SVG files from `/Users/macbook/Downloads/MAIN (1)` and `/Users/macbook/Downloads/MAIN (2)` into `Tools/micrographics`.
- User-visible result: The recovered SVG folder is now part of the default symbol library, alongside upload and pasted SVG sources.
- Direction update: Removed screenshot-derived panel blocks and kept uniform seeded placement on a scalable invisible grid with optional jitter, density, spans, and words.
- Palette rule: Library SVG fill/stroke colors are normalized to `currentColor` so rendered symbols stay inside the allowed palette controls.
- Files changed: `src/app/micrographics-renderer.tsx`, `src/app/app-schema.ts`, this worklog.
- Verification: `pnpm typecheck` and `pnpm build` pass after retune.

### Iteration 3 — SVG Fidelity + Collision-Free Placement

- Request: Newly added SVGs should render correctly, white SVG regions should use the background color, grid lines should stay hidden, and generated graphics should not overlap.
- Asset state: `Tools/micrographics` now contains 36 SVG files and is the default library.
- Rendering update: White/near-white SVG fill and stroke values are mapped to the selected background color; non-white SVG paints are mapped to the selected graphics color.
- Layout update: Added seeded grid occupancy so multi-cell graphics reserve their cells and later items skip occupied slots.
- Export update: PNG export now rasterizes the same SVG composition used by preview instead of drawing generic canvas fallback symbols.
- Verification: `pnpm typecheck` and `pnpm build` pass after this pass.

### Iteration 4 — Image Mask, Export Fallback, STAVE Lore Assets

- Request: Fix export, allow an uploaded image to guide micrographics by light/dark areas, add more STAVE-related micrographics in the prior style, place them in a new identifiable folder, then commit and push.
- Source/lore reviewed: Original STAVE build guide covering system audio capture, ring buffer, 5-second audio windows, Python sidecar, madmom chord/beat inference, CRF/Viterbi smoothing, chord ticker, waveform, latency, and SHM later.
- User-visible result: Source now includes an Image mask upload; Grid includes Image mask mode options Off, Light areas, and Dark areas.
- Rendering update: Preview samples the uploaded image into the invisible grid and biases seeded placement into light or dark cells.
- Export update: PNG export uses the same sampled mask as preview and falls back to canvas drawing if SVG rasterization fails.
- Asset update: Added 12 STAVE-themed SVGs in `Tools/micrographics-stave` and wired that folder into the default symbol library.
- Lore update: Default words now use STAVE terms such as CHORD_TICKER, BEAT_SYNC, AUDIO_WINDOW, RING_BUFFER, SIDECAR, MADMOM, VITERBI, CRF, PCM_STREAM, WAVEFORM, LOOPBACK, LATENCY, and SHM_LATER.
- Verification: `pnpm typecheck` and `pnpm build` pass after this pass; `curl -I http://127.0.0.1:3002/` returns 200.
- Skipped: Playwright export smoke test because the browser executable is not installed and installing it would download Chromium.

## Decisions

### Renderer

- Decision: SVG preview with Canvas 2D PNG export.
- Reason: Product semantics are vector symbols and text aligned to a deterministic grid.
- Evidence: `appPerformance.rendererTechnique` declares SVG preview, canvas export, layer inventory, and render pipeline.

### Timeline

- Decision: No timeline.
- Reason: The tool is a still-output procedural poster, not animated media.
- Evidence: `appTransferMode.animationIntent` is `none` and `panels.timeline` is omitted.

### Layers

- Decision: No layers.
- Reason: The product edits a single generated composition rather than individually selectable objects.
- Evidence: `panels.layers` is omitted.

### Controls

- Decision: Built-in controls only.
- Reason: File drop, code textareas, sliders, selects, color, switch, and panel actions cover the value models.
- Evidence: `starterControlSectionInventory` maps every product control target to Source, Grid, Spans, Palette, Background, and Image Export.

### Export

- Decision: Export PNG through Toolcraft `createToolcraftPngExportCanvas`.
- Reason: Still products require PNG export with background and resolution controls.
- Evidence: `exportMicrographicsPng` passes `includeBackground` and `export.image.resolution` to the helper.

### Performance

- Decision: Treat density, grid count, source text, words, and export resolution as workload controls.
- Reason: Those controls affect node count, parsing work, or raster export size.
- Evidence: `appPerformance.scenarios`, `workloadTargets`, `rendererPipeline`, and `rendererTechnique`.

## Evidence

- Source reviewed: screenshot path as behavior reference, color JSON attachment, recovered SVG library, Toolcraft local docs.
- Contract applied: product schema, acceptance inventory, performance inventory, renderer technique, explicit persistence, export controls.

## Verification

- Passed: `pnpm typecheck`, `pnpm build`, and `curl -I http://127.0.0.1:3002/`.
- Known blocked: `pnpm ai:check` requires Toolcraft AI skills that are not installed in this environment.
- Skipped: `pnpm test:browser` because it may install Chromium and the user asked to avoid heavy data usage.

## Risks

- 28 SVGs were recovered into `Tools/micrographics`; any additional files that existed only in the deleted untracked folder were not available locally.
- Uploaded SVG files embedded as image assets may still keep their original colors in preview/export; SVGs in `Tools/micrographics` and pasted raw SVG markup are palette-normalized.

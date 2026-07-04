# Implementation Worklog

## Status

Mode: product

Micrographics Grid Composer is a Toolcraft product app for seeded vector layouts inspired by dense archival HUD/micrographics posters. Users provide SVG symbols and words, tune an invisible grid, constrain colors to the supplied palette, allow random multi-cell spans, and export a PNG.

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
- Verification: Pending local checks after implementation.
- Skipped checks: None yet.
- Risks: Uploaded SVG files render exactly in preview via SVG image embedding; PNG export uses a canvas-safe symbolic fallback for uploaded SVGs, so uploaded artwork may not rasterize identically in exported PNG until an async SVG image raster pass is added.

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

- Source reviewed: prompt image, color JSON attachment, Toolcraft local docs.
- Contract applied: product schema, acceptance inventory, performance inventory, renderer technique, explicit persistence, export controls.

## Verification

- Planned: `pnpm ai:check`, `pnpm test`, `pnpm build`, `pnpm test:browser`, then `pnpm dev`.
- Pending: Browser performance checkpoint. Use Playwright fallback if no controlled browser is available.

## Risks

- The original SVG folders were not recoverable after scaffold path confusion, so the app ships with a built-in starter symbol library and real upload/paste paths for the user's own SVGs.
- Exact uploaded SVG rasterization in PNG export is a follow-up; preview is faithful, export is deterministic and aligned but uses canvas-safe marks for uploaded symbol positions.

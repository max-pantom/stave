import * as React from "react";

import {
  createToolcraftPngExportCanvas,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";
import type { ToolcraftMediaAsset } from "@/toolcraft/runtime/state/types";

type SymbolDef = {
  id: string;
  markup: string;
  viewBox: string;
};

const recoveredSymbolModules = import.meta.glob("../../micrographics/*.svg", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const staveSymbolModules = import.meta.glob("../../micrographics-stave/*.svg", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

type LayoutItem =
  | {
      height: number;
      id: string;
      kind: "symbol";
      rotate: number;
      symbol: SymbolDef;
      width: number;
      x: number;
      y: number;
    }
  | {
      colorRole: "accent" | "foreground";
      fontSize: number;
      height: number;
      id: string;
      kind: "word";
      rotate: number;
      text: string;
      width: number;
      x: number;
      y: number;
    };

type RenderConfig = {
  accent: string;
  background: string;
  columns: number;
  density: number;
  foreground: string;
  grain: number;
  height: number;
  jitter: number;
  maxSpan: number;
  maskMode: "dark" | "light" | "none";
  rotate: number;
  rows: number;
  scale: number;
  seed: string;
  spanChance: number;
  symbols: SymbolDef[];
  width: number;
  wordChance: number;
  words: string[];
};

type BrightnessMask = {
  columns: number;
  rows: number;
  values: number[];
};

function value<T>(state: ToolcraftState, target: string, fallback: T): T {
  const next = state.values[target];
  return (next === undefined ? fallback : next) as T;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isBackgroundSvgPaint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "white" ||
    normalized === "#fff" ||
    normalized === "#ffffff" ||
    normalized === "rgb(255,255,255)" ||
    normalized === "rgb(255 255 255)"
  );
}

function normalizeSvgPaintAttribute(match: string, attr: string, quote: string, rawValue: string): string {
  const value = rawValue.trim();
  const lowerValue = value.toLowerCase();
  if (
    lowerValue === "none" ||
    lowerValue === "currentcolor" ||
    lowerValue === "transparent" ||
    lowerValue.startsWith("url(") ||
    lowerValue.startsWith("var(")
  ) {
    return match;
  }
  return ` ${attr}=${quote}${isBackgroundSvgPaint(value) ? "var(--micrographics-background)" : "currentColor"}${quote}`;
}

function normalizeSvgStyleColors(style: string): string {
  return style.replace(
    /\b(fill|stroke)\s*:\s*([^;"]+)/gi,
    (match: string, attr: string, rawValue: string) => {
      const value = rawValue.trim();
      const lowerValue = value.toLowerCase();
      if (
        lowerValue === "none" ||
        lowerValue === "currentcolor" ||
        lowerValue === "transparent" ||
        lowerValue.startsWith("url(") ||
        lowerValue.startsWith("var(")
      ) {
        return match;
      }
      return `${attr}: ${isBackgroundSvgPaint(value) ? "var(--micrographics-background)" : "currentColor"}`;
    },
  );
}

function sanitizeSvgMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(
      /\s(fill|stroke)\s*=\s*(["'])([^"']*)\2/gi,
      normalizeSvgPaintAttribute,
    )
    .replace(/\sstyle\s*=\s*(["'])(.*?)\1/gi, (_match: string, quote: string, style: string) => {
      return ` style=${quote}${normalizeSvgStyleColors(style)}${quote}`;
    })
    .replace(/javascript:/gi, "");
}

function svgToSymbolDef(svg: string, id: string): SymbolDef {
  const viewBox = svg.match(/viewBox=["']([^"']+)["']/i)?.[1] ?? "0 0 100 100";
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>[\s\S]*$/i, "");
  return {
    id,
    markup: sanitizeSvgMarkup(body),
    viewBox,
  };
}

function parseSvgSnippets(input: string): SymbolDef[] {
  const matches = input.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
  return matches.map((svg, index) => svgToSymbolDef(svg, `pasted-${index}`));
}

function symbolsFromModules(modules: Record<string, string>, prefix: string): SymbolDef[] {
  return Object.entries(modules).map(([path, svg], index) => {
    const name = path.split("/").pop()?.replace(/\.svg$/i, "") ?? `recovered-${index}`;
    return svgToSymbolDef(svg, `${prefix}-${name}-${index}`);
  });
}

function mediaSvgSymbols(state: ToolcraftState): SymbolDef[] {
  return state.mediaAssets
    .filter((asset) => asset.sourceTarget === "source.svgFiles")
    .map((asset, index) => {
      const href = asset.dataUrl;
      return {
        id: `upload-${asset.id}-${index}`,
        markup: `<image href="${href}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`,
        viewBox: "0 0 100 100",
      };
    });
}

function wordsFromText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function cellsAreOpen(
  occupied: boolean[][],
  column: number,
  row: number,
  columnSpan: number,
  rowSpan: number,
): boolean {
  for (let nextRow = row; nextRow < row + rowSpan; nextRow += 1) {
    for (let nextColumn = column; nextColumn < column + columnSpan; nextColumn += 1) {
      if (occupied[nextRow]?.[nextColumn]) return false;
    }
  }
  return true;
}

function occupyCells(
  occupied: boolean[][],
  column: number,
  row: number,
  columnSpan: number,
  rowSpan: number,
): void {
  for (let nextRow = row; nextRow < row + rowSpan; nextRow += 1) {
    for (let nextColumn = column; nextColumn < column + columnSpan; nextColumn += 1) {
      if (occupied[nextRow]) occupied[nextRow][nextColumn] = true;
    }
  }
}

export function configFromState(state: ToolcraftState): RenderConfig {
  const svgText = value(state, "source.svgText", "");
  const useMainLibrary = value(state, "source.useMainLibrary", true);
  const useStaveLibrary = value(state, "source.useStaveLibrary", true);
  const symbols = [
    ...(useMainLibrary ? symbolsFromModules(recoveredSymbolModules, "library") : []),
    ...(useStaveLibrary ? symbolsFromModules(staveSymbolModules, "stave") : []),
    ...parseSvgSnippets(svgText),
    ...mediaSvgSymbols(state),
  ];
  return {
    accent: value(state, "appearance.accent", "#01FFFF"),
    background: value(state, "appearance.background", "#0E111B"),
    columns: value(state, "grid.columns", 18),
    density: value(state, "grid.density", 58),
    foreground: value(state, "appearance.foreground", "#C2FE0C"),
    grain: value(state, "appearance.grain", 18),
    height: state.canvas.size.height,
    jitter: value(state, "grid.jitter", 12),
    maskMode: value(state, "grid.maskMode", "none"),
    maxSpan: value(state, "span.max", 3),
    rotate: value(state, "span.rotate", 10),
    rows: value(state, "grid.rows", 22),
    scale: value(state, "grid.scale", 0.82),
    seed: value(state, "grid.seed", "ARCHIVE-2026"),
    spanChance: value(state, "span.chance", 24),
    symbols,
    width: state.canvas.size.width,
    wordChance: value(state, "span.wordChance", 18),
    words: wordsFromText(value(state, "source.words", "")),
  };
}

function getMaskWeight(
  config: RenderConfig,
  mask: BrightnessMask | undefined,
  column: number,
  row: number,
): number {
  if (!mask || config.maskMode === "none") return 1;
  const brightness = mask.values[row * mask.columns + column] ?? 0;
  return config.maskMode === "dark" ? 1 - brightness : brightness;
}

export function buildLayout(config: RenderConfig, mask?: BrightnessMask): LayoutItem[] {
  const rng = mulberry32(hashSeed(config.seed));
  const cellW = config.width / config.columns;
  const cellH = config.height / config.rows;
  const items: LayoutItem[] = [];
  const occupied = Array.from({ length: config.rows }, () =>
    Array.from({ length: config.columns }, () => false),
  );
  const cellPadding = 0.9;
  const visualScale = Math.max(0.15, Math.min(config.scale, 1.35));

  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      if (occupied[row]?.[column]) continue;
      const maskWeight = getMaskWeight(config, mask, column, row);
      if (config.maskMode !== "none" && maskWeight < 0.06) continue;
      if (rng() * 100 > config.density * maskWeight) continue;

      const canSpan = rng() * 100 < config.spanChance;
      const requestedSpan = canSpan ? 1 + Math.floor(rng() * config.maxSpan) : 1;
      const reservedSpan = Math.max(1, Math.ceil(requestedSpan * Math.max(1, visualScale)));
      const columnSpan = Math.min(reservedSpan, config.columns - column);
      const rowSpan = Math.min(reservedSpan, config.rows - row);
      if (!cellsAreOpen(occupied, column, row, columnSpan, rowSpan)) continue;

      const slotWidth = columnSpan * cellW;
      const slotHeight = rowSpan * cellH;
      const width = slotWidth * Math.min(visualScale, 1) * cellPadding;
      const height = slotHeight * Math.min(visualScale, 1) * cellPadding;
      const freeX = Math.max(0, slotWidth - width);
      const freeY = Math.max(0, slotHeight - height);
      const jitterRatio = config.jitter / 100;
      const x =
        column * cellW +
        freeX / 2 +
        (rng() - 0.5) * freeX * Math.min(1, jitterRatio * 2);
      const y =
        row * cellH +
        freeY / 2 +
        (rng() - 0.5) * freeY * Math.min(1, jitterRatio * 2);
      const rotate = (rng() - 0.5) * config.rotate * 2;
      const useWord = config.words.length > 0 && rng() * 100 < config.wordChance;
      occupyCells(occupied, column, row, columnSpan, rowSpan);

      if (useWord) {
        const text = config.words[Math.floor(rng() * config.words.length)] ?? "NODE";
        items.push({
          colorRole: rng() > 0.75 ? "accent" : "foreground",
          fontSize: Math.max(10, Math.min(width / Math.max(1, text.length * 0.56), height * 0.62)),
          height,
          id: `w-${row}-${column}`,
          kind: "word",
          rotate,
          text,
          width,
          x,
          y,
        });
      } else {
        const symbol = config.symbols[Math.floor(rng() * config.symbols.length)];
        if (!symbol) continue;
        items.push({
          height,
          id: `s-${row}-${column}`,
          kind: "symbol",
          rotate,
          symbol,
          width,
          x,
          y,
        });
      }
    }
  }

  return items.slice(0, 900);
}

function itemColor(item: LayoutItem, config: RenderConfig): string {
  if (item.kind === "word" && item.colorRole === "accent") return config.accent;
  return config.foreground;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

function symbolMarkupForExport(symbol: SymbolDef, config: RenderConfig): string {
  return symbol.markup.replace(/var\(--micrographics-background\)/g, config.background);
}

function buildMicrographicsSvgMarkup(
  config: RenderConfig,
  items: LayoutItem[],
  includeBackground: boolean,
): string {
  const background = includeBackground
    ? `<rect width="${config.width}" height="${config.height}" fill="${escapeAttribute(config.background)}" />`
    : "";
  const nodes = items
    .map((item) => {
      if (item.kind === "word") {
        const fill = escapeAttribute(itemColor(item, config));
        return `<text dominant-baseline="middle" fill="${fill}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${item.fontSize}" font-weight="800" opacity="0.92" text-anchor="middle" transform="translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.rotate})">${escapeHtml(item.text)}</text>`;
      }

      const color = escapeAttribute(itemColor(item, config));
      return `<svg color="${color}" height="${item.height}" opacity="0.82" overflow="visible" preserveAspectRatio="xMidYMid meet" transform="rotate(${item.rotate} ${item.x + item.width / 2} ${item.y + item.height / 2})" viewBox="${escapeAttribute(item.symbol.viewBox)}" width="${item.width}" x="${item.x}" y="${item.y}">${symbolMarkupForExport(item.symbol, config)}</svg>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">${background}<g color="${escapeAttribute(config.foreground)}" fill="none" stroke="currentColor">${nodes}</g></svg>`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("PNG export failed to load SVG composition."));
    image.src = url;
  });
}

function svgMarkupToDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function getMaskImageAsset(state: ToolcraftState): ToolcraftMediaAsset | undefined {
  return state.mediaAssets.find((asset) => asset.sourceTarget === "source.maskImage");
}

function drawMaskImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  transform: ToolcraftMediaAsset["transform"],
): void {
  context.save();
  context.translate(width / 2, height / 2);
  if (transform?.rotationDeg) {
    context.rotate((transform.rotationDeg * Math.PI) / 180);
  }
  context.scale(transform?.flipHorizontal ? -1 : 1, transform?.flipVertical ? -1 : 1);
  const rotated = transform?.rotationDeg === 90 || transform?.rotationDeg === 270;
  const drawWidth = rotated ? height : width;
  const drawHeight = rotated ? width : height;
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

async function createBrightnessMask(
  asset: ToolcraftMediaAsset | undefined,
  config: RenderConfig,
): Promise<BrightnessMask | undefined> {
  if (!asset || config.maskMode === "none") return undefined;

  const image = await loadImage(asset.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = config.columns;
  canvas.height = config.rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  context.clearRect(0, 0, config.columns, config.rows);
  drawMaskImage(context, image, config.columns, config.rows, asset.transform);

  const data = context.getImageData(0, 0, config.columns, config.rows).data;
  const values: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const brightness =
      ((data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255) *
      alpha;
    values.push(brightness);
  }

  return {
    columns: config.columns,
    rows: config.rows,
    values,
  };
}

function useBrightnessMask(
  state: ToolcraftState,
  config: RenderConfig,
): BrightnessMask | undefined {
  const [mask, setMask] = React.useState<BrightnessMask | undefined>();
  const asset = getMaskImageAsset(state);
  const assetKey = `${asset?.id ?? "none"}:${asset?.dataUrl ?? ""}:${JSON.stringify(asset?.transform ?? {})}`;

  React.useEffect(() => {
    let cancelled = false;
    setMask(undefined);
    if (!asset || config.maskMode === "none") return undefined;

    createBrightnessMask(asset, config)
      .then((nextMask) => {
        if (!cancelled) setMask(nextMask);
      })
      .catch(() => {
        if (!cancelled) setMask(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [asset, assetKey, config.columns, config.rows, config.maskMode]);

  return mask;
}

export function MicrographicsRenderer(): React.JSX.Element {
  const { state } = useToolcraft();
  const config = React.useMemo(() => configFromState(state), [state]);
  const mask = useBrightnessMask(state, config);
  const items = React.useMemo(() => buildLayout(config, mask), [config, mask]);
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });

  return (
    <svg
      className="micrographics-output"
      data-testid="micrographics-output"
      viewBox={`0 0 ${config.width} ${config.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="micrographics-grain">
          <feTurbulence baseFrequency="0.82" numOctaves="2" seed="12" type="fractalNoise" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA slope={config.grain / 100} type="linear" />
          </feComponentTransfer>
        </filter>
      </defs>
      {includeBackground ? (
        <rect width={config.width} height={config.height} fill={config.background} />
      ) : null}
      <g color={config.foreground} fill="none" stroke="currentColor">
        {items.map((item) => {
          if (item.kind === "word") {
            const fill = itemColor(item, config);
            return (
              <text
                dominantBaseline="middle"
                fill={fill}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
                fontSize={item.fontSize}
                fontWeight="800"
                key={item.id}
                opacity="0.92"
                textAnchor="middle"
                transform={`translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.rotate})`}
              >
                {item.text}
              </text>
            );
          }

          return (
            <svg
              color={itemColor(item, config)}
              dangerouslySetInnerHTML={{ __html: item.symbol.markup }}
              height={item.height}
              key={item.id}
              opacity="0.82"
              overflow="visible"
              preserveAspectRatio="xMidYMid meet"
              style={{ "--micrographics-background": config.background } as React.CSSProperties}
              transform={`rotate(${item.rotate} ${item.x + item.width / 2} ${item.y + item.height / 2})`}
              viewBox={item.symbol.viewBox}
              width={item.width}
              x={item.x}
              y={item.y}
            />
          );
        })}
      </g>
      <rect
        width={config.width}
        height={config.height}
        filter="url(#micrographics-grain)"
        opacity="0.7"
        pointerEvents="none"
      />
    </svg>
  );
}

export function drawMicrographicsToCanvas(
  context: CanvasRenderingContext2D,
  config: RenderConfig,
  items: LayoutItem[],
  includeBackground: boolean,
): void {
  if (includeBackground) {
    context.fillStyle = config.background;
    context.fillRect(0, 0, config.width, config.height);
  }
  context.globalAlpha = 0.9;

  for (const item of items) {
    context.save();
    context.translate(item.x + item.width / 2, item.y + item.height / 2);
    context.rotate((item.rotate * Math.PI) / 180);
    if (item.kind === "word") {
      context.fillStyle = itemColor(item, config);
      context.font = `800 ${item.fontSize}px ui-monospace, Menlo, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(item.text, 0, 0, item.width);
    } else {
      const color = itemColor(item, config);
      context.strokeStyle = color;
      context.fillStyle = color;
      const size = Math.min(item.width, item.height);
      context.lineWidth = Math.max(2, size * 0.035);
      context.strokeRect(-item.width / 2 + size * 0.12, -item.height / 2 + size * 0.12, size * 0.76, size * 0.76);
      context.beginPath();
      context.arc(0, 0, size * 0.22, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(-size * 0.42, 0);
      context.lineTo(size * 0.42, 0);
      context.moveTo(0, -size * 0.42);
      context.lineTo(0, size * 0.42);
      context.stroke();
      context.beginPath();
      context.arc(size * 0.32, -size * 0.32, size * 0.05, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

export async function exportMicrographicsPng(state: ToolcraftState): Promise<void> {
  const config = configFromState(state);
  const exportBackground = value<{ hex?: string }>(state, "export.background", {
    hex: config.background,
  });
  const exportConfig = {
    ...config,
    background: exportBackground.hex ?? config.background,
  };
  const includeBackground = value(state, "export.includeBackground", true);
  const resolution = value<string>(state, "export.image.resolution", "4k");
  const mask = await createBrightnessMask(getMaskImageAsset(state), exportConfig);
  const items = buildLayout(exportConfig, mask);
  const canvas = createToolcraftPngExportCanvas({
    background: exportConfig.background,
    includeBackground,
    resolution,
    state,
    render: () => {},
  });

  const svgMarkup = buildMicrographicsSvgMarkup(exportConfig, items, includeBackground);
  try {
    const image = await loadImage(svgMarkupToDataUrl(svgMarkup));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export requires a 2D canvas context.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } catch {
    const fallbackCanvas = createToolcraftPngExportCanvas({
      background: exportConfig.background,
      includeBackground,
      resolution,
      state,
      render: ({ context, includeBackground: helperIncludeBackground }) => {
        drawMicrographicsToCanvas(context, exportConfig, items, helperIncludeBackground);
      },
    });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export requires a 2D canvas context.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(fallbackCanvas, 0, 0);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error("PNG export failed."));
    }, "image/png");
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `micrographics-${config.seed.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

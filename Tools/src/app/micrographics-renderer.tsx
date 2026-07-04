import * as React from "react";

import {
  createToolcraftPngExportCanvas,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

type SymbolDef = {
  id: string;
  markup: string;
  viewBox: string;
};

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
  rotate: number;
  scale: number;
  seed: string;
  spanChance: number;
  symbols: SymbolDef[];
  width: number;
  wordChance: number;
  words: string[];
};

const starterSymbols: SymbolDef[] = [
  {
    id: "rings",
    markup:
      '<circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="50" r="18" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="4" fill="currentColor"/><path d="M50 8v18M50 74v18M8 50h18M74 50h18" stroke="currentColor" stroke-width="3"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "node",
    markup:
      '<path d="M50 10v80M10 50h80M22 22l56 56M78 22 22 78" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="9" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="10" r="5" fill="currentColor"/><circle cx="90" cy="50" r="5" fill="currentColor"/><circle cx="50" cy="90" r="5" fill="currentColor"/><circle cx="10" cy="50" r="5" fill="currentColor"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "bars",
    markup:
      '<rect x="12" y="22" width="76" height="8" rx="4" fill="currentColor"/><rect x="12" y="46" width="52" height="8" rx="4" fill="currentColor"/><rect x="12" y="70" width="68" height="8" rx="4" fill="currentColor"/><circle cx="84" cy="50" r="7" fill="none" stroke="currentColor" stroke-width="3"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "dial",
    markup:
      '<circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="3 8"/><path d="M50 50 74 28" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="50" r="12" fill="currentColor"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "chip",
    markup:
      '<rect x="18" y="20" width="64" height="60" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M32 20v-10M50 20v-10M68 20v-10M32 90V80M50 90V80M68 90V80M8 34h10M8 50h10M8 66h10M92 34H82M92 50H82M92 66H82" stroke="currentColor" stroke-width="3"/><path d="M32 58h36M32 42h18" stroke="currentColor" stroke-width="4"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "orbit",
    markup:
      '<ellipse cx="50" cy="50" rx="42" ry="18" fill="none" stroke="currentColor" stroke-width="3"/><ellipse cx="50" cy="50" rx="18" ry="42" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="8" fill="currentColor"/><circle cx="82" cy="50" r="5" fill="currentColor"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "frame",
    markup:
      '<path d="M12 34V12h22M66 12h22v22M88 66v22H66M34 88H12V66" fill="none" stroke="currentColor" stroke-width="4"/><path d="M30 50h40M50 30v40" stroke="currentColor" stroke-width="3"/><rect x="38" y="38" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3"/>',
    viewBox: "0 0 100 100",
  },
  {
    id: "wave",
    markup:
      '<path d="M8 58c12-28 24-28 36 0s24 28 48 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M8 34h84M8 78h84" stroke="currentColor" stroke-width="3" stroke-dasharray="8 8"/>',
    viewBox: "0 0 100 100",
  },
];

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

function sanitizeSvgMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function parseSvgSnippets(input: string): SymbolDef[] {
  const matches = input.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
  return matches.map((svg, index) => {
    const viewBox = svg.match(/viewBox=["']([^"']+)["']/i)?.[1] ?? "0 0 100 100";
    const body = svg
      .replace(/^[\s\S]*?<svg[^>]*>/i, "")
      .replace(/<\/svg>[\s\S]*$/i, "");
    return {
      id: `pasted-${index}`,
      markup: sanitizeSvgMarkup(body),
      viewBox,
    };
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

export function configFromState(state: ToolcraftState): RenderConfig {
  const svgText = value(state, "source.svgText", "");
  const symbols = [
    ...starterSymbols,
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
    maxSpan: value(state, "span.max", 3),
    rotate: value(state, "span.rotate", 10),
    scale: value(state, "grid.scale", 0.82),
    seed: value(state, "grid.seed", "ARCHIVE-2026"),
    spanChance: value(state, "span.chance", 24),
    symbols,
    width: state.canvas.size.width,
    wordChance: value(state, "span.wordChance", 18),
    words: wordsFromText(value(state, "source.words", "")),
  };
}

export function buildLayout(config: RenderConfig): LayoutItem[] {
  const rng = mulberry32(hashSeed(config.seed));
  const rows = Math.max(1, Math.round(config.width / (config.width / config.columns)));
  const cell = config.width / config.columns;
  const computedRows = Math.max(1, Math.round(config.height / cell));
  const rowCount = Math.max(computedRows, Math.round(rows * (config.height / config.width)));
  const items: LayoutItem[] = [];

  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      if (rng() * 100 > config.density) continue;

      const canSpan = rng() * 100 < config.spanChance;
      const span = canSpan ? 1 + Math.floor(rng() * config.maxSpan) : 1;
      const width = Math.min(span * cell * config.scale, config.width - column * cell);
      const height = Math.min(span * cell * config.scale, config.height - row * cell);
      const jitterPx = cell * (config.jitter / 100);
      const x = column * cell + (cell - width) / 2 + (rng() - 0.5) * jitterPx;
      const y = row * cell + (cell - height) / 2 + (rng() - 0.5) * jitterPx;
      const rotate = (rng() - 0.5) * config.rotate * 2;
      const useWord = config.words.length > 0 && rng() * 100 < config.wordChance;

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
        const symbol = config.symbols[Math.floor(rng() * config.symbols.length)] ?? starterSymbols[0];
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

export function MicrographicsRenderer(): React.JSX.Element {
  const { state } = useToolcraft();
  const config = React.useMemo(() => configFromState(state), [state]);
  const items = React.useMemo(() => buildLayout(config), [config]);
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
      <g opacity="0.14" stroke={config.foreground} strokeWidth="1">
        {Array.from({ length: config.columns + 1 }).map((_, index) => (
          <line
            key={`x-${index}`}
            x1={(config.width / config.columns) * index}
            x2={(config.width / config.columns) * index}
            y1="0"
            y2={config.height}
          />
        ))}
      </g>
      <g color={config.foreground} fill="none" stroke="currentColor">
        {items.map((item) => {
          if (item.kind === "word") {
            const fill = item.colorRole === "accent" ? config.accent : config.foreground;
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
            <g
              color={config.foreground}
              dangerouslySetInnerHTML={{ __html: item.symbol.markup }}
              key={item.id}
              opacity="0.82"
              transform={`translate(${item.x} ${item.y}) rotate(${item.rotate} ${item.width / 2} ${item.height / 2}) scale(${item.width / 100} ${item.height / 100})`}
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
  context.strokeStyle = config.foreground;
  context.lineWidth = 1;
  context.globalAlpha = 0.14;
  for (let index = 0; index <= config.columns; index += 1) {
    const x = (config.width / config.columns) * index;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, config.height);
    context.stroke();
  }
  context.globalAlpha = 0.9;

  for (const item of items) {
    context.save();
    context.translate(item.x + item.width / 2, item.y + item.height / 2);
    context.rotate((item.rotate * Math.PI) / 180);
    if (item.kind === "word") {
      context.fillStyle = item.colorRole === "accent" ? config.accent : config.foreground;
      context.font = `800 ${item.fontSize}px ui-monospace, Menlo, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(item.text, 0, 0, item.width);
    } else {
      context.strokeStyle = config.foreground;
      context.fillStyle = config.foreground;
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
  const items = buildLayout(config);
  const exportBackground = value<{ hex?: string }>(state, "export.background", {
    hex: config.background,
  });
  const includeBackground = value(state, "export.includeBackground", true);
  const resolution = value<string>(state, "export.image.resolution", "4k");
  const canvas = createToolcraftPngExportCanvas({
    background: exportBackground.hex ?? config.background,
    includeBackground,
    resolution,
    state,
    render: ({ context, includeBackground: helperIncludeBackground }) => {
      drawMicrographicsToCanvas(context, config, items, helperIncludeBackground);
    },
  });

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
  anchor.click();
  URL.revokeObjectURL(url);
}

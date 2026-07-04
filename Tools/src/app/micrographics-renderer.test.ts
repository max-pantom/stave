import { describe, expect, it } from "vitest";

import { configFromState } from "./micrographics-renderer";
import type { ToolcraftState } from "@/toolcraft/runtime";

function makeState(values: Record<string, unknown> = {}): ToolcraftState {
  return {
    canvas: { size: { height: 2000, unit: "px", width: 1600 } },
    mediaAssets: [],
    values,
  } as unknown as ToolcraftState;
}

describe("micrographics renderer source libraries", () => {
  it("uses both built-in micrographics folders by default", () => {
    const config = configFromState(makeState());

    expect(config.symbols.some((symbol) => symbol.id.startsWith("library-"))).toBe(true);
    expect(config.symbols.some((symbol) => symbol.id.startsWith("stave-"))).toBe(true);
  });

  it("can disable the main micrographics folder without disabling STAVE assets", () => {
    const config = configFromState(makeState({ "source.useMainLibrary": false }));

    expect(config.symbols.some((symbol) => symbol.id.startsWith("library-"))).toBe(false);
    expect(config.symbols.some((symbol) => symbol.id.startsWith("stave-"))).toBe(true);
  });

  it("can disable the STAVE micrographics folder without disabling main assets", () => {
    const config = configFromState(makeState({ "source.useStaveLibrary": false }));

    expect(config.symbols.some((symbol) => symbol.id.startsWith("library-"))).toBe(true);
    expect(config.symbols.some((symbol) => symbol.id.startsWith("stave-"))).toBe(false);
  });
});

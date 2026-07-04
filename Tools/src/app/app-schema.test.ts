import { describe, expect, it } from "vitest";

import { appPerformance } from "./app-performance";
import { appSchema } from "./app-schema";

describe("micrographics app schema", () => {
  it("publishes a product Toolcraft contract", () => {
    expect(appSchema.canvas.draggable).toBe(true);
    expect(appSchema.canvas.enabled).toBe(true);
    expect(appSchema.canvas.sizing).toEqual({ mode: "editable-output" });
    expect(appSchema.canvas.upload).toBe(true);
    expect(appSchema.panels.controls?.sections[0]?.title).toBe("Setup");
    expect(appSchema.toolbar).toEqual({
      history: true,
      radar: true,
      theme: true,
      zoom: true,
    });
    expect(appSchema.assembly.capabilities).toEqual(
      expect.arrayContaining([
        "canvas.draggable",
        "canvas.editableSize",
        "canvas.upload",
        "controls.defaults",
        "controls.panel",
        "toolbar.history",
        "toolbar.radar",
        "toolbar.theme",
        "toolbar.zoom",
      ]),
    );
  });

  it("exposes the requested micrographics controls", () => {
    const productSections =
      appSchema.panels.controls?.sections.filter((section) => section.title !== "Setup") ??
      [];
    expect(productSections.map((section) => section.title)).toEqual([
      "Source",
      "Grid",
      "Spans",
      "Palette",
      "Background",
      "Image Export",
      "Export",
    ]);
  });

  it("declares renderer workload coverage", () => {
    expect(appPerformance.usesCustomRenderer).toBe(true);
    expect(appPerformance.rendererStrategy).toBe("svg");
    expect(appPerformance.workloadTargets).toEqual(
      expect.arrayContaining([
        "grid.columns",
        "grid.rows",
        "grid.density",
        "source.svgText",
        "source.words",
        "export.image.resolution",
      ]),
    );
  });
});

import { ToolcraftApp } from "@/toolcraft/runtime/react";

import { appSchema } from "../app/app-schema";
import {
  exportMicrographicsPng,
  MicrographicsRenderer,
} from "../app/micrographics-renderer";

export function AppHome(): React.JSX.Element {
  return (
    <ToolcraftApp
      canvasContent={<MicrographicsRenderer />}
      className="h-dvh min-h-dvh"
      onPanelAction={({ action, reportProgress, state }) => {
        if (action.value !== "export-png") return undefined;
        reportProgress(0.15);
        return exportMicrographicsPng(state).finally(() => reportProgress(1));
      }}
      renderDefaultCanvasMedia={false}
      schema={appSchema}
    />
  );
}

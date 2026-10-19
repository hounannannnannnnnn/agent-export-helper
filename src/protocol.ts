export type ExportFormat = "markdown" | "json" | "png";

export type HandoffConfig = {
  mode: "delivery" | "node-url";
  detail: "compact" | "extended";
  maxDepth: number;
  platform: "mobile" | "web" | "desktop";
  assetMode: "settings" | "auto";
  ignoreName: string;
  coordinateSort: boolean;
  fileKey?: string;
};

export type ExportPackageFile = { path: string; content: string | Uint8Array };

export type SelectionInfo = {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
};

export type UIToPluginMessage =
  | { type: "selection:refresh" }
  | { type: "export:request"; format: ExportFormat }
  | { type: "handoff:generate"; config: HandoffConfig };

export type PluginToUIMessage =
  | { type: "selection:update"; pageName: string; fileKey: string | null; selections: SelectionInfo[] }
  | { type: "handoff:progress"; message: string }
  | { type: "handoff:complete"; markdown: string; markdownFilename: string; resourceFilename?: string; resourceZip?: Uint8Array; frameCount: number; assetCount: number }
  | { type: "export:complete"; format: ExportFormat; filename: string; mimeType: string; content: string | Uint8Array }
  | { type: "export:error"; message: string }
  | { type: "error"; message: string };

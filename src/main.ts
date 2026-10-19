/// <reference types="@figma/plugin-typings" />

import { createAssetManifest, createExportDocument, createMarkdown, hasPngSignature, makeFilename, requireSelectedFrame, type ExportNode, type ExportPaint, type MixedValue } from "./export-data";
import { createZip } from "./zip";
import { createExtendedDebugMarkdown, createHandoffMarkdown, prepareHandoffFrame } from "./handoff";
import { createDesignPackageFiles } from "./design-output";
import { readFigmaDesignSnapshot } from "./figma-design";
import { isIconCandidate } from "./icon-detection";
import type { ExportFormat, ExportPackageFile, HandoffConfig, PluginToUIMessage, SelectionInfo, UIToPluginMessage } from "./protocol";

type ExportDocument = ReturnType<typeof createExportDocument>;

function postSelection(): void {
  try {
    const message: PluginToUIMessage = {
      type: "selection:update",
      pageName: figma.currentPage.name,
      fileKey: figma.fileKey ?? null,
      selections: figma.currentPage.selection.map((node): SelectionInfo => ({
        id: node.id,
        name: node.name,
        type: node.type,
        width: Math.round(node.width),
        height: Math.round(node.height),
      })),
    };
    figma.ui.postMessage(message);
  } catch (error) {
    const message: PluginToUIMessage = {
      type: "error",
      message: error instanceof Error ? error.message : "读取选区时发生未知错误。",
    };
    figma.ui.postMessage(message);
  }
}

function getSelectedFrame(): FrameNode {
  return requireSelectedFrame(figma.currentPage.selection) as FrameNode;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readNodeValue(node: SceneNode, key: string): unknown {
  return (node as unknown as Record<string, unknown>)[key];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mixedAwareNumber(value: unknown): number | MixedValue | null {
  if (value === figma.mixed) return "mixed";
  return finiteNumber(value);
}

function summarizeColor(value: unknown): NonNullable<ExportPaint["color"]> | undefined {
  const color = recordOf(value);
  if (!color) return undefined;
  const r = finiteNumber(color.r);
  const g = finiteNumber(color.g);
  const b = finiteNumber(color.b);
  if (r === null || g === null || b === null) return undefined;
  const toHex = (channel: number) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0");
  return { r, g, b, hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` };
}

function summarizePaint(value: unknown): ExportPaint | undefined {
  const paint = recordOf(value);
  if (!paint || typeof paint.type !== "string") return undefined;
  const summary: ExportPaint = { type: paint.type };
  if (typeof paint.visible === "boolean") summary.visible = paint.visible;
  if (paint.opacity !== undefined) summary.opacity = finiteNumber(paint.opacity);
  if (paint.color !== undefined) summary.color = summarizeColor(paint.color);
  if (typeof paint.imageHash === "string") summary.imageHash = paint.imageHash;
  if (typeof paint.scaleMode === "string") summary.scaleMode = paint.scaleMode;
  if (Array.isArray(paint.gradientStops)) {
    summary.gradientStops = paint.gradientStops.flatMap((stopValue) => {
      const stop = recordOf(stopValue);
      const color = summarizeColor(stop?.color);
      return stop && color ? [{ position: finiteNumber(stop.position), color }] : [];
    });
  }
  return summary;
}

function summarizePaints(node: SceneNode, key: "fills" | "strokes"): ExportPaint[] | MixedValue | undefined {
  const value = readNodeValue(node, key);
  if (value === figma.mixed) return "mixed";
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((paint) => {
    const summary = summarizePaint(paint);
    return summary ? [summary] : [];
  });
}

function summarizeText(node: TextNode): ExportNode["text"] {
  const fontName = node.fontName === figma.mixed ? figma.mixed : recordOf(node.fontName);
  return {
    content: node.characters,
    fontSize: mixedAwareNumber(node.fontSize),
    fontWeight: mixedAwareNumber(node.fontWeight),
    fontFamily: fontName === figma.mixed ? "mixed" : typeof fontName?.family === "string" ? fontName.family : undefined,
    fontStyle: fontName === figma.mixed ? "mixed" : typeof fontName?.style === "string" ? fontName.style : undefined,
    horizontalAlignment: node.textAlignHorizontal,
    verticalAlignment: node.textAlignVertical,
  };
}

function summarizeComponentProperties(instance: InstanceNode): NonNullable<ExportNode["component"]>["properties"] {
  const properties: NonNullable<ExportNode["component"]>["properties"] = {};
  for (const [name, property] of Object.entries(instance.componentProperties)) {
    properties[name] = { type: property.type, value: property.value };
  }
  return properties;
}

async function toExportNode(node: SceneNode): Promise<ExportNode>;
async function toExportNode(node: SceneNode, handoffConfig: HandoffConfig, depth?: number): Promise<ExportNode | undefined>;
async function toExportNode(node: SceneNode, handoffConfig?: HandoffConfig, depth = 0): Promise<ExportNode | undefined> {
  if (handoffConfig && depth > 0 && handoffConfig.ignoreName.trim() && node.name.toLocaleLowerCase().includes(handoffConfig.ignoreName.trim().toLocaleLowerCase())) return undefined;
  const result: ExportNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    position: { x: finiteNumber(node.x), y: finiteNumber(node.y) },
    size: { width: finiteNumber(node.width), height: finiteNumber(node.height) },
    visible: node.visible,
    locked: node.locked,
    children: [],
  };

  const opacity = readNodeValue(node, "opacity");
  if (opacity !== undefined) result.opacity = finiteNumber(opacity);
  const fills = summarizePaints(node, "fills");
  if (fills !== undefined) result.fills = fills;
  const strokes = summarizePaints(node, "strokes");
  if (strokes !== undefined) result.strokes = strokes;

  const strokeWeight = readNodeValue(node, "strokeWeight");
  if (strokeWeight !== undefined) result.strokeWeight = mixedAwareNumber(strokeWeight);
  const radius = readNodeValue(node, "cornerRadius");
  const cornerRadii = readNodeValue(node, "rectangleCornerRadii");
  if (cornerRadii === figma.mixed || radius === figma.mixed) result.cornerRadius = "mixed";
  else if (Array.isArray(cornerRadii)) result.cornerRadius = cornerRadii.map(finiteNumber);
  else if (radius !== undefined) result.cornerRadius = finiteNumber(radius);

  const layoutMode = readNodeValue(node, "layoutMode");
  if (typeof layoutMode === "string" && layoutMode !== "NONE") {
    result.layout = {
      mode: layoutMode,
      primaryAxisAlignItems: typeof readNodeValue(node, "primaryAxisAlignItems") === "string" ? readNodeValue(node, "primaryAxisAlignItems") as string : undefined,
      counterAxisAlignItems: typeof readNodeValue(node, "counterAxisAlignItems") === "string" ? readNodeValue(node, "counterAxisAlignItems") as string : undefined,
      paddingTop: finiteNumber(readNodeValue(node, "paddingTop")),
      paddingRight: finiteNumber(readNodeValue(node, "paddingRight")),
      paddingBottom: finiteNumber(readNodeValue(node, "paddingBottom")),
      paddingLeft: finiteNumber(readNodeValue(node, "paddingLeft")),
      itemSpacing: finiteNumber(readNodeValue(node, "itemSpacing")),
      layoutWrap: typeof readNodeValue(node, "layoutWrap") === "string" ? readNodeValue(node, "layoutWrap") as string : undefined,
      layoutSizingHorizontal: typeof readNodeValue(node, "layoutSizingHorizontal") === "string" ? readNodeValue(node, "layoutSizingHorizontal") as string : undefined,
      layoutSizingVertical: typeof readNodeValue(node, "layoutSizingVertical") === "string" ? readNodeValue(node, "layoutSizingVertical") as string : undefined,
      clipsContent: typeof readNodeValue(node, "clipsContent") === "boolean" ? readNodeValue(node, "clipsContent") as boolean : undefined,
    };
  }
  const reactions = readNodeValue(node, "reactions");
  if (Array.isArray(reactions)) {
    result.reactions = reactions.map((reactionValue) => {
      const reaction = recordOf(reactionValue);
      const trigger = recordOf(reaction?.trigger);
      const actions = Array.isArray(reaction?.actions) ? reaction.actions : reaction?.action ? [reaction.action] : [];
      return {
        trigger: typeof trigger?.type === "string" ? trigger.type : undefined,
        actions: actions.flatMap((actionValue) => {
          const action = recordOf(actionValue);
          if (!action) return [];
          return [{
            type: typeof action.type === "string" ? action.type : undefined,
            destinationId: typeof action.destinationId === "string" ? action.destinationId : undefined,
            navigation: typeof action.navigation === "string" ? action.navigation : undefined,
            url: typeof action.url === "string" ? action.url : undefined,
          }];
        }),
      };
    });
  }

  if (node.type === "TEXT") result.text = summarizeText(node);
  if (node.type === "INSTANCE") {
    const component: NonNullable<ExportNode["component"]> = { properties: summarizeComponentProperties(node) };
    try {
      const mainComponent = await node.getMainComponentAsync();
      if (mainComponent) {
        component.mainComponentId = mainComponent.id;
        component.mainComponentName = mainComponent.name;
      }
    } catch {
      // Inaccessible remote components are represented by the instance's own ID and properties.
    }
    result.component = component;
  }

  if ("children" in node) {
    const children = [...node.children];
    if (handoffConfig?.coordinateSort) children.sort((a, b) => a.y - b.y || a.x - b.x);
    if (handoffConfig && depth >= handoffConfig.maxDepth) {
      result.omittedChildren = children.filter((child) => !handoffConfig.ignoreName.trim() || !child.name.toLocaleLowerCase().includes(handoffConfig.ignoreName.trim().toLocaleLowerCase())).length;
    } else {
      const extracted = await Promise.all(children.map((child) => handoffConfig ? toExportNode(child, handoffConfig, depth + 1) : toExportNode(child)));
      result.children = extracted.filter((child): child is ExportNode => Boolean(child));
      const omitted = children.length - result.children.length;
      if (omitted) result.omittedChildren = omitted;
    }
  }
  return result;
}

function safeAssetExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "webp";
  return "bin";
}

function assetBaseName(node: ExportNode): string {
  return makeFilename(node.name, node.id, "svg").replace(/\.svg$/i, "");
}

async function collectPackageAssets(
  source: SceneNode,
  model: ExportNode,
  assetMode: HandoffConfig["assetMode"],
  ignoreName: string,
  imagePaths: Map<string, string>,
  sourcesByPath: Map<string, Array<{ nodeId: string; name: string; type: string }>>,
): Promise<ExportPackageFile[]> {
  const files: ExportPackageFile[] = [];
  const modelById = new Map<string, ExportNode>();
  const indexModel = (node: ExportNode) => {
    modelById.set(node.id, node);
    node.children.forEach(indexModel);
  };
  indexModel(model);

  const addSource = (path: string, node: SceneNode) => {
    const sources = sourcesByPath.get(path) ?? [];
    if (!sources.some((sourceInfo) => sourceInfo.nodeId === node.id)) {
      sources.push({ nodeId: node.id, name: node.name, type: node.type });
    }
    sourcesByPath.set(path, sources);
  };

  const shallowNode = (node: SceneNode): ExportNode => ({
    id: node.id,
    name: node.name,
    type: node.type,
    position: { x: finiteNumber(node.x), y: finiteNumber(node.y) },
    size: { width: finiteNumber(node.width), height: finiteNumber(node.height) },
    visible: node.visible,
    locked: node.locked,
    fills: summarizePaints(node, "fills"),
    strokes: summarizePaints(node, "strokes"),
    children: [],
  });

  async function visit(sourceNode: SceneNode, exportNode: ExportNode, insideIcon = false, ancestorsVisible = true): Promise<void> {
    if (!ancestorsVisible) return;
    if (ignoreName.trim() && sourceNode.name.toLocaleLowerCase().includes(ignoreName.trim().toLocaleLowerCase())) return;
    exportNode = modelById.get(sourceNode.id) ?? exportNode;
    let componentName = exportNode.component?.mainComponentName;
    if (!insideIcon && sourceNode.type === "INSTANCE" && !componentName && sourceNode.width <= 256 && sourceNode.height <= 256) {
      try {
        componentName = (await sourceNode.getMainComponentAsync())?.name;
      } catch {
        // Remote or unavailable component metadata does not prevent geometry-based recognition.
      }
    }
    const isIconAsset = !insideIcon && isIconCandidate(sourceNode, componentName ? [componentName] : []);
    if (sourceNode.visible) {
      if (assetMode === "auto") {
        const paints = [...(exportNode.fills === "mixed" ? [] : exportNode.fills ?? []), ...(exportNode.strokes === "mixed" ? [] : exportNode.strokes ?? [])];
        for (const paint of paints) {
          if (!paint.imageHash) continue;
          let assetPath = imagePaths.get(paint.imageHash);
          if (!assetPath) {
            const image = figma.getImageByHash(paint.imageHash);
            if (image) {
              try {
                const bytes = await image.getBytesAsync();
                const ext = safeAssetExtension(bytes);
                assetPath = `assets/images/${assetBaseName(exportNode)}-${paint.imageHash.slice(0, 8)}.${ext}`;
                files.push({ path: assetPath, content: bytes });
                imagePaths.set(paint.imageHash, assetPath);
                addSource(assetPath, sourceNode);
              } catch {
                // Keep the source image hash in page data when Figma cannot provide the bytes.
              }
            }
          }
          if (assetPath && !exportNode.assetPaths?.includes(assetPath)) (exportNode.assetPaths ??= []).push(assetPath);
          if (assetPath) addSource(assetPath, sourceNode);
        }
      }

      const isVectorLeaf = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"].includes(sourceNode.type)
        && (!("children" in sourceNode) || sourceNode.children.length === 0);
      const isNamedAsset = sourceNode.type !== "TEXT" && /(icon|logo|asset|image|图标|标志|资源|切图|插画|图片)/i.test(`${sourceNode.name} ${componentName ?? ""}`);
      const shouldExportSvg = assetMode === "auto" && !insideIcon && (isVectorLeaf || isNamedAsset) && sourceNode.visible;
      if (shouldExportSvg && "exportAsync" in sourceNode) {
        try {
          const svg = await sourceNode.exportAsync({ format: "SVG_STRING" });
          if (typeof svg === "string" && svg.trim()) {
            const assetPath = `assets/icons/${assetBaseName(exportNode)}.svg`;
            files.push({ path: assetPath, content: svg });
            (exportNode.assetPaths ??= []).push(assetPath);
            addSource(assetPath, sourceNode);
          }
        } catch {
          // SVG export is best effort; the vector remains represented in the page layer tree.
        }
      }

      // Icons are exported in both formats so consumers can choose scalable SVG or raster PNG.
      // Other named composite artwork gets a PNG fallback only when SVG export was unavailable.
      if (assetMode === "auto" && (isIconAsset || (!insideIcon && isNamedAsset && !(exportNode.assetPaths ?? []).some((path) => path.endsWith(".svg")))) && sourceNode.visible && "exportAsync" in sourceNode) {
        try {
          const bytes = await sourceNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
          if (bytes instanceof Uint8Array && bytes.byteLength > 0) {
            const assetPath = `assets/icons/${assetBaseName(exportNode)}.png`;
            files.push({ path: assetPath, content: bytes });
            (exportNode.assetPaths ??= []).push(assetPath);
            addSource(assetPath, sourceNode);
          }
        } catch {
          // Preserve the layer in page data when Figma cannot render it as a standalone asset.
        }
      }

      if (assetMode === "settings" || assetMode === "auto") {
        const settings = sourceNode.exportSettings;
        for (let settingIndex = 0; settingIndex < settings.length; settingIndex += 1) {
          const setting = settings[settingIndex];
          const extension = setting.format.toLowerCase() as "png" | "jpg" | "svg" | "pdf";
          try {
            const bytes = await sourceNode.exportAsync(setting);
            if (!(bytes instanceof Uint8Array)) continue;
            const settingSuffix = "suffix" in setting && setting.suffix ? setting.suffix : "";
            const suffix = `${settingSuffix}${settings.length > 1 ? `-${settingIndex + 1}` : ""}`;
            const assetPath = `assets/export-settings/${makeFilename(`${exportNode.name}${suffix}`, exportNode.id, extension)}`;
            files.push({ path: assetPath, content: bytes });
            (exportNode.assetPaths ??= []).push(assetPath);
          } catch {
            // Continue exporting other configured layers if one Figma export setting fails.
          }
        }
      }
    }

    if ("children" in sourceNode) {
      for (const child of sourceNode.children) {
        const childModel = modelById.get(child.id) ?? shallowNode(child);
        await visit(child, childModel, insideIcon || isIconAsset, ancestorsVisible && sourceNode.visible);
      }
    }
  }

  await visit(source, model);
  return files;
}

function clampHandoffConfig(config: HandoffConfig): HandoffConfig {
  return {
    ...config,
    maxDepth: Math.max(1, Math.min(20, Math.round(Number.isFinite(config.maxDepth) ? config.maxDepth : 4))),
    ignoreName: config.ignoreName.slice(0, 100),
  };
}

async function generateHandoff(configValue: HandoffConfig): Promise<void> {
  const config = clampHandoffConfig(configValue);
  const selectedFrames = figma.currentPage.selection.filter((node): node is FrameNode => node.type === "FRAME");
  if (!selectedFrames.length) throw new Error("请先在当前页面选择一个或多个 Frame。普通图层会被跳过。");

  const models: ExportNode[] = [];
  for (let index = 0; index < selectedFrames.length; index += 1) {
    figma.ui.postMessage({ type: "handoff:progress", message: `正在读取画板 ${index + 1} / ${selectedFrames.length}：${selectedFrames[index].name}` } satisfies PluginToUIMessage);
    const frame = selectedFrames[index];
    const model = config.mode === "node-url" ? {
      id: frame.id,
      name: frame.name,
      type: frame.type,
      position: { x: finiteNumber(frame.x), y: finiteNumber(frame.y) },
      size: { width: finiteNumber(frame.width), height: finiteNumber(frame.height) },
      visible: frame.visible,
      locked: frame.locked,
      children: [],
    } : await toExportNode(frame, config);
    if (model) models.push(model);
  }

  let assetFiles: ExportPackageFile[] = [];
  const assetSources = new Map<string, Array<{ nodeId: string; name: string; type: string }>>();
  if (config.mode === "delivery") {
    const imagePaths = new Map<string, string>();
    for (let index = 0; index < selectedFrames.length; index += 1) {
      figma.ui.postMessage({ type: "handoff:progress", message: `正在提取资源 ${index + 1} / ${selectedFrames.length}：${selectedFrames[index].name}` } satisfies PluginToUIMessage);
      assetFiles.push(...await collectPackageAssets(selectedFrames[index], models[index], config.assetMode, config.ignoreName, imagePaths, assetSources));
    }
  }

  const frames = models.map((model) => prepareHandoffFrame(model, config));
  const exportedAt = new Date().toISOString();
  const pageName = figma.currentPage.name;
  let markdown = createHandoffMarkdown(frames, config, config.fileKey?.trim() || figma.fileKey, pageName, exportedAt);
  // The standalone Markdown is downloaded at the package root; assets are also rooted there.
  markdown = markdown.replace(/\]\(\.\.\/assets\//g, "](assets/");
  const markdownFilename = makeFilename(pageName || "Figma-Handoff", String(frames.length), "md");

  let resourceZip: Uint8Array | undefined;
  let resourceFilename: string | undefined;
  if (config.mode === "delivery") {
    const packageFiles: ExportPackageFile[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const pageStem = makeFilename(frame.name, frame.id, "md").replace(/\.md$/i, "");
      const markdownPath = `frames/${pageStem}.md`;
      const jsonPath = `frames/${pageStem}.json`;
      packageFiles.push({
        path: markdownPath,
        content: createHandoffMarkdown([frame], config, config.fileKey?.trim() || figma.fileKey, pageName, exportedAt).replace(/\]\(assets\//g, "](../assets/"),
      });
      packageFiles.push({ path: jsonPath, content: `${JSON.stringify(createExportDocument(frame, exportedAt), null, 2)}\n` });
    }
    if (config.detail === "extended") {
      packageFiles.push({ path: "DESIGN.extended.md", content: createExtendedDebugMarkdown(frames, exportedAt) });
    }
    const assetPaths = [...new Set(assetFiles.map((file) => file.path))];
    const designSnapshot = await readFigmaDesignSnapshot();
    const designFiles = createDesignPackageFiles({
      projectName: figma.root.name || "未命名项目",
      pageName,
      exportedAt,
      frames,
      assets: assetPaths,
      snapshot: designSnapshot,
      exportConfig: {
        detail: config.detail,
        platform: config.platform,
        assetMode: config.assetMode,
        maxDepth: config.maxDepth,
        ignoreName: config.ignoreName,
        coordinateSort: config.coordinateSort,
      },
    });
    const packageFilesWithIndex: ExportPackageFile[] = [
      { path: "asset-manifest.json", content: createAssetManifest(assetFiles, frames, exportedAt, Object.fromEntries(assetSources)) },
      ...designFiles,
      ...(assetFiles.length ? [] : [{ path: "assets/README.md", content: "# Assets\n\n本次没有从所选 Frame 中读取到可导出的切图。请检查图层 Export 设置，或在自动识别模式中为资源图层添加图标、图片、插画、切图等名称标记。\n" }]),
      ...packageFiles,
      ...assetFiles,
    ];
    resourceZip = createZip(packageFilesWithIndex);
    resourceFilename = makeFilename(pageName || "Figma-Resources", String(frames.length), "zip");
  }

  figma.ui.postMessage({
    type: "handoff:complete",
    markdown,
    markdownFilename,
    resourceFilename,
    resourceZip,
    frameCount: frames.length,
    assetCount: new Set(assetFiles.map((file) => file.path)).size,
  } satisfies PluginToUIMessage);
}

let exportInProgress = false;

async function exportSelection(format: ExportFormat): Promise<void> {
  if (exportInProgress) {
    figma.ui.postMessage({ type: "export:error", message: "已有导出任务正在进行，请稍候。" } satisfies PluginToUIMessage);
    return;
  }

  exportInProgress = true;
  try {
    const frame = getSelectedFrame();
    let content: string | Uint8Array | ExportDocument;
    let mimeType: string;
    let extension: "md" | "json" | "png";

    if (format === "markdown") {
      content = createMarkdown(await toExportNode(frame));
      mimeType = "text/markdown;charset=utf-8";
      extension = "md";
    } else if (format === "json") {
      content = createExportDocument(await toExportNode(frame));
      mimeType = "application/json;charset=utf-8";
      extension = "json";
    } else {
      content = await frame.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
      if (!hasPngSignature(content)) throw new Error("Figma 返回的 PNG 数据为空或格式无效。");
      mimeType = "image/png";
      extension = "png";
    }

    const outputContent = format === "png"
      ? content as Uint8Array
      : format === "json"
        ? `${JSON.stringify(content, null, 2)}\n`
        : content as string;

    figma.ui.postMessage({
      type: "export:complete",
      format,
      filename: makeFilename(frame.name, frame.id, extension),
      mimeType,
      content: outputContent,
    } satisfies PluginToUIMessage);
  } catch (error) {
    figma.ui.postMessage({
      type: "export:error",
      message: error instanceof Error ? error.message : "导出失败，请重试。",
    } satisfies PluginToUIMessage);
  } finally {
    exportInProgress = false;
  }
}

figma.showUI(__html__, { width: 460, height: 780, themeColors: true });
postSelection();
figma.on("selectionchange", postSelection);

figma.ui.onmessage = (message: UIToPluginMessage) => {
  if (message?.type === "selection:refresh") postSelection();
  if (message?.type === "handoff:generate") {
    if (exportInProgress) {
      figma.ui.postMessage({ type: "export:error", message: "已有导出任务正在进行，请稍候。" } satisfies PluginToUIMessage);
      return;
    }
    exportInProgress = true;
    void generateHandoff(message.config)
      .catch((error) => figma.ui.postMessage({ type: "export:error", message: error instanceof Error ? error.message : "生成交付内容失败，请重试。" } satisfies PluginToUIMessage))
      .finally(() => { exportInProgress = false; });
  }
  if (message?.type === "export:request") {
    if (message.format === "markdown" || message.format === "json" || message.format === "png") {
      void exportSelection(message.format);
    } else {
      figma.ui.postMessage({ type: "export:error", message: "不支持的导出格式。" } satisfies PluginToUIMessage);
    }
  }
};

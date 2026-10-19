export type MixedValue = "mixed";

export type ExportPaint = {
  type: string;
  visible?: boolean;
  opacity?: number | null;
  color?: { r: number | null; g: number | null; b: number | null; hex: string };
  gradientStops?: Array<{ position: number | null; color: { r: number | null; g: number | null; b: number | null; hex: string } }>;
  imageHash?: string;
  scaleMode?: string;
};

export type ExportText = {
  content: string;
  fontSize?: number | MixedValue | null;
  fontWeight?: number | MixedValue | null;
  fontFamily?: string | MixedValue;
  fontStyle?: string | MixedValue;
  horizontalAlignment?: string;
  verticalAlignment?: string;
};

export type ExportLayout = {
  mode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingTop?: number | null;
  paddingRight?: number | null;
  paddingBottom?: number | null;
  paddingLeft?: number | null;
  itemSpacing?: number | null;
  layoutWrap?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  clipsContent?: boolean;
};

export type ExportReaction = {
  trigger?: string;
  actions: Array<{ type?: string; destinationId?: string; navigation?: string; url?: string }>;
};

export type ExportNode = {
  id: string;
  name: string;
  type: string;
  position: { x: number | null; y: number | null };
  size: { width: number | null; height: number | null };
  visible: boolean;
  locked: boolean;
  opacity?: number | null;
  fills?: ExportPaint[] | MixedValue;
  strokes?: ExportPaint[] | MixedValue;
  strokeWeight?: number | MixedValue | null;
  cornerRadius?: number | Array<number | null> | MixedValue | null;
  text?: ExportText;
  layout?: ExportLayout;
  reactions?: ExportReaction[];
  omittedChildren?: number;
  component?: {
    mainComponentId?: string;
    mainComponentName?: string;
    properties?: Record<string, { type: string; value: string | boolean }>;
  };
  assetPaths?: string[];
  children: ExportNode[];
};

export type ExportPackageFile = { path: string; content: string | Uint8Array };

export type ExportDocument = {
  schemaVersion: "1.0.0";
  exportedAt: string;
  frames: ExportNode[];
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function escapeInline(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "未提供" : String(value);
}

function colorLabel(color: ExportPaint["color"]): string {
  if (!color) return "";
  return color.hex;
}

function paintLabel(paint: ExportPaint): string {
  const color = colorLabel(paint.color);
  const opacity = paint.opacity === undefined ? "" : `，不透明度 ${formatNumber(paint.opacity)}`;
  const colorSuffix = color ? ` ${color}` : "";
  const stops = paint.gradientStops?.length
    ? `（色标：${paint.gradientStops.map((stop) => `${formatNumber(stop.position)} ${stop.color.hex}`).join("，")}）`
    : "";
  const image = paint.imageHash ? `（图像资源：${paint.imageHash}）` : "";
  const hidden = paint.visible === false ? "（隐藏）" : "";
  return `${paint.type}${colorSuffix}${opacity}${stops}${image}${hidden}`;
}

function appendNode(lines: string[], node: ExportNode, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}- **${escapeInline(node.name || "（未命名）")}**（${escapeInline(node.type)}）`);
  lines.push(`${indent}  - ID：\`${escapeInline(node.id)}\``);
  lines.push(`${indent}  - 位置：(${formatNumber(node.position.x)}, ${formatNumber(node.position.y)})`);
  lines.push(`${indent}  - 尺寸：${formatNumber(node.size.width)} × ${formatNumber(node.size.height)} px`);
  if (node.opacity !== undefined) lines.push(`${indent}  - 不透明度：${formatNumber(node.opacity)}`);
  if (node.fills === "mixed") lines.push(`${indent}  - 填充：混合值（Figma 未提供单一填充）`);
  else if (node.fills?.length) lines.push(`${indent}  - 填充：${node.fills.map(paintLabel).map(escapeInline).join("；")}`);
  if (node.strokes === "mixed") lines.push(`${indent}  - 描边：混合值（Figma 未提供单一描边）`);
  else if (node.strokes?.length) lines.push(`${indent}  - 描边：${node.strokes.map(paintLabel).map(escapeInline).join("；")}`);
  if (node.strokeWeight !== undefined) lines.push(`${indent}  - 描边宽度：${node.strokeWeight === "mixed" ? "混合值" : formatNumber(node.strokeWeight)}`);
  if (node.cornerRadius !== undefined) {
    const radius = node.cornerRadius === "mixed" ? "混合值" : Array.isArray(node.cornerRadius) ? node.cornerRadius.map(formatNumber).join(" / ") : formatNumber(node.cornerRadius);
    lines.push(`${indent}  - 圆角：${radius} px`);
  }
  if (node.layout) {
    const layout = node.layout;
    lines.push(`${indent}  - 自动布局：${layout.mode ?? "未提供"}；主轴 ${layout.primaryAxisAlignItems ?? "未提供"}；交叉轴 ${layout.counterAxisAlignItems ?? "未提供"}`);
    lines.push(`${indent}  - 内边距：上 ${formatNumber(layout.paddingTop)} / 右 ${formatNumber(layout.paddingRight)} / 下 ${formatNumber(layout.paddingBottom)} / 左 ${formatNumber(layout.paddingLeft)} px`);
    lines.push(`${indent}  - 子项间距：${formatNumber(layout.itemSpacing)} px；换行 ${layout.layoutWrap ?? "未提供"}`);
    if (layout.layoutSizingHorizontal || layout.layoutSizingVertical) lines.push(`${indent}  - 尺寸模式：水平 ${layout.layoutSizingHorizontal ?? "未提供"}；垂直 ${layout.layoutSizingVertical ?? "未提供"}`);
  }

  if (node.text) {
    lines.push(`${indent}  - 文本内容：`);
    if (node.text.content.length === 0) {
      lines.push(`${indent}    - （空文本）`);
    } else {
      const fence = "`".repeat(Math.max(3, longestBacktickRun(node.text.content) + 1));
      lines.push(`${indent}    ${fence}text`);
      for (const textLine of node.text.content.split("\n")) lines.push(`${indent}    ${textLine}`);
      lines.push(`${indent}    ${fence}`);
    }
    const fontBits = [
      node.text.fontFamily && node.text.fontFamily !== "mixed" ? node.text.fontFamily : undefined,
      node.text.fontStyle && node.text.fontStyle !== "mixed" ? node.text.fontStyle : undefined,
    ].filter(Boolean).join(" ");
    lines.push(`${indent}  - 字体：${fontBits || "未提供"}`);
    lines.push(`${indent}  - 字号：${node.text.fontSize === "mixed" ? "混合值" : formatNumber(node.text.fontSize)}`);
    lines.push(`${indent}  - 字重：${node.text.fontWeight === "mixed" ? "混合值" : formatNumber(node.text.fontWeight)}`);
    lines.push(`${indent}  - 对齐：水平 ${node.text.horizontalAlignment ?? "未提供"}；垂直 ${node.text.verticalAlignment ?? "未提供"}`);
  }

  if (node.component) {
    const componentName = node.component.mainComponentName ? escapeInline(node.component.mainComponentName) : "未提供";
    const componentId = node.component.mainComponentId ? `（ID：\`${escapeInline(node.component.mainComponentId)}\`）` : "";
    lines.push(`${indent}  - 组件实例：主组件 ${componentName}${componentId}`);
    for (const [name, property] of Object.entries(node.component.properties ?? {})) {
      lines.push(`${indent}    - ${escapeInline(name)}（${escapeInline(property.type)}）：${escapeInline(String(property.value))}`);
    }
  }

  if (!node.visible) lines.push(`${indent}  - 可见性：隐藏`);
  if (node.locked) lines.push(`${indent}  - 锁定：是`);
  for (const reaction of node.reactions ?? []) {
    const trigger = reaction.trigger ?? "触发条件未提供";
    const actions = reaction.actions.map((action) => [action.type, action.navigation, action.destinationId ? `目标 ${action.destinationId}` : undefined, action.url].filter(Boolean).join(" / ")).join("；");
    lines.push(`${indent}  - 原型交互：${trigger}${actions ? ` → ${actions}` : ""}`);
  }
  if (node.omittedChildren) lines.push(`${indent}  - 其余子图层：${node.omittedChildren} 个（超过解析深度或被忽略）`);
  for (const assetPath of node.assetPaths ?? []) {
    lines.push(`${indent}  - 资源：[\`${escapeInline(assetPath)}\`](../${encodeURI(assetPath)})`);
  }
  if (node.children.length > 0) {
    lines.push(`${indent}  - 子图层：`);
    for (const child of node.children) appendNode(lines, child, depth + 2);
  }
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
}

export function createMarkdown(frame: ExportNode): string {
  const lines = [
    `# ${escapeInline(frame.name || "（未命名 Frame）")}`,
    "",
    `- **Frame ID：** \`${escapeInline(frame.id)}\``,
    `- **节点类型：** ${escapeInline(frame.type)}`,
    `- **宽高：** ${formatNumber(frame.size.width)} × ${formatNumber(frame.size.height)} px`,
    "",
    "## 图层树",
    "",
  ];
  appendNode(lines, frame, 0);
  return `${lines.join("\n")}\n`;
}

export function createProjectMarkdown(pageFiles: string[], assetPaths: string[], exportedAt = new Date().toISOString(), extraDocs: string[] = []): string {
  const lines = [
    "# 项目说明",
    "",
    "> 由 Agent导出助手自动生成。内容仅记录当前可从 Figma 文件读取的信息；未提供的产品目标、交互规则和设计规范不会被推测。",
    "",
    "## 项目概览",
    "",
    "- 目标：为 Agent 提供可追踪的 Figma 页面结构、基础样式和资源参考。",
    "- 数据来源：Figma Plugin API；交付包可包含当前页面中选中的多个 Frame。",
    "- 目标应用的技术栈、产品目标和全局设计规范：未从 Figma 页面数据中定义，实施前需从目标代码库或项目负责人确认。",
    "- 尺寸单位：像素；位置为相对父图层的 x/y。",
    "",
    "## 导出信息",
    "",
    `- 生成时间：${exportedAt}`,
    "- 来源：当前 Figma 页面中选中的 Frame；每个 Frame 对应一份独立页面文件",
    "- 页面数据：见 `pages/` 下对应的 Markdown 与 JSON 文件",
    "",
    "## Agent 执行规则",
    "",
    "- 实现页面前先阅读对应页面文件，并按图层 ID 对照结构。",
    "- 保留页面层级、尺寸、文本和明确导出的样式；缺失值不得自行当作设计事实。",
    "- 交互意图或全局规范未在导出数据中提供时，应标记为待确认，不要猜测。",
    "- 图片与 SVG 资源通过页面 Markdown 中的相对路径引用。",
    "- 当前未导出原型连线、交互行为、自动布局约束和设计变量；需要时应另行确认。",
    "",
    "## 页面索引",
    "",
    ...(pageFiles.length ? pageFiles.map((path) => {
      const jsonPath = path.replace(/\.md$/i, ".json");
      return `- [${path.split("/").pop()}](${encodeURI(path)}) · [JSON](${encodeURI(jsonPath)})`;
    }) : ["- 无页面文件"]),
    ...(extraDocs.length ? ["", "## 附加文档", "", ...extraDocs.map((path) => `- [${path.split("/").pop()}](${encodeURI(path)})`)] : []),
    "",
    "## 资源索引",
    "",
    "- 资源清单：[asset-manifest.json](asset-manifest.json)，包含路径、格式、文件大小与来源图层 ID。",
    ...(assetPaths.length ? assetPaths.map((path) => `- [${path.split("/").pop()}](${encodeURI(path)})`) : ["- 当前页面未导出可用的图片或 SVG 资源"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function makeFilename(name: string, nodeId: string, extension: "md" | "json" | "png" | "jpg" | "svg" | "pdf" | "zip"): string {
  const normalizedName = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/-+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[-. ]+$/g, "")
    .trim();
  const base = Array.from(normalizedName).slice(0, 50).join("") || "figma-frame";
  const uniqueId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(-20) || "frame";
  return `${base}-${uniqueId}.${extension}`;
}

export function sanitizeJson(value: unknown, seen = new WeakSet<object>()): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return undefined;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[循环引用已省略]";

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return "[不支持的对象已省略]";
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeJson(item, seen) ?? null);
    seen.delete(value);
    return result;
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeJson(item, seen);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  seen.delete(value);
  return result;
}

export function createExportDocument(frame: ExportNode, exportedAt = new Date().toISOString()): JsonValue {
  return sanitizeJson({ schemaVersion: "1.0.0", exportedAt, frames: [frame] }) ?? null;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (value.charCodeAt(index + 1) - 0xdc00);
      index += 1;
    }
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

export function createAssetManifest(
  files: ExportPackageFile[],
  frames: ExportNode[],
  exportedAt = new Date().toISOString(),
  additionalSources: Record<string, Array<{ nodeId: string; name: string; type: string }>> = {},
): string {
  const sourcesByPath = new Map<string, Array<{ nodeId: string; name: string; type: string }>>();
  const visit = (node: ExportNode) => {
    for (const path of node.assetPaths ?? []) {
      const sources = sourcesByPath.get(path) ?? [];
      if (!sources.some((source) => source.nodeId === node.id)) {
        sources.push({ nodeId: node.id, name: node.name, type: node.type });
      }
      sourcesByPath.set(path, sources);
    }
    node.children.forEach(visit);
  };
  frames.forEach(visit);
  for (const [path, sources] of Object.entries(additionalSources)) {
    const existing = sourcesByPath.get(path) ?? [];
    for (const source of sources) {
      if (!existing.some((item) => item.nodeId === source.nodeId)) existing.push(source);
    }
    sourcesByPath.set(path, existing);
  }

  const assets = files.map((file) => {
    const extension = file.path.split(".").pop()?.toLowerCase() ?? "unknown";
    const sizeBytes = typeof file.content === "string" ? utf8ByteLength(file.content) : file.content.byteLength;
    return {
      path: file.path,
      format: extension,
      sizeBytes,
      sources: sourcesByPath.get(file.path) ?? [],
    };
  });
  return `${JSON.stringify({ schemaVersion: "1.0.0", exportedAt, assetCount: assets.length, assets }, null, 2)}\n`;
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.byteLength >= signature.length && signature.every((value, index) => bytes[index] === value);
}

export function requireSelectedFrame<T extends { type: string }>(selection: readonly T[]): T {
  if (selection.length === 0) throw new Error("请先在画布中选择一个 Frame。");
  if (selection.length > 1) throw new Error("请只选择一个 Frame 后再导出。");
  if (selection[0].type !== "FRAME") throw new Error("当前选中节点不是 Frame，请选择一个 Frame 后再导出。");
  return selection[0];
}

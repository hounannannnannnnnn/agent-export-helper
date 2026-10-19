import { makeFilename, type ExportNode, type ExportPackageFile, type JsonValue } from "./export-data.ts";

export type DesignVariable = {
  id: string;
  name: string;
  description: string;
  resolvedType: string;
  scopes: string[];
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, JsonValue>;
};

export type DesignCollection = {
  id: string;
  name: string;
  defaultModeId: string;
  modes: Array<{ modeId: string; name: string }>;
  variables: DesignVariable[];
};

export type DesignStyle = {
  id: string;
  name: string;
  type: string;
  description: string;
  remote: boolean;
  properties: Record<string, JsonValue>;
};

export type DesignSnapshot = {
  collections: DesignCollection[];
  styles: DesignStyle[];
};

export type DesignPackageContext = {
  projectName: string;
  pageName: string;
  exportedAt: string;
  frames: ExportNode[];
  assets: string[];
  snapshot: DesignSnapshot;
  exportConfig: { detail: "compact" | "extended"; platform: "mobile" | "web" | "desktop"; assetMode: "settings" | "auto"; maxDepth: number; ignoreName: string; coordinateSort: boolean };
};

function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) result[key] = json(item);
    return result;
  }
  return null;
}

function slug(value: string): string {
  const encoded = Array.from(value.toLowerCase()).map((character) => {
    if (/[a-z0-9_-]/.test(character)) return character;
    if (/\s|\//.test(character)) return "-";
    return `u${character.codePointAt(0)?.toString(16) ?? "0"}`;
  }).join("");
  return encoded.replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "token";
}

function tokenName(collection: DesignCollection, variable: DesignVariable): string {
  return `--figma-${slug(collection.name)}-${slug(variable.name)}`;
}

function cssValue(value: JsonValue, byId: Map<string, string>): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return undefined;
  if (value && typeof value === "object") {
    if (value.type === "VARIABLE_ALIAS" && typeof value.id === "string") {
      const alias = byId.get(value.id);
      return alias ? `var(${alias})` : undefined;
    }
    if (typeof value.hex === "string") {
      if (typeof value.a === "number" && value.a < 1 && typeof value.r === "number" && typeof value.g === "number" && typeof value.b === "number") {
        return `rgba(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)}, ${Number(Math.max(0, Math.min(1, value.a)).toFixed(3))})`;
      }
      return value.hex;
    }
    if (value.color && typeof value.color === "object" && !Array.isArray(value.color)) {
      const color = value.color as Record<string, JsonValue>;
      const hex = typeof color.hex === "string" ? color.hex : undefined;
      const opacity = typeof value.opacity === "number" ? value.opacity : 1;
      if (hex && opacity < 1 && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
        return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${Number(Math.max(0, Math.min(1, opacity)).toFixed(3))})`;
      }
      return hex;
    }
  }
  return undefined;
}

function cssForMode(collection: DesignCollection, modeId: string, byId: Map<string, string>): string[] {
  return collection.variables.flatMap((variable) => {
    const value = variable.valuesByMode[modeId];
    if (value === undefined) return [];
    const css = cssValue(value, byId);
    return css === undefined ? [] : [`  ${tokenName(collection, variable)}: ${css};`];
  });
}

function createCssFiles(snapshot: DesignSnapshot): { variables: string; theme: string } {
  const byId = new Map<string, string>();
  for (const collection of snapshot.collections) {
    for (const variable of collection.variables) byId.set(variable.id, tokenName(collection, variable));
  }

  const baseLines = ["/* Generated from Figma local variables. Unavailable values are omitted. */", ":root {"];
  let baseCount = 0;
  for (const collection of snapshot.collections) {
    const declarations = cssForMode(collection, collection.defaultModeId, byId);
    baseLines.push(...declarations);
    baseCount += declarations.length;
  }
  if (!baseCount) baseLines.push("  /* No CSS-compatible local variable values were found in this file. */");
  baseLines.push("}", "");

  const themeLines = ["/* Mode overrides generated from Figma variable collections. */"];
  let overrideCount = 0;
  for (const collection of snapshot.collections) {
    const collectionSelector = slug(collection.name);
    for (const mode of collection.modes) {
      if (mode.modeId === collection.defaultModeId) continue;
      const declarations = cssForMode(collection, mode.modeId, byId);
      if (!declarations.length) continue;
      themeLines.push(`:root[data-figma-mode-${collectionSelector}="${mode.modeId}"] {`, ...declarations, "}", "");
      overrideCount += declarations.length;
    }
  }
  if (!overrideCount) themeLines.push("/* No non-default Figma variable modes were available. */", "");
  return { variables: baseLines.join("\n"), theme: themeLines.join("\n") };
}

function walkFrames(frames: ExportNode[], visit: (node: ExportNode) => void): void {
  const walk = (node: ExportNode) => { visit(node); node.children.forEach(walk); };
  frames.forEach(walk);
}

function createDesignMarkdown(context: DesignPackageContext): string {
  const paintStyles = context.snapshot.styles.filter((style) => style.type === "PAINT");
  const textStyles = context.snapshot.styles.filter((style) => style.type === "TEXT");
  const variableCount = context.snapshot.collections.reduce((sum, collection) => sum + collection.variables.length, 0);
  const colors = new Map<string, number>();
  const fonts = new Map<string, number>();
  const components: ExportNode[] = [];
  const spacing = new Map<string, number>();
  const radii = new Map<string, number>();
  walkFrames(context.frames, (node) => {
    const paints = [...(node.fills === "mixed" ? [] : node.fills ?? []), ...(node.strokes === "mixed" ? [] : node.strokes ?? [])];
    for (const paint of paints) if (paint.color?.hex) colors.set(paint.color.hex, (colors.get(paint.color.hex) ?? 0) + 1);
    if (node.text?.fontFamily && node.text.fontFamily !== "mixed") fonts.set(node.text.fontFamily, (fonts.get(node.text.fontFamily) ?? 0) + 1);
    if (node.component) components.push(node);
    if (node.layout) {
      for (const value of [node.layout.paddingTop, node.layout.paddingRight, node.layout.paddingBottom, node.layout.paddingLeft, node.layout.itemSpacing]) {
        if (typeof value === "number" && Number.isFinite(value)) spacing.set(String(value), (spacing.get(String(value)) ?? 0) + 1);
      }
    }
    const radiusValues = Array.isArray(node.cornerRadius) ? node.cornerRadius : typeof node.cornerRadius === "number" ? [node.cornerRadius] : [];
    for (const value of radiusValues) if (typeof value === "number" && Number.isFinite(value)) radii.set(String(value), (radii.get(String(value)) ?? 0) + 1);
  });
  const tokens = context.snapshot.collections.flatMap((collection) => collection.variables.map((variable) => ({ collection, variable })));
  const treeLines: string[] = [];
  const appendTree = (node: ExportNode, depth: number) => {
    treeLines.push(`${"  ".repeat(depth)}- ${node.name || "（未命名）"}（${node.type}，ID：\`${node.id}\`，${node.size.width ?? "未提供"} × ${node.size.height ?? "未提供"}）`);
    node.children.forEach((child) => appendTree(child, depth + 1));
  };
  context.frames.forEach((frame) => appendTree(frame, 0));
  const componentRows = components.map((node) => {
    const state = node.component?.properties && Object.keys(node.component.properties).length
      ? Object.entries(node.component.properties).map(([key, value]) => `${key}=${String(value.value)}`).join("；")
      : "未提供";
    return `| ${node.name.replace(/\|/g, "\\|")} | ${node.component?.mainComponentName ?? node.type} | ${node.size.width ?? "未提供"} × ${node.size.height ?? "未提供"} | ${state.replace(/\|/g, "\\|")} | \`${node.id}\` |`;
  });
  return [
    "# Design Spec",
    "",
    "> 本文档由 Figma 插件自动生成，内容来自本次导出的节点、Figma 本地变量与样式。未提供的数据会明确标注，不进行推断。",
    "",
    "## 1. 概览",
    "",
    `- 项目：${context.projectName || "未命名项目"}`,
    `- 页面：${context.pageName || "未命名页面"}`,
    `- 本次导出画板：${context.frames.length} 个（画板数不等于 Figma 文件全部页面数）`,
    `- 组件实例：${components.length} 个`,
    "- Figma 文件最后修改时间：Figma Plugin API 未提供该字段",
    `- 导出时间：${context.exportedAt}`,
    `- 本地变量：${variableCount} 个 / ${context.snapshot.collections.length} 个集合；本地样式：${context.snapshot.styles.length} 个（Paint ${paintStyles.length}，Text ${textStyles.length}）`,
    "",
    "## 2. Design Tokens",
    "",
    "### 颜色",
    "",
    ...(colors.size ? [...colors].sort((a, b) => b[1] - a[1]).map(([color, count]) => `- ${color}（${count} 处）`) : ["- 未读取到可识别的纯色填充或描边。"]),
    "",
    ...(tokens.filter(({ variable }) => variable.resolvedType === "COLOR").map(({ collection, variable }) => `- ${collection.name} / ${variable.name}：${JSON.stringify(variable.valuesByMode)}`)),
    "",
    "### 字体与字号",
    "",
    ...(fonts.size ? [...fonts].sort((a, b) => b[1] - a[1]).map(([font, count]) => `- ${font}（${count} 个文本图层）`) : ["- 未读取到字体信息。"]),
    ...tokens.filter(({ variable }) => variable.resolvedType === "STRING" || variable.resolvedType === "FLOAT").map(({ collection, variable }) => `- ${collection.name} / ${variable.name}（${variable.resolvedType}）：${JSON.stringify(variable.valuesByMode)}`),
    ...textStyles.map((style) => `- Figma 文本样式：${style.name}（属性见 tokens.json）`),
    "",
    "### 间距与圆角",
    "",
    `- 节点自动布局中观察到的间距/内边距：${spacing.size ? [...spacing].map(([value, count]) => `${value}px（${count} 处）`).join("、") : "未读取到"}`,
    `- 节点圆角：${radii.size ? [...radii].map(([value, count]) => `${value}px（${count} 处）`).join("、") : "未读取到"}`,
    "- 数值来自节点属性；变量值与模式请查看 tokens.json。",
    "",
    "## 3. 组件清单",
    "",
    "| 名称 | 组件 | 尺寸 | 状态/属性 | 图层 ID |",
    "| --- | --- | --- | --- | --- |",
    ...(componentRows.length ? componentRows : ["| 未读取到组件实例 | — | — | — | — |"]),
    "",
    "## 4. 页面结构",
    "",
    ...(treeLines.length ? treeLines : ["- 未读取到画板结构。"]),
    "",
    "## 5. 备注",
    "",
    `- 本包资源 ${context.assets.length} 个；清单见 asset-manifest.json，实体文件位于 assets/。`,
    `- 资源导出模式：${context.exportConfig.assetMode === "auto" ? "自动识别" : "仅 Figma Export 设置"}；细节：${context.exportConfig.detail}；目标平台：${context.exportConfig.platform}。`,
    `- 节点解析深度配置：${context.exportConfig.maxDepth}；忽略名称：${context.exportConfig.ignoreName || "未设置"}；坐标排序：${context.exportConfig.coordinateSort ? "开启" : "关闭"}。`,
    "- 完整图层属性与父子关系见 frames/ 和 ui-ir.json；变量各模式值见 tokens.json。",
    "- `variables.css` 使用默认模式下可映射的值；其他模式覆盖见 `theme.css`。",
    "- 交互意图仅在 Figma 原型数据可读取时导出，未提供的业务含义不会推测。",
    "",
  ].join("\n");
}

function createReadme(context: DesignPackageContext): string {
  return [
    `# ${context.projectName || "Figma 项目"}`,
    "",
    "## 简介",
    "",
    "本项目设计交付包由 Figma 插件自动生成，供 Agent 阅读页面结构、设计规范与资源引用。文档只记录 Figma 中实际读取到的数据。",
    "",
    "## 页面清单",
    "",
    ...(context.frames.length ? context.frames.flatMap((frame) => {
      const stem = makeFilename(frame.name, frame.id, "md").replace(/\.md$/i, "");
      return [`- [${frame.name || "未命名画板"} Markdown](frames/${encodeURI(stem)}.md) · [JSON](frames/${encodeURI(stem)}.json)（${frame.size.width ?? "未提供"} × ${frame.size.height ?? "未提供"}，ID：\`${frame.id}\`）`];
    }) : ["- 本次没有导出画板。"]),
    "",
    "## 设计规范引用",
    "",
    "全局设计规范、Design Tokens、组件清单与页面结构见 [DESIGN.md](DESIGN.md)。变量按模式的机器可读值见 [tokens.json](tokens.json)，CSS 映射见 [variables.css](variables.css) 与 [theme.css](theme.css)。",
    "",
    "## 导出方式 / 版本记录",
    "",
    "- 导出方式：Figma 桌面插件的「设计交付包」模式，生成 ZIP。",
    `- 来源页面：${context.pageName || "未命名页面"}`,
    `- 导出时间：${context.exportedAt}`,
    "- 数据结构版本：1.0.0（ui-ir.json、tokens.json）。",
    `- 配置：${context.exportConfig.detail} / ${context.exportConfig.platform} / ${context.exportConfig.assetMode} / 最大深度 ${context.exportConfig.maxDepth}。`,
    "- 资源引用：文档与 asset-manifest.json 使用 assets/ 相对路径；具体来源图层 ID 见资源清单。",
    "- 交付内容：00_AGENT_GUIDE.md、DESIGN.md、frames/、ui-ir.json、tokens.json、CSS 变量文件、asset-manifest.json 与 assets/。",
    "- 未被 Figma Plugin API 提供的字段会注明不可用，不以估算值补齐。",
    "",
  ].join("\n");
}

function createAgentGuide(context: DesignPackageContext): string {
  return [
    "# 00_AGENT_GUIDE",
    "",
    "> 本文件由 Figma 插件自动生成，供 Agent 快速理解本次设计交付。",
    "",
    "## 阅读顺序",
    "",
    "1. 阅读 `README.md` 了解交付包和数据边界。",
    "2. 阅读 `DESIGN.md` 查看从当前设计中汇总的视觉信息。",
    "3. 根据任务阅读 `frames/` 对应 Frame 的 Markdown；需要机器处理时读取同名 JSON 或 `ui-ir.json`。",
    "4. 使用 `tokens.json`、`variables.css` 和 `theme.css` 查阅真实 Figma 变量。",
    "5. 通过 `asset-manifest.json` 查找 `assets/` 中的切图。",
    "",
    "## 执行规则",
    "",
    "- 以 Frame / 图层 ID 和父子关系定位节点，不要依赖名称作为唯一标识。",
    "- 保留明确导出的尺寸、布局、文案、样式和组件关系。",
    "- 交互意图、业务逻辑或设计系统信息未提供时标记待确认，不要补造。",
    "- CSS 模式属性使用 `theme.css` 中对应 collection 的 `data-figma-mode-<collection>` 属性。",
    "",
    `- 本次页面：${context.pageName || "未命名页面"}`,
    `- 本次 Frame：${context.frames.length}`,
    `- 本次资源：${context.assets.length}`,
    `- 导出时间：${context.exportedAt}`,
    "",
  ].join("\n");
}

export function createDesignPackageFiles(context: DesignPackageContext): ExportPackageFile[] {
  const css = createCssFiles(context.snapshot);
  const uiIr = {
    schemaVersion: "1.0.0",
    kind: "figma-ui-ir",
    source: { projectName: context.projectName, pageName: context.pageName, exportedAt: context.exportedAt },
    frames: context.frames,
  };
  const tokens = {
    schemaVersion: "1.0.0",
    exportedAt: context.exportedAt,
    source: "Figma local variables and styles",
    collections: context.snapshot.collections,
    styles: context.snapshot.styles,
  };
  return [
    { path: "00_AGENT_GUIDE.md", content: createAgentGuide(context) },
    { path: "DESIGN.md", content: createDesignMarkdown(context) },
    { path: "README.md", content: createReadme(context) },
    { path: "theme.css", content: css.theme },
    { path: "tokens.json", content: `${JSON.stringify(json(tokens), null, 2)}\n` },
    { path: "ui-ir.json", content: `${JSON.stringify(json(uiIr), null, 2)}\n` },
    { path: "variables.css", content: css.variables },
  ];
}

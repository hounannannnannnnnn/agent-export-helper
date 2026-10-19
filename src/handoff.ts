import { createMarkdown, type ExportNode, type ExportPaint } from "./export-data.ts";
import type { HandoffConfig } from "./protocol.ts";

const platformLabels: Record<HandoffConfig["platform"], string> = {
  mobile: "Mobile",
  web: "Web",
  desktop: "Desktop",
};

function ignored(name: string, pattern: string): boolean {
  return Boolean(pattern.trim()) && name.toLocaleLowerCase().includes(pattern.trim().toLocaleLowerCase());
}

function countNodes(node: ExportNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

export function prepareHandoffFrame(frame: ExportNode, config: HandoffConfig): ExportNode {
  function clone(node: ExportNode, depth: number): ExportNode | undefined {
    if (depth > 0 && ignored(node.name, config.ignoreName)) return undefined;
    const copy: ExportNode = { ...node, children: [], assetPaths: node.assetPaths ? [...node.assetPaths] : undefined };
    const sourceChildren = [...node.children];
    if (config.coordinateSort) {
      sourceChildren.sort((a, b) => (a.position.y ?? 0) - (b.position.y ?? 0) || (a.position.x ?? 0) - (b.position.x ?? 0));
    }
    if (depth >= Math.max(1, config.maxDepth)) {
      if (sourceChildren.length) {
        const retained = sourceChildren.filter((child) => !ignored(child.name, config.ignoreName));
        copy.omittedChildren = retained.reduce((total, child) => total + countNodes(child), 0) + sourceChildren.length - retained.length;
      }
      return copy;
    }
    for (const child of sourceChildren) {
      const prepared = clone(child, depth + 1);
      if (prepared) copy.children.push(prepared);
    }
    const omitted = sourceChildren.length - copy.children.length;
    if (omitted > 0) copy.omittedChildren = omitted;
    return copy;
  }
  return clone(frame, 0) ?? { ...frame, children: [] };
}

function cssColor(paint: ExportPaint): string | undefined {
  const color = paint.color;
  if (!color) return undefined;
  const alpha = Math.max(0, Math.min(1, paint.opacity ?? 1));
  if (alpha >= 1) return color.hex;
  const channels = [color.r, color.g, color.b].map((channel) => Math.round((channel ?? 0) * 255));
  return `rgba(${channels.join(", ")}, ${Number(alpha.toFixed(3))})`;
}

function firstSolidPaint(paints: ExportNode["fills"] | ExportNode["strokes"]): string | undefined {
  if (!paints || paints === "mixed") return undefined;
  const solid = paints.find((paint) => paint.type === "SOLID" && paint.visible !== false);
  return solid ? cssColor(solid) : undefined;
}

export function cssDeclarations(node: ExportNode): string[] {
  const declarations: string[] = [];
  const add = (property: string, value: string | number | null | undefined) => {
    if (value !== undefined && value !== null && value !== "") declarations.push(`  ${property}: ${value};`);
  };
  add("width", node.size.width === null ? undefined : `${node.size.width}px`);
  add("height", node.size.height === null ? undefined : `${node.size.height}px`);
  add("left", node.position.x === null ? undefined : `${node.position.x}px`);
  add("top", node.position.y === null ? undefined : `${node.position.y}px`);
  if (typeof node.opacity === "number" && node.opacity < 1) add("opacity", node.opacity);
  add("background", firstSolidPaint(node.fills));
  const stroke = firstSolidPaint(node.strokes);
  if (stroke) add("border", `${node.strokeWeight && node.strokeWeight !== "mixed" ? node.strokeWeight : 1}px solid ${stroke}`);
  if (typeof node.cornerRadius === "number") add("border-radius", `${node.cornerRadius}px`);
  else if (Array.isArray(node.cornerRadius) && node.cornerRadius.length === 4 && node.cornerRadius.every((value) => value !== null)) {
    add("border-radius", `${node.cornerRadius.map((value) => `${value}px`).join(" ")}`);
  }
  if (node.layout?.mode === "HORIZONTAL" || node.layout?.mode === "VERTICAL") {
    add("display", "flex");
    add("flex-direction", node.layout.mode === "HORIZONTAL" ? "row" : "column");
    add("gap", node.layout.itemSpacing === null || node.layout.itemSpacing === undefined ? undefined : `${node.layout.itemSpacing}px`);
    add("padding", [node.layout.paddingTop, node.layout.paddingRight, node.layout.paddingBottom, node.layout.paddingLeft]
      .every((value) => typeof value === "number")
      ? `${node.layout.paddingTop}px ${node.layout.paddingRight}px ${node.layout.paddingBottom}px ${node.layout.paddingLeft}px`
      : undefined);
    const align: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
    add("justify-content", align[node.layout.primaryAxisAlignItems ?? ""]);
    add("align-items", align[node.layout.counterAxisAlignItems ?? ""]);
  }
  if (node.text) {
    if (typeof node.text.fontSize === "number") add("font-size", `${node.text.fontSize}px`);
    if (typeof node.text.fontWeight === "number") add("font-weight", node.text.fontWeight);
    if (node.text.fontFamily && node.text.fontFamily !== "mixed") add("font-family", `\"${node.text.fontFamily.replace(/[\"\\]/g, "\\$&")}\"`);
    if (node.text.horizontalAlignment) add("text-align", node.text.horizontalAlignment.toLowerCase());
    add("color", firstSolidPaint(node.fills));
  }
  return declarations;
}

function compactNode(lines: string[], node: ExportNode, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}- **${node.name || "（未命名）"}** · ${node.type} · ID \`${node.id}\` · x/y ${node.position.x ?? "?"}/${node.position.y ?? "?"} · ${node.size.width ?? "?"}×${node.size.height ?? "?"} px`);
  if (node.fills === "mixed") lines.push(`${indent}  - 填充：混合值`);
  else if (node.fills?.length) lines.push(`${indent}  - 填充：${node.fills.map((paint) => paint.color?.hex ?? (paint.imageHash ? `图片 ${paint.imageHash}` : paint.type)).join("、")}`);
  if (node.strokes === "mixed") lines.push(`${indent}  - 描边：混合值`);
  else if (node.strokes?.length) lines.push(`${indent}  - 描边：${node.strokes.map((paint) => paint.color?.hex ?? paint.type).join("、")}`);
  if (node.cornerRadius !== undefined) lines.push(`${indent}  - 圆角：${Array.isArray(node.cornerRadius) ? node.cornerRadius.join(" / ") : node.cornerRadius} px`);
  if (node.layout) lines.push(`${indent}  - 布局：${node.layout.mode}，间距 ${node.layout.itemSpacing ?? "未提供"} px，内边距 ${node.layout.paddingTop ?? "?"}/${node.layout.paddingRight ?? "?"}/${node.layout.paddingBottom ?? "?"}/${node.layout.paddingLeft ?? "?"}`);
  if (node.text) {
    const text = node.text.content ? `「${node.text.content.replace(/\n/g, " / ")}」` : "（空文本）";
    const font = [node.text.fontFamily !== "mixed" ? node.text.fontFamily : undefined, node.text.fontSize !== "mixed" ? node.text.fontSize : undefined, node.text.fontWeight !== "mixed" ? node.text.fontWeight : undefined].filter((value) => value !== undefined).join(" / ");
    lines.push(`${indent}  - 文本：${text}${font ? `（${font}）` : ""}`);
  }
  if (node.component) lines.push(`${indent}  - 组件：${node.component.mainComponentName ?? "实例"}`);
  const css = cssDeclarations(node).map((line) => line.trim().replace(/;$/, "")).join("; ");
  if (css) lines.push(`${indent}  - CSS：\`${css}\``);
  if (node.reactions?.length) lines.push(`${indent}  - 原型交互：${node.reactions.map((reaction) => `${reaction.trigger ?? "未提供触发器"}${reaction.actions.map((action) => action.destinationId ? ` → ${action.destinationId}` : action.url ? ` → ${action.url}` : "").join("")}`).join("；")}`);
  for (const asset of node.assetPaths ?? []) lines.push(`${indent}  - 资源：[\`${asset}\`](../${encodeURI(asset)})`);
  if (node.omittedChildren) lines.push(`${indent}  - 已省略 ${node.omittedChildren} 个后代图层`);
  for (const child of node.children) compactNode(lines, child, depth + 1);
}

function cssBlock(frame: ExportNode): string[] {
  const lines: string[] = [];
  const visit = (node: ExportNode) => {
    const declarations = cssDeclarations(node);
    if (declarations.length) {
      lines.push(`/* ${node.name.replace(/[\r\n*]/g, " ")} · ${node.id} */`);
      lines.push(`[data-figma-id="${node.id.replace(/[\"\\]/g, "\\$&")}"] {`);
      lines.push(...declarations);
      lines.push("}", "");
    }
    node.children.forEach(visit);
  };
  visit(frame);
  return lines;
}

export function createHandoffMarkdown(frames: ExportNode[], config: HandoffConfig, fileKey: string | undefined, pageName: string, exportedAt: string): string {
  const lines = [
    `# Figma Agent Handoff · ${pageName || "当前页面"}`,
    "",
    `- 导出时间：${exportedAt}`,
    `- 当前页面：${pageName || "未命名页面"}`,
    `- 选中画板：${frames.length}`,
    `- 导出模式：${config.mode === "delivery" ? "设计交付包" : "Frame Node URL"}`,
    `- 详细程度：${config.detail === "compact" ? "Compact" : "Extended"}`,
    `- 目标平台：${platformLabels[config.platform]} · CSS` ,
    `- 解析深度：${Math.max(1, config.maxDepth)}`,
    `- 资源策略：${config.assetMode === "settings" ? "仅导出面板配置" : "自动识别"}`,
    `- 忽略图层名包含：${config.ignoreName.trim() || "无"}`,
    `- 坐标排序：${config.coordinateSort ? "开启（从上到下、从左到右）" : "关闭（保留 Figma 图层顺序）"}`,
    "",
    "## Agent 规则",
    "",
    "- 以节点 ID 和父子关系定位图层；尺寸与坐标单位为 px，坐标相对父节点。",
    "- 未导出的交互、业务语义、断点和设计令牌属于未知信息，不要臆造。",
    "- 资源链接相对页面 Markdown 文件；忽略规则匹配的图层及其子树不参与输出。",
    "",
  ];

  if (config.mode === "node-url") {
    lines.push("## Frame Node URL", "");
    for (const frame of frames) {
      const nodeId = frame.id.replace(/:/g, "-");
      const url = fileKey ? `https://www.figma.com/design/${encodeURIComponent(fileKey)}?node-id=${encodeURIComponent(nodeId)}` : "（当前文件未提供 file key）";
      lines.push(`- **${frame.name}** · \`${frame.id}\` · ${frame.size.width ?? "?"}×${frame.size.height ?? "?"} px · ${url}`);
    }
    return `${lines.join("\n")}\n`;
  }

  lines.push("## 页面索引", "");
  frames.forEach((frame, index) => lines.push(`${index + 1}. [${frame.name || "未命名 Frame"}](#${index + 1}-${frame.id.replace(/[^\p{L}\p{N}-]/gu, "-")}) · \`${frame.id}\` · ${frame.size.width ?? "?"}×${frame.size.height ?? "?"} px`));
  lines.push("");

  frames.forEach((frame, index) => {
    lines.push(`## ${index + 1}. ${frame.name || "未命名 Frame"}`, "", `- Frame ID：\`${frame.id}\``, `- 尺寸：${frame.size.width ?? "?"} × ${frame.size.height ?? "?"} px`, "", "### 图层结构", "");
    if (config.detail === "extended") lines.push(createMarkdown(frame).replace(/^# .*\n/, ""));
    else compactNode(lines, frame, 0);
    if (config.detail === "extended") {
      lines.push("", "### CSS 参考", "", "```css", ...cssBlock(frame), "```", "");
    }
  });
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function createExtendedDebugMarkdown(frames: ExportNode[], exportedAt: string): string {
  const lines = [
    "# Extended export diagnostics",
    "",
    `- Generated at: ${exportedAt}`,
    `- Frames: ${frames.length}`,
    "",
    "## Frame diagnostics",
    "",
  ];
  for (const frame of frames) {
    const nodes: ExportNode[] = [];
    const visit = (node: ExportNode) => { nodes.push(node); node.children.forEach(visit); };
    visit(frame);
    const typeCounts = new Map<string, number>();
    for (const node of nodes) typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
    const mixedCount = nodes.filter((node) => node.fills === "mixed" || node.strokes === "mixed" || node.cornerRadius === "mixed" || node.text?.fontSize === "mixed").length;
    const hiddenCount = nodes.filter((node) => !node.visible).length;
    const truncatedCount = nodes.reduce((total, node) => total + (node.omittedChildren ?? 0), 0);
    lines.push(`### ${frame.name}`, "", `- Frame ID: \`${frame.id}\``, `- Included nodes: ${nodes.length}`, `- Hidden nodes: ${hiddenCount}`, `- Nodes with mixed style values: ${mixedCount}`, `- Omitted child layers at depth limit: ${truncatedCount}`, `- Node types: ${[...typeCounts].map(([type, count]) => `${type} ${count}`).join(", ")}`, "");
  }
  lines.push("## Data caveats", "", "This file reports extraction diagnostics only. Missing Figma properties are not inferred. Prototype conditions, variable mode resolution, and implementation behavior beyond the exported reaction summary remain outside the exported data.", "");
  return `${lines.join("\n")}\n`;
}

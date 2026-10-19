import type { HandoffConfig, PluginToUIMessage, SelectionInfo, UIToPluginMessage } from "./protocol";

const selectionSummary = document.querySelector<HTMLElement>("#selection-summary");
const selectionNames = document.querySelector<HTMLElement>("#selection-names");
const status = document.querySelector<HTMLElement>("#status");
const resultSection = document.querySelector<HTMLElement>("#result");
const resultPreview = document.querySelector<HTMLTextAreaElement>("#markdown-preview");
const generateButton = document.querySelector<HTMLButtonElement>("#generate");
const copyButton = document.querySelector<HTMLButtonElement>("#copy-markdown");
const markdownButton = document.querySelector<HTMLButtonElement>("#download-markdown");
const assetsButton = document.querySelector<HTMLButtonElement>("#download-assets");
const legacyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-legacy-export]"));
const defaultConfig: HandoffConfig = {
  mode: "delivery",
  detail: "compact",
  maxDepth: 4,
  platform: "mobile",
  assetMode: "auto",
  ignoreName: "IGNORE",
  coordinateSort: true,
};

let selections: SelectionInfo[] = [];
let latestMarkdown = "";
let markdownFilename = "figma-handoff.md";
let resourceZip: Uint8Array | undefined;
let resourceFilename = "figma-resources.zip";

function post(message: UIToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function selectedRadio<T extends string>(name: string, fallback: T): T {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value as T ?? fallback;
}

function readConfig(): HandoffConfig {
  return {
    mode: selectedRadio("mode", defaultConfig.mode),
    detail: selectedRadio("detail", defaultConfig.detail),
    maxDepth: Number(document.querySelector<HTMLInputElement>("#max-depth")?.value) || defaultConfig.maxDepth,
    platform: document.querySelector<HTMLSelectElement>("#platform")?.value as HandoffConfig["platform"] ?? defaultConfig.platform,
    assetMode: selectedRadio("asset-mode", defaultConfig.assetMode),
    ignoreName: document.querySelector<HTMLInputElement>("#ignore-name")?.value ?? defaultConfig.ignoreName,
    coordinateSort: Boolean(document.querySelector<HTMLInputElement>("#coordinate-sort")?.checked),
    fileKey: document.querySelector<HTMLInputElement>("#file-key")?.value.trim() || undefined,
  };
}

function updateSummary(): void {
  const config = readConfig();
  const mode = config.mode === "delivery" ? "设计交付包" : "Frame Node URL";
  const detail = config.detail === "compact" ? "Compact" : "Extended";
  const assets = config.assetMode === "settings" ? "Export settings" : "Auto assets";
  const platform = { mobile: "Mobile", web: "Web", desktop: "Desktop" }[config.platform];
  const summary = document.querySelector<HTMLElement>("#config-summary");
  if (summary) summary.textContent = `${platform} · ${detail} · Parse Depth ${config.maxDepth} · CSS · Asset ${assets} · 忽略 ${config.ignoreName || "无"} · 坐标排序 ${config.coordinateSort ? "开启" : "关闭"}`;
  const assetsField = document.querySelector<HTMLElement>("#asset-settings");
  if (assetsField) assetsField.hidden = config.mode === "node-url";
  const fileKeyRow = document.querySelector<HTMLElement>("#file-key-row");
  if (fileKeyRow) fileKeyRow.hidden = config.mode !== "node-url";
  const fileKeyHelp = document.querySelector<HTMLElement>("#file-key-help");
  if (fileKeyHelp) fileKeyHelp.hidden = config.mode !== "node-url";
  if (assetsButton) assetsButton.hidden = config.mode === "node-url";
}

function renderSelection(pageName: string, fileKey: string | null, nextSelections: SelectionInfo[]): void {
  selections = nextSelections;
  const fileKeyInput = document.querySelector<HTMLInputElement>("#file-key");
  if (fileKey && fileKeyInput && !fileKeyInput.value) fileKeyInput.value = fileKey;
  const frames = selections.filter((selection) => selection.type === "FRAME");
  if (selectionSummary) {
    if (!selections.length) selectionSummary.textContent = `“${pageName}”页面当前没有选中节点。请在画布中多选一个或多个 Frame。`;
    else selectionSummary.textContent = `已选中 ${frames.length} 个 Frame${selections.length > frames.length ? `（另有 ${selections.length - frames.length} 个非 Frame 节点将跳过）` : ""}`;
  }
  if (selectionNames) {
    const shown = frames.slice(0, 8).map((frame) => `<li>${html(frame.name)} <span>${frame.width} × ${frame.height} · ${html(frame.id)}</span></li>`);
    if (frames.length > 8) shown.push(`<li class="muted">另有 ${frames.length - 8} 个 Frame…</li>`);
    selectionNames.innerHTML = shown.length ? shown.join("") : '<li class="muted">尚未选择 Frame</li>';
  }
  if (generateButton) generateButton.disabled = frames.length === 0;
}

function setBusy(busy: boolean): void {
  if (generateButton) generateButton.disabled = busy || selections.every((selection) => selection.type !== "FRAME");
  legacyButtons.forEach((button) => { button.disabled = busy; });
  if (copyButton) copyButton.disabled = busy || !latestMarkdown;
  if (markdownButton) markdownButton.disabled = busy || !latestMarkdown;
  if (assetsButton) assetsButton.disabled = busy || !resourceZip;
}

function saveFile(filename: string, mimeType: string, content: string | Uint8Array): void {
  const blob = typeof content === "string"
    ? new Blob([content], { type: mimeType })
    : new Blob([content.slice().buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function copyMarkdown(): Promise<void> {
  if (!latestMarkdown) return;
  try {
    await navigator.clipboard.writeText(latestMarkdown);
  } catch {
    resultPreview?.focus();
    resultPreview?.select();
    if (!document.execCommand("copy")) throw new Error("剪贴板不可用，请手动复制下方 Markdown。");
  }
  if (status) status.textContent = "Markdown 已复制到剪贴板。";
}

window.addEventListener("message", (event: MessageEvent<{ pluginMessage?: PluginToUIMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;
  if (message.type === "selection:update") renderSelection(message.pageName, message.fileKey, message.selections);
  if (message.type === "handoff:progress") {
    if (status) status.textContent = message.message;
  }
  if (message.type === "handoff:complete") {
    latestMarkdown = message.markdown;
    markdownFilename = message.markdownFilename;
    resourceZip = message.resourceZip;
    resourceFilename = message.resourceFilename ?? "figma-resources.zip";
    if (resultPreview) resultPreview.value = latestMarkdown;
    if (resultSection) resultSection.hidden = false;
    if (copyButton) copyButton.disabled = false;
    if (markdownButton) markdownButton.disabled = false;
    if (assetsButton) assetsButton.disabled = !resourceZip;
    if (status) status.textContent = `完成：${message.frameCount} 个画板，${message.assetCount} 个资源。可复制或下载 Markdown${message.resourceZip ? "，并下载资源 ZIP" : "。Node URL 模式不打包资源"}`;
    setBusy(false);
  }
  if (message.type === "error" || message.type === "export:error") {
    if (status) status.textContent = `失败：${message.message}`;
    setBusy(false);
  }
  if (message.type === "export:complete") {
    try {
      saveFile(message.filename, message.mimeType, message.content);
      if (status) status.textContent = `已下载：${message.filename}`;
    } catch (error) {
      if (status) status.textContent = `下载失败：${error instanceof Error ? error.message : "请重试"}`;
    } finally {
      setBusy(false);
    }
  }
});

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((control) => control.addEventListener("input", updateSummary));
document.querySelector("#generate")?.addEventListener("click", () => {
  setBusy(true);
  if (status) status.textContent = "正在准备导出…";
  if (resultSection) resultSection.hidden = true;
  post({ type: "handoff:generate", config: readConfig() });
});
copyButton?.addEventListener("click", () => { void copyMarkdown().catch((error) => { if (status) status.textContent = error.message; }); });
markdownButton?.addEventListener("click", () => {
  try { saveFile(markdownFilename, "text/markdown;charset=utf-8", latestMarkdown); }
  catch (error) { if (status) status.textContent = `下载失败：${error instanceof Error ? error.message : "请重试"}`; }
});
assetsButton?.addEventListener("click", () => {
  if (!resourceZip) return;
  try { saveFile(resourceFilename, "application/zip", resourceZip); }
  catch (error) { if (status) status.textContent = `资源包下载失败：${error instanceof Error ? error.message : "请重试"}`; }
});
legacyButtons.forEach((button) => button.addEventListener("click", () => {
  const format = button.dataset.legacyExport;
  if (format !== "markdown" && format !== "json" && format !== "png") return;
  setBusy(true);
  if (status) status.textContent = `正在导出 ${format.toUpperCase()}…`;
  post({ type: "export:request", format });
}));

document.querySelector("#selection-refresh")?.addEventListener("click", () => post({ type: "selection:refresh" }));
updateSummary();
post({ type: "selection:refresh" });

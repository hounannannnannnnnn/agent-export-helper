import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssetManifest,
  createExportDocument,
  createMarkdown,
  createProjectMarkdown,
  hasPngSignature,
  makeFilename,
  requireSelectedFrame,
  sanitizeJson,
  type ExportNode,
} from "../src/export-data.ts";
import { createZip } from "../src/zip.ts";
import { createDesignPackageFiles, type DesignSnapshot } from "../src/design-output.ts";
import { isIconCandidate } from "../src/icon-detection.ts";
import { createExtendedDebugMarkdown, createHandoffMarkdown, cssDeclarations, prepareHandoffFrame } from "../src/handoff.ts";
import type { HandoffConfig } from "../src/protocol.ts";

const handoffConfig: HandoffConfig = {
  mode: "delivery",
  detail: "compact",
  maxDepth: 4,
  platform: "mobile",
  assetMode: "auto",
  ignoreName: "IGNORE",
  coordinateSort: true,
};

const frameFixture: ExportNode = {
  id: "5:10",
  name: "中文 Frame / 首页",
  type: "FRAME",
  position: { x: 12, y: 24 },
  size: { width: 390, height: 844 },
  visible: true,
  locked: false,
  opacity: 1,
  fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0, hex: "#ff8000" }, opacity: 1 }],
  strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, hex: "#000000" }, opacity: 0.5 }],
  cornerRadius: [12, 12, 0, 0],
  children: [
    {
      id: "5:11",
      name: "标题 `你好`",
      type: "TEXT",
      position: { x: 16, y: 20 },
      size: { width: 200, height: 32 },
      visible: true,
      locked: false,
      text: {
        content: "你好，Figma!\n第二行",
        fontSize: 24,
        fontWeight: 700,
        fontFamily: "Noto Sans SC",
        fontStyle: "Bold",
        horizontalAlignment: "LEFT",
        verticalAlignment: "CENTER",
      },
      children: [],
    },
    {
      id: "5:12",
      name: "Empty text",
      type: "TEXT",
      position: { x: 0, y: 60 },
      size: { width: 50, height: 20 },
      visible: true,
      locked: false,
      text: { content: "", fontSize: "mixed", fontWeight: "mixed" },
      children: [],
    },
    {
      id: "5:13",
      name: "按钮实例",
      type: "INSTANCE",
      position: { x: 0, y: 100 },
      size: { width: 100, height: 40 },
      visible: true,
      locked: false,
      component: {
        mainComponentId: "1:2",
        mainComponentName: "Button / Primary",
        properties: { "Label#1": { type: "TEXT", value: "确定" } },
      },
      children: [],
    },
  ],
};

test("Markdown includes frame identity, geometry, styles, text and component information", () => {
  const markdown = createMarkdown(frameFixture);
  assert.match(markdown, /Frame ID：.*5:10/);
  assert.match(markdown, /390 × 844 px/);
  assert.match(markdown, /#ff8000/);
  assert.match(markdown, /圆角：12 \/ 12 \/ 0 \/ 0 px/);
  assert.match(markdown, /字号：24/);
  assert.match(markdown, /字重：700/);
  assert.match(markdown, /水平 LEFT；垂直 CENTER/);
  assert.match(markdown, /你好，Figma!/);
  assert.match(markdown, /（空文本）/);
  assert.match(markdown, /Button \/ Primary/);
  assert.match(markdown, /Label\\#1（TEXT）：确定/);
  assert.match(markdown, /子图层：\n    - \*\*标题/);
});

test("Agent package docs provide concise project rules, page links, and relative asset references", () => {
  const node = { ...frameFixture, assetPaths: ["assets/images/封面.png"] };
  const markdown = createMarkdown(node);
  const project = createProjectMarkdown(["pages/首页-5-10.md"], ["assets/images/封面.png"], "2026-10-16T00:00:00.000Z");
  assert.match(markdown, /\.\.\/assets\/images\/%E5%B0%81%E9%9D%A2\.png/);
  assert.match(project, /Agent 执行规则/);
  assert.match(project, /pages\/.*\.json/);
  assert.match(project, /assets\/images\/.*\.png/);
  assert.match(project, /不会被推测/);
});

test("asset manifest records exported file sizes and source layer identity", () => {
  const frame = {
    ...frameFixture,
    assetPaths: ["assets/icons/close.svg", "assets/icons/close.png"],
  };
  const manifest = JSON.parse(createAssetManifest(
    [
      { path: "assets/icons/close.svg", content: "<svg/>" },
      { path: "assets/icons/close.png", content: new Uint8Array([1, 2, 3]) },
    ],
    [frame],
    "2026-10-19T00:00:00.000Z",
  ));
  assert.equal(manifest.assetCount, 2);
  assert.deepEqual(manifest.assets.map((asset: { format: string }) => asset.format), ["svg", "png"]);
  assert.equal(manifest.assets[1].sizeBytes, 3);
  assert.equal(manifest.assets[0].sources[0].nodeId, frame.id);
});

test("icon recognition covers vector paths, named icon components, and compact vector groups", () => {
  assert.equal(isIconCandidate({ type: "VECTOR", name: "Vector 12", width: 24, height: 24 }), true);
  assert.equal(isIconCandidate({ type: "INSTANCE", name: "Action / Search", width: 24, height: 24 }), true);
  assert.equal(isIconCandidate({
    type: "GROUP",
    name: "Group 24",
    width: 20,
    height: 20,
    children: [{ type: "VECTOR", name: "Path", width: 20, height: 20 }],
  }), true);
  assert.equal(isIconCandidate({ type: "FRAME", name: "Search results page", width: 390, height: 844 }), false);
  assert.equal(isIconCandidate({ type: "TEXT", name: "Icon", width: 24, height: 24 }), false);
});

test("design package restores all reference artifacts and derives tokens and CSS from Figma values", () => {
  const snapshot: DesignSnapshot = {
    collections: [{
      id: "collection:1",
      name: "颜色 / Colors",
      defaultModeId: "mode:light",
      modes: [{ modeId: "mode:light", name: "Light" }, { modeId: "mode:dark", name: "Dark" }],
      variables: [{
        id: "variable:primary",
        name: "主色 / Primary",
        description: "",
        resolvedType: "COLOR",
        scopes: ["ALL_SCOPES"],
        codeSyntax: {},
        valuesByMode: {
          "mode:light": { hex: "#336699", r: 0.2, g: 0.4, b: 0.6 },
          "mode:dark": { hex: "#112233", r: 0.07, g: 0.13, b: 0.2 },
        },
      }],
    }],
    styles: [],
  };
  const files = createDesignPackageFiles({
    projectName: "示例项目",
    pageName: "示例页面",
    exportedAt: "2026-10-19T00:00:00.000Z",
    frames: [frameFixture],
    assets: ["assets/images/切图.png"],
    snapshot,
    exportConfig: { detail: "compact", platform: "mobile", assetMode: "auto", maxDepth: 4, ignoreName: "IGNORE", coordinateSort: true },
  });
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  for (const path of ["00_AGENT_GUIDE.md", "DESIGN.md", "README.md", "theme.css", "tokens.json", "ui-ir.json", "variables.css"]) {
    assert.ok(byPath.has(path), `missing ${path}`);
  }
  assert.match(String(byPath.get("variables.css")), /#336699/);
  assert.match(String(byPath.get("theme.css")), /data-figma-mode-/);
  const tokens = JSON.parse(String(byPath.get("tokens.json")));
  const ir = JSON.parse(String(byPath.get("ui-ir.json")));
  assert.equal(tokens.collections[0].variables[0].valuesByMode["mode:dark"].hex, "#112233");
  assert.equal(ir.frames[0].id, frameFixture.id);
  assert.match(String(byPath.get("00_AGENT_GUIDE.md")), /frames\//);
  assert.match(String(byPath.get("DESIGN.md")), /# Design Spec/);
  assert.match(String(byPath.get("DESIGN.md")), /#ff8000/);
  assert.match(String(byPath.get("DESIGN.md")), /组件清单/);
  assert.match(String(byPath.get("DESIGN.md")), /页面结构/);
  assert.match(String(byPath.get("DESIGN.md")), /Figma Plugin API 未提供/);
  assert.match(String(byPath.get("README.md")), /# 示例项目/);
  assert.match(String(byPath.get("README.md")), /frames\/.*\.json/);
  assert.match(String(byPath.get("README.md")), /数据结构版本：1\.0\.0/);
});

test("ZIP package writes UTF-8 paths, binary assets, and valid archive structure", () => {
  const archive = createZip([
    { path: "PROJECT.md", content: "项目说明" },
    { path: "assets/icons/图标.svg", content: "<svg/>" },
    { path: "assets/images/image.png", content: new Uint8Array([0, 1, 2, 255]) },
  ]);
  assert.equal(new DataView(archive.buffer, archive.byteOffset).getUint32(0, true), 0x04034b50);
  assert.ok(Array.from(archive).some((value, index) => value === 0x50 && archive[index + 1] === 0x4b && archive[index + 2] === 0x05 && archive[index + 3] === 0x06));
  assert.ok(new TextDecoder().decode(archive).includes("assets/icons/图标.svg"));
  assert.throws(() => createZip([{ path: "../escape", content: "x" }]), /路径无效/);
  assert.throws(() => createZip([{ path: "same", content: "a" }, { path: "same", content: "b" }]), /重复文件路径/);
});

test("handoff applies ignored layer names, parse depth, and coordinate sorting", () => {
  const frame: ExportNode = {
    ...frameFixture,
    children: [
      { ...frameFixture.children[2], position: { x: 30, y: 50 }, children: [{ ...frameFixture.children[0], id: "deep:1" }] },
      { ...frameFixture.children[0], id: "ignore:1", name: "IGNORE: helper layer" },
      { ...frameFixture.children[1], position: { x: 1, y: 20 } },
    ],
  };
  const prepared = prepareHandoffFrame(frame, { ...handoffConfig, maxDepth: 1 });
  assert.deepEqual(prepared.children.map((node) => node.id), ["5:12", "5:13"]);
  assert.equal(prepared.children[1].children.length, 0);
  assert.equal(prepared.children[1].omittedChildren, 1);
});

test("handoff generates Node URLs, extended CSS, and CSS layout declarations from real model fields", () => {
  const frame: ExportNode = {
    ...frameFixture,
    layout: { mode: "HORIZONTAL", itemSpacing: 12, paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8 },
  };
  const css = cssDeclarations(frame);
  assert.ok(css.some((line) => line.includes("display: flex;")));
  assert.ok(css.some((line) => line.includes("gap: 12px;")));
  const nodeUrlMarkdown = createHandoffMarkdown([frame], { ...handoffConfig, mode: "node-url" }, "fileKey", "页面", "2026-10-19T00:00:00.000Z");
  assert.match(nodeUrlMarkdown, /https:\/\/www\.figma\.com\/design\/fileKey\?node-id=5-10/);
  const extended = createHandoffMarkdown([frame], { ...handoffConfig, detail: "extended" }, undefined, "页面", "2026-10-19T00:00:00.000Z");
  assert.match(extended, /### CSS 参考/);
  assert.match(extended, /flex-direction: row/);
  assert.match(createExtendedDebugMarkdown([frame], "2026-10-19T00:00:00.000Z"), /Included nodes: 4/);
});

test("JSON document parses and preserves schema, IDs, names, types and parent-child structure", () => {
  const serialized = JSON.stringify(createExportDocument(frameFixture, "2026-10-16T00:00:00.000Z"), null, 2);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.schemaVersion, "1.0.0");
  assert.equal(parsed.exportedAt, "2026-10-16T00:00:00.000Z");
  assert.equal(parsed.frames[0].id, "5:10");
  assert.equal(parsed.frames[0].name, "中文 Frame / 首页");
  assert.equal(parsed.frames[0].type, "FRAME");
  assert.equal(parsed.frames[0].children[0].id, "5:11");
  assert.equal(parsed.frames.length, 1);
  assert.equal(parsed.frames[0].children[2].component.mainComponentId, "1:2");
});

test("JSON sanitizer handles non-finite values, undefined, functions and circular references", () => {
  const circular: Record<string, unknown> = { keep: "中文" };
  circular.self = circular;
  const sanitized = sanitizeJson({
    nan: Number.NaN,
    positiveInfinity: Number.POSITIVE_INFINITY,
    negativeInfinity: Number.NEGATIVE_INFINITY,
    missing: undefined,
    callback: () => "not serializable",
    circular,
    values: [undefined, Number.NaN],
  }) as Record<string, unknown>;

  assert.equal(sanitized.nan, null);
  assert.equal(sanitized.positiveInfinity, null);
  assert.equal(sanitized.negativeInfinity, null);
  assert.equal("missing" in sanitized, false);
  assert.equal("callback" in sanitized, false);
  assert.deepEqual(sanitized.circular, { keep: "中文", self: "[循环引用已省略]" });
  assert.deepEqual(sanitized.values, [null, null]);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(sanitized)));
});

test("filenames are safe, identify duplicate-name frames by ID, and handle empty names", () => {
  const filename = makeFilename("页面 / A:*?  ", "5:10", "md");
  assert.equal(filename, "页面 - A-5-10.md");
  assert.equal(makeFilename("页面 / A:*?  ", "5:11", "md"), "页面 - A-5-11.md");
  assert.equal(makeFilename("...  ", "5:12", "png"), "figma-frame-5-12.png");
  assert.ok(Array.from(makeFilename("界".repeat(100), "5:13", "json")).length <= 50 + 1 + 4 + 5);
  assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f]/);
});

test("PNG payload validation accepts a PNG signature and rejects empty or non-PNG bytes", () => {
  assert.equal(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), true);
  assert.equal(hasPngSignature(new Uint8Array()), false);
  assert.equal(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
});

test("selection validation gives clear errors for no selection, multi-select and non-Frame nodes", () => {
  assert.throws(() => requireSelectedFrame([]), /请先在画布中选择一个 Frame/);
  assert.throws(() => requireSelectedFrame([{ type: "FRAME" }, { type: "FRAME" }]), /只选择一个 Frame/);
  assert.throws(() => requireSelectedFrame([{ type: "TEXT" }]), /不是 Frame/);
  assert.equal(requireSelectedFrame([{ type: "FRAME", id: "1:2" }]).id, "1:2");
});

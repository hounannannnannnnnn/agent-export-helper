import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const outdir = new URL("../dist/", import.meta.url);
const htmlTemplate = await readFile(new URL("../src/ui.html", import.meta.url), "utf8");

await mkdir(outdir, { recursive: true });

const uiBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/ui.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2020",
});
const uiScript = uiBundle.outputFiles[0].text;

await writeFile(new URL("ui.html", outdir), htmlTemplate.replace("__UI_SCRIPT__", uiScript));

await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  outfile: fileURLToPath(new URL("main.js", outdir)),
  platform: "browser",
  target: "es2020",
  define: { __html__: JSON.stringify(htmlTemplate.replace("__UI_SCRIPT__", uiScript)) },
});

console.log("Figma 插件已构建到 dist/。");

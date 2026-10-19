# Agent导出助手

![Agent导出助手图标](assets/agent-export-icon.png)

一个基于 TypeScript 和 Figma Plugin API 的插件，可读取多选 Frame 并生成面向 Agent 的页面交接文档、节点 URL 和资源 ZIP。

## 环境

- Node.js 和 npm
- Figma 桌面端

## 安装与构建

```bash
npm ci
npm run typecheck
npm test
npm run build
```

构建会先执行 TypeScript 类型检查，再生成 `dist/main.js` 和 `dist/ui.html`。`manifest.json` 的入口与这两个输出文件对应。

## 在 Figma 桌面端加载

1. 在 Figma 桌面端打开任意设计文件。
2. 打开主菜单，选择 **Plugins（插件） > Development（开发） > Import plugin from manifest…（从 manifest 导入插件…）**。不同版本的菜单文字可能略有差异。
3. 选择本项目中的 `manifest.json`。
4. 从 **Plugins > Development** 运行“Agent导出助手”。
5. 在画布中选择 Frame，插件面板会显示名称、节点类型和尺寸；更改选区时面板自动更新。

选择一个或多个 Frame 后可按配置生成交接内容。非 Frame 选区会跳过。交付模式生成合并 Markdown 和资源 ZIP；Frame Node 模式只生成 Figma Node URL。文档支持 Compact / Extended、解析深度、Mobile / Web / Desktop CSS、忽略图层名和坐标排序。数据提取由主线程执行，深度与忽略规则会在递归读取时生效。

资源策略支持：

- **仅导出设置**：按图层 Figma Export 面板配置生成 PNG、JPG、SVG 或 PDF。
- **自动识别**：提取图片填充、矢量叶子，以及名称包含 icon、logo、asset、image、图标、标志或资源的可见节点。

生成后可复制 Markdown、下载 Markdown 和资源 ZIP。资源 ZIP 包含自动生成的 `PROJECT.md`、每个 Frame 的 Markdown / JSON、`assets/` 下的媒体资源；Extended 模式还包含 `DESIGN.extended.md` 提取诊断。Markdown 包含父子层级、像素坐标、组件信息、文本、颜色、自动布局摘要、原型触发器与目标；Extended 模式附带 CSS 声明。忽略图层会连同子树排除。图像按 hash 去重。无法导出的资源会跳过，不会伪造文件。主线程创建 ZIP（STORE，无压缩、无额外依赖），通过 Figma 消息桥发送给 UI；UI 使用 Blob、object URL 和剪贴板 API。

自动化测试覆盖 Markdown / CSS / Node URL、过滤和坐标排序、JSON 模型、ZIP 结构、文件名和选区校验。Figma 真实资源读取、原型字段和桌面端下载仍需在 Figma 桌面端手动验证。

## Figma 桌面端手动验证

1. 运行 `npm run build`，在 Figma 桌面端通过 **Plugins > Development > Import plugin from manifest…** 导入项目根目录的 `manifest.json`。
2. 在当前页面多选几个 Frame，建议包含文字、自动布局、图像填充、命名图标和至少一个配置过 Export 面板的图层。
3. 选择 Compact、深度 4、自动资源和坐标排序后生成；检查 Markdown 图层/样式摘要、页面数量和资源数量。
4. 测试复制 Markdown、下载 Markdown、下载资源 ZIP；解压检查 `PROJECT.md`、每个 Frame 的页面文件和 `assets/` 相对链接。
5. 切换 Extended，确认详细图层/CSS；切换 Frame Node，确认只输出所选 Frame 的 Figma Node URL。若插件环境未开放 file key，在面板中粘贴 Figma 文件 URL 中的 key。
6. 将某个图层命名为包含 `IGNORE` 并降低深度，确认被忽略子树和超深后代不会导出；关闭坐标排序确认顺序回到 Figma 图层顺序。
7. 在仅导出设置模式下确认只有配置了 Figma Export 面板的资源进入资源 ZIP。

真实 Figma 桌面端的选区、导出设置、原型数据与大资源消息传输需要按以上步骤人工确认。ZIP 使用不压缩格式，文件较大时会占用相应内存。复杂渐变只会输出已提取的颜色摘要；完整变量模式、条件原型动作和页面级响应约束还没有导出。

首次导入前请先运行构建，确保 `dist/` 产物存在。此项目尚未在 Figma 桌面端实际运行验证。

## 插件图标

`assets/agent-export-icon.png` 是 128 × 128 PNG，可用于 GitHub 项目页和 Figma Community 发布资料。Figma 插件 manifest 当前没有声明图标的字段；发布到 Community 时需在 Figma 的发布窗口单独上传该图片。

## 发布到 GitHub

1. 在 GitHub 创建一个空仓库，例如 `agent-export-helper`。第一次推送时不要勾选自动创建 README、License 或 `.gitignore`，因为这些文件由本项目管理。
2. 在项目目录初始化并推送：

   ```bash
   git init
   git add .
   git commit -m "初始版本：Agent导出助手"
   git branch -M main
   git remote add origin <你的 GitHub 仓库 URL>
   git push -u origin main
   ```

3. 后续修改源码或图标后，先运行 `npm ci`（仅首次克隆时）、`npm test` 和 `npm run build`，再提交并推送：

   ```bash
   git add .
   git commit -m "描述这次修改"
   git push
   ```

4. 在另一台电脑或重新克隆后运行 `npm ci`、`npm run build`，再通过 Figma 的 **Import plugin from manifest…** 选择根目录 `manifest.json`。

不要把访问令牌、密码、个人文件或 `node_modules/` 提交到仓库。仓库许可证见下方说明。

## 许可证

本项目采用 MIT License，完整条款见 [LICENSE](LICENSE)。MIT 允许复用、修改和分发，条件是保留版权与许可声明；软件按“现状”提供，不附带保证。

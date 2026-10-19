type IconNodeLike = {
  type: string;
  name: string;
  width: number;
  height: number;
  children?: readonly IconNodeLike[];
};

const vectorLeaves = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);
const iconContainers = new Set(["INSTANCE", "COMPONENT", "COMPONENT_SET", "GROUP", "FRAME"]);
const graphicShapes = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "RECTANGLE", "ELLIPSE"]);
const explicitIconName = /(?:^|[\s/_-])(?:icon|icons|icn|glyph|symbol)(?:$|[\s/_-])|arrow|chevron|caret|close|search|menu|home|settings|delete|edit|favorite|share|more|notification|user|cart|upload|download|filter|refresh|play|pause|图标|箭头|关闭|返回|搜索|菜单|首页|设置|删除|编辑|收藏|分享|更多|通知|用户|购物车|上传|下载|筛选|刷新|播放|暂停/i;

function containsVectorOnlyArtwork(node: IconNodeLike): boolean {
  if (node.type === "TEXT" || node.type === "IMAGE" || node.type === "VIDEO") return false;
  if (node.children?.length) return node.children.every(containsVectorOnlyArtwork)
    && node.children.some((child) => containsVectorOnlyArtwork(child) && (vectorLeaves.has(child.type) || Boolean(child.children?.length)));
  return graphicShapes.has(node.type);
}

/** Identify icon-like Figma layers from their node type, label, and compact vector structure. */
export function isIconCandidate(node: IconNodeLike, additionalNames: string[] = []): boolean {
  if (vectorLeaves.has(node.type) && (!node.children || node.children.length === 0)) return true;

  const width = Number.isFinite(node.width) ? node.width : Number.POSITIVE_INFINITY;
  const height = Number.isFinite(node.height) ? node.height : Number.POSITIVE_INFINITY;
  const compact = width > 0 && height > 0 && width <= 256 && height <= 256;
  const name = [node.name, ...additionalNames].join(" ");
  if (compact && explicitIconName.test(name) && node.type !== "TEXT") return true;
  if (!compact || !iconContainers.has(node.type) || !node.children?.length) return false;
  return explicitIconName.test(name) || (
    width <= 128 && height <= 128 && node.children.some((child) => vectorLeaves.has(child.type)) && containsVectorOnlyArtwork(node)
  );
}

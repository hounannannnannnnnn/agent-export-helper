import type { ExportPackageFile } from "./export-data";

/** Figma's plugin main-thread runtime does not expose TextEncoder in all hosts. */
function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function safePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`ZIP 文件路径无效：${path}`);
  }
  return normalized;
}

/** Build a dependency-free ZIP archive using the standard STORE method. */
export function createZip(files: ExportPackageFile[]): Uint8Array {
  if (files.length > 0xffff) throw new Error("ZIP 文件数量超出支持范围。");
  const paths = new Set<string>();
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const path = safePath(file.path);
    if (paths.has(path)) throw new Error(`ZIP 中存在重复文件路径：${path}`);
    paths.add(path);
    const name = encodeUtf8(path);
    const content = typeof file.content === "string" ? encodeUtf8(file.content) : file.content;
    if (name.byteLength > 0xffff || content.byteLength > 0xffffffff || localOffset > 0xffffffff) {
      throw new Error("导出包超过 ZIP 标准格式支持的大小。");
    }
    const checksum = crc32(content);

    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0x0021);
    write32(localView, 14, checksum);
    write32(localView, 18, content.byteLength);
    write32(localView, 22, content.byteLength);
    write16(localView, 26, name.byteLength);
    write16(localView, 28, 0);
    local.set(name, 30);
    localRecords.push(local, content);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x0021);
    write32(centralView, 16, checksum);
    write32(centralView, 20, content.byteLength);
    write32(centralView, 24, content.byteLength);
    write16(centralView, 28, name.byteLength);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralRecords.push(central);
    localOffset += local.byteLength + content.byteLength;
  }

  const centralDirectory = concat(centralRecords);
  if (localOffset > 0xffffffff || centralDirectory.byteLength > 0xffffffff) throw new Error("导出包超过 ZIP 标准格式支持的大小。");
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralDirectory.byteLength);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);
  return concat([...localRecords, centralDirectory, end]);
}

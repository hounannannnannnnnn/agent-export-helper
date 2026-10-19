import type { DesignCollection, DesignSnapshot, DesignStyle } from "./design-output";
import type { JsonValue } from "./export-data";

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.r === "number" && typeof record.g === "number" && typeof record.b === "number") {
      const channel = (component: number) => Math.round(Math.max(0, Math.min(1, component)) * 255).toString(16).padStart(2, "0");
      return {
        r: record.r,
        g: record.g,
        b: record.b,
        ...(typeof record.a === "number" ? { a: record.a } : {}),
        hex: `#${channel(record.r)}${channel(record.g)}${channel(record.b)}`,
      };
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(record)) {
      const serialized = toJsonValue(child);
      if (serialized !== null || child === null) result[key] = serialized;
    }
    return result;
  }
  return null;
}

function styleSnapshot(style: PaintStyle | TextStyle | EffectStyle | GridStyle): DesignStyle {
  const properties: Record<string, JsonValue> = {};
  if (style.type === "PAINT") properties.paints = toJsonValue(style.paints);
  else if (style.type === "TEXT") {
    properties.fontName = toJsonValue(style.fontName);
    properties.fontSize = style.fontSize;
    properties.textDecoration = style.textDecoration;
    properties.letterSpacing = toJsonValue(style.letterSpacing);
    properties.lineHeight = toJsonValue(style.lineHeight);
    properties.paragraphSpacing = style.paragraphSpacing;
    properties.paragraphIndent = style.paragraphIndent;
  } else if (style.type === "EFFECT") properties.effects = toJsonValue(style.effects);
  else if (style.type === "GRID") properties.layoutGrids = toJsonValue(style.layoutGrids);
  return {
    id: style.id,
    name: style.name,
    type: style.type,
    description: style.description,
    remote: style.remote,
    properties,
  };
}

export async function readFigmaDesignSnapshot(): Promise<DesignSnapshot> {
  const [variables, collections, paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
  ]);
  const variablesByCollection = new Map<string, DesignCollection["variables"]>();

  for (const variable of variables) {
    const entries: Record<string, JsonValue> = {};
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) entries[modeId] = toJsonValue(value);
    const list = variablesByCollection.get(variable.variableCollectionId) ?? [];
    list.push({
      id: variable.id,
      name: variable.name,
      description: variable.description,
      resolvedType: variable.resolvedType,
      scopes: [...variable.scopes],
      codeSyntax: { ...variable.codeSyntax },
      valuesByMode: entries,
    });
    variablesByCollection.set(variable.variableCollectionId, list);
  }

  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
      variables: variablesByCollection.get(collection.id) ?? [],
    })),
    styles: [...paintStyles, ...textStyles, ...effectStyles, ...gridStyles].map(styleSnapshot),
  };
}

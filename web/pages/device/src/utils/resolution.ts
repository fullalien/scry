export type Size = { width: number; height: number };

export function parseResolution(value?: string): Size | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function parseDensity(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const density = Number(match[1]);
  if (!Number.isFinite(density) || density <= 0) return null;
  return density;
}

export function toCssInchPixels(
  px: number,
  density: number,
  cssPxPerInch = 96
): number {
  return (px * cssPxPerInch) / density;
}

export function alignOrientation(target: Size, reference: Size): Size {
  const sameOrientation =
    (target.width >= target.height && reference.width >= reference.height) ||
    (target.width < target.height && reference.width < reference.height);
  if (sameOrientation) return target;
  return { width: target.height, height: target.width };
}

import { parseTilePixelRatio, tilePixelRatioSuffix } from '@mapconductor/js-sdk-core';

/**
 * Marker tiles OpenLayers loads straight from `LocalTileServer` when no
 * Service Worker is available. The ratio suffix (`@2x`) means the same as in
 * the Service Worker's `/__tiles/` URLs.
 */
export const MAPCONDUCTOR_TILE_PROTOCOL = 'mc-local-tile';

export interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
  /** Device pixels per CSS pixel the route's tiles are drawn at (`@2x` → 2). */
  pixelRatio: number;
  requiresDirectLoad: boolean;
}

// mc-local-tile://{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}{@2x?}.png
export function localTileUrlTemplate({
  routeId,
  tileSize,
  cacheKey,
  pixelRatio,
}: {
  routeId: string;
  tileSize: number;
  cacheKey?: string;
  pixelRatio?: number;
}): string {
  const base = `${MAPCONDUCTOR_TILE_PROTOCOL}://${routeId}/${tileSize}`;
  const tile = `{z}/{x}/{y}${tilePixelRatioSuffix(pixelRatio)}.png`;
  if (cacheKey) {
    return `${base}/${cacheKey}/${tile}`;
  }
  return `${base}/${tile}`;
}

/** The route behind an SDK-owned tile template, or null for any other template. */
export function parseLocalTileTemplate(template: string): LocalTileTemplate | null {
  const pixelRatio = parseTilePixelRatio(template.match(/(@\d+x)\.png$/)?.[1]);
  if (template.startsWith(`${MAPCONDUCTOR_TILE_PROTOCOL}://`)) {
    const url = new URL(template);
    const tileSize = Number(url.pathname.split('/').filter(Boolean)[0]);
    return Number.isFinite(tileSize)
      ? { routeId: url.hostname, tileSize, pixelRatio, requiresDirectLoad: true }
      : null;
  }
  const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)\//);
  return match
    ? { routeId: match[1], tileSize: Number(match[2]), pixelRatio, requiresDirectLoad: false }
    : null;
}

/** One tile's `mc-local-tile://` URL, as OpenLayers hands it to the tile load function. */
export function parseLocalTileRequest(
  src: string,
): { routeId: string; x: number; y: number; z: number; pixelRatio: number } | null {
  const url = new URL(src);
  if (url.protocol !== `${MAPCONDUCTOR_TILE_PROTOCOL}:`) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;
  const z = Number(segments.at(-3));
  const x = Number(segments.at(-2));
  const last = segments.at(-1)!.match(/^(\d+)(@\d+x)?\.png$/);
  if (!last) return null;
  const y = Number(last[1]);
  if (![z, x, y].every(Number.isFinite)) return null;
  return { routeId: url.hostname, x, y, z, pixelRatio: parseTilePixelRatio(last[2]) };
}

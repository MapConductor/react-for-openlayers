import { createGeoPoint, overlayStackZ, type GeoPoint, type GeoPointInterface, type OverlayKind } from '@mapconductor/js-sdk-core';
import type { Coordinate } from 'ol/coordinate';
import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type BaseLayer from 'ol/layer/Base';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import LayerGroup from 'ol/layer/Group.js';

export const toCoordinate = (point: GeoPointInterface): Coordinate =>
  fromLonLat([point.longitude, point.latitude]);

export const fromOpenLayersEvent = (event: MapBrowserEvent): GeoPoint => {
  const [longitude, latitude] = toLonLat(event.coordinate);
  return createGeoPoint({ latitude, longitude });
};

export function ensureLayerGroup(
  map: Map,
  name: string,
  zIndex: number,
): void {
  const groups = map.getLayerGroup().getLayersArray();
  const existing = groups.find(group => group.get('name') === name);
  if (existing) {
    existing.setZIndex(zIndex);
    return;
  }

  const group = new LayerGroup({
    zIndex,
  });
  group.set('name', name);
  map.getLayerGroup().getLayers().push(group);
}

export function getLayerGroup(map: Map, name: string): BaseLayer | undefined {
  const groups = map.getLayerGroup().getLayersArray();
  return groups.find(group => group.get('name') === name);
}

/**
 * Layer z-index for an overlay, from the shared stack (js-sdk-core OVERLAY_STACK_ORDER):
 * raster < ground image < polygon < circle < polyline < marker, zIndex within the band.
 *
 * Bands of 60 from 211 to 569: above the basemap (index 0, no zIndex) and below the native
 * marker layer (600). zIndex is clamped to ±29 so it cannot cross a band. Polygons, circles
 * and polylines used to share one range (400 ± zIndex), so with equal zIndexes the one added
 * last was drawn on top; a raster could go up to 350, over ground images (300).
 */
export function overlayLayerZIndex(kind: OverlayKind, zIndex: number | null | undefined = 0): number {
  return overlayStackZ(kind, zIndex, { base: 240, bandSize: 60 });
}

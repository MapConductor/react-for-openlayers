import { createGeoPoint, type GeoPoint, type GeoPointInterface } from '@mapconductor/js-sdk-core';
import type { Coordinate } from 'ol/coordinate';
import type Map from 'ol/Map';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import LayerGroup from 'ol/layer/Group.js';

export const toCoordinate = (point: GeoPointInterface): Coordinate =>
  fromLonLat([point.longitude, point.latitude]);

export const fromOpenLayersEvent = (event: any): GeoPoint => {
  const [longitude, latitude] = toLonLat(event.coordinate);
  return createGeoPoint({ latitude, longitude });
};

export function ensureLayerGroup(
  map: Map,
  name: string,
  zIndex: number,
): void {
  const groups = map.getLayerGroup().getLayersArray();
  const existing = groups.find(group => (group as any).get('name') === name);
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

export function getLayerGroup(map: Map, name: string): any {
  const groups = map.getLayerGroup().getLayersArray();
  return groups.find(group => (group as any).get('name') === name);
}

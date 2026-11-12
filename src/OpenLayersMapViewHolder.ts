import {
  MapViewHolderBase,
  ProjectedUnit,
  createGeoPoint,
  type MapCoordinateSystem,
  type GeoPoint,
  type GeoPointInterface,
  type Offset,
} from '@mapconductor/js-sdk-core';
import type Map from 'ol/Map';
import type View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import type { OpenLayersMapViewController } from './OpenLayersMapViewController';
import { toCoordinate } from './helpers';

export class OpenLayersMapViewHolder extends MapViewHolderBase<HTMLElement, Map> {
  private controller: OpenLayersMapViewController | null = null;

  constructor(
    readonly mapView: HTMLElement,
    readonly map: Map,
    readonly view: View,
  ) {
    super();
  }

  getController(): OpenLayersMapViewController | null {
    return this.controller;
  }

  setController(controller: OpenLayersMapViewController): void {
    this.controller = controller;
  }

  /**
   * The view's projection: EPSG:3857 by default, or whatever the view was
   * created with. `getUnits()` gives `m` / `degrees` for the common ones.
   */
  override get coordinateSystem(): MapCoordinateSystem {
    const projection = this.view.getProjection();
    const units = projection.getUnits();
    return {
      code: projection.getCode() || null,
      unit: units === 'm' ? ProjectedUnit.Meters : units === 'degrees' ? ProjectedUnit.Degrees : ProjectedUnit.Other,
    };
  }

  override toProjectedPoint(position: GeoPointInterface): Offset | null {
    const [x, y] = fromLonLat([position.longitude, position.latitude], this.view.getProjection());
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  override fromProjectedPoint(point: Offset): GeoPoint | null {
    const [longitude, latitude] = toLonLat([point.x, point.y], this.view.getProjection());
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? createGeoPoint({ latitude, longitude }) : null;
  }

  toScreenOffset(position: GeoPointInterface): Offset {
    const coordinate = toCoordinate(position);
    const center = this.view.getCenter();
    const projectionExtent = this.view.getProjection().getExtent();
    if (center && projectionExtent) {
      const worldWidth = projectionExtent[2] - projectionExtent[0];
      if (worldWidth > 0) {
        coordinate[0] += Math.round((center[0] - coordinate[0]) / worldWidth) * worldWidth;
      }
    }
    const pixel = this.map.getPixelFromCoordinate(coordinate);
    return this.mapPixelToViewport({ x: pixel[0], y: pixel[1] });
  }

  fromScreenOffsetSync(offset: Offset): GeoPoint {
    const pixel = this.viewportToMapPixel(offset);
    const coordinate = this.map.getCoordinateFromPixel([pixel.x, pixel.y]);
    const [longitude, latitude] = toLonLat(coordinate);
    return createGeoPoint({ latitude, longitude });
  }

  private mapPixelToViewport(offset: Offset): Offset {
    const mapWidth = this.mapView.clientWidth;
    const mapHeight = this.mapView.clientHeight;
    const viewport = this.mapView.parentElement;
    const viewportWidth = viewport?.clientWidth ?? mapWidth;
    const viewportHeight = viewport?.clientHeight ?? mapHeight;
    const bearing = (this.controller?.getVisualBearing() ?? 0) * Math.PI / 180;
    const tiltScale = Math.cos((this.controller?.getVisualTilt() ?? 0) * Math.PI / 180);
    // Same order as the plane's CSS transform: rotate, then tilt on screen.
    const x = offset.x - mapWidth / 2;
    const y = offset.y - mapHeight / 2;
    return {
      x: viewportWidth / 2 + x * Math.cos(bearing) - y * Math.sin(bearing),
      y: viewportHeight / 2 + (x * Math.sin(bearing) + y * Math.cos(bearing)) * tiltScale,
    };
  }

  private viewportToMapPixel(offset: Offset): Offset {
    const mapWidth = this.mapView.clientWidth;
    const mapHeight = this.mapView.clientHeight;
    const viewport = this.mapView.parentElement;
    const viewportWidth = viewport?.clientWidth ?? mapWidth;
    const viewportHeight = viewport?.clientHeight ?? mapHeight;
    const bearing = -(this.controller?.getVisualBearing() ?? 0) * Math.PI / 180;
    const tiltScale = Math.max(Math.cos((this.controller?.getVisualTilt() ?? 0) * Math.PI / 180), 0.01);
    // Inverse of mapPixelToViewport: undo the tilt, then the rotation.
    const x = offset.x - viewportWidth / 2;
    const y = (offset.y - viewportHeight / 2) / tiltScale;
    return {
      x: mapWidth / 2 + x * Math.cos(bearing) - y * Math.sin(bearing),
      y: mapHeight / 2 + x * Math.sin(bearing) + y * Math.cos(bearing),
    };
  }
}

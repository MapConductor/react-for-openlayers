import {
  MapProvider,
  MarkerTilingOptions, PolylineTiler, PolylineTilingOptions, CircleTiler, CircleTilingOptions,
  type GeoRectBounds,
  type MapConfig,
  type MapViewControllerInterface, toNativeRotation, } from '@mapconductor/js-sdk-core';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import type { Extent } from 'ol/extent';
import TileLayer from 'ol/layer/Tile.js';
import type { MapOptions } from 'ol/Map';
import type { OpenLayersMapDesignType } from './OpenLayersDesign';
import { OpenLayersMapViewController } from './OpenLayersMapViewController';
import { OpenLayersMapViewHolder } from './OpenLayersMapViewHolder';
import { toCoordinate } from './helpers';
import { OpenLayersMarkerController } from './marker/OpenLayersMarkerController';
import { OpenLayersMarkerOverlayRenderer } from './marker/OpenLayersMarkerOverlayRenderer';
import {
  OpenLayersCircleController,
  OpenLayersCircleRenderer,
  OpenLayersGroundImageController,
  OpenLayersGroundImageRenderer,
  OpenLayersPolygonController,
  OpenLayersPolygonRenderer,
  OpenLayersPolylineController,
  OpenLayersPolylineRenderer,
} from './vector/OpenLayersVectorControllers';
import {
  OpenLayersRasterLayerController,
  OpenLayersRasterLayerRenderer,
} from './raster/OpenLayersRasterLayer';

export interface OpenLayersConfig extends MapConfig {
  mapDesignType: OpenLayersMapDesignType;
  maxZoom?: number;
  minZoom?: number;
  /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  markerTilingOptions?: MarkerTilingOptions;
  /**
   * When to draw polylines as raster tiles; {@link PolylineTilingOptions.Default} if omitted.
   * The controller's `setPolylineTilingOptions` replaces it later.
   */
  polylineTilingOptions?: PolylineTilingOptions;
  /**
   * When to draw circles as raster tiles; {@link CircleTilingOptions.Default} if omitted.
   * The controller's `setCircleTilingOptions` replaces it later.
   */
  circleTilingOptions?: CircleTilingOptions;
  options?: Omit<MapOptions, 'target'>;
}

function toExtent(bounds: GeoRectBounds | undefined): Extent | undefined {
  if (!bounds?.southWest || !bounds.northEast) return undefined;
  const [minX, minY] = toCoordinate(bounds.southWest);
  const [maxX, maxY] = toCoordinate(bounds.northEast);
  return [minX, minY, maxX, maxY];
}

export class OpenLayersProvider extends MapProvider {
  async initialize(config: OpenLayersConfig): Promise<MapViewControllerInterface> {
    if (this.controller) return this.controller;
    const container = typeof config.container === 'string'
      ? document.getElementById(config.container)
      : config.container;
    if (!container) throw new Error('Container element not found');

    const initial = config.initCameraPosition;
    const view = new View({
      center: toCoordinate(initial?.position ?? { longitude: 0, latitude: 0 }),
      zoom: initial?.zoom ?? 0,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      extent: toExtent(config.restrictBounds),
      rotation: toNativeRotation(initial?.bearing ?? 0) * (Math.PI / 180),
    });

    const map = new Map({
      target: container,
      view,
      ...config.options,
    });

    const design = config.mapDesignType;
    const baseLayer = design.tileSource ? new TileLayer({ source: design.tileSource }) : null;
    if (baseLayer) map.addLayer(baseLayer);

    const holder = new OpenLayersMapViewHolder(container, map, view);
    const markerRenderer = new OpenLayersMarkerOverlayRenderer(holder);
    const markerController = new OpenLayersMarkerController(markerRenderer, config.markerTilingOptions);
    const circleController = new OpenLayersCircleController(new OpenLayersCircleRenderer(holder));
    const polylineController = new OpenLayersPolylineController(new OpenLayersPolylineRenderer(holder));
    // Many polylines are drawn as tiles by the tile service worker and shown as one raster
    // layer (the view controller mounts it); taps still resolve against the original paths.
    polylineController.tiler = new PolylineTiler(config.polylineTilingOptions ?? PolylineTilingOptions.Default);
    // Many circles are drawn as tiles too, shown as one raster layer at the bottom of the circle
    // band (the view controller mounts it); taps still resolve against the original circles.
    circleController.tiler = new CircleTiler(config.circleTilingOptions ?? CircleTilingOptions.Default);
    const polygonController = new OpenLayersPolygonController(new OpenLayersPolygonRenderer(holder));
    const groundImageController = new OpenLayersGroundImageController(new OpenLayersGroundImageRenderer(holder));
    const rasterLayerController = new OpenLayersRasterLayerController(new OpenLayersRasterLayerRenderer(holder));

    this.controller = new OpenLayersMapViewController(
      holder,
      markerController,
      circleController,
      polylineController,
      polygonController,
      groundImageController,
      rasterLayerController,
      initial?.tilt ?? 0,
      initial?.bearing ?? 0,
      baseLayer,
    );
    return this.controller;
  }

  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
  }
}

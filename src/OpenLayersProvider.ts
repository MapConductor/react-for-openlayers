import {
  MapProvider,
  MarkerTilingOptions,
  type MapConfig,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
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
  markerTilingOptions?: MarkerTilingOptions;
  options?: Omit<MapOptions, 'target'>;
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
      rotation: -(initial?.bearing ?? 0) * (Math.PI / 180),
    });

    const map = new Map({
      target: container,
      view,
      ...config.options,
    });

    const design = config.mapDesignType;
    if (design.tileSource) {
      const tileLayer = new TileLayer({
        source: design.tileSource,
      });
      map.addLayer(tileLayer);
    }

    const holder = new OpenLayersMapViewHolder(container, map, view);
    const markerRenderer = new OpenLayersMarkerOverlayRenderer(holder);
    const markerController = new OpenLayersMarkerController(markerRenderer, config.markerTilingOptions);
    const circleController = new OpenLayersCircleController(new OpenLayersCircleRenderer(holder));
    const polylineController = new OpenLayersPolylineController(new OpenLayersPolylineRenderer(holder));
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
    );
    return this.controller;
  }

  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
  }
}

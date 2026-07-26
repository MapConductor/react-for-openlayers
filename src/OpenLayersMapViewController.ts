import {
  BaseMapViewController,
  createGeoPoint,
  createGeoRectBounds,
  createMapCameraPosition,
  computeOffset,
  type CameraOptions,
  type CircleCapable,
  type CircleEvent,
  type CircleState,
  type GeoRectBounds,
  type GroundImageCapable,
  type GroundImageEvent,
  type GroundImageState,
  type GeoPoint,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type Offset,
  type OnCircleEventHandler,
  type OnGroundImageEventHandler,
  type OnMapInitializedHandler,
  type OnMarkerEventHandler,
  type OnPolygonEventHandler,
  type OnPolylineEventHandler,
  type PolygonCapable,
  type PolygonEvent,
  type PolygonState,
  type PolylineCapable,
  type PolylineEvent,
  type PolylineState,
  type RasterLayerCapable,
  type RasterLayerState,
  type VisibleRegion,
} from '@mapconductor/js-sdk-core';
import type Map from 'ol/Map';
import type View from 'ol/View';
import { OpenLayersMapViewHolder } from './OpenLayersMapViewHolder';
import { fromOpenLayersEvent, toCoordinate } from './helpers';
import { toLonLat } from 'ol/proj.js';
import { OpenLayersMarkerController } from './marker/OpenLayersMarkerController';
import {
  OpenLayersCircleController,
  OpenLayersGroundImageController,
  OpenLayersPolygonController,
  OpenLayersPolylineController,
} from './vector/OpenLayersVectorControllers';
import { OpenLayersRasterLayerController } from './raster/OpenLayersRasterLayer';

export class OpenLayersMapViewController
  extends BaseMapViewController
  implements
    MapViewControllerInterface,
    MarkerCapable,
    CircleCapable,
    PolylineCapable,
    PolygonCapable,
    GroundImageCapable,
    RasterLayerCapable {
  private readonly map: Map;
  private readonly view: View;
  private destroyed = false;
  private logicalTilt: number;
  private logicalPosition = createGeoPoint({ latitude: 0, longitude: 0 });
  private logicalZoom = 0;
  private logicalBearing = 0;
  private hasLogicalCameraOverride = false;
  private isCameraMoving = false;

  constructor(
    readonly holder: OpenLayersMapViewHolder,
    private readonly markerController: OpenLayersMarkerController,
    private readonly circleController: OpenLayersCircleController,
    private readonly polylineController: OpenLayersPolylineController,
    private readonly polygonController: OpenLayersPolygonController,
    private readonly groundImageController: OpenLayersGroundImageController,
    private readonly rasterLayerController: OpenLayersRasterLayerController,
    initialTilt = 0,
    initialBearing = 0,
  ) {
    super();
    this.map = holder.map;
    this.view = holder.view;
    this.logicalTilt = initialTilt;
    const initialCenter = this.view.getCenter();
    if (initialCenter) {
      const [longitude, latitude] = toLonLat(initialCenter);
      this.logicalPosition = createGeoPoint({ latitude, longitude });
    }
    this.logicalZoom = this.view.getZoom() ?? 0;
    this.logicalBearing = initialBearing;
    this.hasLogicalCameraOverride = initialTilt !== 0 || initialBearing !== 0;
    this.view.setRotation(0);
    if (this.hasLogicalCameraOverride) {
      const camera = toOpenLayersCamera(createMapCameraPosition({
        position: this.logicalPosition,
        zoom: this.logicalZoom,
        bearing: initialBearing,
        tilt: initialTilt,
      }));
      this.view.setCenter(toCoordinate(camera.position));
      this.view.setZoom(camera.zoom);
    }
    holder.setController(this);
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };
    this.setupEvents();
  }

  getMap(): Map { return this.map; }

  getVisualTilt(): number { return Math.min(60, Math.abs(this.logicalTilt)); }

  getVisualBearing(): number { return this.logicalBearing; }

  private setupEvents(): void {
    this.map.on('movestart', () => {
      this.isCameraMoving = true;
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMoveStart(camera);
    });

    this.map.on('postrender', () => {
      if (!this.isCameraMoving) return;
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMove(camera);
    });

    this.map.on('moveend', () => {
      this.isCameraMoving = false;
      const camera = this.getCameraPosition();
      if (!camera) return;
      void this.notifyControllersCameraChanged(camera);
      this.notifyCameraMoveEnd(camera);
    });

    this.map.on('click' as any, (event: any) => {
      const feature = this.map.forEachFeatureAtPixel(event.pixel, candidate => candidate) as {
        getId(): string | number | undefined;
      } | undefined;
      if (feature && this.markerController.handleFeatureClick(feature)) return;
      const clicked = fromOpenLayersEvent(event);
      const zoom = this.view.getZoom() ?? 0;
      const tiled = this.markerController.findTiled(clicked, zoom);
      if (tiled?.state.clickable) {
        this.markerController.dispatchClick(tiled.state);
        return;
      }
      // While tilted, native markers are hidden (drawn as upright canvas
      // billboards) and OpenLayers' feature hit-testing is skewed by the CSS
      // transform, so resolve non-tiled marker clicks in the billboards' screen
      // space instead.
      if (!this.markerController.isNativeMarkersVisible()) {
        const outer = this.outerOffsetFromEvent(event.originalEvent);
        const entity = outer ? this.markerController.findAtScreen(outer) : null;
        if (entity?.state.clickable) {
          this.markerController.dispatchClick(entity.state);
          return;
        }
      }
      if (this.dispatchOverlayClick(clicked)) return;
      this.notifyMapClick(clicked);
    });

    this.map.on('contextmenu' as any, (event: any) => {
      this.notifyMapLongClick(fromOpenLayersEvent(event));
    });

    const camera = this.getCameraPosition();
    if (camera) void this.notifyControllersCameraChanged(camera);
  }

  private dispatchOverlayClick(clicked: GeoPoint): boolean {
    const circle = this.circleController.find(clicked);
    if (circle) {
      const event: CircleEvent = { state: circle.state, clicked };
      this.circleController.dispatchClick(event);
      return true;
    }

    const polygon = this.polygonController.find(clicked);
    if (polygon) {
      const event: PolygonEvent = { state: polygon.state, clicked };
      this.polygonController.dispatchClick(event);
      return true;
    }

    const polyline = this.polylineController.findWithClosestPoint(clicked);
    if (polyline) {
      const event: PolylineEvent = {
        state: polyline.entity.state,
        clicked: polyline.closestPoint,
      };
      this.polylineController.dispatchClick(event);
      return true;
    }

    const groundImage = this.groundImageController.find(clicked);
    if (groundImage) {
      const event: GroundImageEvent = { state: groundImage.state, clicked };
      this.groundImageController.dispatchClick(event);
      return true;
    }

    return false;
  }

  override setMapInitializedListener(listener: OnMapInitializedHandler | null): void {
    super.setMapInitializedListener(listener);
    if (listener && !this.destroyed) queueMicrotask(() => this.notifyMapInitialized());
  }

  async moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;

    const camera = toOpenLayersCamera(position);
    this.view.setCenter(toCoordinate(camera.position));
    this.view.setZoom(camera.zoom);
    this.view.setRotation(0);

    return true;
  }

  async animateCamera(position: MapCameraPosition, options?: CameraOptions): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;

    const camera = toOpenLayersCamera(position);
    const durationSeconds = (options?.duration ?? 500) / 1000;

    this.view.animate({
      center: toCoordinate(camera.position),
      zoom: camera.zoom,
      rotation: 0,
      duration: durationSeconds * 1000,
    });

    return true;
  }

  async fitBounds(bounds: GeoRectBounds, options?: CameraOptions): Promise<boolean> {
    if (!bounds.southWest || !bounds.northEast) return false;

    const southWest = toCoordinate(bounds.southWest);
    const northEast = toCoordinate(bounds.northEast);
    const extent = [
      southWest[0],
      southWest[1],
      northEast[0],
      northEast[1],
    ];

    const duration = (options?.duration ?? 0) / 1000;
    this.view.fit(extent, {
      duration: duration * 1000,
      padding: this.normalizePadding(options?.padding ?? options?.paddings),
    });

    return true;
  }

  getCameraPosition(): MapCameraPosition {
    const center = this.view.getCenter();
    if (!center) return createMapCameraPosition({
      position: createGeoPoint({ latitude: 0, longitude: 0 }),
      zoom: this.view.getZoom() ?? 0,
      bearing: -(this.view.getRotation() * (180 / Math.PI)),
      tilt: this.logicalTilt,
      visibleRegion: this.getVisibleRegion(),
    });

    const [longitude, latitude] = toLonLat(center);
    return createMapCameraPosition({
      position: this.hasLogicalCameraOverride ? this.logicalPosition : createGeoPoint({ latitude, longitude }),
      zoom: this.hasLogicalCameraOverride ? this.logicalZoom : this.view.getZoom() ?? 0,
      bearing: this.hasLogicalCameraOverride ? this.logicalBearing : 0,
      tilt: this.logicalTilt,
      visibleRegion: this.getVisibleRegion(),
    });
  }

  getBounds(): GeoRectBounds | null {
    return this.getVisibleRegion().bounds;
  }

  private getVisibleRegion(): VisibleRegion {
    // this.map's own target element is deliberately rendered at 200% size (see
    // OpenLayersMapView's mapPlaneStyle, used to give the CSS tilt/bearing
    // transform room to rotate without showing gaps at the edges), so
    // map.getSize() reports that oversized plane rather than what's actually
    // visible on screen. Use the real (clipping) viewport element's size
    // instead, or the extent ends up ~2x too wide/tall and, once the
    // longitude span crosses 180°, GeoRectBounds picks the wrong hemisphere.
    const viewportElement = this.holder.mapView.parentElement;
    const size: [number, number] = viewportElement && viewportElement.clientWidth > 0 && viewportElement.clientHeight > 0
      ? [viewportElement.clientWidth, viewportElement.clientHeight]
      : (this.map.getSize() as [number, number] | undefined) ?? [0, 0];
    const extent = this.view.calculateExtent(size);
    const [bottomLeftLongitude, bottomLeftLatitude] = toLonLat([extent[0], extent[1]]);
    const [bottomRightLongitude, bottomRightLatitude] = toLonLat([extent[2], extent[1]]);
    const [topLeftLongitude, topLeftLatitude] = toLonLat([extent[0], extent[3]]);
    const [topRightLongitude, topRightLatitude] = toLonLat([extent[2], extent[3]]);
    const bottomLeft = createGeoPoint({ latitude: bottomLeftLatitude, longitude: bottomLeftLongitude });
    const bottomRight = createGeoPoint({ latitude: bottomRightLatitude, longitude: bottomRightLongitude });
    const topLeft = createGeoPoint({ latitude: topLeftLatitude, longitude: topLeftLongitude });
    const topRight = createGeoPoint({ latitude: topRightLatitude, longitude: topRightLongitude });

    const bounds = createGeoRectBounds();
    bounds.extend(bottomLeft);
    bounds.extend(bottomRight);
    bounds.extend(topLeft);
    bounds.extend(topRight);

    return {
      bounds,
      nearLeft: bottomLeft,
      nearRight: bottomRight,
      farLeft: topLeft,
      farRight: topRight,
    };
  }

  private async notifyControllersCameraChanged(camera: MapCameraPosition): Promise<void> {
    await Promise.all([
      this.markerController.onCameraChanged(camera),
      this.circleController.onCameraChanged(camera),
      this.polylineController.onCameraChanged(camera),
      this.polygonController.onCameraChanged(camera),
      this.groundImageController.onCameraChanged(camera),
      this.rasterLayerController.onCameraChanged(camera),
    ]);
  }

  async compositionMarkers(data: MarkerState[]): Promise<void> { await this.markerController.composition(data); }
  async updateMarker(state: MarkerState): Promise<void> { await this.markerController.update(state); }
  hasMarker(state: MarkerState): boolean { return this.markerController.has(state); }
  setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void { this.markerController.setOnClickListener(listener); }
  setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragStart(listener); }
  setOnMarkerDrag(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDrag(listener); }
  setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragEnd(listener); }
  setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateStart(listener); }
  setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateEnd(listener); }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void { this.markerController.setMarkerAnimationOverlayHost(host); }

  /** Hide/show native markers when the CSS tilt hack is toggled (see OpenLayersMapView). */
  setNativeMarkersVisible(visible: boolean): void { this.markerController.setNativeMarkersVisible(visible); }
  /** Whether native markers are currently visible (false while tilted). */
  isNativeMarkersVisible(): boolean { return this.markerController.isNativeMarkersVisible(); }
  /** Live states of the non-tiled markers, drawn as upright billboards while tilted. */
  getNonTiledMarkerStates(): MarkerState[] { return this.markerController.getNonTiledMarkerStates(); }

  /**
   * The pointer position of a DOM event in the tilt-aware viewport pixel space
   * used by the billboard canvas and `findAtScreen` (see
   * OpenLayersMapViewHolder.toScreenOffset / mapPixelToViewport). That space is
   * relative to the outer (untransformed) viewport container.
   */
  private outerOffsetFromEvent(originalEvent: Event | undefined): Offset | null {
    const source = originalEvent as MouseEvent | undefined;
    if (!source || typeof source.clientX !== 'number') return null;
    const viewport = this.holder.mapView.parentElement;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  async compositionCircles(data: CircleState[]): Promise<void> { await this.circleController.composition(data); }
  async updateCircle(state: CircleState): Promise<void> { await this.circleController.update(state); }
  hasCircle(state: CircleState): boolean { return this.circleController.has(state); }
  setOnCircleClickListener(listener: OnCircleEventHandler | null): void { this.circleController.setOnClickListener(listener); }

  async compositionPolylines(data: PolylineState[]): Promise<void> { await this.polylineController.composition(data); }
  async updatePolyline(state: PolylineState): Promise<void> { await this.polylineController.update(state); }
  hasPolyline(state: PolylineState): boolean { return this.polylineController.has(state); }
  setOnPolylineClickListener(listener: OnPolylineEventHandler | null): void { this.polylineController.setOnClickListener(listener); }

  async compositionPolygons(data: PolygonState[]): Promise<void> { await this.polygonController.composition(data); }
  async updatePolygon(state: PolygonState): Promise<void> { await this.polygonController.update(state); }
  hasPolygon(state: PolygonState): boolean { return this.polygonController.has(state); }
  setOnPolygonClickListener(listener: OnPolygonEventHandler | null): void { this.polygonController.setOnClickListener(listener); }

  async compositionGroundImages(data: GroundImageState[]): Promise<void> { await this.groundImageController.composition(data); }
  async updateGroundImage(state: GroundImageState): Promise<void> { await this.groundImageController.update(state); }
  hasGroundImage(state: GroundImageState): boolean { return this.groundImageController.has(state); }
  setOnGroundImageClickListener(listener: OnGroundImageEventHandler | null): void { this.groundImageController.setOnClickListener(listener); }

  async compositionRasterLayers(data: RasterLayerState[]): Promise<void> { await this.rasterLayerController.composition(data); }
  async updateRasterLayer(state: RasterLayerState): Promise<void> { await this.rasterLayerController.update(state); }
  hasRasterLayer(state: RasterLayerState): boolean { return this.rasterLayerController.has(state); }

  async clearOverlays(): Promise<void> {
    await Promise.all([
      this.markerController.clear(),
      this.circleController.clear(),
      this.polylineController.clear(),
      this.polygonController.clear(),
      this.groundImageController.clear(),
      this.rasterLayerController.clear(),
    ]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map.setTarget(undefined);
    void this.clearOverlays().finally(() => this.markerController.destroy());
  }

  private normalizePadding(value: CameraOptions['padding'] | CameraOptions['paddings']): number[] {
    if (typeof value === 'number') {
      return [value, value, value, value];
    }
    return value ? [value.top, value.right, value.bottom, value.left] : [0, 0, 0, 0];
  }
}

/**
 * Quantize a programmatic zoom target to the nearest integer, mirroring how
 * Google Maps 2D (the project-wide camera reference) snaps zoom. Keeps
 * OpenLayers aligned with Google at fractional demo zooms (Oahu 9.5 -> 10,
 * Kiribati 4.5 -> 5) instead of rendering the true half level Google never shows.
 */
function snapZoomToGoogle(zoom: number): number {
  return Math.round(zoom);
}

function toOpenLayersCamera(position: MapCameraPosition): MapCameraPosition {
  // Google Maps 2D snaps zoom to the nearest integer while OpenLayers renders
  // the true fractional zoom, leaving the two up to half a level apart at
  // fractional targets. Quantize programmatic targets the way Google does. Live
  // zoom reported from gestures (view.getZoom in getCameraPosition) stays fractional.
  if (position.tilt >= 0) return position.copy({ zoom: snapZoomToGoogle(position.zoom) });

  const tiltAbs = Math.min(Math.max(Math.abs(position.tilt), 0), 60);
  const tiltRadians = (tiltAbs * Math.PI) / 180;
  const latitudeRadians = (Math.max(-85, Math.min(85, position.position.latitude)) * Math.PI) / 180;
  const altitude = Math.min(
    Math.max((171_319_879 * Math.max(Math.abs(Math.cos(latitudeRadians)), 0.01)) / (2 ** position.zoom), 100),
    50_000_000,
  );
  const target = computeOffset({
    origin: position.position,
    distance: altitude * Math.cos(tiltRadians) * Math.tan(tiltRadians) * 1.83,
    heading: position.bearing,
  });

  return position.copy({
    position: target,
    zoom: position.zoom - 0.9 * (tiltAbs / 60),
    tilt: tiltAbs,
  });
}

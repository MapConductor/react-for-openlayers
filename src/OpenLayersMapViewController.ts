import {
  BaseMapViewController,
  createGeoPoint,
  MapUISettingsDiagnostics,
  type MapUISettings,
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
} from '@mapconductor/js-sdk-core';
import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Types as MapBrowserEventTypes } from 'ol/MapBrowserEventType';
import type View from 'ol/View';
import DragPan from 'ol/interaction/DragPan.js';
import DragZoom from 'ol/interaction/DragZoom.js';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import KeyboardPan from 'ol/interaction/KeyboardPan.js';
import KeyboardZoom from 'ol/interaction/KeyboardZoom.js';
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom.js';
import PinchZoom from 'ol/interaction/PinchZoom.js';
import { OpenLayersMapViewHolder } from './OpenLayersMapViewHolder';
import { toLonLat } from 'ol/proj.js';
import { OpenLayersMarkerController } from './marker/OpenLayersMarkerController';
import {
  OpenLayersCircleController,
  OpenLayersGroundImageController,
  OpenLayersPolygonController,
  OpenLayersPolylineController,
} from './vector/OpenLayersVectorControllers';
import { OpenLayersRasterLayerController } from './raster/OpenLayersRasterLayer';
import { OpenLayersCameraState } from './OpenLayersCameraState';
import { fromOpenLayersEvent } from './helpers';

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

  /** 論理カメラの保持とカメラ操作。状態を持つのでコンストラクタで組み立てて注入する。 */
  private readonly camera: OpenLayersCameraState;
  private destroyed = false;
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
    this.camera = new OpenLayersCameraState(
      { map: this.map, view: this.view, holder },
      initialTilt,
      initialBearing,
    );
    const initialCenter = this.view.getCenter();
    const initialPosition = initialCenter
      ? (() => {
          const [longitude, latitude] = toLonLat(initialCenter);
          return createGeoPoint({ latitude, longitude });
        })()
      : null;
    this.camera.seed(initialPosition, this.view.getZoom() ?? 0);
    this.view.setRotation(0);
    this.camera.applyInitialOverride();
    holder.setController(this);
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };
    this.setupEvents();
  }

  getMap(): Map { return this.map; }

  /**
   * OpenLayers keeps its interactions in one collection, so each is matched by
   * type and switched with `setActive`. Interactions MapConductor adds itself
   * (marker `Translate`) are left alone.
   *
   * The view's own rotation is pinned to 0 — bearing and tilt are faked with a
   * CSS transform — so there is no rotate or tilt gesture to disable.
   */
  applyUISettings(settings: MapUISettings): void {
    for (const interaction of this.map.getInteractions().getArray()) {
      if (interaction instanceof DragPan || interaction instanceof KeyboardPan) {
        interaction.setActive(settings.scrollGesture);
      } else if (
        interaction instanceof MouseWheelZoom
        || interaction instanceof DoubleClickZoom
        || interaction instanceof PinchZoom
        || interaction instanceof DragZoom
        || interaction instanceof KeyboardZoom
      ) {
        interaction.setActive(settings.zoomGesture);
      }
    }

    MapUISettingsDiagnostics.warnIfRequested(
      settings.rotateGesture, 'rotate', 'OpenLayers',
      'bearing is emulated with a CSS transform, so there is no rotate gesture',
    );
    MapUISettingsDiagnostics.warnIfRequested(
      settings.tiltGesture, 'tilt', 'OpenLayers',
      'tilt is emulated with a CSS transform, so there is no tilt gesture',
    );
  }

  getVisualTilt(): number { return this.camera.visualTilt; }

  getVisualBearing(): number { return this.camera.visualBearing; }

  getCameraPosition(): MapCameraPosition { return this.camera.read(); }

  async moveCamera(position: MapCameraPosition): Promise<boolean> { return this.camera.move(position); }

  async animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    return this.camera.animate(position, durationMillis);
  }

  async fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    return this.camera.fit(bounds, padding);
  }

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

    this.map.on('click', (event: MapBrowserEvent) => {
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

    // 'contextmenu' is delivered by OpenLayers as a MapBrowserEvent at runtime
    // but is absent from OL's typed map-browser event-name union, so the name
    // needs a narrowing cast (string -> MapBrowserEventTypes, no `any`).
    this.map.on('contextmenu' as string as MapBrowserEventTypes, (event: MapBrowserEvent) => {
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

}



import { PolygonTiler, POLYGON_TILE_LAYER_ID, polygonTileRasterLayerState, POLYLINE_TILE_LAYER_ID, polylineTileRasterLayerState, CIRCLE_TILE_LAYER_ID, circleTileRasterLayerState } from '@mapconductor/js-sdk-core';
import {
  BaseMapViewController,
  createGeoPoint,
  MapUISettingsDiagnostics,
  type MapUISettings,
  type CircleCapable,
  type GeoRectBounds,
  type GroundImageCapable,
  type GeoPoint,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type Offset,
  type OnMapInitializedHandler,
  type OnMarkerEventHandler,
  type PolygonCapable,
  type PolylineCapable,
  type RasterLayerCapable,
} from '@mapconductor/js-sdk-core';
import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Types as MapBrowserEventTypes } from 'ol/MapBrowserEventType';
import type View from 'ol/View';
import TileLayer from 'ol/layer/Tile.js';
import type { OpenLayersMapDesignType } from './OpenLayersDesign';
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
import { fromOpenLayersEvent, toCoordinate } from './helpers';

/** Pointer travel before a press on a marker becomes a drag (a click below it). */
const DRAG_SLOP_PX = 4;

/** Zoom levels for one wheel event: a mouse notch is about one level. */
function wheelZoomDelta(event: WheelEvent): number {
  const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
  return Math.max(-1, Math.min(1, -pixels / 100));
}

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
  /** The basemap tile layer, or null for `OpenLayersDesign.None`. */
  private baseLayer: TileLayer | null;

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
    baseLayer: TileLayer | null = null,
  ) {
    super();
    this.baseLayer = baseLayer;

    // Capable ファサードの既定実装がここから kind で引く。

    // **登録を忘れると composition が黙って捨てられる。**

    this.registerOverlayController(this.markerController);

    this.registerOverlayController(this.circleController);

    this.registerOverlayController(this.polylineController);

    this.registerOverlayController(this.polygonController);

    this.registerOverlayController(this.groundImageController);

    this.registerOverlayController(this.rasterLayerController);
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
    // Many polygons are drawn as tiles by the tile service worker and shown
    // as one raster layer; taps still resolve against the original shapes.
    this.polygonController.tiler = new PolygonTiler();
    this.polygonController.tiler.onTemplate = async (template, tileSize) => {
      if (template) await this.rasterLayerController.upsert(polygonTileRasterLayerState(template, tileSize));
      else await this.rasterLayerController.removeById(POLYGON_TILE_LAYER_ID);
    };
    // Many polylines are drawn as tiles too (the tiler is set by the provider, with the map's
    // PolylineTilingOptions) and shown as one raster layer, in the polyline band.
    if (this.polylineController.tiler) {
      this.polylineController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(polylineTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(POLYLINE_TILE_LAYER_ID);
      };
    }
    // Many circles are drawn as tiles too (the tiler is set by the provider, with the map's
    // CircleTilingOptions) and shown as one raster layer, at the bottom of the circle band.
    if (this.circleController.tiler) {
      this.circleController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(circleTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(CIRCLE_TILE_LAYER_ID);
      };
    }
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };
    this.setupEvents();
    this.uninstallTransformedGestures = this.installTransformedGestures();
  }

  getMap(): Map { return this.map; }

  /**
   * Swaps the basemap tile layer in place. It goes in at index 0: the
   * overlay layers carry no zIndex of their own, so insertion order is what
   * keeps the basemap underneath. Called by the view state's
   * `mapDesignType` setter.
   */
  setMapDesignType(design: OpenLayersMapDesignType): void {
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);
    this.baseLayer = design.tileSource ? new TileLayer({ source: design.tileSource }) : null;
    if (this.baseLayer) this.map.getLayers().insertAt(0, this.baseLayer);
  }

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
      // OpenLayers のフィーチャーヒットは DOM ではなくピクセル判定なので、
      // マーカーだけは先にここで見る（dispatchMarkerTap では pixel を渡せない）。
      const feature = this.map.forEachFeatureAtPixel(event.pixel, candidate => candidate) as {
        getId(): string | number | undefined;
      } | undefined;
      if (feature && this.markerController.handleFeatureClick(feature)) return;
      this.lastClickEvent = event;
      // marker → circle → groundImage → polyline → polygon → map の一本道。
      // 順序と先勝ちはコアの BaseMapViewController.dispatchTap が持つ。
      this.dispatchTap(this.eventGeoPoint(event));
      this.lastClickEvent = null;
    });

    // 'contextmenu' is delivered by OpenLayers as a MapBrowserEvent at runtime
    // but is absent from OL's typed map-browser event-name union, so the name
    // needs a narrowing cast (string -> MapBrowserEventTypes, no `any`).
    this.map.on('contextmenu' as string as MapBrowserEventTypes, (event: MapBrowserEvent) => {
      this.notifyMapLongClick(this.eventGeoPoint(event));
    });

    const camera = this.getCameraPosition();
    if (camera) void this.notifyControllersCameraChanged(camera);
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

  /** @internal */
  private isPlaneTransformed(): boolean {
    return this.getVisualTilt() > 0.5 || Math.abs(this.getVisualBearing()) > 0.01;
  }

  /**
   * The ground point of a map event. OpenLayers reads the pointer against the
   * map element's bounding box, which the plane's CSS rotation/tilt throws off,
   * so while the plane is transformed the point is reprojected from the
   * pointer's position in the outer container.
   *
   * @internal
   */
  private eventGeoPoint(event: MapBrowserEvent): GeoPoint {
    if (this.isPlaneTransformed()) {
      const outer = this.outerOffsetFromEvent(event.originalEvent);
      if (outer) return this.holder.fromScreenOffsetSync(outer);
    }
    return fromOpenLayersEvent(event);
  }

  /** @internal */
  private uninstallTransformedGestures: () => void = () => {};

  /**
   * Pans, wheel-zooms and drags markers by hand while the plane is rotated or
   * tilted.
   *
   * `DragPan` and `MouseWheelZoom` read the pointer in the plane's
   * untransformed pixels, so on a rotated map the map slides off at the
   * bearing's angle and zooms toward the wrong point. The native marker layer
   * is hidden meanwhile (upright billboards are drawn instead), so `Translate`
   * cannot start a marker drag either. While the plane is transformed:
   *
   * - a press on a draggable marker drags it, keeping the grab offset on
   *   screen, once the pointer has moved past `DRAG_SLOP_PX`;
   * - any other press pans, keeping the grabbed ground point under the pointer;
   * - the wheel zooms about the ground under the cursor.
   *
   * A flat, north-up map keeps OpenLayers' own interactions (and their
   * inertia). Listens in the capture phase on the plane's parent so it runs
   * before OpenLayers' own pointer handling. Returns the uninstaller.
   *
   * @internal
   */
  private installTransformedGestures(): () => void {
    const outer = this.holder.mapView.parentElement;
    if (!outer) return () => {};
    let pointerId: number | null = null;
    let down: Offset | null = null;
    // Pan: the ground point grabbed. Marker drag: the marker and the pointer's
    // offset from its anchor on screen.
    let anchor: number[] | null = null;
    let marker: { state: MarkerState; grab: Offset; started: boolean } | null = null;
    let suspended: DragPan[] = [];

    const screenOffset = (event: MouseEvent): Offset => {
      const rect = outer.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const mapPixelOf = (offset: Offset) =>
      this.map.getPixelFromCoordinate(toCoordinate(this.holder.fromScreenOffsetSync(offset)));

    const end = () => {
      if (pointerId == null) return;
      pointerId = null;
      down = null;
      anchor = null;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (marker?.started) this.markerController.endScreenDrag(marker.state);
      marker = null;
      for (const interaction of suspended) interaction.setActive(true);
      suspended = [];
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const at = screenOffset(event);
      if (marker) {
        if (!marker.started) {
          if (!down || Math.hypot(at.x - down.x, at.y - down.y) < DRAG_SLOP_PX) return;
          marker.started = true;
          this.markerController.beginScreenDrag(marker.state);
        }
        const position = this.holder.fromScreenOffsetSync({ x: at.x - marker.grab.x, y: at.y - marker.grab.y });
        this.markerController.moveScreenDrag(marker.state, position);
        return;
      }
      if (!anchor) return;
      const anchorPx = this.map.getPixelFromCoordinate(anchor);
      const pointerPx = mapPixelOf(at);
      const size = this.map.getSize();
      if (!anchorPx || !pointerPx || !size) return;
      // Both points in the plane's own pixels: move the centre by the gap
      // between where the anchor is and where the pointer now is.
      const center = this.map.getCoordinateFromPixel([
        size[0] / 2 + anchorPx[0] - pointerPx[0],
        size[1] / 2 + anchorPx[1] - pointerPx[1],
      ]);
      if (center) this.view.setCenter(center);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId) end();
    };
    const onDown = (event: PointerEvent) => {
      if (pointerId != null) {
        // A second finger: leave the gesture (pinch) to OpenLayers.
        end();
        return;
      }
      if (!event.isPrimary || event.button !== 0 || !this.isPlaneTransformed()) return;
      const at = screenOffset(event);
      const dragPans = this.map.getInteractions().getArray()
        .filter((interaction): interaction is DragPan => interaction instanceof DragPan && interaction.getActive());
      const hit = this.markerController.isNativeMarkersVisible()
        ? null
        : this.markerController.findAtScreen(at, event.pointerType === 'touch' ? 'touch' : 'mouse');
      if (hit?.state.draggable) {
        const anchorScreen = this.holder.toScreenOffset(hit.state.position);
        marker = { state: hit.state, grab: { x: at.x - anchorScreen.x, y: at.y - anchorScreen.y }, started: false };
      } else if (dragPans.length > 0) {
        anchor = toCoordinate(this.holder.fromScreenOffsetSync(at));
      } else {
        // DragPan switched off by the app's UI settings: no panning at all.
        return;
      }
      pointerId = event.pointerId;
      down = at;
      suspended = dragPans;
      for (const interaction of suspended) interaction.setActive(false);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    };
    // MouseWheelZoom anchors on the pointer read the same untransformed way,
    // so it zooms toward the wrong point; zoom about the ground under the cursor.
    const onWheel = (event: WheelEvent) => {
      if (!this.isPlaneTransformed()) return;
      const wheelZoom = this.map.getInteractions().getArray()
        .some(interaction => interaction instanceof MouseWheelZoom && interaction.getActive());
      if (!wheelZoom) return;
      event.preventDefault();
      event.stopPropagation();
      const anchorCoordinate = toCoordinate(this.holder.fromScreenOffsetSync(screenOffset(event)));
      this.view.adjustZoom(wheelZoomDelta(event), anchorCoordinate);
    };

    outer.addEventListener('pointerdown', onDown, true);
    outer.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      end();
      outer.removeEventListener('pointerdown', onDown, true);
      outer.removeEventListener('wheel', onWheel, true);
    };
  }

  async clearOverlays(): Promise<void> {
    await this.clearOverlayControllers([
      this.markerController,
      this.circleController,
      this.polylineController,
      this.polygonController,
      this.groundImageController,
      this.rasterLayerController,
    ]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uninstallTransformedGestures();
    this.map.setTarget(undefined);
    void this.clearOverlays().finally(() => this.markerController.destroy());
  }


  /** クリックした OpenLayers のイベント。`dispatchMarkerTap` が画面座標を要るため。 */
  private lastClickEvent: MapBrowserEvent | null = null;

  /**
   * マーカーのヒットテストと配送。カスケードの先頭。
   *
   * タイル方式のマーカーと、傾き中のビルボード（OpenLayers のフィーチャー判定が
   * CSS transform でずれるため画面座標で見る）の 2 経路を持つのでここに置く。
   */
  protected override dispatchMarkerTap(clicked: GeoPoint): boolean {
    const zoom = this.view.getZoom() ?? 0;
    const tiled = this.markerController.findTiled(clicked, zoom);
    if (tiled?.state.clickable) {
      this.markerController.dispatchClick(tiled.state);
      return true;
    }
    if (!this.markerController.isNativeMarkersVisible() && this.lastClickEvent) {
      const outer = this.outerOffsetFromEvent(this.lastClickEvent.originalEvent);
      const pointerType = (this.lastClickEvent.originalEvent as PointerEvent | undefined)?.pointerType === 'touch' ? 'touch' : 'mouse';
      const entity = outer ? this.markerController.findAtScreen(outer, pointerType) : null;
      if (entity?.state.clickable) {
        this.markerController.dispatchClick(entity.state);
        return true;
      }
    }
    return false;
  }

}


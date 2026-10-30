import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MARKER_HIT_RADIUS_TOUCH_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  createDefaultIcon,
  createGeoPoint,
  createRasterLayerState,
  markerHitShape,
  pickMarkerHit,
  tilePixelRatio,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  type Offset,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import type Feature from 'ol/Feature';
import type { Point } from 'ol/geom';
import Translate, { type TranslateEvent } from 'ol/interaction/Translate.js';
import { toLonLat } from 'ol/proj.js';
import { localTileUrlTemplate } from '../raster/localTileUrl';
import { OpenLayersMarkerOverlayRenderer } from './OpenLayersMarkerOverlayRenderer';

const MARKER_DRAG_THRESHOLD_PX = 3;

export class OpenLayersMarkerController extends AbstractMarkerController<Feature<Point>> {
  declare readonly renderer: OpenLayersMarkerOverlayRenderer;

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  /** Device pixels per CSS pixel the current tiles are drawn at. */
  private tilePixelRatio = 1;
  private tileGeneration = 0;
  private readonly translateInteraction: Translate;
  private suppressClickId: string | null = null;
  private suppressClickUntil = 0;
  private translateStartPixel: [number, number] | null = null;
  private translateStarted = false;

  onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null = null;

  constructor(
    renderer: OpenLayersMarkerOverlayRenderer,
    private readonly tilingOptions: MarkerTilingOptions = MarkerTilingOptions.Default,
  ) {
    super({
      markerManager: MarkerManager.defaultManager<Feature<Point>>(
        null,
        tilingOptions.minMarkerCount,
      ),
      renderer,
    });

    this.translateInteraction = new Translate({
      hitTolerance: 4,
      filter: feature => {
        const id = feature.getId();
        if (id == null) return false;
        const entity = this.markerManager.getEntity(String(id));
        return entity?.marker === feature && entity.state.draggable;
      },
    });
    this.translateInteraction.on('translatestart', this.handleTranslateStart);
    this.translateInteraction.on('translating', this.handleTranslating);
    this.translateInteraction.on('translateend', this.handleTranslateEnd);
    renderer.holder.map.addInteraction(this.translateInteraction);
  }

  override async update(state: MarkerState): Promise<void> {
    if (this.isDragging(state)) return;
    await super.update(state);
  }

  findTiled(position: GeoPoint, zoom: number): MarkerEntity<Feature<Point>> | null {
    const found = this.tileRenderer?.findNearest(position, MARKER_HIT_RADIUS_MOUSE_PX, zoom);
    return found ? this.markerManager.getEntity(found.id) : null;
  }

  /**
   * Shows/hides every native marker (the whole vector layer). The 2D view hides
   * them while its CSS tilt hack is active — they would otherwise lie flat
   * against the ground — and draws upright canvas billboards instead. Hit-testing
   * is unaffected: clicks are resolved via findAtScreen while tilted.
   */
  setNativeMarkersVisible(visible: boolean): void {
    this.renderer.setNativeVisible(visible);
  }

  /** Whether native markers are currently visible (false while tilted). */
  isNativeMarkersVisible(): boolean {
    return this.renderer.isNativeVisible;
  }

  /** Live states of the non-tiled (native) markers, for the tilt billboard canvas. */
  getNonTiledMarkerStates(): MarkerState[] {
    return this.markerManager
      .allEntities()
      .filter(entity => entity.marker !== null)
      .map(entity => entity.state);
  }

  /**
   * Hit-tests non-tiled markers against a screen point in the tilt-aware viewport
   * space used by the canvas billboards (see holder.toScreenOffset). Returns the
   * top-most marker whose drawn pin (label included, `markerHitShape`) contains
   * the point, falling back to the nearest within the pointer's slop (none for a
   * mouse, MARKER_HIT_RADIUS_TOUCH_PX for a finger); chosen by the core
   * `pickMarkerHit`. Used for clicks while tilted, where OpenLayers' own feature
   * hit-testing — which is by drawn pixel — is skewed by the CSS transform. It
   * used to test the whole square bitmap plus `Settings.Default.tapTolerance`
   * (48 px). Mirrors HERE's `find`.
   */
  findAtScreen(touch: Offset, pointerType: 'touch' | 'mouse' = 'mouse'): MarkerEntity<Feature<Point>> | null {
    const holder = this.renderer.holder;
    const tolerance = pointerType === 'touch' ? MARKER_HIT_RADIUS_TOUCH_PX : MARKER_HIT_RADIUS_MOUSE_PX;
    return (
      pickMarkerHit(
        touch,
        // tiled markers are hit-tested via findTiled
        this.markerManager.allEntities().filter(entity => entity.marker !== null),
        entity => ({
          anchorScreen: holder.toScreenOffset(entity.state.position),
          ...markerHitShape((entity.state.icon ?? createDefaultIcon()).toBitmapIcon()),
        }),
        tolerance,
      )?.item ?? null
    );
  }

  override async clear(): Promise<void> {
    await super.clear();
    await this.removeTileOverlay();
  }

  override destroy(): void {
    this.translateInteraction.un('translatestart', this.handleTranslateStart);
    this.translateInteraction.un('translating', this.handleTranslating);
    this.translateInteraction.un('translateend', this.handleTranslateEnd);
    this.renderer.holder.map.removeInteraction(this.translateInteraction);
    void this.removeTileOverlay();
    super.destroy();
  }

  protected override shouldTile(state: MarkerState, totalCount: number): boolean {
    return this.tilingOptions.enabled &&
      totalCount >= this.tilingOptions.minMarkerCount &&
      !state.draggable &&
      state.getAnimation() == null;
  }

  protected override async onTiledMarkersChanged(): Promise<void> {
    await this.syncTiledOverlay();
  }

  handleFeatureClick(feature: { getId(): string | number | undefined }): boolean {
    const id = feature.getId();
    if (id == null) return false;
    if (String(id) === this.suppressClickId && Date.now() <= this.suppressClickUntil) {
      this.suppressClickId = null;
      return true;
    }
    const state = this.markerManager.getEntity(String(id))?.state;
    if (!state?.clickable) return false;
    this.dispatchClick(state);
    return true;
  }

  private readonly handleTranslateStart = (event: TranslateEvent): void => {
    const entity = this.entityFromTranslateEvent(event);
    if (!entity) return;
    this.setDraggingState(entity.state, true);
    const [x, y] = event.mapBrowserEvent.pixel;
    this.translateStartPixel = [x, y];
    this.translateStarted = false;
  };

  private readonly handleTranslating = (event: TranslateEvent): void => {
    const entity = this.entityFromTranslateEvent(event);
    if (!entity) return;
    if (!this.translateStarted) {
      const start = this.translateStartPixel;
      const current = event.mapBrowserEvent.pixel;
      if (!start || Math.hypot(current[0] - start[0], current[1] - start[1]) < MARKER_DRAG_THRESHOLD_PX) {
        return;
      }
      this.translateStarted = true;
      this.dispatchDragStart(entity.state);
    }
    const position = this.positionFromEntity(entity);
    if (!position) return;
    entity.state.setPosition(position);
    this.dispatchDrag(entity.state);
  };

  private readonly handleTranslateEnd = (event: TranslateEvent): void => {
    const entity = this.entityFromTranslateEvent(event);
    if (!entity) return;
    const didTranslate = this.translateStarted;
    if (didTranslate) {
      const position = this.positionFromEntity(entity);
      if (position) entity.state.setPosition(position);
    }
    this.setDraggingState(entity.state, false);
    this.translateStartPixel = null;
    this.translateStarted = false;
    if (didTranslate) {
      this.suppressClickId = entity.state.id;
      this.suppressClickUntil = Date.now() + 500;
      this.dispatchDragEnd(entity.state);
    } else {
      this.renderer.setMarkerPosition(entity, entity.state.position);
    }
    void super.update(entity.state);
  };

  private entityFromTranslateEvent(event: TranslateEvent): MarkerEntity<Feature<Point>> | null {
    const feature = event.features.item(0) as Feature<Point> | undefined;
    const id = feature?.getId();
    if (!feature || id == null) return null;
    const entity = this.markerManager.getEntity(String(id));
    return entity?.marker === feature ? entity : null;
  }

  private positionFromEntity(entity: MarkerEntity<Feature<Point>>): GeoPoint | null {
    const coordinate = entity.marker?.getGeometry()?.getCoordinates();
    if (!coordinate) return null;
    const [longitude, latitude] = toLonLat(coordinate);
    return createGeoPoint({ latitude, longitude });
  }

  private async syncTiledOverlay(): Promise<void> {
    const generation = ++this.tileGeneration;
    const tiledStates = this.markerManager.allEntities()
      .filter(entity => entity.tiling)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-openlayers-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    // Tiles are laid out as 256 CSS pixels; drawing them at the display's ratio
    // keeps pins and labels sharp instead of stretching a 1x image.
    this.tilePixelRatio = tilePixelRatio();
    const renderer = new MarkerTileRenderer(
      tiledStates,
      256,
      this.tilingOptions.iconScaleCallback ?? undefined,
      1.0,
      false,
      this.tilingOptions.declutterPx,
      this.tilePixelRatio,
    );
    this.tileRenderer = renderer;
    this.tileVersion++;
    server.register(this.tileRouteId, renderer);

    let template: string;
    if (LocalTileServer.isServiceWorkerSupported()) {
      server.startServiceWorker('/tile-sw.js');
      await server.waitForController();
      await server.sendSWRegisterAndWait(this.tileRouteId, await renderer.toSWData());
      template = server.urlTemplate({
        routeId: this.tileRouteId,
        tileSize: 256,
        cacheKey: String(this.tileVersion),
        pixelRatio: this.tilePixelRatio,
      });
    } else {
      await renderer.preloadIcons();
      template = localTileUrlTemplate({
        routeId: this.tileRouteId,
        tileSize: 256,
        cacheKey: String(this.tileVersion),
        pixelRatio: this.tilePixelRatio,
      });
    }

    if (generation !== this.tileGeneration) return;
    await this.onRasterLayerUpdate?.(createRasterLayerState({
      id: 'mc-marker-tiles',
      source: RasterLayerSource.UrlTemplate({ template, tileSize: 256 }),
    }));
  }

  private async removeTileOverlay(): Promise<void> {
    this.tileGeneration++;
    if (!this.tileRouteId) return;
    LocalTileServer.startServer().unregister(this.tileRouteId);
    this.tileRenderer = null;
    this.tileRouteId = null;
    await this.onRasterLayerUpdate?.(null);
  }
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

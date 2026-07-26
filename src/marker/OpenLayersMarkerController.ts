import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  Settings,
  createDefaultIcon,
  createGeoPoint,
  createRasterLayerState,
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
import { OpenLayersMarkerOverlayRenderer } from './OpenLayersMarkerOverlayRenderer';

const MARKER_DRAG_THRESHOLD_PX = 3;

export class OpenLayersMarkerController extends AbstractMarkerController<Feature<Point>> {
  declare readonly renderer: OpenLayersMarkerOverlayRenderer;

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
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
   * top-most marker whose upright icon rectangle contains the point, falling back
   * to the nearest within the tap tolerance. Used for clicks while tilted, where
   * OpenLayers' own feature hit-testing is skewed by the CSS transform. Mirrors
   * HERE's `find`.
   */
  findAtScreen(touch: Offset): MarkerEntity<Feature<Point>> | null {
    const holder = this.renderer.holder;
    const tolerance = Settings.Default.tapTolerance;
    let bestOnIcon: MarkerEntity<Feature<Point>> | null = null;
    let bestOnIconY = -Infinity;
    let bestNear: MarkerEntity<Feature<Point>> | null = null;
    let bestNearDistSq = Infinity;
    for (const entity of this.markerManager.allEntities()) {
      if (entity.marker === null) continue; // tiled markers are hit-tested via findTiled
      const markerScreen = holder.toScreenOffset(entity.state.position);
      const icon = (entity.state.icon ?? createDefaultIcon()).toBitmapIcon();
      const dx = touch.x - markerScreen.x;
      const dy = touch.y - markerScreen.y;
      const left = -icon.anchor.x * icon.size.width;
      const right = (1 - icon.anchor.x) * icon.size.width;
      const top = -icon.anchor.y * icon.size.height;
      const bottom = (1 - icon.anchor.y) * icon.size.height;
      if (dx >= left && dx <= right && dy >= top && dy <= bottom) {
        if (markerScreen.y > bestOnIconY) {
          bestOnIconY = markerScreen.y;
          bestOnIcon = entity;
        }
      } else if (dx >= left - tolerance && dx <= right + tolerance && dy >= top - tolerance && dy <= bottom + tolerance) {
        const distSq = dx * dx + dy * dy;
        if (distSq < bestNearDistSq) {
          bestNearDistSq = distSq;
          bestNear = entity;
        }
      }
    }
    return bestOnIcon ?? bestNear;
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
      .filter(entity => entity.marker === null)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-openlayers-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    const renderer = new MarkerTileRenderer(tiledStates, {
      tileSize: 256,
      iconScaleCallback: this.tilingOptions.iconScaleCallback ?? undefined,
    });
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
      });
    } else {
      await renderer.preloadIcons();
      template = `mc-local-tile://${this.tileRouteId}/256/${this.tileVersion}/{z}/{x}/{y}.png`;
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

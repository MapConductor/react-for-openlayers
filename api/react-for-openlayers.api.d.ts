import { MapDesignTypeInterface, AttributionRule, MapViewStateInterface, MapViewState, MapCameraPosition, MapViewControllerInterface, MapViewBaseProps, GeoRectBounds, MarkerTilingOptions, MapViewHolderBase, GeoPointInterface, Offset, GeoPoint, AbstractMarkerOverlayRenderer, AddParams, ChangeParams, MarkerEntity, AbstractMarkerController, RasterLayerState, MarkerState, CircleController, AbstractCircleOverlayRenderer, CircleState, CircleEntity, PolylineController, AbstractPolylineOverlayRenderer, PolylineState, PolylineEntity, PolygonController, AbstractPolygonOverlayRenderer, PolygonState, PolygonEntity, GroundImageController, AbstractGroundImageOverlayRenderer, GroundImageState, GroundImageEntity, RasterLayerController, RasterHeaderSupport, RasterLayerAddParams, RasterLayerChangeParams, RasterLayerEntity, BaseMapViewController, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable, MapUISettings, OnMapInitializedHandler, OnMarkerEventHandler, MarkerAnimationOverlayHost, MapConfig, MapProvider } from '@mapconductor/js-sdk-core';
import TileSource from 'ol/source/Tile';
import * as react from 'react';
import { CSSProperties, ReactNode } from 'react';
import Map, { MapOptions } from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { Point } from 'ol/geom';
import LineString from 'ol/geom/LineString';
import PolygonGeometry from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';

interface OpenLayersMapDesignType extends MapDesignTypeInterface<string> {
    readonly tileSource: TileSource | null;
}
interface OpenLayersDesignParams {
    id: string;
    tileSource: TileSource | null;
    attributionRules?: readonly AttributionRule[];
}
declare class OpenLayersDesign implements OpenLayersMapDesignType {
    readonly id: string;
    readonly tileSource: TileSource | null;
    readonly attributionRules: readonly AttributionRule[];
    constructor({ id, tileSource, attributionRules, }: OpenLayersDesignParams);
    getValue(): string;
    static readonly OpenStreetMap: OpenLayersDesign;
    static readonly None: OpenLayersDesign;
}

interface OpenLayersMapViewStateInterface extends MapViewStateInterface<OpenLayersMapDesignType> {
}
interface OpenLayersMapViewStateParams {
    id?: string;
    mapDesignType?: OpenLayersMapDesignType;
    cameraPosition?: MapCameraPosition;
}
declare class OpenLayersMapViewState extends MapViewState<OpenLayersMapDesignType> implements OpenLayersMapViewStateInterface {
    private _mapDesignType;
    constructor({ id, mapDesignType, cameraPosition, }?: OpenLayersMapViewStateParams);
    get mapDesignType(): OpenLayersMapDesignType;
    set mapDesignType(value: OpenLayersMapDesignType);
    /** このプロバイダは接続時にカメラを動かさない（ビュー側が別経路で初期位置を当てる）。 */
    setController(controller: MapViewControllerInterface | null): void;
}
declare function useOpenLayersMapViewState(params?: OpenLayersMapViewStateParams): OpenLayersMapViewStateInterface;

interface OpenLayersMapViewProps extends MapViewBaseProps<OpenLayersMapViewStateInterface> {
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    className?: string;
    containerStyle?: CSSProperties;
    options?: Omit<MapOptions, 'target'>;
    onError?: (error: Error) => void;
    children?: ReactNode;
    markerTilingOptions?: MarkerTilingOptions;
}
declare function OpenLayersMapView({ state, onMapLoaded, onMapClick, onMapLongClick, onCameraMoveStart, onCameraMove, onCameraMoveEnd, maxZoom, minZoom, restrictBounds, cameraRestriction, className, containerStyle, options, onError, children, markerTilingOptions, }: OpenLayersMapViewProps): react.JSX.Element;

declare class OpenLayersMapViewHolder extends MapViewHolderBase<HTMLElement, Map> {
    readonly mapView: HTMLElement;
    readonly map: Map;
    readonly view: View;
    private controller;
    constructor(mapView: HTMLElement, map: Map, view: View);
    getController(): OpenLayersMapViewController | null;
    setController(controller: OpenLayersMapViewController): void;
    toScreenOffset(position: GeoPointInterface): Offset;
    fromScreenOffsetSync(offset: Offset): GeoPoint;
    private mapPixelToViewport;
    private viewportToMapPixel;
}

declare class OpenLayersMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<OpenLayersMapViewHolder, Feature<Point>> {
    private vectorSource;
    private vectorLayer;
    constructor(holder: OpenLayersMapViewHolder);
    /**
     * Whether the native marker vector layer is visible. The 2D view fakes camera
     * tilt with a CSS `rotateX` on the map, which lays the canvas-drawn marker
     * icons flat against the ground. While tilted the view hides this layer and
     * draws upright, billboarded icons on a separate canvas instead. Toggling the
     * layer hides every non-tiled marker (and any added later) at once.
     */
    setNativeVisible(visible: boolean): void;
    /** Whether native markers are currently visible (false while tilted). */
    get isNativeVisible(): boolean;
    onAdd(data: AddParams[]): Promise<(Feature<Point> | null)[]>;
    onChange(data: ChangeParams<Feature<Point>>[]): Promise<(Feature<Point> | null)[]>;
    onRemove(data: MarkerEntity<Feature<Point>>[]): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerPosition(entity: MarkerEntity<Feature<Point>>, position: GeoPoint): void;
    setMarkerVisible(entity: MarkerEntity<Feature<Point>>, visible: boolean): void;
    private createStyle;
}

declare class OpenLayersMarkerController extends AbstractMarkerController<Feature<Point>> {
    private readonly tilingOptions;
    readonly renderer: OpenLayersMarkerOverlayRenderer;
    private tileRenderer;
    private tileRouteId;
    private tileVersion;
    private tileGeneration;
    private readonly translateInteraction;
    private suppressClickId;
    private suppressClickUntil;
    private translateStartPixel;
    private translateStarted;
    onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null;
    constructor(renderer: OpenLayersMarkerOverlayRenderer, tilingOptions?: MarkerTilingOptions);
    update(state: MarkerState): Promise<void>;
    findTiled(position: GeoPoint, zoom: number): MarkerEntity<Feature<Point>> | null;
    /**
     * Shows/hides every native marker (the whole vector layer). The 2D view hides
     * them while its CSS tilt hack is active — they would otherwise lie flat
     * against the ground — and draws upright canvas billboards instead. Hit-testing
     * is unaffected: clicks are resolved via findAtScreen while tilted.
     */
    setNativeMarkersVisible(visible: boolean): void;
    /** Whether native markers are currently visible (false while tilted). */
    isNativeMarkersVisible(): boolean;
    /** Live states of the non-tiled (native) markers, for the tilt billboard canvas. */
    getNonTiledMarkerStates(): MarkerState[];
    /**
     * Hit-tests non-tiled markers against a screen point in the tilt-aware viewport
     * space used by the canvas billboards (see holder.toScreenOffset). Returns the
     * top-most marker whose upright icon rectangle contains the point, falling back
     * to the nearest within the tap tolerance. Used for clicks while tilted, where
     * OpenLayers' own feature hit-testing is skewed by the CSS transform. Mirrors
     * HERE's `find`.
     */
    findAtScreen(touch: Offset): MarkerEntity<Feature<Point>> | null;
    clear(): Promise<void>;
    destroy(): void;
    protected shouldTile(state: MarkerState, totalCount: number): boolean;
    protected onTiledMarkersChanged(): Promise<void>;
    handleFeatureClick(feature: {
        getId(): string | number | undefined;
    }): boolean;
    private readonly handleTranslateStart;
    private readonly handleTranslating;
    private readonly handleTranslateEnd;
    private entityFromTranslateEvent;
    private positionFromEntity;
    private syncTiledOverlay;
    private removeTileOverlay;
}

declare class OpenLayersCircleRenderer extends AbstractCircleOverlayRenderer<OpenLayersMapViewHolder, Feature<PolygonGeometry>> {
    private layers;
    createCircle(state: CircleState): Promise<Feature<PolygonGeometry>>;
    updateCircleProperties({ current, }: {
        current: CircleEntity<Feature<PolygonGeometry>>;
    }): Promise<Feature<PolygonGeometry>>;
    removeCircle(entity: CircleEntity<Feature<PolygonGeometry>>): Promise<void>;
}
declare class OpenLayersCircleController extends CircleController<Feature<PolygonGeometry>> {
    constructor(renderer: OpenLayersCircleRenderer);
}
declare class OpenLayersPolylineRenderer extends AbstractPolylineOverlayRenderer<OpenLayersMapViewHolder, Feature<LineString>> {
    private layers;
    createPolyline(state: PolylineState): Promise<Feature<LineString>>;
    updatePolylineProperties({ current, }: {
        current: PolylineEntity<Feature<LineString>>;
    }): Promise<Feature<LineString>>;
    removePolyline(entity: PolylineEntity<Feature<LineString>>): Promise<void>;
}
declare class OpenLayersPolylineController extends PolylineController<Feature<LineString>> {
    constructor(renderer: OpenLayersPolylineRenderer);
}
declare class OpenLayersPolygonRenderer extends AbstractPolygonOverlayRenderer<OpenLayersMapViewHolder, Feature<PolygonGeometry>> {
    private layers;
    createPolygon(state: PolygonState): Promise<Feature<PolygonGeometry>>;
    updatePolygonProperties({ current, }: {
        current: PolygonEntity<Feature<PolygonGeometry>>;
    }): Promise<Feature<PolygonGeometry>>;
    removePolygon(entity: PolygonEntity<Feature<PolygonGeometry>>): Promise<void>;
}
declare class OpenLayersPolygonController extends PolygonController<Feature<PolygonGeometry>> {
    constructor(renderer: OpenLayersPolygonRenderer);
}
declare class OpenLayersGroundImageRenderer extends AbstractGroundImageOverlayRenderer<OpenLayersMapViewHolder, Feature<Point>> {
    private readonly currentLayer;
    private readonly pendingLayer;
    private extentOf;
    private buildLayer;
    private dropPending;
    createGroundImage(state: GroundImageState): Promise<Feature<Point> | null>;
    updateGroundImageProperties({ current, }: {
        current: GroundImageEntity<Feature<Point>>;
    }): Promise<Feature<Point> | null>;
    removeGroundImage(entity: GroundImageEntity<Feature<Point>>): Promise<void>;
}
declare class OpenLayersGroundImageController extends GroundImageController<Feature<Point>> {
    constructor(renderer: OpenLayersGroundImageRenderer);
}

declare class OpenLayersRasterLayerRenderer {
    readonly holder: OpenLayersMapViewHolder;
    constructor(holder: OpenLayersMapViewHolder);
    onAdd(data: RasterLayerAddParams[]): Promise<(TileLayer<TileSource> | null)[]>;
    onChange(data: RasterLayerChangeParams<TileLayer<TileSource>>[]): Promise<(TileLayer<TileSource> | null)[]>;
    onRemove(data: RasterLayerEntity<TileLayer<TileSource>>[]): Promise<void>;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
    private create;
    private parseLocalTileTemplate;
    /** `extraHeaders` を載せてタイルを取り、blob URL に差し替える。 */
    private loadTileWithHeaders;
    private loadLocalTile;
    private parseLocalTileRequest;
}
declare class OpenLayersRasterLayerController extends RasterLayerController<TileLayer<TileSource>> {
    /**
     * ヘッダ指定があるときだけ tileLoadFunction を fetch 経路に差し替える。
     *
     * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
     */
    protected get headerSupport(): RasterHeaderSupport;
    constructor(renderer: OpenLayersRasterLayerRenderer);
    composition(data: RasterLayerState[]): Promise<void>;
    update(state: RasterLayerState): Promise<void>;
    updateInternal(state: RasterLayerState): Promise<void>;
    removeInternal(id: string): Promise<void>;
}

declare class OpenLayersMapViewController extends BaseMapViewController implements MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable {
    readonly holder: OpenLayersMapViewHolder;
    private readonly markerController;
    private readonly circleController;
    private readonly polylineController;
    private readonly polygonController;
    private readonly groundImageController;
    private readonly rasterLayerController;
    private readonly map;
    private readonly view;
    /** 論理カメラの保持とカメラ操作。状態を持つのでコンストラクタで組み立てて注入する。 */
    private readonly camera;
    private destroyed;
    private isCameraMoving;
    constructor(holder: OpenLayersMapViewHolder, markerController: OpenLayersMarkerController, circleController: OpenLayersCircleController, polylineController: OpenLayersPolylineController, polygonController: OpenLayersPolygonController, groundImageController: OpenLayersGroundImageController, rasterLayerController: OpenLayersRasterLayerController, initialTilt?: number, initialBearing?: number);
    getMap(): Map;
    /**
     * OpenLayers keeps its interactions in one collection, so each is matched by
     * type and switched with `setActive`. Interactions MapConductor adds itself
     * (marker `Translate`) are left alone.
     *
     * The view's own rotation is pinned to 0 — bearing and tilt are faked with a
     * CSS transform — so there is no rotate or tilt gesture to disable.
     */
    applyUISettings(settings: MapUISettings): void;
    getVisualTilt(): number;
    getVisualBearing(): number;
    getCameraPosition(): MapCameraPosition;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    private setupEvents;
    private dispatchOverlayClick;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    private notifyControllersCameraChanged;
    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    /** Hide/show native markers when the CSS tilt hack is toggled (see OpenLayersMapView). */
    setNativeMarkersVisible(visible: boolean): void;
    /** Whether native markers are currently visible (false while tilted). */
    isNativeMarkersVisible(): boolean;
    /** Live states of the non-tiled markers, drawn as upright billboards while tilted. */
    getNonTiledMarkerStates(): MarkerState[];
    /**
     * The pointer position of a DOM event in the tilt-aware viewport pixel space
     * used by the billboard canvas and `findAtScreen` (see
     * OpenLayersMapViewHolder.toScreenOffset / mapPixelToViewport). That space is
     * relative to the outer (untransformed) viewport container.
     */
    private outerOffsetFromEvent;
    clearOverlays(): Promise<void>;
    destroy(): void;
}

interface OpenLayersConfig extends MapConfig {
    mapDesignType: OpenLayersMapDesignType;
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    markerTilingOptions?: MarkerTilingOptions;
    options?: Omit<MapOptions, 'target'>;
}
declare class OpenLayersProvider extends MapProvider {
    initialize(config: OpenLayersConfig): Promise<MapViewControllerInterface>;
    destroy(): void;
}

export { type OpenLayersConfig, OpenLayersDesign, type OpenLayersMapDesignType, OpenLayersMapView, OpenLayersMapViewController, OpenLayersMapViewHolder, type OpenLayersMapViewProps, OpenLayersMapViewState, type OpenLayersMapViewStateInterface, type OpenLayersMapViewStateParams, OpenLayersProvider, useOpenLayersMapViewState };

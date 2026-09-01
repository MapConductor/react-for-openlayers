import {
  createGeoPoint,
  createGeoRectBounds,
  createMapCameraPosition,
  type GeoPoint,
  type GeoRectBounds,
  type MapCameraPosition,
  type VisibleRegion,
  computeOffset, toNativeHeading, bearingFromNativeRotation, } from '@mapconductor/js-sdk-core';
import type Map from 'ol/Map';
import type View from 'ol/View';
// 拡張子を付けること。'ol/proj' はディレクトリ import になり、Node の ESM 解決が
// ERR_UNSUPPORTED_DIR_IMPORT で落ちる（バンドラは通るので気付きにくい）。
import { toLonLat } from 'ol/proj.js';
import type { OpenLayersMapViewHolder } from './OpenLayersMapViewHolder';
import { toCoordinate } from './helpers';


/**
 * 論理カメラの保持とカメラ操作。
 *
 * OpenLayers の View は bearing（rotation）は持つが **tilt を持たない**。
 * MapConductor 側の論理 tilt / bearing はここで別に覚えておき、読み出しの
 * ときに混ぜる（[hasLogicalCameraOverride] が立っている間だけ論理値を優先）。
 */
export interface OpenLayersCameraDeps {
  readonly map: Map;
  readonly view: View;
  readonly holder: OpenLayersMapViewHolder;
}

export class OpenLayersCameraState {
  private logicalPosition: GeoPoint = createGeoPoint({ latitude: 0, longitude: 0 });
  private logicalZoom = 0;
  private hasLogicalCameraOverride = false;

  constructor(
    private readonly deps: OpenLayersCameraDeps,
    private logicalTilt: number,
    private logicalBearing: number,
  ) {}

  get visualTilt(): number {
    return Math.min(60, Math.abs(this.logicalTilt));
  }

  get visualBearing(): number {
    return this.logicalBearing;
  }

  /** 地図の初期状態を論理カメラの初期値として取り込む。 */
  seed(position: GeoPoint | null, zoom: number): void {
    if (position) this.logicalPosition = position;
    this.logicalZoom = zoom;
    this.hasLogicalCameraOverride = this.logicalTilt !== 0 || this.logicalBearing !== 0;
  }

  get hasOverride(): boolean {
    return this.hasLogicalCameraOverride;
  }

  /**
   * 初期 tilt / bearing が指定されていたときだけ、View を論理カメラに合わせる。
   *
   * OpenLayers 自体は tilt を持たないので、tilt ぶんは
   * [toOpenLayersCamera] がズームの補正に読み替える。
   */
  applyInitialOverride(): void {
    if (!this.hasLogicalCameraOverride) return;
    const camera = toOpenLayersCamera(
      createMapCameraPosition({
        position: this.logicalPosition,
        zoom: this.logicalZoom,
        bearing: this.logicalBearing,
        tilt: this.logicalTilt,
      }),
    );
    this.deps.view.setCenter(toCoordinate(camera.position));
    this.deps.view.setZoom(camera.zoom);
  }

  async move(position: MapCameraPosition): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;

    const camera = toOpenLayersCamera(position);
    this.deps.view.setCenter(toCoordinate(camera.position));
    this.deps.view.setZoom(camera.zoom);
    this.deps.view.setRotation(0);

    return true;
  }

  async animate(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;

    const camera = toOpenLayersCamera(position);
    const durationSeconds = (durationMillis ?? 500) / 1000;

    this.deps.view.animate({
      center: toCoordinate(camera.position),
      zoom: camera.zoom,
      rotation: 0,
      duration: durationSeconds * 1000,
    });

    return true;
  }

  async fit(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    if (!bounds.southWest || !bounds.northEast) return false;

    const southWest = toCoordinate(bounds.southWest);
    const northEast = toCoordinate(bounds.northEast);
    const extent = [
      southWest[0],
      southWest[1],
      northEast[0],
      northEast[1],
    ];

    // android-sdk の fitBounds(bounds, padding) と同じくアニメーションはしない。
    this.deps.view.fit(extent, {
      padding: this.normalizePadding(padding),
    });

    return true;
  }

  read(): MapCameraPosition {
    const center = this.deps.view.getCenter();
    if (!center) return createMapCameraPosition({
      position: createGeoPoint({ latitude: 0, longitude: 0 }),
      zoom: this.deps.view.getZoom() ?? 0,
      bearing: bearingFromNativeRotation(this.deps.view.getRotation() * (180 / Math.PI)),
      tilt: this.logicalTilt,
      visibleRegion: this.readVisibleRegion(),
    });

    const [longitude, latitude] = toLonLat(center);
    return createMapCameraPosition({
      position: this.hasLogicalCameraOverride ? this.logicalPosition : createGeoPoint({ latitude, longitude }),
      zoom: this.hasLogicalCameraOverride ? this.logicalZoom : this.deps.view.getZoom() ?? 0,
      bearing: this.hasLogicalCameraOverride ? this.logicalBearing : 0,
      tilt: this.logicalTilt,
      visibleRegion: this.readVisibleRegion(),
    });
  }

  private readVisibleRegion(): VisibleRegion {
    // this.deps.map's own target element is deliberately rendered at 200% size (see
    // OpenLayersMapView's mapPlaneStyle, used to give the CSS tilt/bearing
    // transform room to rotate without showing gaps at the edges), so
    // map.getSize() reports that oversized plane rather than what's actually
    // visible on screen. Use the real (clipping) viewport element's size
    // instead, or the extent ends up ~2x too wide/tall and, once the
    // longitude span crosses 180°, GeoRectBounds picks the wrong hemisphere.
    const viewportElement = this.deps.holder.mapView.parentElement;
    const size: [number, number] = viewportElement && viewportElement.clientWidth > 0 && viewportElement.clientHeight > 0
      ? [viewportElement.clientWidth, viewportElement.clientHeight]
      : (this.deps.map.getSize() as [number, number] | undefined) ?? [0, 0];
    const extent = this.deps.view.calculateExtent(size);
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

  private normalizePadding(value: number | undefined): number[] {
    if (typeof value === 'number') {
      return [value, value, value, value];
    }
    return [0, 0, 0, 0];
  }
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
    heading: toNativeHeading(position.bearing),
  });

  return position.copy({
    position: target,
    zoom: position.zoom - 0.9 * (tiltAbs / 60),
    tilt: tiltAbs,
  });
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

import {
  AbstractCircleOverlayRenderer,
  AbstractGroundImageOverlayRenderer,
  AbstractPolygonOverlayRenderer,
  AbstractPolylineOverlayRenderer,
  buildUnwrappedPolygonRings,
  buildUnwrappedPolylinePath,
  circleToRing,
  closeRing,
  CircleController,
  CircleManager,
  GroundImageController,
  GroundImageManager,
  PolygonController,
  PolygonManager,
  PolylineController,
  PolylineManager,
  type CircleEntity,
  type CircleState,
  type GroundImageEntity,
  type GroundImageState,
  type GeoPoint,
  type PolygonEntity,
  type PolygonState,
  type PolylineEntity,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import type Feature from 'ol/Feature';
import type { Point } from 'ol/geom';
import type LineString from 'ol/geom/LineString';
import type PolygonGeometry from 'ol/geom/Polygon';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import FeatureClass from 'ol/Feature.js';
import LineStringClass from 'ol/geom/LineString.js';
import PolygonClass from 'ol/geom/Polygon.js';
import VectorLayerClass from 'ol/layer/Vector.js';
import VectorSourceClass from 'ol/source/Vector.js';
import StyleClass from 'ol/style/Style.js';
import FillClass from 'ol/style/Fill.js';
import StrokeClass from 'ol/style/Stroke.js';
import IconClass from 'ol/style/Icon.js';
import ImageLayerClass from 'ol/layer/Image.js';
import StaticClass from 'ol/source/ImageStatic.js';
import { OpenLayersMapViewHolder } from '../OpenLayersMapViewHolder';
import { toCoordinate } from '../helpers';

const VECTOR_BASE_Z_INDEX = 400;
const GROUND_IMAGE_BASE_Z_INDEX = 300;

function vectorLayer(
  holder: OpenLayersMapViewHolder,
  kind: string,
  id: string,
  zIndex: number,
): VectorLayer<VectorSource<Feature<any>>> {
  const source = new VectorSourceClass();
  const layer = new VectorLayerClass({
    source,
    zIndex: VECTOR_BASE_Z_INDEX + Math.max(-100, Math.min(100, zIndex)),
  });

  layer.set('name', `mc-${kind}-${id}`);
  holder.map.addLayer(layer);
  return layer;
}

export class OpenLayersCircleRenderer extends AbstractCircleOverlayRenderer<
  OpenLayersMapViewHolder,
  Feature<PolygonGeometry>
> {
  private layers = new Map<string, VectorLayer<VectorSource<Feature<PolygonGeometry>>>>();

  async createCircle(state: CircleState): Promise<Feature<PolygonGeometry>> {
    // コア共通の circleToRing でリングを生成し、投影座標のポリゴンとして描画する
    // （geodesic 円を表現できない native の ol/geom/Circle は使わない）。リングは
    // 中心経度まわりに連続化（unwrap）済みなので ±180 跨ぎでも分割不要。
    const ring = closeRing(
      circleToRing(state.center, state.radiusMeters, state.geodesic),
    );
    const polygon = new PolygonClass([ring.map((p) => toCoordinate(p))]);
    const feature = new FeatureClass({ geometry: polygon });
    feature.setId(state.id);

    const style = new StyleClass({
      stroke: new StrokeClass({
        color: state.strokeColor,
        width: state.strokeWidth,
      }),
      fill: new FillClass({
        color: state.fillColor,
      }),
    });

    feature.setStyle(style);

    const layer = vectorLayer(this.holder, 'circle', state.id, state.zIndex ?? 0);
    layer.getSource()?.addFeature(feature);
    this.layers.set(state.id, layer);

    return feature;
  }

  async updateCircleProperties({
    current,
  }: {
    current: CircleEntity<Feature<PolygonGeometry>>;
  }): Promise<Feature<PolygonGeometry>> {
    const previousLayer = this.layers.get(current.state.id);
    if (previousLayer) {
      this.holder.map.removeLayer(previousLayer);
      this.layers.delete(current.state.id);
    }
    return this.createCircle(current.state);
  }

  async removeCircle(entity: CircleEntity<Feature<PolygonGeometry>>): Promise<void> {
    const layer = this.layers.get(entity.state.id);
    if (layer) {
      layer.getSource()?.removeFeature(entity.circle);
      this.holder.map.removeLayer(layer);
      this.layers.delete(entity.state.id);
    }
  }
}

export class OpenLayersCircleController extends CircleController<Feature<PolygonGeometry>> {
  constructor(renderer: OpenLayersCircleRenderer) {
    super({ circleManager: new CircleManager(), renderer });
  }
}

export class OpenLayersPolylineRenderer extends AbstractPolylineOverlayRenderer<
  OpenLayersMapViewHolder,
  Feature<LineString>
> {
  private layers = new Map<string, VectorLayer<VectorSource<Feature<LineString>>>>();

  async createPolyline(state: PolylineState): Promise<Feature<LineString>> {
    const coordinates = pathToCoordinates(state.points, state.geodesic);
    const lineString = new LineStringClass(coordinates);
    const feature = new FeatureClass({ geometry: lineString });
    feature.setId(state.id);

    const style = new StyleClass({
      stroke: new StrokeClass({
        color: state.strokeColor,
        width: state.strokeWidth,
      }),
    });

    feature.setStyle(style);

    const layer = vectorLayer(this.holder, 'polyline', state.id, state.zIndex);
    layer.getSource()?.addFeature(feature);
    this.layers.set(state.id, layer);

    return feature;
  }

  async updatePolylineProperties({
    current,
  }: {
    current: PolylineEntity<Feature<LineString>>;
  }): Promise<Feature<LineString>> {
    const previousLayer = this.layers.get(current.state.id);
    if (previousLayer) {
      this.holder.map.removeLayer(previousLayer);
      this.layers.delete(current.state.id);
    }
    return this.createPolyline(current.state);
  }

  async removePolyline(entity: PolylineEntity<Feature<LineString>>): Promise<void> {
    const layer = this.layers.get(entity.state.id);
    if (layer) {
      layer.getSource()?.removeFeature(entity.polyline);
      this.holder.map.removeLayer(layer);
      this.layers.delete(entity.state.id);
    }
  }
}

export class OpenLayersPolylineController extends PolylineController<Feature<LineString>> {
  constructor(renderer: OpenLayersPolylineRenderer) {
    super({ polylineManager: new PolylineManager(), renderer });
  }
}

export class OpenLayersPolygonRenderer extends AbstractPolygonOverlayRenderer<
  OpenLayersMapViewHolder,
  Feature<PolygonGeometry>
> {
  private layers = new Map<string, VectorLayer<VectorSource<Feature<PolygonGeometry>>>>();

  async createPolygon(state: PolygonState): Promise<Feature<PolygonGeometry>> {
    const coordinates = polygonCoordinates(state);
    const polygon = new PolygonClass(coordinates);
    const feature = new FeatureClass({ geometry: polygon });
    feature.setId(state.id);

    const style = new StyleClass({
      stroke: new StrokeClass({
        color: state.strokeColor,
        width: state.strokeWidth,
      }),
      fill: new FillClass({
        color: state.fillColor,
      }),
    });

    feature.setStyle(style);

    const layer = vectorLayer(this.holder, 'polygon', state.id, state.zIndex);
    layer.getSource()?.addFeature(feature);
    this.layers.set(state.id, layer);

    return feature;
  }

  async updatePolygonProperties({
    current,
  }: {
    current: PolygonEntity<Feature<PolygonGeometry>>;
  }): Promise<Feature<PolygonGeometry>> {
    const previousLayer = this.layers.get(current.state.id);
    if (previousLayer) {
      this.holder.map.removeLayer(previousLayer);
      this.layers.delete(current.state.id);
    }
    return this.createPolygon(current.state);
  }

  async removePolygon(entity: PolygonEntity<Feature<PolygonGeometry>>): Promise<void> {
    const layer = this.layers.get(entity.state.id);
    if (layer) {
      layer.getSource()?.removeFeature(entity.polygon);
      this.holder.map.removeLayer(layer);
      this.layers.delete(entity.state.id);
    }
  }
}

function polygonCoordinates(state: PolygonState): number[][][] {
  // Core pipeline: densify each ring (geodesic great-circle or straight-in-
  // lat/lng linear interpolation, matching the Android renderers) and unwrap
  // the longitudes into the outer ring's world copy before projecting.
  const { outerRings, holeRings } = buildUnwrappedPolygonRings(
    state.points,
    state.holes,
    state.geodesic,
  );
  return [...outerRings, ...holeRings].map(ring => closeRingCoordinates(ring));
}

function closeRingCoordinates(ring: GeoPoint[]): number[][] {
  const coordinates = ring.map(point => toCoordinate(point));
  if (coordinates.length === 0) return coordinates;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push(first);
  return coordinates;
}

function pathToCoordinates(points: GeoPoint[], geodesic: boolean): number[][] {
  // Core pipeline for both modes: densification (great-circle when geodesic,
  // linear lat/lng otherwise — Android's straight-line semantics) + longitude
  // unwrap (before projecting).
  return buildUnwrappedPolylinePath(points, geodesic).map(point => toCoordinate(point));
}

export class OpenLayersPolygonController extends PolygonController<Feature<PolygonGeometry>> {
  constructor(renderer: OpenLayersPolygonRenderer) {
    super({ polygonManager: new PolygonManager(), renderer });
  }
}

export class OpenLayersGroundImageRenderer extends AbstractGroundImageOverlayRenderer<
  OpenLayersMapViewHolder,
  Feature<Point>
> {
  async createGroundImage(state: GroundImageState): Promise<Feature<Point> | null> {
    const { southWest, northEast } = state.bounds;
    if (!southWest || !northEast) return null;

    const extent = [
      ...toCoordinate(southWest),
      ...toCoordinate(northEast),
    ];

    const feature = new FeatureClass<Point>();
    feature.setId(state.id);

    const style = new StyleClass({
      image: new IconClass({
        src: state.imageUrl,
        opacity: state.opacity,
      }),
    });

    feature.setStyle(style);

    const imageSource = new StaticClass({
      url: state.imageUrl,
      imageExtent: extent,
    });

    const imageLayer = new ImageLayerClass({
      source: imageSource,
      zIndex: GROUND_IMAGE_BASE_Z_INDEX,
    });

    imageLayer.set('name', `mc-ground-image-${state.id}`);
    this.holder.map.addLayer(imageLayer);

    return feature;
  }

  async updateGroundImageProperties({
    current,
  }: {
    current: GroundImageEntity<Feature<Point>>;
  }): Promise<Feature<Point> | null> {
    const layerName = `mc-ground-image-${current.state.id}`;
    const previousLayer = this.holder.map.getAllLayers().find(
      (layer: any) => layer.get('name') === layerName,
    );
    if (previousLayer) this.holder.map.removeLayer(previousLayer);
    return this.createGroundImage(current.state);
  }

  async removeGroundImage(entity: GroundImageEntity<Feature<Point>>): Promise<void> {
    const layers = this.holder.map.getAllLayers();
    const layer = layers.find(
      (layer: any) => layer.get('name') === `mc-ground-image-${entity.state.id}`,
    );
    if (layer) {
      this.holder.map.removeLayer(layer);
    }
  }
}

export class OpenLayersGroundImageController extends GroundImageController<Feature<Point>> {
  constructor(renderer: OpenLayersGroundImageRenderer) {
    super({ groundImageManager: new GroundImageManager(), renderer });
  }
}

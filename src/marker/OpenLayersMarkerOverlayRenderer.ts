import {
  AbstractMarkerOverlayRenderer,
  type AddParams,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
} from '@mapconductor/js-sdk-core';
import type Feature from 'ol/Feature';
import type { Point } from 'ol/geom';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import type Style from 'ol/style/Style';
import FeatureClass from 'ol/Feature.js';
import PointClass from 'ol/geom/Point.js';
import VectorLayerClass from 'ol/layer/Vector.js';
import VectorSourceClass from 'ol/source/Vector.js';
import StyleClass from 'ol/style/Style.js';
import IconClass from 'ol/style/Icon.js';
import { OpenLayersMapViewHolder } from '../OpenLayersMapViewHolder';
import { toCoordinate } from '../helpers';

export class OpenLayersMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  OpenLayersMapViewHolder,
  Feature<Point>
> {
  private vectorSource: VectorSource<Feature<Point>>;
  private vectorLayer: VectorLayer<VectorSource<Feature<Point>>>;

  constructor(holder: OpenLayersMapViewHolder) {
    super({ holder });
    this.supportsAnimationOverlay = true;

    this.vectorSource = new VectorSourceClass();
    this.vectorLayer = new VectorLayerClass({
      source: this.vectorSource,
      zIndex: 600,
    });

    holder.map.addLayer(this.vectorLayer);
  }

  async onAdd(data: AddParams[]): Promise<(Feature<Point> | null)[]> {
    const features: (Feature<Point> | null)[] = [];

    for (const { state, bitmapIcon } of data) {
      const feature = new FeatureClass({
        geometry: new PointClass(toCoordinate(state.position)),
        id: state.id,
      });

      feature.setId(state.id);
      feature.setStyle(this.createStyle(bitmapIcon));

      this.vectorSource.addFeature(feature);
      features.push(feature);
    }

    return features;
  }

  async onChange(data: ChangeParams<Feature<Point>>[]): Promise<(Feature<Point> | null)[]> {
    const features: (Feature<Point> | null)[] = [];

    for (const { current, prev, bitmapIcon } of data) {
      const actual = prev.marker;
      if (!actual) {
        features.push(null);
        continue;
      }

      actual.setGeometry(new PointClass(toCoordinate(current.state.position)));
      actual.setStyle(this.createStyle(bitmapIcon));

      features.push(actual);
    }

    return features;
  }

  async onRemove(data: MarkerEntity<Feature<Point>>[]): Promise<void> {
    for (const entity of data) {
      if (entity.marker) this.vectorSource.removeFeature(entity.marker);
    }
  }

  async onPostProcess(): Promise<void> {}

  setMarkerPosition(entity: MarkerEntity<Feature<Point>>, position: GeoPoint): void {
    entity.marker?.setGeometry(new PointClass(toCoordinate(position)));
  }

  override setMarkerVisible(entity: MarkerEntity<Feature<Point>>, visible: boolean): void {
    if (visible) {
      entity.marker?.setStyle(entity.marker.getStyle());
    } else {
      entity.marker?.setStyle(undefined);
    }
  }

  private createStyle(bitmapIcon: AddParams['bitmapIcon']): Style {
    return new StyleClass({
      image: new IconClass({
        src: bitmapIcon.url,
        size: [bitmapIcon.size.width, bitmapIcon.size.height],
        anchor: [
          bitmapIcon.size.width * bitmapIcon.anchor.x,
          bitmapIcon.size.height * bitmapIcon.anchor.y,
        ],
        anchorXUnits: 'pixels',
        anchorYUnits: 'pixels',
      }),
    });
  }
}

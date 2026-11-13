import {
  AbstractMarkerOverlayRenderer,
  type AddParams,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  markerDrawOrder,
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

/** Feature property holding the marker's draw order (see markerDrawOrder). */
const DRAW_ORDER_KEY = 'mc:drawOrder';
/** The marker's own Style, kept on the feature so a hidden marker can get it back. */
const STYLE_KEY = 'mc:style';
/** Set while the marker is hidden (its style is then null). */
const HIDDEN_KEY = 'mc:hidden';

const drawOrderOf = (feature: Feature<Point>): number => (feature.get(DRAW_ORDER_KEY) as number | undefined) ?? 0;

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
      // Later features are drawn on top: sort by the shared marker draw order
      // (zIndex, then south, then west) rather than by the order they were added.
      // A per-feature Style zIndex would do too, but makes one replay group per value.
      renderOrder: (a, b) => drawOrderOf(a as Feature<Point>) - drawOrderOf(b as Feature<Point>),
    });

    holder.map.addLayer(this.vectorLayer);
  }

  /**
   * Whether the native marker vector layer is visible. The 2D view fakes camera
   * tilt with a CSS `rotateX` on the map, which lays the canvas-drawn marker
   * icons flat against the ground. While tilted the view hides this layer and
   * draws upright, billboarded icons on a separate canvas instead. Toggling the
   * layer hides every non-tiled marker (and any added later) at once.
   */
  setNativeVisible(visible: boolean): void {
    this.vectorLayer.setVisible(visible);
  }

  /** Whether native markers are currently visible (false while tilted). */
  get isNativeVisible(): boolean {
    return this.vectorLayer.getVisible();
  }

  async onAdd(data: AddParams[]): Promise<(Feature<Point> | null)[]> {
    const features: (Feature<Point> | null)[] = [];

    for (const { state, bitmapIcon } of data) {
      const feature = new FeatureClass({
        geometry: new PointClass(toCoordinate(state.position)),
        id: state.id,
      });

      feature.setId(state.id);
      feature.set(DRAW_ORDER_KEY, markerDrawOrder(state.zIndex, state.position), true);
      this.applyStyle(feature, this.createStyle(bitmapIcon));

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
      this.applyDrawOrder(actual, current.state);
      this.applyStyle(actual, this.createStyle(bitmapIcon));

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
    if (entity.marker) entity.marker.set(DRAW_ORDER_KEY, markerDrawOrder(entity.state.zIndex, position), true);
  }

  /** @internal */
  private applyDrawOrder(feature: Feature<Point>, state: MarkerState): void {
    feature.set(DRAW_ORDER_KEY, markerDrawOrder(state.zIndex, state.position), true);
  }

  /**
   * Sets the feature's style and remembers it. Hiding sets the style to `null`,
   * which OpenLayers takes as "do not render"; `undefined` would mean "use the
   * layer's style", which is OpenLayers' default blue dot here. The remembered
   * style is what showing the marker again puts back. (A fresh Feature's
   * `getStyle()` is null too, so hidden is tracked as its own flag.)
   */
  private applyStyle(feature: Feature<Point>, style: Style): void {
    feature.set(STYLE_KEY, style, true);
    if (!feature.get(HIDDEN_KEY)) feature.setStyle(style);
  }

  override setMarkerVisible(entity: MarkerEntity<Feature<Point>>, visible: boolean): void {
    const feature = entity.marker;
    if (!feature) return;
    feature.set(HIDDEN_KEY, !visible, true);
    if (visible) {
      feature.setStyle((feature.get(STYLE_KEY) as Style | undefined) ?? null);
    } else {
      feature.setStyle(null);
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

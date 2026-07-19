import type {
  AttributionRule,
  MapDesignTypeInterface,
} from '@mapconductor/js-sdk-core';
import type TileSource from 'ol/source/Tile';
import OSM from 'ol/source/OSM.js';

export interface OpenLayersMapDesignType extends MapDesignTypeInterface<string> {
  readonly tileSource: TileSource | null;
}

export interface OpenLayersDesignParams {
  id: string;
  tileSource: TileSource | null;
  attributionRules?: readonly AttributionRule[];
}

export class OpenLayersDesign implements OpenLayersMapDesignType {
  readonly id: string;
  readonly tileSource: TileSource | null;
  readonly attributionRules: readonly AttributionRule[];

  constructor({
    id,
    tileSource,
    attributionRules = [],
  }: OpenLayersDesignParams) {
    this.id = id;
    this.tileSource = tileSource;
    this.attributionRules = attributionRules;
  }

  getValue(): string {
    return this.id;
  }

  static readonly OpenStreetMap = new OpenLayersDesign({
    id: 'openstreetmap',
    tileSource: new OSM(),
    attributionRules: [{
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }],
  });

  static readonly None = new OpenLayersDesign({ id: 'none', tileSource: null });
}

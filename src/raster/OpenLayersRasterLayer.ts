import {
  LocalTileServer,
  RasterLayerController,
  RasterLayerManager,
  type MapCameraPosition,
  type RasterLayerAddParams,
  type RasterLayerChangeParams,
  type RasterLayerEntity,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import type TileLayer from 'ol/layer/Tile';
import type TileSource from 'ol/source/Tile';
import type ImageTile from 'ol/ImageTile';
import TileLayerClass from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { renderXYZTemplate } from 'ol/uri.js';
import { OpenLayersMapViewHolder } from '../OpenLayersMapViewHolder';

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
  requiresDirectLoad: boolean;
}

export class OpenLayersRasterLayerRenderer {
  constructor(readonly holder: OpenLayersMapViewHolder) {}

  async onAdd(data: RasterLayerAddParams[]): Promise<(TileLayer<TileSource> | null)[]> {
    return Promise.all(data.map(({ state }) => state.visible ? this.create(state) : null));
  }

  async onChange(data: RasterLayerChangeParams<TileLayer<TileSource>>[]): Promise<(TileLayer<TileSource> | null)[]> {
    return Promise.all(data.map(async ({ current, prev }) => {
      this.holder.map.removeLayer(prev.layer);
      return current.state.visible ? this.create(current.state) : null;
    }));
  }

  async onRemove(data: RasterLayerEntity<TileLayer<TileSource>>[]): Promise<void> {
    for (const entity of data) {
      this.holder.map.removeLayer(entity.layer);
    }
  }

  async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}
  async onPostProcess(): Promise<void> {}

  private async create(state: RasterLayerState): Promise<TileLayer<TileSource> | null> {
    const { source } = state;
    let tileSource: TileSource;

    switch (source.type) {
      case 'UrlTemplate': {
        const local = this.parseLocalTileTemplate(source.template);
        if (local) {
          const tileSize = source.tileSize ?? local.tileSize;
          tileSource = new XYZ({
            // OpenLayers' XYZ tile grid already yields the standard web-mercator
            // z for any tileSize (a 512px grid is one zoom coarser, so z matches
            // a 256px grid's z for the same ground extent). The route renderer
            // expects that standard z/x/y, so pass tileCoord straight through —
            // adjusting z here requested a coarser level whose x/y were out of
            // range, producing blank tiles (e.g. the 512px GeoJSON layer).
            tileUrlFunction: tileCoord => renderXYZTemplate(
              source.template,
              tileCoord[0],
              tileCoord[1],
              tileCoord[2],
            ),
            tileSize,
            minZoom: source.minZoom ?? undefined,
            maxZoom: source.maxZoom ?? undefined,
            tileLoadFunction: local.requiresDirectLoad
              ? (tile, src) => this.loadLocalTile(tile as ImageTile, src)
              : undefined,
          });
        } else {
          tileSource = new XYZ({
            url: source.template,
            tileSize: source.tileSize ?? 256,
            minZoom: source.minZoom ?? undefined,
            maxZoom: source.maxZoom ?? undefined,
          });
        }
        break;
      }
      case 'ArcGisService': {
        tileSource = new XYZ({
          url: `${source.serviceUrl.replace(/\/+$/, '')}/tile/{z}/{y}/{x}`,
        });
        break;
      }
      case 'TileJson': {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`Failed to load TileJSON: ${response.status}`);
        const json = await response.json();
        if (!json.tiles?.[0]) throw new Error('TileJSON does not contain a tile template');
        tileSource = new XYZ({
          url: json.tiles[0],
          minZoom: json.minzoom,
          maxZoom: json.maxzoom,
        });
        break;
      }
    }

    const layer = new TileLayerClass({
      source: tileSource,
      opacity: state.opacity,
      zIndex: 250 + Math.max(-100, Math.min(100, state.zIndex)),
    });

    this.holder.map.addLayer(layer);
    return layer;
  }

  private parseLocalTileTemplate(template: string): LocalTileTemplate | null {
    if (template.startsWith('mc-local-tile://')) {
      const url = new URL(template);
      const tileSize = Number(url.pathname.split('/').filter(Boolean)[0]);
      return Number.isFinite(tileSize)
        ? { routeId: url.hostname, tileSize, requiresDirectLoad: true }
        : null;
    }
    const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)\//);
    return match
      ? { routeId: match[1], tileSize: Number(match[2]), requiresDirectLoad: false }
      : null;
  }

  private loadLocalTile(tile: ImageTile, src: string): void {
    const image = tile.getImage() as HTMLImageElement;
    const request = this.parseLocalTileRequest(src);
    if (!request) {
      image.src = EMPTY_TILE;
      return;
    }

    const server = LocalTileServer.startServer();
    const dataUrl = server.handleFetchDataUrl(request.routeId, request);
    if (dataUrl) {
      image.src = dataUrl;
      return;
    }

    void server.handleFetch(request.routeId, request).then(bytes => {
      if (!bytes) {
        image.src = EMPTY_TILE;
        return;
      }
      const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const release = () => URL.revokeObjectURL(blobUrl);
      image.addEventListener('load', release, { once: true });
      image.addEventListener('error', release, { once: true });
      image.src = blobUrl;
    });
  }

  private parseLocalTileRequest(src: string): { routeId: string; x: number; y: number; z: number } | null {
    const url = new URL(src);
    if (url.protocol !== 'mc-local-tile:') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 4) return null;
    const z = Number(segments.at(-3));
    const x = Number(segments.at(-2));
    const y = Number(segments.at(-1)?.replace(/\.png$/, ''));
    if (![z, x, y].every(Number.isFinite)) return null;
    return { routeId: url.hostname, x, y, z };
  }
}

export class OpenLayersRasterLayerController extends RasterLayerController<TileLayer<TileSource>> {
  constructor(renderer: OpenLayersRasterLayerRenderer) {
    super({ rasterLayerManager: new RasterLayerManager(), renderer });
  }

  async composition(data: RasterLayerState[]): Promise<void> {
    await this.add(data);
    for (const state of data) {
      if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
    }
  }

  override async update(state: RasterLayerState): Promise<void> {
    await super.update(state);
    if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
  }

  async updateInternal(state: RasterLayerState): Promise<void> { await this.upsert(state); }
  async removeInternal(id: string): Promise<void> { await this.removeById(id); }
}

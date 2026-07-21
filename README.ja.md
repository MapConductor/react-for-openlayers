[English](./README.md) | 日本語 | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/react-for-openlayers

MapConductor React SDK の OpenLayers プロバイダです。MapConductor のプロバイダ非依存なカメラ・マーカー・オーバーレイ API を通じて OpenLayers の地図を描画するため、同じアプリケーションコードが Google Maps、MapLibre、Mapbox、Leaflet、ArcGIS、Cesium、HERE でもそのまま動作します。

## インストール

```shell
npm install @mapconductor/react-for-openlayers
```

`@mapconductor/js-sdk-core` と `@mapconductor/js-sdk-react`(マーカーなどの共有コンポーネントで使用)は依存関係として自動的にインストールされます。ただしアプリケーションコードはこの2つから直接 import するため、pnpm の strict(isolated)な `node_modules` を使う場合や、import するものをすべて明示的に宣言したい場合は、次のように明示的にインストールしてください:

```shell
npm install @mapconductor/react-for-openlayers @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

`ol` は依存関係として同梱されています。デフォルトの OpenStreetMap ソースに API キーは不要です。

## クイックスタート

```tsx
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';
import {
  OpenLayersDesign,
  OpenLayersMapView,
  useOpenLayersMapViewState,
} from '@mapconductor/react-for-openlayers';
import '@mapconductor/react-for-openlayers/style.css';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });

export function App() {
  const state = useOpenLayersMapViewState({
    mapDesignType: OpenLayersDesign.OpenStreetMap,
    cameraPosition: createMapCameraPosition({ position: TOKYO, zoom: 12 }),
  });

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <OpenLayersMapView
        state={state}
        onMapClick={point => console.log('clicked', point.latitude, point.longitude)}
        onCameraMoveEnd={camera => console.log('zoom', camera.zoom)}
      >
        <Marker position={TOKYO} />
      </OpenLayersMapView>
    </div>
  );
}
```

## マップデザイン

`OpenLayersDesign` は `OpenStreetMap`(標準の OSM ソース)と `None`(ベースレイヤーなし。独自のソースを使う場合など)を提供します。実行時に切り替えるには `state.mapDesignType = ...` を代入します。

## 関連パッケージ

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — ジオメトリ・カメラ・状態のプリミティブ
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — 共有の `Marker`・`Markers`・シェイプ・インフォバブル

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import View from 'ol/View.js';

// 投影座標は view の投影（既定 EPSG:3857、アプリが渡せば別のもの）で返る。
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/projected-point-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: { holder: 'src/OpenLayersMapViewHolder.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
    external: ['@mapconductor/js-sdk-core', /^ol\//],
});
const { OpenLayersMapViewHolder } = await import(pathToFileURL(resolve(outDir, 'holder.mjs')).href);
const { createGeoPoint, ProjectedUnit } = await import('@mapconductor/js-sdk-core');

const tokyo = createGeoPoint({ latitude: 35.681236, longitude: 139.767125 });
const holderWith = projection => new OpenLayersMapViewHolder(null, null, new View({ projection }));

test('EPSG:3857 view returns meters', () => {
    const holder = holderWith('EPSG:3857');
    assert.deepEqual(holder.coordinateSystem, { code: 'EPSG:3857', unit: ProjectedUnit.Meters });
    const point = holder.toProjectedPoint(tokyo);
    assert.ok(Math.abs(point.x - 15558805.18) < 0.01, `x ${point.x}`);
    assert.ok(Math.abs(point.y - 4256848.12) < 0.01, `y ${point.y}`);
});

test('EPSG:4326 view returns degrees and round-trips', () => {
    const holder = holderWith('EPSG:4326');
    assert.deepEqual(holder.coordinateSystem, { code: 'EPSG:4326', unit: ProjectedUnit.Degrees });
    const point = holder.toProjectedPoint(tokyo);
    assert.ok(Math.abs(point.x - tokyo.longitude) < 1e-9);
    assert.ok(Math.abs(point.y - tokyo.latitude) < 1e-9);
    const back = holder.fromProjectedPoint(point);
    assert.ok(Math.abs(back.latitude - tokyo.latitude) < 1e-9);
    assert.ok(Math.abs(back.longitude - tokyo.longitude) < 1e-9);
});

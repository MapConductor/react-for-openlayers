import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

// The tile URLs OpenLayers loads straight from LocalTileServer when there is
// no Service Worker. `@2x` asks for a tile drawn at two device pixels per CSS
// pixel, as in the Service Worker's URLs; without it the tile is 1x, as before.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/local-tile-url-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: { url: 'src/raster/localTileUrl.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
    external: ['@mapconductor/js-sdk-core'],
});
const { localTileUrlTemplate, parseLocalTileRequest, parseLocalTileTemplate } =
    await import(pathToFileURL(resolve(outDir, 'url.mjs')));

const tile = (template) => template.replace('{z}', '16').replace('{x}', '58211').replace('{y}', '25803');

test('1x tiles keep the URLs they always had', () => {
    const template = localTileUrlTemplate({ routeId: 'mc-tile-a', tileSize: 256, cacheKey: '3' });
    assert.equal(template, 'mc-local-tile://mc-tile-a/256/3/{z}/{x}/{y}.png');
    assert.deepEqual(parseLocalTileTemplate(template),
        { routeId: 'mc-tile-a', tileSize: 256, pixelRatio: 1, requiresDirectLoad: true });
    assert.deepEqual(parseLocalTileRequest(tile(template)),
        { routeId: 'mc-tile-a', x: 58211, y: 25803, z: 16, pixelRatio: 1 });
});

test('a 2x tile says so in its URL and the tile loader reads it back', () => {
    const template = localTileUrlTemplate({ routeId: 'mc-tile-a', tileSize: 256, cacheKey: '3', pixelRatio: 2 });
    assert.equal(template, 'mc-local-tile://mc-tile-a/256/3/{z}/{x}/{y}@2x.png');
    assert.deepEqual(parseLocalTileTemplate(template),
        { routeId: 'mc-tile-a', tileSize: 256, pixelRatio: 2, requiresDirectLoad: true });
    assert.deepEqual(parseLocalTileRequest(tile(template)),
        { routeId: 'mc-tile-a', x: 58211, y: 25803, z: 16, pixelRatio: 2 });
});

test('Service Worker templates, at either ratio', () => {
    assert.deepEqual(parseLocalTileTemplate('/__tiles/mc-tile-a/256/3/{z}/{x}/{y}@2x.png'),
        { routeId: 'mc-tile-a', tileSize: 256, pixelRatio: 2, requiresDirectLoad: false });
    assert.deepEqual(parseLocalTileTemplate('/__tiles/geojson-1/512/{z}/{x}/{y}.png'),
        { routeId: 'geojson-1', tileSize: 512, pixelRatio: 1, requiresDirectLoad: false });
});

test('other templates are not SDK tiles', () => {
    assert.equal(parseLocalTileTemplate('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), null);
    assert.equal(parseLocalTileTemplate('https://example.com/tiles/{z}/{x}/{y}@2x.png'), null);
});

test('URLs without a cache key, and ones that name no tile', () => {
    assert.equal(parseLocalTileRequest('mc-local-tile://r/256/16/1/2@2x.png').pixelRatio, 2);
    assert.equal(parseLocalTileRequest('mc-local-tile://r/256/16/1/2.jpg'), null);
    assert.equal(parseLocalTileRequest('mc-local-tile://r/256/16/1'), null);
    assert.equal(parseLocalTileRequest('https://example.com/256/16/1/2.png'), null);
});

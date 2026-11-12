import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

// A marker hidden for a drop/bounce animation must come back with its own icon,
// and while hidden it must not fall back to the layer's default style.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/marker-visibility-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: { renderer: 'src/marker/OpenLayersMarkerOverlayRenderer.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
    external: ['@mapconductor/js-sdk-core', /^ol\//],
});
const { OpenLayersMarkerOverlayRenderer } = await import(pathToFileURL(resolve(outDir, 'renderer.mjs')).href);
const { createGeoPoint, createMarkerState } = await import('@mapconductor/js-sdk-core');

const layers = [];
const holder = { map: { addLayer: (layer) => layers.push(layer) }, mapView: null };
const renderer = new OpenLayersMarkerOverlayRenderer(holder);
const state = createMarkerState({ position: createGeoPoint({ latitude: 35, longitude: 139 }) });
const bitmapIcon = { url: 'data:image/png;base64,', size: { width: 10, height: 10 }, anchor: { x: 0.5, y: 1 } };

test('hidden markers are not rendered, and showing them restores their icon', async () => {
    const [feature] = await renderer.onAdd([{ state, bitmapIcon }]);
    const style = feature.getStyle();
    assert.ok(style, 'the marker has its own style');
    const entity = { marker: feature, state };

    renderer.setMarkerVisible(entity, false);
    assert.equal(feature.getStyle(), null, 'null = not rendered (undefined would be the layer default style)');

    renderer.setMarkerVisible(entity, true);
    assert.equal(feature.getStyle(), style, 'the icon is back');
});

test('a change while hidden keeps the marker hidden and shows the new icon later', async () => {
    const [feature] = await renderer.onAdd([{ state, bitmapIcon }]);
    const entity = { marker: feature, state };
    renderer.setMarkerVisible(entity, false);
    const [changed] = await renderer.onChange([{ current: { state }, prev: { marker: feature, state }, bitmapIcon }]);
    assert.equal(changed.getStyle(), null, 'still hidden');
    renderer.setMarkerVisible(entity, true);
    assert.ok(changed.getStyle(), 'the new icon shows');
});

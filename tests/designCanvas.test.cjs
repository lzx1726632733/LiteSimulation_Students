const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/components/DesignCanvas.vue');
const source = fs.readFileSync(filename, 'utf8');
const { descriptor } = parse(source, { filename });
const alignBounds = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/alignment.js'), 'utf8',
).replace('export const alignBounds', 'const alignBounds') + '\n;alignBounds');

// Run the actual component handlers with Vue reactivity and a small DOM/canvas stub.
// No test-only exports or alternate coordinate implementation are added to production.
function createCanvas(items = []) {
  const mounted = [];
  const cleanup = [];
  const frames = new Map();
  let frameId = 0;
  const context = new Proxy({ measureText: (text) => ({ width: text.length * 12 }) }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  const document = { activeElement: null, createElement: () => ({ getContext: () => context }) };
  const element = vue.markRaw({
    style: {}, width: 0, height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 180, top: 100, width: 1000, height: 600 }),
    focus() { document.activeElement = element; },
    setPointerCapture() {},
  });
  const container = vue.markRaw({ clientWidth: 1000, clientHeight: 600 });
  const props = vue.reactive({ placedComponents: items, activeControl: null, selectedId: null, selectedIds: [] });
  const events = [];
  const emit = (type, value) => {
    events.push({ type, value });
    if (type === 'component-placed') props.placedComponents.push(value);
    if (type === 'select-component') {
      props.selectedId = value;
      props.selectedIds = value ? [value] : [];
    }
    if (type === 'select-components') {
      props.selectedIds = [...value];
      props.selectedId = value[0] ?? null;
    }
    if (type === 'update-component-position') {
      Object.assign(props.placedComponents.find((item) => item.id === value.id), value);
    }
    if (type === 'update-component-positions') {
      value.forEach((position) => Object.assign(props.placedComponents.find((item) => item.id === position.id), position));
    }
  };
  let resize;
  const sandbox = {
    alignBounds,
    ...vue, document, defineProps: () => props, defineEmits: () => emit, defineExpose() {},
    onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => cleanup.push(callback),
    getComponentLabel: (component) => component.displayName || `${component.name || component.type}${component.index || 1}`,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    window: { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} },
    Image: class {
      complete = true;
      set src(value) { this.onload?.(); }
    },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() {}
    },
  };
  const script = descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, '');
  const exports = `({ canvas, canvasContainer, ppm, viewOrigin, canvasWidth, canvasHeight,
    alignmentGuides, cursorX, cursorY,
    metersPerCell, panning, selectionBox, isComponentSelected, imageCache, handleWheel, resetZoom, focusComponent,
    handleMouseDown, handleMouseMove, handleMouseUp, handleMouseEnter, handleMouseLeave,
    handleCanvasKeyDown, handlePointerCancel, handleWindowBlur, getCanvasMousePosition,
    drawGridNow, dragging, draggingCorner, editingId, labelRects, labelEditorStyle,
    hitTestComponent, hitTestLabel, resolveLineEndpoints, hitTestConnectionLine })`;
  const scope = vue.effectScope();
  const api = scope.run(() => vm.runInNewContext(`${script}\n${exports}`, sandbox, { filename }));
  api.canvas.value = element;
  api.canvasContainer.value = container;
  mounted.forEach((callback) => callback());
  api.handleMouseEnter();
  const pointer = (worldX, worldY, extra = {}) => ({
    clientX: 180 + (worldX - api.viewOrigin.value.x) * api.ppm.value,
    clientY: 100 + (api.viewOrigin.value.y - worldY) * api.ppm.value,
    button: 0, pointerId: 1, preventDefault() {}, ...extra,
  });
  return { api, props, events, element, container, pointer, resize: () => resize(),
    dispose() { cleanup.forEach((callback) => callback()); scope.stop(); },
  };
}

const buffer = (overrides = {}) => ({
  id: 'component-1', type: 'buffer', name: '缓冲区', icon: 'buffer.svg', index: 1,
  x: 10, y: 10, width: 3, height: 3, ...overrides,
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('alignment matches both centerlines and all edges, including adjacent edges and negative coordinates', () => {
  const target = { id: 'reference', x: -5, y: -8, width: 6, height: 8 };
  for (const axis of ['x', 'y']) {
    const extent = axis === 'x' ? target.width : target.height;
    for (const [offset, kind] of [[0, 'edge'], [extent - 2, 'edge'],
      [(extent - 2) / 2, 'center'], [-2, 'edge'], [extent, 'edge']]) {
      const expected = target[axis] + offset;
      const raw = { x: 100, y: 100, width: 2, height: 2, [axis]: expected + 0.04 };
      const aligned = alignBounds(raw, raw, [target], 0.06);
      near(aligned[axis], expected);
      assert.equal(aligned.guides.length, 1);
      assert.equal(aligned.guides[0].axis, axis);
      assert.equal(aligned.guides[0].kind, kind);
    }
  }
});

test('alignment picks the closest candidate and falls back to the movement step outside the threshold', () => {
  const raw = { x: 0.04, y: -10, width: 3, height: 3 };
  const fallback = { ...raw, x: 0 };
  const targets = [
    { id: 'farther', x: 0, y: 10, width: 3, height: 3 },
    { id: 'closer', x: 0.025, y: 10, width: 3, height: 3 },
  ];
  const result = alignBounds(raw, fallback, targets, 0.06);
  near(result.x, 0.025);
  assert.equal(result.guides[0].targetId, 'closer');
  assert.equal(result.guides[0].kind, 'center');
  const outside = alignBounds(raw, fallback, targets, 0.01);
  near(outside.x, 0);
  assert.equal(outside.guides.length, 0);
});

for (const scale of [10, 100, 1000]) {
  test(`drag alignment uses a screen-space threshold at ${scale}px/m; Alt bypasses it and release clears guides`, async (t) => {
    const size = 30 / scale;
    const start = -100 / scale;
    const c = createCanvas([
      buffer({ x: start, y: start, width: size, height: size }),
      buffer({ id: 'reference', x: 0.025, y: 30 / scale, width: size, height: size }),
    ]); t.after(() => c.dispose());
    c.api.ppm.value = scale;
    c.api.viewOrigin.value = { x: -200 / scale, y: 200 / scale };
    await c.api.handleMouseDown(c.pointer(start + size / 2, start + size / 2));
    const rawX = 0.025 - 5 / scale;
    const move = c.pointer(rawX + size / 2, start + size / 2);
    c.api.handleMouseMove(move);
    near(c.props.placedComponents[0].x, 0.025);
    assert.equal(c.api.alignmentGuides.value[0].targetId, 'reference');
    c.api.drawGridNow();
    c.api.handleMouseMove({ ...move, altKey: true });
    near(c.props.placedComponents[0].x, start + Math.round((rawX - start) / 0.1) * 0.1);
    assert.equal(c.api.alignmentGuides.value.length, 0);
    c.api.handleMouseMove(move);
    c.api.handleMouseUp();
    near(c.props.placedComponents[0].x, 0.025);
    assert.equal(c.api.alignmentGuides.value.length, 0);
  });
}

test('Shift direction lock prevents alignment from moving the locked axis', async (t) => {
  const c = createCanvas([
    buffer({ x: -10, y: 0 }),
    buffer({ id: 'reference', x: 0.025, y: 0.2 }),
  ]); t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(-9, 1));
  c.api.handleMouseMove(c.pointer(0.9, 1.1, { shiftKey: true }));
  near(c.props.placedComponents[0].x, 0.025);
  near(c.props.placedComponents[0].y, 0);
  assert.deepEqual([...c.api.alignmentGuides.value].map((guide) => guide.axis), ['x']);
});

test('group alignment uses its outer bounds without changing spacing or snapping to its own members', async (t) => {
  const c = createCanvas([
    buffer({ id: 'a', x: -10, y: 0 }),
    buffer({ id: 'b', x: -6, y: 2 }),
    buffer({ id: 'reference', x: 0.025, y: 10 }),
  ]); t.after(() => c.dispose());
  c.props.selectedId = 'a'; c.props.selectedIds = ['a', 'b'];
  await c.api.handleMouseDown(c.pointer(-9, 1));
  // Group right edge approaches the reference's left edge.
  c.api.handleMouseMove(c.pointer(-6.1, 1));
  near(c.props.placedComponents[0].x, -6.975);
  near(c.props.placedComponents[1].x - c.props.placedComponents[0].x, 4);
  near(c.props.placedComponents[1].y - c.props.placedComponents[0].y, 2);
  assert.equal(c.api.alignmentGuides.value[0].targetId, 'reference');
  c.api.handleMouseUp();
});

test('placement preview and final coordinates agree for automatic center and edge alignment', async (t) => {
  const c = createCanvas([buffer({ x: -5.025, y: -8, width: 6, height: 8 })]);
  t.after(() => c.dispose());
  c.props.activeControl = { type: 'buffer', name: '缓冲区', icon: 'buffer.svg' };
  await vue.nextTick();
  const move = c.pointer(-2.1, 1.4);
  c.api.handleMouseMove(move);
  near(c.api.cursorX.value, -2.025);
  near(c.api.cursorY.value, 1.5);
  assert.equal(c.api.alignmentGuides.value.length, 2);
  c.api.drawGridNow();
  await c.api.handleMouseDown(move);
  const placed = c.props.placedComponents.at(-1);
  near(placed.x + placed.width / 2, -2.025);
  near(placed.y, 0);
  assert.equal(c.api.alignmentGuides.value.length, 0);
});

test('alignment ignores offscreen objects, connections and the dragged object itself', async (t) => {
  const c = createCanvas([
    buffer({ x: 0, y: 0 }),
    buffer({ id: 'offscreen', x: 0.025, y: 10000 }),
    { id: 'line', type: 'connectionLine', x: 0.025, y: 10, width: 3, height: 3 },
    { id: 'route', type: 'AGVpath', x: 0.025, y: 10, width: 3, height: 3, nodes: [] },
  ]); t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(1, 1));
  c.api.handleMouseMove(c.pointer(1.1, 1.1));
  near(c.props.placedComponents[0].x, 0.1);
  near(c.props.placedComponents[0].y, 0.1);
  assert.equal(c.api.alignmentGuides.value.length, 0);
});

test('Vue template and setup compile; zoom toolbar contains only fit-all', () => {
  const script = compileScript(descriptor, { id: 'canvas-test' });
  const template = compileTemplate({ source: descriptor.template.content, filename,
    id: 'canvas-test', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  assert.equal((descriptor.template.content.match(/<button\b/g) || []).length, 1);
  assert.match(descriptor.template.content, /@click="resetZoom"/);
});

test('wheel preserves the mouse world point, model dimensions and viewport bitmap at every scale', (t) => {
  const c = createCanvas([buffer()]); t.after(() => c.dispose());
  const model = JSON.stringify(c.props.placedComponents);
  const event = c.pointer(11.5, 11.5, { deltaY: -120, deltaMode: 0 });
  for (let i = 0; i < 45; i++) {
    c.api.handleWheel(event);
    const anchor = c.api.getCanvasMousePosition(event);
    near(anchor.x, 11.5); near(anchor.y, 11.5);
  }
  near(c.api.ppm.value, 1000);
  for (let i = 0; i < 90; i++) {
    c.api.handleWheel({ ...event, deltaY: 3, deltaMode: 1 });
    const anchor = c.api.getCanvasMousePosition(event);
    near(anchor.x, 11.5); near(anchor.y, 11.5);
  }
  assert.equal(JSON.stringify(c.props.placedComponents), model);
  c.api.imageCache.set('buffer.svg', { complete: true });
  c.api.drawGridNow();
  assert.equal(c.element.width, 2000);
  assert.equal(c.element.height, 1200);
});

for (const scale of [10, 45, 1000]) {
  test(`drag moves by 0.1m at ${scale}px/m, preserving grab offset and Shift axis lock`, async (t) => {
    const c = createCanvas([buffer({ x: 10.025 })]); t.after(() => c.dispose());
    c.api.ppm.value = scale;
    await c.api.handleMouseDown(c.pointer(10.7, 10.8));
    c.api.handleMouseMove(c.pointer(10.74, 10.8));
    near(c.props.placedComponents[0].x, 10.025);
    c.api.handleMouseMove(c.pointer(10.76, 10.8));
    near(c.props.placedComponents[0].x, 10.125);
    c.api.handleMouseMove(c.pointer(11.96, 11.04, { shiftKey: true }));
    near(c.props.placedComponents[0].x, 11.325);
    near(c.props.placedComponents[0].y, 10);
    c.api.handleMouseUp();
    assert.equal(c.api.dragging.value, false);
  });
}

test('only middle-button pans; Space plus left-button selects a component; losing focus clears interaction', async (t) => {
  const c = createCanvas([buffer()]); t.after(() => c.dispose());
  const before = JSON.stringify(c.props.placedComponents);
  const initialOrigin = { ...c.api.viewOrigin.value };
  const event = c.pointer(11, 11, { button: 1 });
  await c.api.handleMouseDown(event);
  c.api.handleMouseMove({ ...event, clientX: event.clientX + 80, clientY: event.clientY + 40 });
  near(c.api.viewOrigin.value.x, initialOrigin.x - 8);
  near(c.api.viewOrigin.value.y, initialOrigin.y + 4);
  c.api.handleMouseLeave();
  assert.equal(c.api.panning.value, true);
  c.api.handleMouseUp();
  c.api.handleMouseEnter();
  c.api.handleCanvasKeyDown({ code: 'Space', preventDefault() {} });
  await c.api.handleMouseDown(c.pointer(11, 11));
  assert.equal(c.api.panning.value, false);
  assert.equal(c.api.dragging.value, true);
  c.api.handleWindowBlur();
  assert.equal(c.api.dragging.value, false);
  assert.equal(c.api.panning.value, false);
  assert.equal(JSON.stringify(c.props.placedComponents), before);
});

for (const reverse of [false, true]) {
  test(`left-button box selection works ${reverse ? 'backward' : 'forward'} across axes without panning`, async (t) => {
    const c = createCanvas([
      buffer({ x: -6, y: -3 }), buffer({ id: 'component-2', x: 2, y: 2 }),
      buffer({ id: 'partial', x: 9, y: 9 }), buffer({ id: 'outside', x: 30, y: 30 }),
      { id: 'station', type: 'node', x: 0, y: -5, width: 0, height: 0 },
    ]); t.after(() => c.dispose());
    const before = JSON.stringify(c.props.placedComponents);
    const origin = JSON.stringify(c.api.viewOrigin.value);
    const start = reverse ? [10, -10] : [-10, 10];
    const end = reverse ? [-10, 10] : [10, -10];
    await c.api.handleMouseDown(c.pointer(...start));
    assert.equal(c.api.panning.value, false);
    c.api.handleMouseMove(c.pointer(...end));
    assert.equal(c.api.selectionBox.value.moved, true);
    assert.deepEqual([...c.props.selectedIds], ['component-1', 'component-2', 'station']);
    for (const id of c.props.selectedIds) assert.equal(c.api.isComponentSelected(id), true);
    c.api.drawGridNow();
    c.api.handleMouseUp(c.pointer(...end));
    assert.equal(c.api.selectionBox.value, null);
    assert.equal(JSON.stringify(c.api.viewOrigin.value), origin);
    assert.equal(JSON.stringify(c.props.placedComponents), before);
    // 拖动已框选的一员，整组使用同一 0.1m 步长位移。
    await c.api.handleMouseDown(c.pointer(-4.5, -1.5));
    c.api.handleMouseMove(c.pointer(-4.24, -1.86));
    c.api.handleMouseUp();
    near(c.props.placedComponents[0].x, -5.7); near(c.props.placedComponents[0].y, -3.4);
    near(c.props.placedComponents[1].x, 2.3); near(c.props.placedComponents[1].y, 1.6);
    near(c.props.placedComponents[4].x, 0.3); near(c.props.placedComponents[4].y, -5.4);
    near(c.props.placedComponents[3].x, 30);
    assert.equal(c.props.selectedIds.length, 3);
  });
}

test('box selection cancels on Escape or pointer cancellation and a blank click clears selection', async (t) => {
  const c = createCanvas([buffer({ x: 1, y: 1 })]); t.after(() => c.dispose());
  c.props.selectedId = 'component-1'; c.props.selectedIds = ['component-1'];
  await c.api.handleMouseDown(c.pointer(-10, 10));
  c.api.handleMouseMove(c.pointer(10, -10));
  c.api.handleCanvasKeyDown({ key: 'Escape' });
  assert.equal(c.api.selectionBox.value, null);
  assert.deepEqual([...c.props.selectedIds], ['component-1']);
  await c.api.handleMouseDown(c.pointer(-20, 20));
  c.api.handleMouseMove(c.pointer(-10, 10));
  c.api.handlePointerCancel();
  assert.equal(c.api.selectionBox.value, null);
  assert.deepEqual([...c.props.selectedIds], ['component-1']);
  await c.api.handleMouseDown(c.pointer(-10, 10));
  const scale = c.api.ppm.value;
  c.api.handleWheel(c.pointer(-10, 10, { deltaY: -120, deltaMode: 0 }));
  near(c.api.ppm.value, scale);
  c.api.handleMouseUp();
  assert.deepEqual([...c.props.selectedIds], []);
  c.api.handleWheel(c.pointer(-10, 10, { deltaY: -120, deltaMode: 0 }));
  assert.ok(c.api.ppm.value > scale);
});

test('middle-button panning preserves a multi-selection and never creates a selection rectangle', async (t) => {
  const c = createCanvas([buffer(), buffer({ id: 'second', x: 20 })]); t.after(() => c.dispose());
  c.props.selectedIds = ['component-1', 'second']; c.props.selectedId = 'component-1';
  const start = c.pointer(11, 11, { button: 1 });
  await c.api.handleMouseDown(start);
  c.api.handleMouseMove({ ...start, clientX: start.clientX + 120 });
  c.api.handleMouseUp();
  assert.equal(c.api.selectionBox.value, null);
  assert.equal(c.api.panning.value, false);
  assert.deepEqual([...c.props.selectedIds], ['component-1', 'second']);
  near(c.props.placedComponents[0].x, 10);
});

for (const scale of [10, 200]) {
  test(`box selection includes a complete connection line without requiring its endpoint objects at ${scale}px/m`, async (t) => {
    const c = createCanvas([
      buffer({ x: -11.5, y: -1.5 }), buffer({ id: 'second', x: 8.5, y: -1.5 }),
      { id: 'line', type: 'connectionLine', fromId: 'component-1', toId: 'second' },
      { id: 'orphan', type: 'connectionLine', fromId: 'missing', toId: 'second' },
    ]); t.after(() => c.dispose());
    c.api.ppm.value = scale;
    for (const [start, end] of [
      [[-12, 1], [12, -1]], [[12, -1], [-12, 1]],
    ]) {
      await c.api.handleMouseDown(c.pointer(...start));
      c.api.handleMouseMove(c.pointer(...end));
      c.api.handleMouseUp();
      assert.deepEqual([...c.props.selectedIds], ['line']);
      assert.equal(c.api.isComponentSelected('line'), true);
    }
    // 与控件一样，连接线也必须完整落入选框。
    await c.api.handleMouseDown(c.pointer(-2, 1));
    c.api.handleMouseMove(c.pointer(2, -1));
    c.api.handleMouseUp();
    assert.deepEqual([...c.props.selectedIds], []);
  });
}

test('Shift-click accumulates and toggles objects and connection lines, and labels also support it', async (t) => {
  const c = createCanvas([
    buffer({ x: -6, y: -3 }), buffer({ id: 'second', x: 2, y: 2 }),
    { id: 'line', type: 'connectionLine', fromId: 'component-1', toId: 'second' },
  ]); t.after(() => c.dispose());
  const before = JSON.stringify(c.props.placedComponents);
  const click = async (x, y, shiftKey = true) => {
    await c.api.handleMouseDown(c.pointer(x, y, { shiftKey }));
    c.api.handleMouseUp();
  };
  await click(-4.5, -1.5);
  await click(3.5, 3.5);
  await click(-0.5, 1);
  assert.deepEqual([...c.props.selectedIds], ['component-1', 'second', 'line']);
  await click(3.5, 3.5);
  assert.deepEqual([...c.props.selectedIds], ['component-1', 'line']);
  await click(-0.5, 1);
  assert.deepEqual([...c.props.selectedIds], ['component-1']);
  c.api.drawGridNow();
  const label = c.api.labelRects.get('second');
  await click(label.x + label.width / 2, label.y + label.height / 2);
  assert.deepEqual([...c.props.selectedIds], ['component-1', 'second']);
  assert.equal(JSON.stringify(c.props.placedComponents), before);
  await click(3.5, 3.5, false);
  assert.deepEqual([...c.props.selectedIds], ['second']);
});

test('Shift-drag preserves the group selection and axis lock instead of toggling the dragged object off', async (t) => {
  const c = createCanvas([buffer({ x: -6, y: -3 }), buffer({ id: 'second', x: 2, y: 2 })]);
  t.after(() => c.dispose());
  c.props.selectedIds = ['component-1', 'second']; c.props.selectedId = 'component-1';
  await c.api.handleMouseDown(c.pointer(-4.5, -1.5, { shiftKey: true }));
  c.api.handleMouseMove(c.pointer(-3.5, -1.2, { shiftKey: true }));
  c.api.handleMouseUp();
  assert.deepEqual([...c.props.selectedIds], ['component-1', 'second']);
  near(c.props.placedComponents[0].x, -5); near(c.props.placedComponents[0].y, -3);
  near(c.props.placedComponents[1].x, 3); near(c.props.placedComponents[1].y, 2);
});

test('fit-all includes distant components and AGV bends without changing the model', (t) => {
  const c = createCanvas([
    buffer({ x: -120, y: -80 }), buffer({ id: 'component-2', x: 310, y: 200 }),
    { id: 'path-1', type: 'AGVpath', nodes: [{ x: -115, y: -75 }, { x: 600, y: 440 }, { x: 310, y: 200 }] },
  ]); t.after(() => c.dispose());
  const before = JSON.stringify(c.props.placedComponents);
  c.api.ppm.value = 1000;
  c.api.viewOrigin.value = { x: 100, y: 100 };
  c.api.resetZoom();
  for (const point of [{ x: -120, y: -80 }, { x: 313, y: 203 }, { x: 600, y: 440 }]) {
    const px = (point.x - c.api.viewOrigin.value.x) * c.api.ppm.value;
    const py = (c.api.viewOrigin.value.y - point.y) * c.api.ppm.value;
    assert.ok(px >= 0 && px <= c.api.canvasWidth.value);
    assert.ok(py >= 0 && py <= c.api.canvasHeight.value);
  }
  assert.equal(JSON.stringify(c.props.placedComponents), before);
  const scale = c.api.ppm.value;
  c.api.resetZoom(); near(c.api.ppm.value, scale);
});

test('screen quadrants map to signed physical coordinates; buffers and stations can be placed in all four', async (t) => {
  const c = createCanvas(); t.after(() => c.dispose());
  c.api.imageCache.set('buffer.svg', { complete: true });
  for (const type of ['buffer', 'node']) {
    c.props.activeControl = { type, name: type, icon: 'buffer.svg' };
    await vue.nextTick();
    for (const [dx, dy] of [[100, -100], [-100, -100], [-100, 100], [100, 100], [0, 0]]) {
      const event = { clientX: 680 + dx, clientY: 400 + dy, button: 0, pointerId: 1, preventDefault() {} };
      const physical = c.api.getCanvasMousePosition(event);
      near(physical.x, dx / 10); near(physical.y, -dy / 10);
      await c.api.handleMouseDown(event);
      c.api.handleMouseUp();
      const placed = c.props.placedComponents.at(-1);
      near(placed.x + placed.width / 2, dx / 10);
      near(placed.y + placed.height / 2, -dy / 10);
      assert.equal(placed.type, type);
    }
  }
  assert.equal(c.props.placedComponents.length, 10);
});

test('a buffer can cross both axes while dragging and retains signed coordinates in movement logs', async (t) => {
  const c = createCanvas([buffer({ x: 0.5, y: 0.5 })]); t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(2, 2));
  c.api.handleMouseMove(c.pointer(-2.1, -3.2));
  c.api.handleMouseUp();
  near(c.props.placedComponents[0].x, -3.6);
  near(c.props.placedComponents[0].y, -4.7);
  assert.match(c.events.find((e) => e.type === 'add-log').value, /\(-2.1 m, -3.2 m\)/);
});

test('AGV paths can be drawn and their bends dragged across negative coordinates', async (t) => {
  const c = createCanvas([
    { id: 'node-1', type: 'node', x: -5, y: 5, width: 0, height: 0 },
    { id: 'node-2', type: 'node', x: 5, y: -5, width: 0, height: 0 },
  ]); t.after(() => c.dispose());
  c.props.activeControl = { type: 'AGVpath', name: 'AGV路径' };
  await vue.nextTick();
  for (const [x, y] of [[-5, 5], [-10, -10], [5, -5]]) {
    await c.api.handleMouseDown(c.pointer(x, y));
    c.api.handleMouseUp();
  }
  const route = c.props.placedComponents.at(-1);
  assert.equal(route.type, 'AGVpath');
  near(route.nodes[1].x, -10); near(route.nodes[1].y, -10);
  c.props.activeControl = null;
  await vue.nextTick();
  c.props.selectedId = route.id;
  await c.api.handleMouseDown(c.pointer(-10, -10));
  c.api.handleMouseMove(c.pointer(-12.1, 2.3));
  c.api.handleMouseUp();
  near(route.nodes[1].x, -12.1); near(route.nodes[1].y, 2.3);
});

test('Y-up rendering keeps labels, editing positions and connection hit tests aligned', (t) => {
  const c = createCanvas([
    buffer({ x: -11.5, y: -11.5 }), buffer({ id: 'component-2', x: 8.5, y: 8.5 }),
    { id: 'line-1', type: 'connectionLine', fromId: 'component-1', toId: 'component-2' },
  ]); t.after(() => c.dispose());
  c.api.drawGridNow();
  assert.equal(c.api.hitTestComponent(-10, -10).id, 'component-1');
  const label = c.api.labelRects.get('component-1');
  assert.ok(label.y + label.height < -11.5, 'label is below the lower edge in physical coordinates');
  assert.equal(c.api.hitTestLabel(label.x + label.width / 2, label.y + label.height / 2).id, 'component-1');
  c.api.editingId.value = 'component-1';
  near(parseFloat(c.api.labelEditorStyle.value.top), 417);
  const line = c.props.placedComponents[2];
  const endpoints = c.api.resolveLineEndpoints(line);
  assert.ok(endpoints.start.y > endpoints.end.y, 'increasing physical Y goes upward on screen');
  assert.equal(c.api.hitTestConnectionLine(line, 0, 0), true);
});

function loadComponent(name, bindings, exposed) {
  const file = path.resolve(__dirname, `../src/components/${name}.vue`);
  const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content.replace(/^import .*\r?$/gm, '');
  return vm.runInNewContext(`${script}\n;({ ${exposed} })`, {
    ...vue, onMounted() {}, onBeforeUnmount() {}, defineExpose() {},
    defineEmits: () => () => {}, ...bindings,
  });
}

test('group movement translates both station endpoints and AGV bends together without shrinking the corner', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentPositions');
  workspace.placedComponents.value.push(
    { id: 'a', type: 'node', x: 0, y: 0, width: 0, height: 0 },
    { id: 'b', type: 'node', x: 10, y: 10, width: 0, height: 0 },
    { id: 'route', type: 'AGVpath', fromId: 'a', toId: 'b',
      nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], cornerRadii: [4] },
  );
  workspace.handleUpdateComponentPositions([{ id: 'a', x: -9, y: 7 }, { id: 'b', x: 1, y: 17 }]);
  const route = workspace.placedComponents.value[2];
  near(route.nodes[0].x, -9); near(route.nodes[0].y, 7);
  near(route.nodes[1].x, 1); near(route.nodes[1].y, 7);
  near(route.nodes[2].x, 1); near(route.nodes[2].y, 17);
  near(route.cornerRadii[0], 4);
  workspace.handleUpdateComponentPositions([{ id: 'a', x: -8.9, y: 7.2 }, { id: 'b', x: 1.1, y: 17.2 }]);
  near(route.nodes[1].x, 1.1); near(route.nodes[1].y, 7.2);
  near(route.cornerRadii[0], 4);
});

test('parent keeps multi-selection in sync when selecting from the tree and deleting selected objects', () => {
  const workspace = loadComponent('WorkspaceLayout', {
    getComponentLabel: (item) => item.id,
  }, 'placedComponents, selectedIds, selectedId, handleSelectComponents, handleSelectComponent, handleKeyDown');
  workspace.placedComponents.value.push(buffer(), buffer({ id: 'second' }), buffer({ id: 'third' }));
  workspace.handleSelectComponents(['component-1', 'second', 'second', 'missing']);
  assert.deepEqual([...workspace.selectedIds.value], ['component-1', 'second']);
  assert.equal(workspace.selectedId.value, 'component-1');
  workspace.handleSelectComponent('third');
  assert.deepEqual([...workspace.selectedIds.value], ['third']);
  workspace.handleSelectComponents(['component-1', 'second']);
  workspace.handleKeyDown({ key: 'Delete', target: { tagName: 'INPUT' }, preventDefault() {} });
  assert.equal(workspace.placedComponents.value.length, 3);
  workspace.handleKeyDown({ key: 'Delete', target: { tagName: 'CANVAS' }, preventDefault() {} });
  assert.deepEqual([...workspace.placedComponents.value].map((item) => item.id), ['third']);
  assert.equal(workspace.selectedIds.value.length, 0);
  assert.equal(workspace.selectedId.value, null);
});

test('model tree Shift-click adds and removes objects through the shared selection state', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, selectedIds, handleToggleComponentSelection, handleSelectComponent');
  workspace.placedComponents.value.push(buffer(), buffer({ id: 'second' }));
  const sidebar = loadComponent('ResourceSidebar', {
    defineProps: () => ({}),
    defineEmits: () => (event, id) => {
      if (event === 'toggle-component-selection') workspace.handleToggleComponentSelection(id);
      else if (event === 'select-component') workspace.handleSelectComponent(id);
    },
  }, 'selectInstance');
  sidebar.selectInstance('component-1', { shiftKey: false });
  sidebar.selectInstance('second', { shiftKey: true });
  assert.deepEqual([...workspace.selectedIds.value], ['component-1', 'second']);
  sidebar.selectInstance('component-1', { shiftKey: true });
  assert.deepEqual([...workspace.selectedIds.value], ['second']);
});

test('focusing a component centers and fits its bounds, including small, large and negative-coordinate objects', (t) => {
  const c = createCanvas([
    buffer({ x: -120, y: -200 }),
    buffer({ id: 'large', x: 300, y: 500, width: 240, height: 80 }),
    buffer({ id: 'small', x: -500, y: 800, width: 0.2, height: 0.2 }),
    { id: 'station', type: 'node', x: -1000, y: -800, width: 0, height: 0 },
  ]); t.after(() => c.dispose());
  const before = JSON.stringify(c.props.placedComponents);
  for (const item of c.props.placedComponents) {
    c.api.focusComponent(item.id);
    const center = c.api.getCanvasMousePosition({ clientX: 680, clientY: 400 });
    near(center.x, item.x + item.width / 2);
    near(center.y, item.y + item.height / 2);
    assert.ok(item.width * c.api.ppm.value <= 904);
    assert.ok(item.height * c.api.ppm.value <= 472 + 1e-8);
    assert.ok(Number.isFinite(c.api.ppm.value) && c.api.ppm.value > 0);
    if (item.id === 'small') assert.ok(item.width * c.api.ppm.value >= 50);
  }
  assert.equal(JSON.stringify(c.props.placedComponents), before);
  const view = JSON.stringify(c.api.viewOrigin.value);
  c.api.focusComponent('deleted');
  assert.equal(JSON.stringify(c.api.viewOrigin.value), view);
});

test('focusing a line includes both endpoints; focusing an AGV path includes distant bends', (t) => {
  const c = createCanvas([
    buffer({ x: -20, y: -40 }), buffer({ id: 'component-2', x: 30, y: 50 }),
    { id: 'line', type: 'connectionLine', fromId: 'component-1', toId: 'component-2' },
    { id: 'path', type: 'AGVpath', nodes: [{ x: -20, y: -40 }, { x: -800, y: 900 }, { x: 30, y: 50 }] },
  ]); t.after(() => c.dispose());
  for (const [id, points] of [
    ['line', [{ x: -20, y: -40 }, { x: 33, y: 53 }]],
    ['path', c.props.placedComponents[3].nodes],
  ]) {
    c.api.focusComponent(id);
    for (const p of points) {
      const screen = c.pointer(p.x, p.y);
      assert.ok(screen.clientX > 180 && screen.clientX < 1180);
      assert.ok(screen.clientY > 100 && screen.clientY < 700);
    }
  }
});

test('model-tree double-click focuses the object, while single-click selection leaves the view unchanged', (t) => {
  const c = createCanvas([buffer({ x: -40, y: 70 })]); t.after(() => c.dispose());
  const workspace = loadComponent('WorkspaceLayout', {},
    'selectedId, designCanvas, handleTreeFocusComponent, handleSelectComponent');
  workspace.designCanvas.value = { focusComponent: c.api.focusComponent };
  workspace.handleTreeFocusComponent('component-1');
  assert.equal(workspace.selectedId.value, 'component-1');
  const origin = { ...c.api.viewOrigin.value };
  const scale = c.api.ppm.value;
  c.api.viewOrigin.value = { x: 999, y: -999 };
  c.api.ppm.value = 2;
  workspace.handleSelectComponent('component-1');
  near(c.api.viewOrigin.value.x, 999); near(c.api.ppm.value, 2);
  workspace.handleTreeFocusComponent('component-1');
  near(c.api.viewOrigin.value.x, origin.x); near(c.api.viewOrigin.value.y, origin.y);
  near(c.api.ppm.value, scale);
});

test('resizing across the origin preserves the center, and properties display signed Y-up coordinates', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(buffer({ x: -1, y: -2 }));
  workspace.handleUpdateComponentProperties({ id: 'component-1', width: 8, height: 10 });
  const item = workspace.placedComponents.value[0];
  near(item.x, -3.5); near(item.y, -5.5);
  near(item.x + item.width / 2, 0.5); near(item.y + item.height / 2, -0.5);
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({ selectedItem: item, placedComponents: [item] }),
  }, 'centerCoordinates');
  near(properties.centerCoordinates.value.x, 0.5);
  near(properties.centerCoordinates.value.y, -0.5);
});

test('editing center coordinates moves the selected component without changing its size or other axis', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentPosition');
  workspace.placedComponents.value.push(buffer({ x: -3, y: 5, width: 3.01, height: 4 }));
  const item = workspace.placedComponents.value[0];
  const updates = [];
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({ selectedItem: item }),
    defineEmits: () => (event, value) => {
      assert.equal(event, 'update-component-position');
      updates.push(value);
      workspace.handleUpdateComponentPosition(value);
    },
  }, 'centerCoordinates, handleCenterCoordinateChange');
  const input = (value) => ({ target: { value } });
  properties.handleCenterCoordinateChange('x', input('-12.3'));
  near(item.x, -13.805); near(item.y, 5);
  near(properties.centerCoordinates.value.x, -12.3);
  properties.handleCenterCoordinateChange('y', input('0'));
  near(item.x, -13.805); near(item.y, -2);
  near(item.width, 3.01); near(item.height, 4);
  properties.handleCenterCoordinateChange('y', input('0'));
  assert.equal(updates.length, 2, 'change followed by blur must not emit a duplicate move');
  for (const value of ['', '-', 'Infinity', '1e999', 'invalid']) {
    const event = input(value);
    properties.handleCenterCoordinateChange('x', event);
    assert.equal(event.target.value, '-12.3');
  }
  assert.equal(updates.length, 2);
  workspace.handleUpdateComponentPosition({ id: item.id, x: 10, y: -8 });
  near(properties.centerCoordinates.value.x, 11.505);
  near(properties.centerCoordinates.value.y, -6);
});

test('editing a station coordinate updates attached AGV path endpoints', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentPosition');
  workspace.placedComponents.value.push(
    { id: 'node-1', type: 'node', x: 5, y: 5, width: 0, height: 0 },
    { id: 'path-1', type: 'AGVpath', fromId: 'node-1', toId: 'node-2',
      nodes: [{ x: 5, y: 5 }, { x: 10, y: 10 }], cornerRadii: [] },
  );
  const item = workspace.placedComponents.value[0];
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({ selectedItem: item }),
    defineEmits: () => (_, value) => workspace.handleUpdateComponentPosition(value),
  }, 'centerCoordinates, handleCenterCoordinateChange');
  properties.handleCenterCoordinateChange('x', { target: { value: '-4.2' } });
  properties.handleCenterCoordinateChange('y', { target: { value: '-3.1' } });
  near(item.x, -4.2); near(item.y, -3.1);
  const nodes = workspace.placedComponents.value[1].nodes;
  near(nodes[0].x, -4.2); near(nodes[0].y, -3.1);
  near(nodes[1].x, 10); near(nodes[1].y, 10);
});

test('placement after reset uses click coordinates and the default 3m buffer; empty reset and resize work', async (t) => {
  const c = createCanvas(); t.after(() => c.dispose());
  const viewportCenter = { clientX: 680, clientY: 400 };
  const initialCenter = c.api.getCanvasMousePosition(viewportCenter);
  near(initialCenter.x, 0); near(initialCenter.y, 0);
  c.api.ppm.value = 120;
  c.api.viewOrigin.value = { x: 100, y: 100 };
  c.api.resetZoom();
  near(c.api.ppm.value, 10);
  const resetCenter = c.api.getCanvasMousePosition(viewportCenter);
  near(resetCenter.x, 0); near(resetCenter.y, 0);
  c.props.activeControl = { type: 'buffer', name: '缓冲区', icon: 'buffer.svg' };
  c.api.imageCache.set('buffer.svg', { complete: true });
  await c.api.handleMouseDown(c.pointer(20.24, 25.26));
  const placed = c.props.placedComponents[0];
  near(placed.x + placed.width / 2, 20.2);
  near(placed.y + placed.height / 2, 25.3);
  assert.equal(placed.width, 3); assert.equal(placed.height, 3);
  c.container.clientWidth = 720; c.container.clientHeight = 420;
  c.resize(); c.api.drawGridNow();
  assert.equal(c.element.width, 1440); assert.equal(c.element.height, 840);
});

test('AGV bend and station dragging retain grab offset and 0.1m steps', async (t) => {
  const c = createCanvas([
    { id: 'node-1', type: 'node', x: 5, y: 5, width: 0, height: 0 },
    { id: 'path-1', type: 'AGVpath', nodes: [{ x: 5, y: 5 }, { x: 15, y: 15 }, { x: 25, y: 5 }] },
  ]); t.after(() => c.dispose());
  c.api.ppm.value = 100;
  c.props.selectedId = 'path-1';
  await c.api.handleMouseDown(c.pointer(15.02, 15.01));
  assert.equal(c.api.draggingCorner.value, true);
  c.api.handleMouseMove(c.pointer(15.08, 15.15));
  near(c.props.placedComponents[1].nodes[1].x, 15.1);
  near(c.props.placedComponents[1].nodes[1].y, 15.1);
  c.api.handleMouseUp();
  await c.api.handleMouseDown(c.pointer(5.02, 5.01));
  c.api.handleMouseMove(c.pointer(5.08, 5.01));
  near(c.props.placedComponents[0].x, 5.1);
  near(c.props.placedComponents[0].y, 5);
  c.api.handleMouseUp();
});

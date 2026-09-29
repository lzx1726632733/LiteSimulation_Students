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
const agvGeometry = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/agvPath.js'), 'utf8',
).replace(/export const /g, 'const ') + '\n;({ DEFAULT_PATH_WIDTH, getPathWidth, getCornerMaxRadius, buildPathGeometry, pointOnPathSegment, tracePathGeometry, isPointInPathArea, getPathBounds })');
const stations = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/stations.js'), 'utf8',
).replace(/export const /g, 'const ') + '\n;({ STATION_TYPES, DEFAULT_STATION_SIZE, getStationType, getNextStationIndex, getComponentBounds, getComponentCenter })');
const componentAppearance = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/componentAppearance.js'), 'utf8',
).replace(/export const /g, 'const ') + '\n;({ RESIZABLE_COMPONENT_TYPES, DEFAULT_COMPONENT_SHADOW_COLORS, DEFAULT_COMPONENT_SIZES, getDefaultShadowColor })');
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
    ...agvGeometry,
    ...stations,
    ...componentAppearance,
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
    hitTestComponent, hitTestLabel, resolveLineEndpoints, hitTestConnectionLine, hitTestAGVPath,
  })`;
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

test('straight AGV areas use physical width and flat rectangular ends', () => {
  const route = { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }], pathWidth: 2 };
  assert.equal(agvGeometry.isPointInPathArea(route, 5, 0.99), true);
  assert.equal(agvGeometry.isPointInPathArea(route, 5, -0.99), true);
  assert.equal(agvGeometry.isPointInPathArea(route, 5, 1.01), false);
  assert.equal(agvGeometry.isPointInPathArea(route, -0.01, 0), false);
  assert.equal(agvGeometry.isPointInPathArea(route, 10.01, 0), false);
  assert.equal(agvGeometry.buildPathGeometry({ nodes: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }).length, 0);
  near(agvGeometry.getPathWidth({}), 1);
});

test('a pure quarter-circle AGV area has annular bounds and tangent directions in both orientations', () => {
  const route = { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], pathWidth: 1, cornerRadii: [10] };
  const segments = agvGeometry.buildPathGeometry(route);
  assert.equal(segments.length, 1);
  const arc = segments[0];
  assert.equal(arc.type, 'arc');
  near(arc.center.x, 0); near(arc.center.y, 10);
  near(arc.length, 5 * Math.PI);
  const mid = agvGeometry.pointOnPathSegment(arc, 0.5);
  near(mid.ux, Math.SQRT1_2); near(mid.uy, Math.SQRT1_2);
  for (const radius of [9.51, 10.49]) {
    assert.equal(agvGeometry.isPointInPathArea(route, radius * Math.SQRT1_2, 10 - radius * Math.SQRT1_2), true);
  }
  for (const radius of [9.49, 10.51]) {
    assert.equal(agvGeometry.isPointInPathArea(route, radius * Math.SQRT1_2, 10 - radius * Math.SQRT1_2), false);
  }
  assert.equal(agvGeometry.isPointInPathArea(route, 0, 10), false);
  const reversed = agvGeometry.buildPathGeometry({ ...route, nodes: [...route.nodes].reverse() });
  const reverseMid = agvGeometry.pointOnPathSegment(reversed[0], 0.5);
  near(reverseMid.x, mid.x); near(reverseMid.y, mid.y);
  near(reverseMid.ux, -mid.ux); near(reverseMid.uy, -mid.uy);
  const commands = [];
  agvGeometry.tracePathGeometry({ beginPath() {}, moveTo() {}, arc(...args) { commands.push(args); } }, segments, 10);
  near(commands[0][2], 100);
  assert.equal(commands[0][5], true, 'Y-up left turn becomes counterclockwise canvas arc');
});

test('AGV arc radius limits account for sharp turns, duplicate points and neighboring arcs', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }];
  const maxRadius = agvGeometry.getCornerMaxRadius(nodes, 0);
  assert.ok(maxRadius > 0 && maxRadius < 1);
  const arc = agvGeometry.buildPathGeometry({ nodes, cornerRadii: [100] }).find((s) => s.type === 'arc');
  near(arc.radius, maxRadius);
  assert.equal(agvGeometry.getCornerMaxRadius([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 2 }], 0), 0);
  const shared = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }];
  near(agvGeometry.getCornerMaxRadius(shared, 0), 5);
  near(agvGeometry.getCornerMaxRadius(shared, 1), 5);
  const curve = agvGeometry.buildPathGeometry({ nodes: shared, cornerRadii: [100, 100] });
  assert.ok(curve.every((s) => Number.isFinite(s.length) && s.length > 0));
});

test('AGV area rendering scales width, reverses arrow direction and fits the full corridor', (t) => {
  const item = { id: 'route', type: 'AGVpath', nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }], pathWidth: 2, cornerRadii: [] };
  const c = createCanvas([item]); t.after(() => c.dispose());
  const ctx = c.element.getContext('2d');
  const strokes = [], arrows = [];
  let points = [];
  ctx.beginPath = () => { points = []; };
  ctx.moveTo = (x, y) => points.push({ x, y });
  ctx.lineTo = (x, y) => points.push({ x, y });
  ctx.stroke = () => strokes.push({ width: ctx.lineWidth, color: ctx.strokeStyle, cap: ctx.lineCap });
  ctx.fill = () => { if (ctx.fillStyle === '#047857') arrows.push([...points]); };
  for (const scale of [10, 40]) {
    c.api.ppm.value = scale;
    c.api.viewOrigin.value = { x: -2, y: 5 };
    strokes.length = 0; arrows.length = 0;
    c.api.drawGridNow();
    const band = strokes.find((stroke) => stroke.color === '#d1fae5');
    near(band.width, 2 * scale);
    assert.equal(band.cap, 'butt');
    assert.ok(arrows.length > 0);
    assert.ok(arrows[0][0].x > arrows[0][1].x);
    assert.equal(c.api.hitTestAGVPath(item, 5, 0.95), true);
    assert.equal(c.api.hitTestAGVPath(item, 5, 2), false);
  }
  item.nodes.reverse();
  arrows.length = 0;
  c.api.drawGridNow();
  assert.ok(arrows[0][0].x < arrows[0][1].x);
  item.pathWidth = 100;
  c.api.resetZoom();
  const bounds = agvGeometry.getPathBounds(item);
  const lower = c.pointer(bounds.minX, bounds.minY), upper = c.pointer(bounds.maxX, bounds.maxY);
  assert.ok(lower.clientX >= 180 && upper.clientX <= 1180);
  assert.ok(upper.clientY >= 100 && lower.clientY <= 700);
});

test('AGV properties change width, reverse endpoints, and keep station links working', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties, handleUpdateComponentPosition');
  workspace.placedComponents.value.push(
    { id: 'a', type: 'node', x: 0, y: 0, width: 3, height: 3 },
    { id: 'b', type: 'node', x: 10, y: 10, width: 3, height: 3 },
    { id: 'route', type: 'AGVpath', fromId: 'a', toId: 'b', fromName: 'A', toName: 'B',
      nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
  );
  const route = workspace.placedComponents.value[2];
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({ selectedItem: route }),
    defineEmits: () => (_, value) => workspace.handleUpdateComponentProperties(value),
  }, 'handlePathWidthChange');
  const input = { target: { value: '2.346' } };
  properties.handlePathWidthChange(input);
  near(route.pathWidth, 2.35);
  assert.equal(input.target.value, '2.35');
  workspace.handleUpdateComponentProperties({ id: 'route', reverseDirection: true });
  assert.equal(route.fromId, 'b'); assert.equal(route.toId, 'a');
  assert.equal(route.fromName, 'B'); assert.equal(route.toName, 'A');
  near(route.nodes[0].x, 10); near(route.nodes[2].x, 0);
  near(route.pathWidth, 2.35);
  workspace.handleUpdateComponentPosition({ id: 'a', x: -1, y: -2 });
  near(route.nodes[2].x, -1); near(route.nodes[2].y, -2);
});

test('AGV path drawing creates straight corridors through clicked waypoints', async (t) => {
  const stationsAt = [
    { id: 'start', type: 'node', name: '停靠站点', index: 1, x: 0, y: 0, width: 3, height: 3 },
    { id: 'end', type: 'node', name: '停靠站点', index: 2, x: 10, y: 10, width: 3, height: 3 },
  ];
  const c = createCanvas(stationsAt); t.after(() => c.dispose());
  c.props.activeControl = { type: 'AGVpath', name: 'AGV路径', icon: 'AGVpath.svg' };
  await vue.nextTick();
  assert.doesNotMatch(descriptor.template.content, /agvDrawingMode|arcDrawingRadius|圆弧/);
  await c.api.handleMouseDown(c.pointer(0, 0));
  await c.api.handleMouseDown(c.pointer(10, 0));
  await c.api.handleMouseDown(c.pointer(10, 10));
  const path = c.props.placedComponents.find((item) => item.type === 'AGVpath');
  assert.ok(path);
  assert.equal(path.fromId, 'start'); assert.equal(path.toId, 'end');
  assert.equal(path.cornerRadii, undefined);
  assert.equal(agvGeometry.buildPathGeometry(path).some((segment) => segment.type === 'arc'), false);
});

test('ordinary connection lines reject stations at both endpoints and still connect components', async (t) => {
  const c = createCanvas([
    { id: 'station', type: 'node', name: '停靠站点', index: 1, x: 0, y: 0, width: 3, height: 3 },
    buffer({ id: 'machine-a', x: 9, y: -1.5 }),
    buffer({ id: 'machine-b', x: 18, y: -1.5 }),
  ]); t.after(() => c.dispose());
  c.props.activeControl = { type: 'connectionLine', name: '连接线', icon: 'connection.svg' };
  await vue.nextTick();
  await c.api.handleMouseDown(c.pointer(0, 0));
  await c.api.handleMouseDown(c.pointer(10, 0));
  await c.api.handleMouseDown(c.pointer(1, 0));
  assert.equal(c.props.placedComponents.some((item) => item.type === 'connectionLine'), false);
  await c.api.handleMouseDown(c.pointer(19, 0));
  const line = c.props.placedComponents.find((item) => item.type === 'connectionLine');
  assert.ok(line);
  assert.equal(line.fromId, 'machine-a'); assert.equal(line.toId, 'machine-b');
  assert.ok(c.events.some((event) => event.type === 'add-log' && event.value.includes('不能连接站点')));
});

test('station placement numbers each subtype independently and reuses gaps without reusing IDs', async (t) => {
  const c = createCanvas(); t.after(() => c.dispose());
  const sequence = ['parking', 'charging', 'junction', 'loading', 'parking', 'charging'];
  for (const [i, stationType] of sequence.entries()) {
    c.props.activeControl = { type: 'node', name: '站点', stationType };
    await vue.nextTick();
    await c.api.handleMouseDown(c.pointer(i * 4, 0, { altKey: true }));
  }
  assert.deepEqual(c.props.placedComponents.map((item) => item.index), [1, 1, 1, 1, 2, 2]);
  const removed = c.props.placedComponents.splice(1, 1)[0];
  const survivors = c.props.placedComponents.map((item) => item.id);
  await c.api.handleMouseDown(c.pointer(25, 0, { altKey: true }));
  const replacement = c.props.placedComponents.at(-1);
  assert.equal(replacement.stationType, 'charging');
  assert.equal(replacement.index, 1);
  assert.notEqual(replacement.id, removed.id);
  assert.ok(!survivors.includes(replacement.id));
  assert.ok(c.events.some(({ type, value }) => type === 'add-log' && value.includes('充电站点1')));
});

test('changing station subtype allocates a free index and preserves custom names and references', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(
    { id: 'p1', type: 'node', stationType: 'parking', index: 1, displayName: '入口', x: 0, y: 0, width: 2, height: 1 },
    { id: 'p2', type: 'node', stationType: 'parking', index: 2, x: 4, y: 0, width: 2, height: 1 },
    { id: 'c1', type: 'node', stationType: 'charging', index: 1, x: 8, y: 0, width: 2, height: 1 },
    { id: 'route', type: 'AGVpath', fromId: 'p1', toId: 'p2', nodes: [{ x: 0, y: 0 }, { x: 4, y: 0 }] },
  );
  const item = workspace.placedComponents.value[0];
  const route = JSON.stringify(workspace.placedComponents.value[3]);
  workspace.handleUpdateComponentProperties({ id: 'p1', stationType: 'charging' });
  assert.equal(item.index, 2);
  assert.equal(item.name, '充电站点');
  assert.equal(item.displayName, '入口');
  workspace.handleUpdateComponentProperties({ id: 'p1', stationType: 'charging' });
  assert.equal(item.index, 2);
  workspace.handleUpdateComponentProperties({ id: 'p1', stationType: 'parking' });
  assert.equal(item.index, 1);
  assert.equal(item.name, '停靠站点');
  assert.equal(JSON.stringify(workspace.placedComponents.value[3]), route);
  workspace.handleUpdateComponentProperties({ id: 'p1', stationType: 'unknown' });
  assert.equal(item.index, 1);
  assert.equal(item.stationType, 'parking');
});

test('model tree groups stations by subtype with matching colors, sorted indices, search and independent collapse', () => {
  const menu = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/config/controlMenuData.js'), 'utf8')
    .replace(/export const /g, 'const ') + '\n;({ tabList, menuControls })');
  const getComponentLabel = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/utils/componentLabel.js'), 'utf8')
    .replace('export const ', 'const ') + '\n;getComponentLabel');
  const items = vue.reactive([
    { id: 'p2', type: 'node', stationType: 'parking', name: '停靠站点', index: 2 },
    { id: 'c1', type: 'node', stationType: 'charging', name: '充电站点', index: 1, displayName: '电池区' },
    { id: 'p1', type: 'node', name: '停靠站点', index: 1 },
    { id: 'j1', type: 'node', stationType: 'junction', name: '路径节点', index: 1 },
    { id: 'l1', type: 'node', stationType: 'loading', name: '装卸站点', index: 1 },
    buffer(),
  ]);
  const sidebar = loadComponent('ResourceSidebar', {
    ...menu, getComponentLabel, defineProps: () => ({ placedComponents: items }),
  }, 'treeData, searchQuery, toggleNode, isCollapsed');
  const stationGroup = () => sidebar.treeData.value.find((category) => category.tabId === 'logistics').types.find((group) => group.type === 'node');
  const sections = stationGroup().sections;
  assert.equal(sections.length, 4);
  assert.deepEqual([...sections[0].instances].map((item) => item.id), ['p1', 'p2']);
  sections.forEach((section, i) => {
    assert.equal(section.name, stations.STATION_TYPES[i].label);
    assert.equal(section.color, stations.STATION_TYPES[i].color);
  });
  assert.equal(stationGroup().instances.length, 5);
  sidebar.toggleNode('logistics:node:parking');
  assert.equal(sidebar.isCollapsed('logistics:node:parking'), true);
  assert.equal(sidebar.isCollapsed('logistics:node:charging'), false);
  for (const query of ['充电站点', '电池区']) {
    sidebar.searchQuery.value = query;
    assert.equal(stationGroup().sections.length, 1);
    assert.equal(stationGroup().sections[0].instances[0].id, 'c1');
  }
  sidebar.searchQuery.value = '站点';
  assert.equal(stationGroup().instances.length, 5);
  sidebar.searchQuery.value = '';
  items[1].stationType = 'loading';
  assert.equal(stationGroup().sections.length, 3);
  assert.equal(stationGroup().sections.find((section) => section.stationType === 'loading').instances.length, 2);
  assert.equal(sidebar.treeData.value.find((category) => category.tabId === 'commonControl').total, 1);
});

test('all station types render real rectangular bounds and colors at different zoom levels', async (t) => {
  const fills = new Set();
  for (const type of stations.STATION_TYPES) {
    const c = createCanvas(); t.after(() => c.dispose());
    c.props.activeControl = { type: 'node', name: '站点', stationType: type.value };
    await vue.nextTick();
    await c.api.handleMouseDown(c.pointer(-5.23, 4.56));
    const item = c.props.placedComponents[0];
    assert.equal(item.stationType, type.value);
    assert.equal(item.name, type.label);
    near(item.x, -5.23); near(item.y, 4.56);
    near(item.width, 3); near(item.height, 3);
    fills.add(type.fill);
    const ctx = c.element.getContext('2d');
    const rectangles = [];
    ctx.fillRect = (...args) => rectangles.push({ color: ctx.fillStyle, args });
    for (const scale of [10, 100]) {
      rectangles.length = 0;
      c.api.ppm.value = scale;
      c.api.drawGridNow();
      const rect = rectangles.find((entry) => entry.color === type.fill);
      assert.ok(rect);
      near(rect.args[0], (-5.23 - 1.5) * scale);
      near(rect.args[1], -(4.56 + 1.5) * scale);
      near(rect.args[2], 3 * scale); near(rect.args[3], 3 * scale);
      assert.equal(c.api.hitTestComponent(-6.72, 6.05)?.id, item.id);
      assert.equal(c.api.hitTestComponent(-6.74, 6.05), null);
    }
  }
  assert.equal(fills.size, 4);
});

test('station type and dimensions can change while preserving its center, custom name and AGV route', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(
    { id: 'station', type: 'node', name: '停靠站点', displayName: '入口站', stationType: 'parking', x: -3.21, y: 5.67, width: 2, height: 1 },
    { id: 'route', type: 'AGVpath', fromId: 'station', nodes: [{ x: -3.21, y: 5.67 }, { x: 10, y: 10 }], cornerRadii: [] },
  );
  const item = workspace.placedComponents.value[0];
  const routeBefore = JSON.stringify(workspace.placedComponents.value[1]);
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({ selectedItem: item }),
    defineEmits: () => (_, value) => workspace.handleUpdateComponentProperties(value),
  }, 'centerCoordinates, widthInMeters, heightInMeters, stationStyle, handleStationTypeChange, handleDimensionChange');
  properties.handleStationTypeChange({ target: { value: 'charging' } });
  properties.handleDimensionChange('width', { target: { value: '3.01' } });
  properties.handleDimensionChange('height', { target: { value: '1.25' } });
  assert.equal(item.name, '充电站点');
  assert.equal(item.displayName, '入口站');
  assert.equal(properties.stationStyle.value.value, 'charging');
  near(properties.widthInMeters.value, 3.01); near(properties.heightInMeters.value, 1.25);
  near(properties.centerCoordinates.value.x, -3.21); near(properties.centerCoordinates.value.y, 5.67);
  assert.equal(JSON.stringify(workspace.placedComponents.value[1]), routeBefore);
});

test('rectangular stations require their full bounds for box selection and drag from their center by 0.01m', async (t) => {
  const c = createCanvas([{ id: 'station', type: 'node', x: 0, y: 0, width: 2, height: 1 }]);
  t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(-10, -5));
  c.api.handleMouseMove(c.pointer(0.5, 0.4));
  c.api.handleMouseUp();
  assert.equal(c.props.selectedIds.length, 0);
  await c.api.handleMouseDown(c.pointer(-10, -5));
  c.api.handleMouseMove(c.pointer(1.1, 0.6));
  c.api.handleMouseUp();
  assert.deepEqual([...c.props.selectedIds], ['station']);
  await c.api.handleMouseDown(c.pointer(-0.9, 0.4));
  c.api.handleMouseMove(c.pointer(-0.87, 0.38, { altKey: true }));
  c.api.handleMouseUp();
  near(c.props.placedComponents[0].x, 0.03);
  near(c.props.placedComponents[0].y, -0.02);
});

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

test('alignment can snap component edges to the X axis, Y axis and coordinate origin', () => {
  const axes = [
    { id: 'axis-x', axes: ['y'], anchorKinds: ['edge', 'center'], x: -100, y: 0, width: 200, height: 0 },
    { id: 'axis-y', axes: ['x'], anchorKinds: ['edge', 'center'], x: 0, y: -100, width: 0, height: 200 },
  ];
  const yAxisEdge = alignBounds(
    { x: 0.04, y: 10, width: 2, height: 2 },
    { x: 0, y: 10, width: 2, height: 2 }, axes, 0.06,
  );
  near(yAxisEdge.x, 0);
  assert.equal(yAxisEdge.guides[0].targetId, 'axis-y');
  assert.equal(yAxisEdge.guides[0].kind, 'edge');
  const xAxisEdge = alignBounds(
    { x: 10, y: 0.04, width: 2, height: 2 },
    { x: 10, y: 0, width: 2, height: 2 }, axes, 0.06,
  );
  near(xAxisEdge.y, 0);
  assert.equal(xAxisEdge.guides[0].targetId, 'axis-x');
  assert.equal(xAxisEdge.guides[0].kind, 'edge');

  const xAxis = alignBounds(
    { x: 20, y: -1.04, width: 2, height: 2 },
    { x: 20, y: -1, width: 2, height: 2 }, axes, 0.06,
  );
  near(xAxis.y + 1, 0);
  assert.deepEqual([...xAxis.guides].map((guide) => guide.targetId), ['axis-x']);
  assert.deepEqual([...xAxis.guides].map((guide) => guide.axis), ['y']);

  const origin = alignBounds(
    { x: -1.04, y: -1.04, width: 2, height: 2 },
    { x: -1, y: -1, width: 2, height: 2 }, [...axes, { id: 'origin', anchorKinds: ['center'], x: 0, y: 0, width: 0, height: 0 }], 0.06,
  );
  near(origin.x + 1, 0);
  near(origin.y + 1, 0);
  assert.deepEqual([...origin.guides].map((guide) => guide.targetId), ['origin', 'origin']);
});

for (const scale of [10, 100, 1000]) {
  test(`drag alignment uses a screen-space threshold at ${scale}px/m; Alt bypasses it and release clears guides`, async (t) => {
    const size = 30 / scale;
    const start = -100 / scale;
    const c = createCanvas([
      buffer({ x: start, y: start, width: size, height: size }),
      buffer({ id: 'reference', x: -0.04, y: 30 / scale, width: size, height: size }),
    ]); t.after(() => c.dispose());
    c.api.ppm.value = scale;
    c.api.viewOrigin.value = { x: -200 / scale, y: 200 / scale };
    await c.api.handleMouseDown(c.pointer(start + size / 2, start + size / 2));
    const rawX = -0.04 - 5 / scale;
    const move = c.pointer(rawX + size / 2, start + size / 2);
    c.api.handleMouseMove(move);
    near(c.props.placedComponents[0].x, -0.04);
    assert.equal(c.api.alignmentGuides.value[0].targetId, 'reference');
    c.api.drawGridNow();
    c.api.handleMouseMove({ ...move, altKey: true });
    assert.ok(Math.abs(c.props.placedComponents[0].x - (start + Math.round((rawX - start) / 0.01) * 0.01)) <= 0.01 + 1e-8);
    assert.equal(c.api.alignmentGuides.value.length, 0);
    c.api.handleMouseMove(move);
    c.api.handleMouseUp();
    near(c.props.placedComponents[0].x, -0.04);
    assert.equal(c.api.alignmentGuides.value.length, 0);
  });
}

test('Shift direction lock prevents alignment from moving the locked axis', async (t) => {
  const c = createCanvas([
    buffer({ x: -10, y: 0 }),
    buffer({ id: 'reference', x: -0.025, y: 0.2 }),
  ]); t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(-9, 1));
  c.api.handleMouseMove(c.pointer(0.9, 1.1, { shiftKey: true }));
  near(c.props.placedComponents[0].x, -0.025);
  near(c.props.placedComponents[0].y, 0);
  assert.deepEqual([...c.api.alignmentGuides.value].map((guide) => guide.axis), ['x']);
});

test('group alignment uses its outer bounds without changing spacing or snapping to its own members', async (t) => {
  const c = createCanvas([
    buffer({ id: 'a', x: -10, y: 0 }),
    buffer({ id: 'b', x: -6, y: 2 }),
    buffer({ id: 'reference', x: -0.025, y: 10 }),
  ]); t.after(() => c.dispose());
  c.props.selectedId = 'a'; c.props.selectedIds = ['a', 'b'];
  await c.api.handleMouseDown(c.pointer(-9, 1));
  // Group right edge approaches the reference's left edge.
  c.api.handleMouseMove(c.pointer(-6.1, 1));
  near(c.props.placedComponents[0].x, -7.025);
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
  c.api.handleMouseMove(c.pointer(1.1, 1.1, { altKey: true }));
  near(c.props.placedComponents[0].x, 0.1);
  near(c.props.placedComponents[0].y, 0.1);
  assert.equal(c.api.alignmentGuides.value.length, 0);
});

test('Vue template and setup compile; zoom toolbar contains only fit-all', () => {
  const script = compileScript(descriptor, { id: 'canvas-test' });
  const template = compileTemplate({ source: descriptor.template.content, filename,
    id: 'canvas-test', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  assert.equal((descriptor.template.content.match(/class="zoom-btn"/g) || []).length, 1);
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
  test(`drag moves by 0.01m at ${scale}px/m, preserving grab offset and Shift axis lock`, async (t) => {
    const c = createCanvas([buffer({ x: 10.025 })]); t.after(() => c.dispose());
    c.api.ppm.value = scale;
    await c.api.handleMouseDown(c.pointer(10.7, 10.8));
    c.api.handleMouseMove(c.pointer(10.704, 10.8));
    near(c.props.placedComponents[0].x, 10.025);
    c.api.handleMouseMove(c.pointer(10.706, 10.8));
    near(c.props.placedComponents[0].x, 10.035);
    c.api.handleMouseMove(c.pointer(10.694, 10.806));
    near(c.props.placedComponents[0].x, 10.015);
    near(c.props.placedComponents[0].y, 10.01);
    c.api.handleMouseMove(c.pointer(11.96, 11.04, { shiftKey: true }));
    near(c.props.placedComponents[0].x, 11.285);
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
    // 拖动已框选的一员，整组使用同一 0.01m 步长位移。
    await c.api.handleMouseDown(c.pointer(-4.5, -1.5));
    c.api.handleMouseMove(c.pointer(-4.24, -1.86, { altKey: true }));
    c.api.handleMouseUp();
    near(c.props.placedComponents[0].x, -5.74); near(c.props.placedComponents[0].y, -3.36);
    near(c.props.placedComponents[1].x, 2.26); near(c.props.placedComponents[1].y, 1.64);
    near(c.props.placedComponents[4].x, 0.26); near(c.props.placedComponents[4].y, -5.36);
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

test('AGV paths can be box selected in either drag direction only when the entire area is enclosed', async (t) => {
  const route = { id: 'route', type: 'AGVpath', pathWidth: 2,
    nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], cornerRadii: [3] };
  const bounds = agvGeometry.getPathBounds(route);
  for (const reverse of [false, true]) {
    const c = createCanvas([route]); t.after(() => c.dispose());
    const corner = reverse
      ? [[bounds.maxX + 1, bounds.maxY + 1], [bounds.minX - 1, bounds.minY - 1]]
      : [[bounds.minX - 1, bounds.minY - 1], [bounds.maxX + 1, bounds.maxY + 1]];
    await c.api.handleMouseDown(c.pointer(bounds.minX - 1, bounds.minY - 1));
    c.api.handleMouseMove(c.pointer(bounds.maxX - 1, bounds.maxY + 1));
    c.api.handleMouseUp();
    assert.deepEqual([...c.props.selectedIds], [], 'a box that cuts through the route must not select it');
    await c.api.handleMouseDown(c.pointer(...corner[0]));
    c.api.handleMouseMove(c.pointer(...corner[1]));
    c.api.handleMouseUp();
    assert.deepEqual([...c.props.selectedIds], ['route']);
    assert.equal(c.api.isComponentSelected('route'), true);
    assert.deepEqual(c.props.placedComponents[0].nodes, route.nodes, 'box selection does not move or alter the path');
  }
});

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
  c.api.handleMouseMove(c.pointer(-3.5, -1.2, { shiftKey: true, altKey: true }));
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
      const center = stations.getComponentCenter(placed);
      near(center.x, dx / 10);
      near(center.y, -dy / 10);
      assert.equal(placed.type, type);
    }
  }
  assert.equal(c.props.placedComponents.length, 10);
});

test('a buffer can cross both axes while dragging and retains signed coordinates in movement logs', async (t) => {
  const c = createCanvas([buffer({ x: 0.5, y: 0.5 })]); t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(2, 2));
  c.api.handleMouseMove(c.pointer(-2.1, -3.2, { altKey: true }));
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
    ...agvGeometry,
    ...stations,
    ...componentAppearance,
    ...vue, onMounted() {}, onBeforeUnmount() {}, defineExpose() {},
    defineEmits: () => () => {}, ...bindings,
  });
}

test('system input and output have distinct shaded rectangles and editable physical dimensions', () => {
  const cases = [
    { type: 'systemInput', color: '#cffafe' },
    { type: 'systemOutput', color: '#ffe4e6' },
  ];
  for (const { type, color } of cases) {
    assert.equal(componentAppearance.RESIZABLE_COMPONENT_TYPES.has(type), true);
    assert.deepEqual({ ...componentAppearance.DEFAULT_COMPONENT_SIZES[type] }, { width: 3, height: 3 });
    assert.equal(componentAppearance.getDefaultShadowColor(type), color);

    const item = { id: type, type, name: type, icon: `${type}.svg`, index: 1,
      x: 1, y: 2, width: 3, height: 3 };
    const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
    workspace.placedComponents.value.push(item);
    const placedItem = workspace.placedComponents.value[0];
    const properties = loadComponent('PropertyPanel', {
      defineProps: () => ({ selectedItem: placedItem }),
      defineEmits: () => (_, value) => workspace.handleUpdateComponentProperties(value),
    }, 'isResizableComponent, widthInMeters, heightInMeters, shadowColor, handleDimensionChange, handleShadowColorChange');
    assert.equal(properties.isResizableComponent.value, true);
    assert.equal(properties.widthInMeters.value, 3);
    assert.equal(properties.heightInMeters.value, 3);
    assert.equal(properties.shadowColor.value, color);
    properties.handleDimensionChange('width', { target: { value: '4' } });
    properties.handleDimensionChange('height', { target: { value: '2' } });
    assert.equal(placedItem.width, 4);
    assert.equal(placedItem.height, 2);
    near(placedItem.x + placedItem.width / 2, 2.5);
    near(placedItem.y + placedItem.height / 2, 3.5);
    properties.handleShadowColorChange({ target: { value: '#123456' } });
    assert.equal(placedItem.shadowColor, '#123456');
    assert.equal(properties.shadowColor.value, '#123456');
  }
});

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
  const roundedInput = input('-12.346');
  properties.handleCenterCoordinateChange('x', roundedInput);
  assert.equal(roundedInput.target.value, '-12.35');
  near(item.x, -13.855); near(item.y, 5);
  near(properties.centerCoordinates.value.x, -12.35);
  properties.handleCenterCoordinateChange('y', input('0'));
  near(item.x, -13.855); near(item.y, -2);
  near(item.width, 3.01); near(item.height, 4);
  properties.handleCenterCoordinateChange('y', input('0'));
  assert.equal(updates.length, 2, 'change followed by blur must not emit a duplicate move');
  for (const value of ['', '-', 'Infinity', '1e999', 'invalid']) {
    const event = input(value);
    properties.handleCenterCoordinateChange('x', event);
    assert.equal(event.target.value, '-12.35');
  }
  assert.equal(updates.length, 2);
  workspace.handleUpdateComponentPosition({ id: item.id, x: 10.001, y: -8 });
  near(properties.centerCoordinates.value.x, 11.51);
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
  properties.handleCenterCoordinateChange('x', { target: { value: '-4.23' } });
  properties.handleCenterCoordinateChange('y', { target: { value: '-3.16' } });
  near(item.x, -4.23); near(item.y, -3.16);
  const nodes = workspace.placedComponents.value[1].nodes;
  near(nodes[0].x, -4.23); near(nodes[0].y, -3.16);
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
  near(placed.x + placed.width / 2, 20.24);
  near(placed.y + placed.height / 2, 25.26);
  assert.equal(placed.width, 3); assert.equal(placed.height, 3);
  c.container.clientWidth = 720; c.container.clientHeight = 420;
  c.resize(); c.api.drawGridNow();
  assert.equal(c.element.width, 1440); assert.equal(c.element.height, 840);
});

test('AGV bend and station dragging retain grab offset and 0.01m steps', async (t) => {
  const c = createCanvas([
    { id: 'node-1', type: 'node', x: 5, y: 5, width: 0, height: 0 },
    { id: 'path-1', type: 'AGVpath', nodes: [{ x: 5, y: 5 }, { x: 15, y: 15 }, { x: 25, y: 5 }] },
  ]); t.after(() => c.dispose());
  c.api.ppm.value = 100;
  c.props.selectedId = 'path-1';
  await c.api.handleMouseDown(c.pointer(15.02, 15.01));
  assert.equal(c.api.draggingCorner.value, true);
  c.api.handleMouseMove(c.pointer(15.08, 15.15));
  near(c.props.placedComponents[1].nodes[1].x, 15.06);
  near(c.props.placedComponents[1].nodes[1].y, 15.14);
  c.api.handleMouseUp();
  await c.api.handleMouseDown(c.pointer(5.02, 5.01));
  c.api.handleMouseMove(c.pointer(5.08, 5.01));
  near(c.props.placedComponents[0].x, 5.06);
  near(c.props.placedComponents[0].y, 5);
  c.api.handleMouseUp();
});

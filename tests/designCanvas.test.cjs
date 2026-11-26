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
).replace(/export const /g, 'const ') + '\n;({ DEFAULT_PATH_WIDTH, getPathWidth, getPathParameters, buildPathGeometry, pointOnPathSegment, tracePathGeometry, isPointInPathArea, getPathBounds, getPathGeometryBounds, distanceToPathSegment, angleOnArc })');
const triangle = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/triangleObstacle.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({TRIANGULAR_OBSTACLE_TYPE, DEFAULT_TRIANGLE_SIZE, TRIANGLE_FIELDS, getLocalTriangleVertices, getTriangleVertices, getTriangleChanges, getTriangleParameters, solveTriangle, orientTriangle, formatTriangleValue})');
const rectangularWall = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/rectangularWall.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({RECTANGULAR_WALL_TYPE,DEFAULT_WALL_SIZE,WALL_SIDES,WALL_THICKNESS_MODES,getWallSettings,getWallGeometry,getWallOuterBounds,getWallSideOptions,getWallValidationError})');
const componentAppearance = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/componentAppearance.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export const /g, 'const ') +
  '\n;({RECTANGULAR_OBSTACLE_TYPE,CIRCULAR_OBSTACLE_TYPE,OBSTACLE_COMPONENT_TYPES,MIN_CIRCLE_RADIUS,getCircleRadius,RESIZABLE_COMPONENT_TYPES,RESIZABLE_COMPONENT_TYPES_WITHOUT_PORTS,PRODUCTION_COMPONENT_TYPES,DEFAULT_COMPONENT_SHADOW_COLORS,DEFAULT_COMPONENT_SIZES,getDefaultShadowColor})', {...triangle, ...rectangularWall});
const stations = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/stations.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export const /g, 'const ') +
  '\n;({ STATION_TYPES, DEFAULT_STATION_SIZE, getStationType, getNextStationIndex, getComponentBounds, getComponentCenter, getComponentFootprint, getComponentQuarterTurns })', {...triangle, ...componentAppearance, ...rectangularWall});
const agvConfiguration = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/agvConfiguration.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export (const|function) /g, '$1 ') +
  '\n;({AGV_CONFIGURATION_TYPE,DEFAULT_AGV_DIMENSIONS,DEFAULT_AGV_SPEED,DUPLICATE_AGV_CONFIGURATION_MESSAGE,findAgvConfiguration,getAgvDimensions,getAgvParkingStations,getAgvParkingGrid,getAgvParkingCapacity,isValidAgvRange,parseAgvRange,getAgvRowsError})', stations);
const canvasBoundaryUtils = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/canvasBoundary.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export function /g, 'function ') +
  '\n;({clampCanvasOffset,clampCanvasPoint,encloseCanvasBounds,fitsCanvasBounds,getCanvasItemBounds,getCanvasMoveBounds,getCanvasSizeError})',
{...stations, ...agvGeometry});
const componentCollision = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/componentCollision.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export function /g, 'function ') +
  '\n;({distanceToCollisionFootprint,getCollisionFootprint,footprintsOverlap,hasComponentCollision,hasTriangleVertexSweepCollision,resolveComponentDrag})',
{...stations, ...triangle, ...componentAppearance, ...rectangularWall});
const componentPorts = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/componentPorts.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export function /g, 'function ') +
  '\n;({getComponentPorts,getComponentPortOffset,getComponentPortPosition,isValidComponentPortOffset,setComponentPortOffset,getLocalComponentPorts,fitComponentPorts})',
{...stations, ...componentAppearance});
const alignBounds = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/alignment.js'), 'utf8',
).replace('export const alignBounds', 'const alignBounds') + '\n;alignBounds');
const inputRules = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/inputRules.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({INPUT_ENTITY_TYPES,getInputType,getInputRuleCategory,INPUT_PROPERTY_DEFAULTS,INPUT_RULE_DEFAULT_DIMENSIONS,isValidInputProperty,parseGenerationInterval,formatGenerationInterval,getInputRuleValidationMessage,sampleInputRule,getDefaultWorkpieceDimensions})');
const workstationProperties = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/workstationProperties.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({WORKSTATION_PROPERTY_DEFAULTS,PARALLEL_WORKSTATION_PROPERTY_DEFAULTS,isValidWorkstationProperty,isValidParallelWorkstationProperty,ensureParallelWorkstationEquipment})');
const assemblyRecipes = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/assemblyRecipes.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({ASSEMBLY_MODES,CONTAINER_TYPES,ASSEMBLY_TIME_TOLERANCE_MS,getAssemblyUnitCount,isValidAssemblyUnitCount,getAssemblyRecipeError,getAssemblyPackingType,findAssemblyBatch})');
const disassemblyRecipes = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/disassemblyRecipes.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') +
  '\n;({DISASSEMBLY_MODES,getDisassemblyUnitCount,isValidDisassemblyUnitCount,getDisassemblyRecipeError,findDisassemblyRecipe})');
const bufferProperties = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/bufferProperties.js'), 'utf8',
).replace(/export (const|function) /g, '$1 ') + '\n;({BUFFER_PROPERTY_DEFAULTS,isValidBufferProperty,getBufferProperty})');
const createInputSimulation = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/inputSimulation.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace('export function ', 'function ') + '\n;createInputSimulation', {
  ...inputRules, ...workstationProperties, ...assemblyRecipes, ...disassemblyRecipes, ...bufferProperties,
  ...componentAppearance, ...stations, getComponentLabel: item => `${item.name}${item.index}`,
  getConnectionGeometry: (...args) => connectionGeometry.getConnectionGeometry(...args),
  getPointOnConnection: (...args) => connectionGeometry.getPointOnConnection(...args), DEFAULT_WORKPIECE_SPEED: 1,
});
const connectionGeometry = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/connectionLine.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export (const|function) /g, '$1 ') +
  '\n;({DEFAULT_WORKPIECE_SPEED,getConnectionGeometry,getEditableRouteGeometry,getPointOnConnection,getConnectionSegmentMove})', {...stations, ...componentAppearance, ...componentPorts, ...agvGeometry});
const hasWallRouteCollision = vm.runInNewContext(fs.readFileSync(
  path.resolve(__dirname, '../src/utils/wallRoutes.js'), 'utf8',
).replace(/^import .*;\r?$/gm, '').replace(/export function /g, 'function ') + '\n;hasWallRouteCollision',
{...agvGeometry, ...connectionGeometry, ...componentCollision, ...rectangularWall});

// Run the actual component handlers with Vue reactivity and a small DOM/canvas stub.
// No test-only exports or alternate coordinate implementation are added to production.
function createCanvas(items = [], onPlacementDone, handlers = {}) {
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
  const props = vue.reactive({ placedComponents: items, activeControl: null, selectedId: null, selectedIds: [], canvasBoundary: null });
  const events = [];
  const emit = (type, value) => {
    events.push({ type, value });
    if (handlers[type]) {
      handlers[type](value);
      return;
    }
    if (type === 'component-placed') props.placedComponents.push(value);
    if (type === 'placement-done') onPlacementDone?.();
    if (type === 'select-component') {
      props.selectedId = value;
      props.selectedIds = value ? [value] : [];
    }
    if (type === 'select-components') {
      props.selectedIds = [...value];
      props.selectedId = value[0] ?? null;
    }
    if (type === 'update-component-position') {
      const target = props.placedComponents.find(item => item.id === value.id);
      if (value.connectionCorner) {
        const {index, point} = value.connectionCorner;
        target.waypoints[index] = point;
        if (target.cornerRadii) target.cornerRadii[index] = 0;
      } else {
        Object.assign(target, value);
      }
    }
    if (type === 'update-component-positions') {
      value.forEach((position) => Object.assign(props.placedComponents.find((item) => item.id === position.id), position));
    }
  };
  let resize;
  const sandbox = {
    ...agvGeometry,
    ...agvConfiguration,
    ...stations,
    ...canvasBoundaryUtils,
    ...componentCollision,
    ...componentAppearance,
    ...triangle,
    ...rectangularWall, hasWallRouteCollision,
    ...componentPorts,
    ...connectionGeometry,
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
  const script = descriptor.scriptSetup.content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm, '');
  const exports = `({ canvas, canvasContainer, ppm, viewOrigin, canvasWidth, canvasHeight,
    alignmentGuides, cursorX, cursorY, cursorStyle, showCursor,
    metersPerCell, panning, selectionBox, isComponentSelected, imageCache, handleWheel, resetZoom, focusComponent,
    handleMouseDown, handleMouseMove, handleMouseUp, handleMouseEnter, handleMouseLeave, handleDoubleClick,
    handleCanvasKeyDown, handleCanvasContextMenu, handlePointerCancel, handleWindowBlur, getCanvasMousePosition, undoDraftPoint, finishCanvasDrag,
    drawGridNow, drawWorkpieces, hitTestWorkpiece, workpieceTooltipAnchor, dragging, draggingCorner, editingId, labelRects, labelEditorStyle,
    hitTestComponent, hitTestLabel, connectionScreenPoint, hitTestConnectionLine, hitTestAGVPath,
  })`;
  const scope = vue.effectScope();
  const api = scope.run(() => vm.runInNewContext(`${script}\n${exports}`, sandbox, { filename }));
  api.resolveLineEndpoints = line => {
    const {start, end} = connectionGeometry.getConnectionGeometry(line, props.placedComponents);
    return {start: api.connectionScreenPoint(start), end: api.connectionScreenPoint(end)};
  };
  api.canvas.value = element;
  api.canvasContainer.value = container;
  mounted.forEach((callback) => callback());
  api.handleMouseEnter();
  const pointer = (worldX, worldY, extra = {}) => ({
    clientX: 180 + (worldX - api.viewOrigin.value.x) * api.ppm.value,
    clientY: 100 + (api.viewOrigin.value.y - worldY) * api.ppm.value,
    button: 0, pointerId: 1, preventDefault() {}, ...extra,
  });
  return { api, props, events, element, container, pointer, window: sandbox.window, resize: () => resize(),
    dispose() { cleanup.forEach((callback) => callback()); scope.stop(); },
  };
}

const buffer = (overrides = {}) => ({
  id: 'component-1', type: 'buffer', name: '缓冲区', icon: 'buffer.svg', index: 1,
  x: 10, y: 10, width: 3, height: 3, ...overrides,
  loadPoint: overrides.loadPoint ?? {x: 0, y: 0},
  unloadPoint: overrides.unloadPoint ?? {x: 0, y: 0},
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('workpieces render their physical bounds, rule color and red border at the current zoom', () => {
  const scene = createCanvas();
  scene.props.workpieces = [{x: 2, y: 3, width: 4, height: 1, sequence: 1, fillColor: '#123456', borderColor: '#ff0000'}];
  scene.api.ppm.value = 20;
  const calls = [];
  const ctx = new Proxy({
    fillRect(...args) { calls.push(['fill', this.fillStyle, ...args]); },
    strokeRect(...args) { calls.push(['border', this.strokeStyle, ...args]); },
  }, {get: (target, key) => target[key] ?? (() => {})});
  scene.api.drawWorkpieces(ctx);
  assert.deepEqual(calls, [['fill', '#123456', 40, -80, 80, 20], ['border', '#ff0000', 40, -80, 80, 20]]);
  scene.dispose();
});

test('hidden stack workpieces do not render or expand fit-all, and the front displays the total', () => {
  const scene = createCanvas();
  scene.props.workpieces = Array.from({length: 30}, (_, index) => ({
    x: index < 25 ? 2 : 1000000, y: 3, width: 4, height: 1, sequence: index + 1,
    stackHidden: index >= 25, stackCount: index === 24 ? 30 : undefined,
    fillColor: '#22c55e', borderColor: '#ff0000',
  }));
  scene.api.ppm.value = 20;
  let rectangles = 0;
  const labels = [];
  const ctx = new Proxy({
    fillRect() { rectangles++; },
    fillText(text) { labels.push(text); },
  }, {get: (target, key) => target[key] ?? (() => {})});
  scene.api.drawWorkpieces(ctx);
  assert.equal(rectangles, 25);
  assert.equal(labels.at(-1), '30');
  scene.api.resetZoom();
  assert.ok(scene.api.ppm.value >= 20);
  scene.dispose();
});

test('moving workpieces rotate around their center with a red border', () => {
  const scene = createCanvas();
  scene.props.workpieces = [{x: 9, y: 9.5, position: {x: 10, y: 10}, width: 2, height: 1,
    angle: 90, sequence: 1, fillColor: '#22c55e', borderColor: '#ff0000'}];
  scene.api.ppm.value = 20;
  const calls = [];
  const ctx = new Proxy({
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(radians) { calls.push(['rotate', radians]); },
    fillRect(...args) { calls.push(['fill', ...args]); },
    strokeRect(...args) { calls.push(['border', this.strokeStyle, ...args]); },
  }, {get: (target, key) => target[key] ?? (() => {})});
  scene.api.drawWorkpieces(ctx);
  assert.deepEqual(calls, [['translate', 200, -200], ['rotate', -Math.PI / 2],
    ['fill', -20, -10, 40, 20], ['border', '#ff0000', -20, -10, 40, 20]]);
  scene.dispose();
});

test('workpiece hit testing respects rotation, topmost drawing order and hidden stack entries', () => {
  const scene = createCanvas();
  const first = {id: 'first', position: {x: 0, y: 0}, width: 4, height: 1, angle: 90};
  const second = {...first, id: 'second', width: 1, height: 1};
  scene.props.workpieces = [first, second, {...second, id: 'hidden', stackHidden: true}];
  assert.equal(scene.api.hitTestWorkpiece(0, 0).id, 'second');
  assert.equal(scene.api.hitTestWorkpiece(.4, 1.8).id, 'first');
  assert.equal(scene.api.hitTestWorkpiece(1.8, .4), null);
  scene.dispose();
});

function installWorkpieceTooltip(scene) {
  const calls = [];
  scene.api.workpieceTooltipAnchor.value = vue.markRaw({style: {}});
  scene.window.bootstrap = {Tooltip: class {
    constructor(element, options) { calls.push({type: 'create', options}); }
    setContent(content) { calls.push({type: 'content', text: content['.tooltip-inner']}); }
    show() { calls.push({type: 'show'}); }
    hide() { calls.push({type: 'hide'}); }
    update() { calls.push({type: 'update'}); }
    dispose() { calls.push({type: 'dispose'}); }
  }};
  return calls;
}

test('hover shows the correct source immediately for identical part numbers and safely updates names', () => {
  const scene = createCanvas([buffer({id: 'a', name: '输入', index: 1}), buffer({id: 'b', name: '输入', index: 2})]);
  const calls = installWorkpieceTooltip(scene);
  scene.props.workpieces = [
    {id: 'p1', status: 'moving', sourceId: 'a', sequence: 1, position: {x: 0, y: 0}, width: 2, height: 1},
    {id: 'p2', status: 'moving', sourceId: 'b', sequence: 1, position: {x: 5, y: 0}, width: 2, height: 1},
  ];
  scene.api.handleMouseMove(scene.pointer(0, 0));
  assert.equal(calls.filter(call => call.type === 'show').length, 1);
  assert.equal(calls.find(call => call.type === 'content').text, '输入1');
  const options = calls.find(call => call.type === 'create').options;
  assert.equal(options.delay, 0);
  assert.equal(options.animation, false);
  assert.equal(options.html, false);
  scene.api.handleMouseMove(scene.pointer(5, 0));
  assert.equal(calls.filter(call => call.type === 'content').at(-1).text, '输入2');
  scene.props.placedComponents[1].displayName = '<b>新输入</b>';
  scene.api.drawGridNow();
  assert.equal(calls.filter(call => call.type === 'content').at(-1).text, '<b>新输入</b>');
  scene.api.handleMouseLeave();
  assert.equal(calls.at(-1).type, 'hide');
  scene.dispose();
  assert.equal(calls.at(-1).type, 'dispose');
});

test('a moving workpiece entering or leaving a stationary pointer updates its tooltip on redraw', () => {
  const scene = createCanvas([buffer({id: 'a', name: '输入', index: 1})]);
  const calls = installWorkpieceTooltip(scene);
  scene.api.handleMouseMove(scene.pointer(0, 0));
  assert.equal(calls.filter(call => call.type === 'show').length, 0);
  scene.props.workpieces = [{id: 'part', status: 'moving', sourceId: 'a', position: {x: 0, y: 0},
    x: -1, y: -.5, width: 2, height: 1, sequence: 1, angle: 0}];
  scene.api.drawGridNow();
  assert.equal(calls.filter(call => call.type === 'show').length, 1);
  for (const status of ['stacked', 'waiting', 'completed']) {
    scene.props.workpieces[0].status = status;
    scene.api.drawGridNow();
    scene.api.handleMouseMove(scene.pointer(0, 0));
    assert.equal(calls.at(-1).type, 'hide');
    assert.equal(calls.filter(call => call.type === 'show').length, 1);
  }
  scene.props.workpieces = [];
  scene.api.drawGridNow();
  assert.equal(calls.at(-1).type, 'hide');
  scene.dispose();
});

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
  const maxRadius = agvGeometry.getPathParameters(nodes, {}).rows[1].maxRadius;
  assert.ok(maxRadius > 0 && maxRadius < 1);
  const arc = agvGeometry.buildPathGeometry({ nodes, cornerRadii: [100] }).find((s) => s.type === 'arc');
  near(arc.radius, maxRadius);
  const duplicate = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 2 }];
  assert.equal(agvGeometry.getPathParameters(duplicate, {}).rows[1].maxRadius, 0);
  const shared = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }];
  const {rows} = agvGeometry.getPathParameters(shared, {cornerRadii: [8, 100]});
  near(rows[1].maxRadius, 8);
  near(rows[3].maxRadius, 2);
  near(rows[2].length, 0);
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

test('AGV configuration uses its default or custom fill with and without a route', (t) => {
  const config = {id: 'config', type: 'AGVconfiguration', x: 4, y: 5, width: 3, height: 3};
  const canvas = createCanvas([config]);
  t.after(() => canvas.dispose());
  const ctx = canvas.element.getContext('2d');
  const scale = canvas.api.ppm.value;
  let renderedColor;
  let fillStyle;
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyle,
    set: value => { if (typeof value === 'string') fillStyle = value; },
  });
  ctx.fillRect = (x, y, width, height) => {
    if (x === 4 * scale && y === -8 * scale && width === 3 * scale && height === 3 * scale) renderedColor = ctx.fillStyle;
  };
  const defaultColor = componentAppearance.getDefaultShadowColor(config.type);
  canvas.api.drawGridNow();
  const before = renderedColor;
  canvas.props.placedComponents.push({id: 'route', type: 'AGVpath', nodes: [{x: 0, y: 0}, {x: 8, y: 0}]});
  canvas.api.drawGridNow();
  assert.equal(renderedColor, defaultColor);
  assert.equal(before, defaultColor);
  canvas.props.placedComponents[0].shadowColor = '#123456';
  canvas.api.drawGridNow();
  assert.equal(renderedColor, '#123456');
});

test('AGV configuration is a singleton and disabled endurance resets to unlimited', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, logs, handleComponentPlaced, handleUpdateComponentProperties');
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {
    'component-placed': workspace.handleComponentPlaced,
  });
  t.after(() => canvas.dispose());
  canvas.props.activeControl = {type: 'AGVconfiguration', name: 'AGV配置', icon: 'AGVconfiguration.svg'};
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, 0));
  const [config] = workspace.placedComponents.value;
  assert.equal(config.type, 'AGVconfiguration');
  assert.equal(config.agvRows.length, 0);
  await canvas.api.handleMouseDown(canvas.pointer(8, 0));
  assert.equal(workspace.placedComponents.value.length, 1);
  assert.ok(canvas.events.some(event => event.type === 'add-log' && event.value.includes('只能有一个 AGV')));
  workspace.handleComponentPlaced({...config, id: 'agv-second', x: 10});
  assert.equal(workspace.placedComponents.value.length, 1);
  assert.match(workspace.logs.value.at(-1), /只能有一个 AGV/);

  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: config}),
    defineEmits: () => (_, value) => workspace.handleUpdateComponentProperties(value),
  }, 'agvRangeText, handleAgvRangeChange');
  const setRange = value => panel.handleAgvRangeChange({target: {value}});
  assert.equal(config.agvRangeEnabled, false);
  assert.equal(panel.agvRangeText.value, '∞');
  setRange('800');
  assert.equal(panel.agvRangeText.value, '∞');
  workspace.handleUpdateComponentProperties({id: config.id, agvRangeEnabled: true});
  assert.equal(panel.agvRangeText.value, '∞');
  setRange('800.25');
  setRange('-12');
  assert.equal(config.agvRange, 800.25);
  setRange('∞');
  assert.equal(config.agvRange, null);
  setRange('800');
  workspace.handleUpdateComponentProperties({id: config.id, agvRangeEnabled: false});
  assert.equal(config.agvRange, null);
  assert.equal(panel.agvRangeText.value, '∞');
});

test('saved AGV rows draw four-wheel vehicles in separate slots at their station scale and orientation', (t) => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, openDialog, saveDialog');
  workspace.placedComponents.value.push(
    {id: 'config', type: 'AGVconfiguration', x: -3, y: -2, width: 1, height: 1},
    {id: 'parking', type: 'node', x: 2, y: 1, width: 3.6, height: 2, quarterTurns: 1},
  );
  const canvas = createCanvas(workspace.placedComponents.value);
  t.after(() => canvas.dispose());
  const ctx = canvas.element.getContext('2d');
  const plates = [], decks = [], wheels = [], frontMarks = [], rotations = [], translations = [];
  ctx.rotate = angle => rotations.push(angle);
  ctx.translate = (x, y) => translations.push([x, y]);
  ctx.fillRect = (x, y, width, height) => {
    if (ctx.fillStyle === '#d97706') plates.push({x, y, width, height});
    if (ctx.fillStyle === '#374151') wheels.push({x, y, width, height});
    if (ctx.fillStyle === '#fde68a') decks.push({x, y, width, height});
    if (ctx.fillStyle === '#991b1b') frontMarks.push({x, y, width, height});
  };
  canvas.api.drawGridNow();
  assert.equal(plates.length, 0);

  const dialog = {itemId: 'config', dialogType: 'agv-configuration'};
  workspace.openDialog(dialog);
  workspace.saveDialog({...dialog, agvRows: [{stationId: 'parking', count: 4,
    length: 1200, width: 800, emptySpeed: 1, loadedSpeed: 1}]});
  for (const scale of [10, 40]) {
    canvas.api.ppm.value = scale;
    canvas.api.viewOrigin.value = {x: -5, y: 5};
    plates.length = 0; wheels.length = 0; rotations.length = 0; translations.length = 0;
    decks.length = 0; frontMarks.length = 0;
    canvas.api.drawGridNow();
    assert.equal(plates.length, 4);
    assert.equal(wheels.length, 16);
    assert.equal(decks.length, 4);
    assert.equal(frontMarks.length, 8);
    assert.deepEqual(rotations, [Math.PI / 2]);
    assert.deepEqual(translations.at(-1), [2 * scale, -scale]);
    for (const [i, plate] of plates.entries()) {
      near(plate.width / scale, 1.2);
      near(plate.height / scale, 0.64);
      near((plate.x + plate.width / 2) / scale, i % 2 === 0 ? -0.9 : 0.9);
      near((plate.y + plate.height / 2) / scale, i < 2 ? -0.5 : 0.5);
      const deck = decks[i];
      const front = plate.x + plate.width;
      const deckFront = deck.x + deck.width;
      near(front - deckFront, (deck.x - plate.x) * 1.5);
      const [upperMark, lowerMark] = frontMarks.slice(i * 2, i * 2 + 2);
      near(upperMark.x, lowerMark.x);
      assert.ok(upperMark.x > deckFront && upperMark.x + upperMark.width < front);
      near((upperMark.y + lowerMark.y + upperMark.height) / 2, plate.y + plate.height / 2);
      for (const wheel of wheels.slice(i * 4, i * 4 + 4)) {
        near(wheel.width / scale, 0.192);
        near(wheel.height / scale, 0.08);
      }
    }
  }

  // 站点深度只够一排时，四辆车仍要放在各自的车位。
  const parking = workspace.placedComponents.value[1];
  parking.width = 4.8;
  parking.height = 0.8;
  plates.length = 0;
  canvas.api.drawGridNow();
  assert.equal(plates.length, 4);
  for (const [index, plate] of plates.entries()) {
    near(plate.x / canvas.api.ppm.value, -2.4 + index * 1.2);
    near((plate.y + plate.height / 2) / canvas.api.ppm.value, 0);
  }

  workspace.openDialog(dialog);
  workspace.saveDialog({...dialog, agvRows: []});
  plates.length = 0;
  canvas.api.drawGridNow();
  assert.equal(plates.length, 0);
});

test('AGV rows accept unique parking stations, available capacity and positive speeds', () => {
  const workspace = loadComponent('WorkspaceLayout', {getComponentLabel: item => item.id},
    'placedComponents, activeDialog, openDialog, saveDialog, handleUpdateComponentProperties, handleRemoveComponent');
  workspace.placedComponents.value.push(
    {id: 'config', type: 'AGVconfiguration', agvRows: []},
    {id: 'parking1', type: 'node', stationType: 'parking', x: -8, y: 0},
    {id: 'parking2', type: 'node', stationType: 'parking', x: 8, y: 0, width: 1.8, height: 1.4},
    {id: 'small', type: 'node', stationType: 'parking', x: 0, y: 8, width: 0.8, height: 1.4},
    {id: 'charge', type: 'node', stationType: 'charging', x: 0, y: -8},
  );
  const [config, parking1, parking2] = workspace.placedComponents.value;
  const dialogType = 'agv-configuration';
  const openEditor = () => {
    workspace.openDialog({itemId: config.id, dialogType});
    return loadComponent('Dialog', {
      defineProps: () => ({item: config, dialogType, placedComponents: workspace.placedComponents.value}),
      defineEmits: () => (event, payload) => {
        if (event === 'save') workspace.saveDialog(payload);
        if (event === 'close') workspace.activeDialog.value = null;
      },
      systemInputIcon: '',
    }, 'agvRows, agvCapacities, availableAgvStations, setAgvStation, addAgvRow, deleteAgvRow, saveAgvRows, agvRowsError, emit');
  };
  const editor = openEditor();
  editor.addAgvRow();
  assert.match(editor.agvRowsError.value, /停靠站点/);
  const [row] = editor.agvRows.value;
  assert.deepEqual(Array.from(editor.availableAgvStations(row), station => station.id), ['parking1', 'parking2', 'small']);
  editor.setAgvStation(row, parking1.id);
  assert.deepEqual([row.count, row.length, row.width, row.emptySpeed, row.loadedSpeed], [1, 900, 700, 1, 1]);
  assert.equal(editor.agvCapacities.value[0], 12);
  row.count = 13;
  assert.match(editor.agvRowsError.value, /1 至 12/);
  row.count = 12;
  row.length = 1500;
  assert.equal(editor.agvCapacities.value[0], 8);
  assert.match(editor.agvRowsError.value, /1 至 8/);
  row.length = 900;
  row.width = '';
  assert.match(editor.agvRowsError.value, /长、宽都须大于 0/);
  row.width = 700;
  row.loadedSpeed = 0;
  editor.saveAgvRows();
  assert.equal(config.agvRows.length, 0);
  row.loadedSpeed = 1.2;
  editor.addAgvRow();
  const other = editor.agvRows.value[1];
  assert.deepEqual(Array.from(editor.availableAgvStations(other), station => station.id), ['parking2', 'small']);
  editor.setAgvStation(other, parking1.id);
  assert.match(editor.agvRowsError.value, /已被选用/);
  editor.setAgvStation(other, parking2.id);
  assert.equal(editor.agvCapacities.value[1], 4);
  other.length = 600;
  other.count = 4;
  assert.equal(editor.agvCapacities.value[1], 6);
  editor.saveAgvRows();
  assert.equal(workspace.activeDialog.value, null);
  assert.deepEqual(Array.from(config.agvRows, item => [item.stationId, item.count, item.length, item.width]),
    [['parking1', 12, 900, 700], ['parking2', 4, 600, 700]]);

  delete config.agvRows[0].length;
  delete config.agvRows[0].width;
  const editAgain = openEditor();
  assert.deepEqual([editAgain.agvRows.value[0].length, editAgain.agvRows.value[0].width], [900, 700]);
  editAgain.setAgvStation(editAgain.agvRows.value[1], 'small');
  assert.equal(editAgain.agvCapacities.value[1], 2);
  editAgain.agvRows.value[1].length = 900;
  assert.equal(editAgain.agvCapacities.value[1], 0);
  assert.match(editAgain.agvRowsError.value, /放不下/);
  editAgain.addAgvRow();
  editAgain.deleteAgvRow();
  editAgain.emit('close');
  assert.equal(config.agvRows[1].stationId, parking2.id);
  workspace.handleUpdateComponentProperties({id: parking1.id, width: 1});
  assert.equal(parking1.width, undefined, 'shrinking cannot make the configured count exceed capacity');
  workspace.handleUpdateComponentProperties({id: parking2.id, width: 1.2});
  assert.equal(parking2.width, 1.2, 'resizing checks the configured vehicle dimensions');
  workspace.handleUpdateComponentProperties({id: parking2.id, width: 1.1});
  assert.equal(parking2.width, 1.2);
  workspace.handleUpdateComponentProperties({id: parking2.id, stationType: 'charging'});
  assert.equal(config.agvRows.length, 1);
  workspace.handleRemoveComponent(parking1.id);
  assert.equal(config.agvRows.length, 0);
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

test('AGV path drawing can cancel at a station or undo one draft waypoint', async (t) => {
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
  let contextMenuSuppressed = false;
  await c.api.handleMouseDown(c.pointer(10, 10, {button: 2}));
  c.api.handleCanvasContextMenu({preventDefault() { contextMenuSuppressed = true; }});
  assert.equal(contextMenuSuppressed, true);
  assert.equal(c.api.undoDraftPoint(), false);
  assert.equal(c.props.placedComponents.length, 2);
  assert.ok(c.events.some(event => event.type === 'add-log' && event.value.includes('已取消当前绘制')));
  await c.api.handleMouseDown(c.pointer(0, 0));
  await c.api.handleMouseDown(c.pointer(10, 0));
  await c.api.handleMouseDown(c.pointer(12, 5));
  assert.equal(c.api.undoDraftPoint(), true);
  await c.api.handleMouseDown(c.pointer(10, 10));
  const path = c.props.placedComponents.find((item) => item.type === 'AGVpath');
  assert.ok(path);
  assert.equal(path.fromId, 'start'); assert.equal(path.toId, 'end');
  assert.deepEqual(Array.from(path.nodes, ({x, y}) => [x, y]), [[0, 0], [10, 0], [10, 10]]);
  assert.equal(path.cornerRadii, undefined);
  assert.equal(agvGeometry.buildPathGeometry(path).some((segment) => segment.type === 'arc'), false);
});

test('ordinary connection lines reject stations at both endpoints and still connect components', async (t) => {
  const station = { id: 'station', type: 'node', name: '停靠站点', index: 1, x: 0, y: 0, width: 3, height: 3,
    loadPoint: {x: -1.5, y: 0}, unloadPoint: {x: 1.5, y: 0} };
  const c = createCanvas([
    station,
    buffer({ id: 'machine-a', x: 9, y: -1.5 }),
    buffer({ id: 'machine-b', x: 18, y: -1.5 }),
  ]); t.after(() => c.dispose());
  c.props.activeControl = { type: 'connectionLine', name: '连接线', icon: 'connection.svg' };
  await vue.nextTick();
  await c.api.handleMouseDown(c.pointer(0, 0));
  await c.api.handleMouseDown(c.pointer(10.5, 0));
  await c.api.handleMouseDown(c.pointer(1, 0));
  assert.equal(c.props.placedComponents.some((item) => item.type === 'connectionLine'), false);
  await c.api.handleMouseDown(c.pointer(19.5, 0));
  const line = c.props.placedComponents.find((item) => item.type === 'connectionLine');
  assert.ok(line);
  assert.equal(line.fromId, 'machine-a'); assert.equal(line.toId, 'machine-b');
  for (const type of ['node', 'rectangularObstacle', 'AGVconfiguration', 'createScript']) {
    const item = {...station, id: type, type};
    const components = [...c.props.placedComponents, item];
    assert.ok(componentAppearance.RESIZABLE_COMPONENT_TYPES.has(type));
    assert.equal(componentPorts.getComponentPorts(item).length, 0);
    assert.equal(componentPorts.getComponentPortPosition(item, 'loadPoint'), null);
    assert.equal(componentPorts.getComponentPortPosition(item, 'unloadPoint'), null);
    assert.equal(connectionGeometry.getConnectionGeometry({...line, fromId: item.id}, components), null);
    assert.equal(connectionGeometry.getConnectionGeometry({...line, toId: item.id}, components), null);
  }
  assert.ok(c.events.some((event) => event.type === 'add-log' && event.value.includes('不能连接站点')));
});

test('ordinary connections require a port to finish, can cancel over the port and support reverse drawing', async (t) => {
  const source = {id: 'source', type: 'systemInput', x: -3, y: -1.5, width: 3, height: 3};
  const sink = {id: 'sink', type: 'systemOutput', x: 12, y: -1.5, width: 3, height: 3};
  const c = createCanvas([source, sink]);
  t.after(() => c.dispose());
  c.props.activeControl = {type: 'connectionLine', name: '连接线'};
  await vue.nextTick();
  const click = (x, y, button = 0) => c.api.handleMouseDown(c.pointer(x, y, {button}));
  const links = () => c.props.placedComponents.filter(item => item.type === 'connectionLine');
  await click(0, 0);
  await click(3, 4);
  await click(13.5, 0); // 点在组件内但没有点中端口。
  assert.equal(links().length, 0);
  await click(12, 0, 2);
  assert.equal(links().length, 0);
  assert.ok(c.events.some(event => event.type === 'add-log' && event.value.includes('已取消当前绘制')));
  await click(12, 0);
  await click(9, 5);
  await click(4, 3);
  await click(2, 7);
  assert.equal(c.api.undoDraftPoint(), true);
  await click(0, 0);
  assert.equal(links().length, 1);
  const [line] = links();
  assert.deepEqual([line.fromId, line.toId], ['source', 'sink']);
  assert.deepEqual(Array.from(line.waypoints, point => [point.x, point.y]), [[4, 3], [9, 5]]);
  assert.equal(c.api.undoDraftPoint(), false);
});

test('dragging an ordinary arc selects the line and resets its radius without moving the ports', async (t) => {
  const from = buffer({id: 'from', x: -1.5, y: -1.5});
  const to = buffer({id: 'to', x: 8.5, y: 8.5});
  const line = {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to', waypoints: [{x: 10, y: 0}], cornerRadii: [5]};
  const c = createCanvas([from, to, line]);
  t.after(() => c.dispose());
  const geometry = connectionGeometry.getConnectionGeometry(line, c.props.placedComponents);
  const arc = geometry.segments.find(segment => segment.type === 'arc');
  const mid = agvGeometry.pointOnPathSegment(arc, 0.5);
  assert.equal(c.api.hitTestConnectionLine(line, mid.x, mid.y), true);
  assert.equal(c.api.hitTestConnectionLine(line, 10, 0), false);
  const ctx = c.element.getContext();
  const rectangles = [];
  ctx.strokeRect = (...bounds) => rectangles.push(bounds);
  c.props.selectedId = line.id;
  c.props.selectedIds = [line.id];
  c.api.drawGridNow();
  assert.ok(rectangles.some(([x, y, w, h]) => x + w / 2 === 10 * c.api.ppm.value && y + h / 2 === 0 && w === 8 && h === 8));
  c.props.selectedId = null;
  c.props.selectedIds = [];
  await c.api.handleMouseDown(c.pointer(mid.x, mid.y));
  assert.equal(c.props.selectedId, line.id);
  c.api.handleMouseMove(c.pointer(mid.x + 1, mid.y + 2));
  c.api.handleMouseUp();
  assert.deepEqual({...line.waypoints[0]}, {x: 11, y: 2});
  assert.equal(line.cornerRadii[0], 0);
  const updated = connectionGeometry.getConnectionGeometry(line, c.props.placedComponents);
  assert.deepEqual({...updated.start}, {...geometry.start});
  assert.deepEqual({...updated.end}, {...geometry.end});
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
    buffer({ id: 'reference', x: -0.025, y: 3.2 }),
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

test('Escape returns a pending placement to selection and clears its preview', async (t) => {
  const item = buffer({x: 1, y: 1});
  const canvas = createCanvas([item], () => { canvas.props.activeControl = {type: 'select'}; });
  t.after(() => canvas.dispose());
  const tool = {type: 'buffer', name: '缓冲区', icon: 'buffer.svg'};
  canvas.props.selectedId = item.id;
  canvas.props.selectedIds = [item.id];
  canvas.props.activeControl = tool;
  await vue.nextTick();
  canvas.api.handleMouseMove(canvas.pointer(-8, 0));
  assert.equal(canvas.api.showCursor.value, true);
  canvas.api.handleCanvasKeyDown({key: 'Escape', target: {closest: () => true}});
  assert.equal(canvas.props.activeControl.type, 'buffer');
  canvas.api.handleCanvasKeyDown({key: 'Escape'});
  await vue.nextTick();
  assert.equal(canvas.props.activeControl.type, 'select');
  assert.equal(canvas.api.showCursor.value, false);
  assert.deepEqual([...canvas.props.selectedIds], [item.id]);

  canvas.props.activeControl = tool;
  await vue.nextTick();
  const pendingPlacement = canvas.api.handleMouseDown(canvas.pointer(-8, 0));
  canvas.api.handleCanvasKeyDown({key: 'Escape'});
  await pendingPlacement;
  assert.equal(canvas.props.activeControl.type, 'select');
  assert.deepEqual(Array.from(canvas.props.placedComponents, component => component.id), [item.id]);
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
  for (const type of ['buffer', 'node']) {
    const c = createCanvas(); t.after(() => c.dispose());
    c.api.imageCache.set('buffer.svg', {complete: true});
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
    assert.equal(c.props.placedComponents.length, 5);
  }
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

test('double-clicking production components opens their properties and keeps nested editors independent', async (t) => {
  const types = ['systemInput', 'systemOutput', 'workstation', 'parallelWorkstation', 'assemblyWorkstation', 'disassemblyWorkstation', 'buffer'];
  const workspace = loadComponent('WorkspaceLayout', {getComponentLabel: item => item.id},
    'placedComponents, componentPropertiesItem, openComponentProperties, activeDialog, openDialog, saveDialog, handleRemoveComponent');
  workspace.placedComponents.value.push(...types.map((type, index) =>
    buffer({id: type, type, name: '组件', x: index * 5 - 1.5, y: -1.5})),
    {id: 'parking', type: 'node', x: 35, y: 0});
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {
    'open-component-properties': workspace.openComponentProperties,
  });
  t.after(() => canvas.dispose());

  for (const [index, type] of types.entries()) {
    canvas.api.handleDoubleClick(canvas.pointer(index * 5, 0));
    assert.equal(workspace.componentPropertiesItem.value.id, type);
  }
  canvas.api.handleDoubleClick(canvas.pointer(35, 0));
  assert.equal(workspace.componentPropertiesItem.value.id, 'buffer');
  canvas.props.activeControl = {type: 'AGVpath'};
  await vue.nextTick();
  canvas.api.handleDoubleClick(canvas.pointer(0, 0));
  assert.equal(workspace.componentPropertiesItem.value.id, 'buffer');
  canvas.props.activeControl = {type: 'select'};
  await vue.nextTick();

  canvas.api.drawGridNow();
  const label = canvas.api.labelRects.get('systemInput');
  canvas.api.handleDoubleClick(canvas.pointer(label.x + label.width / 2, label.y + label.height / 2));
  assert.equal(canvas.api.editingId.value, 'systemInput');
  assert.equal(workspace.componentPropertiesItem.value.id, 'buffer');

  canvas.api.handleDoubleClick(canvas.pointer(0, 0));
  const input = workspace.componentPropertiesItem.value;
  const dialog = {itemId: input.id, dialogType: 'input-rule'};
  workspace.openDialog(dialog);
  assert.equal(workspace.activeDialog.value.dialogType, 'input-rule');
  assert.equal(workspace.componentPropertiesItem.value, input);
  workspace.saveDialog({...dialog, properties: {inputRuleRows: [{partType: 'A', relativeWeight: 100}]}});
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(workspace.componentPropertiesItem.value, input);
  assert.equal(input.inputRuleRows[0].partType, 'A');
  workspace.handleRemoveComponent(input.id);
  assert.equal(workspace.componentPropertiesItem.value, undefined);
});

test('the component properties window starts on basic settings and moves focus between tabs with the keyboard', () => {
  const focused = [];
  const dialog = loadComponent('ComponentPropertiesDialog', {
    defineProps: () => ({item: {type: 'systemOutput'}}), useId: () => 'properties',
    document: {getElementById: id => ({focus: () => focused.push(id)})},
  }, 'tabs, activeTab, moveTabFocus');
  assert.deepEqual(Array.from(dialog.tabs, tab => tab.label), ['基本属性', '呼叫AGV']);
  assert.equal(dialog.activeTab.value, 'basic');
  dialog.moveTabFocus({key: 'ArrowRight', preventDefault() {}}, 0);
  assert.equal(dialog.activeTab.value, 'call-agv');
  dialog.moveTabFocus({key: 'Home', preventDefault() {}}, 1);
  assert.equal(dialog.activeTab.value, 'basic');
  assert.deepEqual(focused, ['properties-call-agv-tab', 'properties-basic-tab']);
});

function loadComponent(name, bindings, exposed) {
  const file = path.resolve(__dirname, `../src/components/${name}.vue`);
  const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm, '');
  return vm.runInNewContext(`${script}\n;({ ${exposed} })`, {
    ...agvGeometry,
    ...agvConfiguration,
    ...stations,
    ...canvasBoundaryUtils,
    ...componentCollision,
    ...componentAppearance,
    ...triangle,
    ...rectangularWall, hasWallRouteCollision,
    ...componentPorts,
    ...inputRules, ...workstationProperties, ...assemblyRecipes, ...disassemblyRecipes, ...bufferProperties, ...connectionGeometry,
    createInputSimulation, createBootstrapTooltipDirective: () => ({}),
    ...vue, onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, defineExpose() {},
    defineEmits: () => () => {}, ...bindings,
  });
}

test('rotation buttons turn the icon and footprint about the same center without moving its links', (t) => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties, handleUpdateComponentPosition');
  workspace.placedComponents.value.push(
    buffer({id: 'rotated', x: -3, y: -1, width: 6, height: 2}),
    buffer({id: 'other', x: 9, y: -1, width: 2, height: 2}),
    {id: 'line', type: 'connectionLine', fromId: 'rotated', toId: 'other'},
    {id: 'station', type: 'node', x: 2, y: 10, width: 6, height: 2},
  );
  const [item, , line, station] = workspace.placedComponents.value;
  const props = vue.reactive({selectedItem: item});
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => props,
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'rotateSelectedComponent, widthInMeters, heightInMeters, handleDimensionChange');
  const canvas = createCanvas(workspace.placedComponents.value);
  t.after(() => canvas.dispose());
  const centerBefore = stations.getComponentCenter(item);
  const lineLength = connectionGeometry.getConnectionGeometry(line, workspace.placedComponents.value).length;
  const endpoints = canvas.api.resolveLineEndpoints(line);
  assert.equal(canvas.api.hitTestComponent(2, 0).id, item.id);

  panel.rotateSelectedComponent(1);
  assert.equal(item.quarterTurns, 1);
  assert.deepEqual(stations.getComponentCenter(item), centerBefore);
  assert.deepEqual(canvas.api.resolveLineEndpoints(line), endpoints);
  assert.deepEqual([panel.widthInMeters.value, panel.heightInMeters.value], [2, 6]);
  assert.equal(canvas.api.hitTestComponent(0, 2).id, item.id);
  assert.equal(canvas.api.hitTestComponent(2, 0).id, line.id);
  const rotations = [];
  const ctx = canvas.element.getContext();
  ctx.rotate = angle => rotations.push(angle);
  canvas.api.drawGridNow();
  assert.ok(rotations.includes(Math.PI / 2));
  const label = canvas.api.labelRects.get(item.id);
  near(label.x + label.width / 2, centerBefore.x);
  assert.ok(label.y + label.height < -3);

  panel.handleDimensionChange('width', {target: {value: '4'}});
  assert.deepEqual([panel.widthInMeters.value, panel.heightInMeters.value, item.width, item.height], [4, 6, 6, 4]);
  assert.deepEqual(stations.getComponentCenter(item), centerBefore);
  assert.equal(connectionGeometry.getConnectionGeometry(line, workspace.placedComponents.value).length, lineLength);
  panel.rotateSelectedComponent(-1);
  assert.deepEqual([item.quarterTurns, panel.widthInMeters.value, panel.heightInMeters.value], [0, 6, 4]);

  props.selectedItem = station;
  panel.rotateSelectedComponent(-1);
  assert.deepEqual([station.x, station.y, station.quarterTurns], [2, 10, 3]);
  assert.equal(canvas.api.hitTestComponent(2, 12).id, station.id);
  assert.equal(canvas.api.hitTestComponent(4, 10), null);
  props.selectedItem = line;
  panel.rotateSelectedComponent(1);
  assert.equal(line.quarterTurns, undefined);
});

function loadExports(file, fields) {
  return vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8')
    .replace(/export (const|function) /g, '$1 ') + `\n;({${fields}})`);
}

const shortcuts = {
  ...loadExports('config/shortcuts.js', 'shortcutBindings,shortcutLabels'),
  ...loadExports('utils/shortcuts.js', 'installShortcuts,loadShortcutBindings,saveShortcutBindings,formatShortcutBinding,normalizeShortcutBinding'),
};

test('finite canvas keeps the same viewport and shades only outside the world-space boundary', async (t) => {
  const c = createCanvas();
  t.after(() => c.dispose());
  const backingSize = [c.element.width, c.element.height];
  const ctx = c.element.getContext();
  let rects = [];
  let mask;
  ctx.beginPath = () => { rects = []; };
  ctx.rect = (...rect) => rects.push(rect);
  ctx.fill = rule => { if (rule === 'evenodd') mask = rects; };
  c.api.drawGridNow();
  assert.equal(mask, undefined);
  c.props.canvasBoundary = {x: -10, y: -6, width: 20, height: 12};
  c.api.drawGridNow();
  assert.deepEqual(mask, [[0, 0, 1000, 600], [400, 240, 200, 120]]);
  assert.deepEqual([c.element.width, c.element.height], backingSize);
  await c.api.handleMouseDown(c.pointer(0, 0, {button: 1}));
  c.api.handleMouseMove(c.pointer(5, -2));
  c.api.handleMouseUp();
  c.api.drawGridNow();
  assert.deepEqual(mask[1], [450, 260, 200, 120]);
});

test('rectangular obstacle hatching fills its footprint at every zoom with constant pixel spacing', (t) => {
  const obstacle = buffer({id: 'pillar', type: 'rectangularObstacle', icon: 'rectangularObstacle.svg',
    x: -3, y: -2, width: 6, height: 4});
  const canvas = createCanvas([obstacle]);
  t.after(() => canvas.dispose());
  canvas.api.imageCache.set(obstacle.icon, {complete: true});
  canvas.props.selectedId = obstacle.id;
  const ctx = canvas.element.getContext();
  let path;
  let hatches;
  let outline;
  let icons = 0;
  let corners = [];
  ctx.beginPath = () => { path = []; };
  ctx.moveTo = (x, y) => path.push([x, y]);
  ctx.lineTo = (x, y) => path.push([x, y]);
  ctx.stroke = () => {
    if (ctx.strokeStyle === '#64748b') hatches = {path, lineWidth: ctx.lineWidth};
  };
  ctx.strokeRect = (...bounds) => { outline = bounds; };
  ctx.drawImage = () => { icons++; };
  ctx.arc = (x, y, radius) => corners.push([x, y, radius]);
  const render = scale => {
    canvas.api.ppm.value = scale;
    canvas.api.viewOrigin.value = {x: -canvas.api.canvasWidth.value / (2 * scale), y: canvas.api.canvasHeight.value / (2 * scale)};
    corners = [];
    canvas.api.drawGridNow();
    assert.deepEqual(outline, [-3 * scale, -2 * scale, 6 * scale, 4 * scale]);
    assert.deepEqual(corners, [[-3 * scale, -2 * scale, 3.5], [-3 * scale, 2 * scale, 3.5],
      [3 * scale, -2 * scale, 3.5], [3 * scale, 2 * scale, 3.5]]);
    assert.equal(hatches.lineWidth, 1);
    near((hatches.path[2][0] - hatches.path[0][0]) / Math.SQRT2, 8);
    near(hatches.path[1][0] - hatches.path[0][0], -(hatches.path[1][1] - hatches.path[0][1]));
    return hatches.path.length;
  };
  const normalCount = render(10);
  assert.ok(render(20) > normalCount);
  canvas.props.selectedId = null;
  corners = [];
  canvas.api.drawGridNow();
  assert.equal(corners.length, 0);
  assert.equal(icons, 0);
  assert.equal(componentPorts.getComponentPorts(obstacle).length, 0);
});

test('triangle definitions require a unique solution and keep the edge numbering from the diagram', () => {
  const combinations = [
    {side1: 3, side2: 4, side3: 5},
    {side1: 3, side2: 4, angleA: 90},
    {side3: 5, angleA: 90, angleB: Math.atan2(4, 3) * 180 / Math.PI},
    {side1: 3, side3: 5, angleA: 90},
  ];
  for (const fields of combinations) {
    const {parameters} = triangle.solveTriangle(fields);
    near(parameters.side1, 3);
    near(parameters.side2, 4);
    near(parameters.side3, 5);
    near(parameters.angleA, 90);
  }
  assert.match(triangle.solveTriangle({side1: 2, side2: 3, side3: 5}).error, /无法构成/);
  assert.match(triangle.solveTriangle({side1: 3, side2: 4, side3: 5, angleA: 80}).error, /无法构成/);
  assert.match(triangle.solveTriangle({angleA: 60, angleB: 60, angleC: 60}).hint, /边长/);
  assert.match(triangle.solveTriangle({side3: 7, side2: 9, angleA: 40}).hint, /两组解/);
  assert.ok(triangle.solveTriangle({side3: 7, side2: 9, angleA: 40, angleB: 55.734881}).vertices);
  near(triangle.solveTriangle({side3: 5, side2: 10, angleA: 30}).parameters.angleB, 90);
});

test('triangle canvas placement, vertex drag and definition share the property model and undo history', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentPosition, beginCanvasEdit, endCanvasEdit, undoCanvasEdit, openDialog, saveDialog, activeDialog, getTriangleDefinitionError, finiteCanvas');
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {
    'component-placed': workspace.handleComponentPlaced,
    'update-component-position': workspace.handleUpdateComponentPosition,
    'canvas-drag-start': workspace.beginCanvasEdit,
    'canvas-drag-end': workspace.endCanvasEdit,
  });
  t.after(() => canvas.dispose());
  canvas.props.activeControl = {type: 'triangularObstacle', name: '三角形障碍物', icon: 'triangularObstacle.svg'};
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, 0, {altKey: true}));
  canvas.api.handleMouseUp();
  const [item] = workspace.placedComponents.value;
  const vertices = () => Array.from(triangle.getTriangleVertices(workspace.placedComponents.value[0]), point => ({...point}));
  const original = vertices();
  assert.equal(canvas.api.hitTestComponent(-1.4, 1), null, 'empty footprint corner stays selectable as canvas');
  assert.equal(canvas.api.hitTestComponent(0, 0).id, item.id);
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({get selectedItem() { return workspace.placedComponents.value[0]; }}),
  }, 'triangleParameters');
  near(panel.triangleParameters.value.side1, 3);
  near(panel.triangleParameters.value.angleA, 60);
  canvas.props.activeControl = null;
  canvas.props.selectedId = item.id;
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, original[1].y));
  canvas.api.handleMouseMove(canvas.pointer(0, -5));
  canvas.api.handleMouseUp();
  assert.deepEqual(vertices(), original, 'selected edge is fixed');
  await canvas.api.handleMouseDown(canvas.pointer(original[0].x, original[0].y));
  canvas.api.handleMouseMove(canvas.pointer(1, 4));
  canvas.api.handleMouseUp();
  near(vertices()[0].x, 1);
  assert.deepEqual(vertices().slice(1), original.slice(1));
  assert.notEqual(panel.triangleParameters.value.angleA, 60);
  workspace.undoCanvasEdit();
  assert.deepEqual(vertices(), original);

  const center = stations.getComponentCenter(workspace.placedComponents.value[0]);
  workspace.finiteCanvas.value = {enabled: true, length: 10, width: 10};
  workspace.openDialog({itemId: item.id, dialogType: 'triangle-definition'});
  const dialog = loadComponent('Dialog', {
    defineProps: () => ({
      item: workspace.placedComponents.value[0],
      dialogType: 'triangle-definition',
      validateTriangle: workspace.getTriangleDefinitionError,
    }),
    defineEmits: () => (_, payload) => workspace.saveDialog(payload),
    systemInputIcon: '',
    window: {innerWidth: 1200, innerHeight: 800},
  }, 'triangleDraft, triangleSolution, triangleError, saveTriangleDefinition');
  dialog.saveTriangleDefinition();
  assert.ok(workspace.activeDialog.value);
  Object.assign(dialog.triangleDraft, {side1: 30, side2: 40, angleA: 90});
  assert.match(dialog.triangleError.value, /超出有限画布/);
  dialog.saveTriangleDefinition();
  assert.ok(workspace.activeDialog.value);
  Object.assign(dialog.triangleDraft, {side1: 3, side2: 4});
  near(dialog.triangleSolution.value.parameters.side3, 5);
  dialog.saveTriangleDefinition();
  assert.equal(workspace.activeDialog.value, null);
  near(panel.triangleParameters.value.angleA, 90);
  assert.deepEqual(stations.getComponentCenter(workspace.placedComponents.value[0]), center);
});

test('triangular footprints allow use of empty bounding-box corners and block swept collisions', () => {
  const obstacle = {id: 'obstacle', type: 'triangularObstacle', x: 0, y: 0};
  const rect = buffer({id: 'device', x: 0, y: 2, width: 0.4, height: 0.4});
  const triangleBounds = componentCollision.getCollisionFootprint(obstacle);
  const rectBounds = componentCollision.getCollisionFootprint(rect);
  assert.equal(componentCollision.footprintsOverlap(triangleBounds, rectBounds), false);
  const traveled = componentCollision.resolveComponentDrag([rectBounds], [triangleBounds], {x: 4, y: 0});
  near(traveled.x, 2 / Math.sqrt(3) - 0.4);
  assert.equal(componentCollision.hasTriangleVertexSweepCollision([obstacle, rect], obstacle, 0, {x: -3, y: 1.9}), true);
});

test('circular obstacles draw a round outline and resize around their center through both editing paths', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentProperties, handleResizeObstacleEdge, beginCanvasEdit, endCanvasEdit, undoCanvasEdit, finiteCanvas');
  workspace.handleComponentPlaced(buffer({id: 'block', x: 3, y: -1, width: 2, height: 2}));
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {
    'component-placed': workspace.handleComponentPlaced,
    'resize-obstacle-edge': workspace.handleResizeObstacleEdge,
    'canvas-drag-start': workspace.beginCanvasEdit,
    'canvas-drag-end': workspace.endCanvasEdit,
  });
  t.after(() => canvas.dispose());
  canvas.props.activeControl = {type: 'circularObstacle', name: '圆形障碍物', icon: 'circularObstacle.svg'};
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, 0, {altKey: true}));
  canvas.api.handleMouseUp();
  const circle = workspace.placedComponents.value[1];
  assert.deepEqual([circle.width, circle.height], [3, 3]);
  assert.equal(canvas.api.hitTestComponent(1.4, 1.4), null);
  assert.equal(canvas.api.hitTestComponent(0, 1).id, circle.id);

  canvas.props.activeControl = null;
  canvas.props.selectedId = circle.id;
  await vue.nextTick();
  const arcs = [];
  canvas.element.getContext().arc = (x, y, radius) => arcs.push([x, y, radius]);
  canvas.api.drawGridNow();
  assert.ok(arcs.some(([x, y, radius]) => x === 0 && y === 0 && radius === 1.5 * canvas.api.ppm.value));
  assert.equal(arcs.filter(([, , radius]) => radius === 3.5).length, 4);
  assert.equal(canvas.api.imageCache.has(circle.icon), false);

  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({get selectedItem() { return workspace.placedComponents.value[1]; }}),
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'circleRadius, handleCircleRadiusBlur');
  const setRadius = value => {
    const target = {value};
    panel.handleCircleRadiusBlur({target});
    return target.value;
  };
  assert.equal(setRadius('2'), '2');
  assert.equal(setRadius('0'), '2');
  assert.equal(setRadius('3.1'), '2');
  await canvas.api.handleMouseDown(canvas.pointer(2, 0));
  canvas.api.handleMouseMove(canvas.pointer(4, 0));
  canvas.api.handleMouseUp();
  near(panel.circleRadius.value, 3);
  assert.deepEqual({...stations.getComponentCenter(circle)}, {x: 0, y: 0});
  workspace.undoCanvasEdit();
  near(panel.circleRadius.value, 2);

  workspace.finiteCanvas.value = {enabled: true, length: 12, width: 5};
  assert.equal(setRadius('2.6'), '2');
  assert.equal(setRadius('2.5'), '2.5');
});

test('circular collision uses the exact outline and stops at the first contact between shapes', () => {
  const {footprintsOverlap, getCollisionFootprint, resolveComponentDrag} = componentCollision;
  const disk = getCollisionFootprint({type: 'circularObstacle', x: -1, y: -1, width: 2, height: 2});
  assert.equal(footprintsOverlap(disk, {x: 0.8, y: 0.8, width: 1, height: 1}), false);
  assert.equal(footprintsOverlap(disk, {x: 0.6, y: 0.6, width: 1, height: 1}), true);
  const otherDisk = {...disk, x: 4, y: 0};
  const rectangle = {x: 4, y: 0.6, width: 1, height: 2};
  const triangleBounds = getCollisionFootprint({type: 'triangularObstacle', x: 5, y: 0});
  near(resolveComponentDrag([disk], [otherDisk], {x: 10, y: 0}).x, 5 - Math.sqrt(3));
  near(resolveComponentDrag([disk], [rectangle], {x: 10, y: 0}).x, 3.2);
  near(resolveComponentDrag([rectangle], [disk], {x: -10, y: 0}).x, -3.2);
  near(resolveComponentDrag([{...rectangle, width: 0}], [disk], {x: -10, y: 0}).x, -3.2);
  near(resolveComponentDrag([{...disk, y: 0}], [triangleBounds], {x: 10, y: 0}).x, 5 - 1 / Math.sqrt(3));
  assert.equal(footprintsOverlap(disk, {...disk, x: 1}), false, 'touching circles do not overlap');
});

test('rectangular wall thickness and exits use the inner frame while collisions use only solid strips', () => {
  const {getWallGeometry, getWallSideOptions, getWallValidationError} = rectangularWall;
  const {getCollisionFootprint, footprintsOverlap, resolveComponentDrag} = componentCollision;
  const wall = {id: 'wall', type: 'rectangularWall', x: 0, y: 0, width: 40, height: 24, wallThickness: 1};
  const shape = getWallGeometry(wall);
  assert.deepEqual({...shape.outer}, {x: -1, y: -1, width: 42, height: 26});
  assert.deepEqual({...shape.exitPoints[0]}, {x: 5, y: 24});
  assert.deepEqual({...getWallGeometry({...wall, wallThicknessMode: 'centered'}).exitPoints[0]}, {x: 5.5, y: 23.5});
  assert.deepEqual({...getWallGeometry({...wall, wallThicknessMode: 'inside'}).exitPoints[0]}, {x: 6, y: 23});
  assert.deepEqual(Array.from(getWallSideOptions('top'), side => side.value), ['left', 'right']);
  assert.deepEqual(Array.from(getWallSideOptions('right'), side => side.value), ['top', 'bottom']);
  assert.equal(getWallSideOptions('').length, 4);
  assert.match(getWallValidationError({...wall, wallThickness: 13, wallThicknessMode: 'inside'}), /内部空间/);
  assert.match(getWallValidationError({...wall, wallExits: [
    {side: 'bottom', reference: 'right', width: 4, distance: 4},
    {side: 'bottom', reference: 'right', width: 4, distance: 6},
  ]}), /重叠/);
  const wallFootprint = getCollisionFootprint(wall);
  const box = {x: 4.5, y: 21, width: 1, height: 1};
  assert.equal(footprintsOverlap(box, wallFootprint), false);
  assert.equal(footprintsOverlap({...box, x: 10, y: 24}, wallFootprint), true);
  near(resolveComponentDrag([box], [wallFootprint], {x: 0, y: 8}).y, 8);
  near(resolveComponentDrag([{...box, x: 10}], [wallFootprint], {x: 0, y: 8}).y, 2);
});

test('wall placement and the exit editor update the same model and support undo', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentProperties, openDialog, activeDialog, saveDialog, validateWallExits, undoCanvasEdit');
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {'component-placed': workspace.handleComponentPlaced});
  t.after(() => canvas.dispose());
  canvas.props.activeControl = {type: 'rectangularWall', name: '矩形墙', icon: 'rectangularWall.svg'};
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, 0, {altKey: true}));
  const [wall] = workspace.placedComponents.value;
  assert.deepEqual([wall.width, wall.height, wall.wallThickness, wall.wallThicknessMode], [40, 24, 0.3, 'outside']);
  assert.equal(canvas.api.hitTestComponent(0, 0), null);
  assert.equal(canvas.api.hitTestComponent(0, 12.15).id, wall.id);
  assert.equal(canvas.api.hitTestComponent(-15, 12.15), null);
  const ctx = canvas.element.getContext();
  const markers = [];
  ctx.arc = (x, y, radius) => markers.push([x, y, radius]);
  canvas.api.drawGridNow();
  assert.ok(markers.some(([x, y, radius]) => x === -15 * canvas.api.ppm.value && y === -12 * canvas.api.ppm.value && radius === 3));

  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: wall}),
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'handleWallNumber, handleWallThicknessMode');
  panel.handleWallNumber('width', {target: {value: '50'}});
  panel.handleWallNumber('wallThickness', {target: {value: '1'}});
  panel.handleWallThicknessMode({target: {value: 'inside'}});
  assert.deepEqual([wall.width, wall.wallThickness, wall.wallThicknessMode], [50, 1, 'inside']);
  assert.deepEqual({...stations.getComponentCenter(wall)}, {x: 0, y: 0});

  workspace.openDialog({itemId: wall.id, dialogType: 'wall-exits'});
  const editor = loadComponent('WallExitDialog', {
    defineProps: () => ({wall, validate: workspace.validateWallExits}),
    defineEmits: () => (_, payload) => workspace.saveDialog(payload),
  }, 'rows, addRow, removeRow, save, validationError');
  editor.addRow();
  editor.save();
  assert.ok(editor.validationError.value);
  assert.equal(wall.wallExits.length, 1);
  editor.removeRow();
  editor.addRow();
  Object.assign(editor.rows.value[1], {side: 'left', reference: 'top', width: 2, distance: 4});
  editor.save();
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(wall.wallExits.length, 2);
  workspace.undoCanvasEdit();
  assert.equal(workspace.placedComponents.value[0].wallExits.length, 1);
});

test('wall crossings accept openings that fit and reject solid-wall and rounded-route intersections', () => {
  const wall = {id: 'wall', type: 'rectangularWall', x: 0, y: 0, width: 40, height: 24};
  const from = buffer({id: 'inside', x: 4.5, y: 19.5, width: 1, height: 1});
  const to = buffer({id: 'outside', x: 9.5, y: 24.5, width: 1, height: 1});
  const waypoint = {x: 5, y: 25};
  const connection = {id: 'line', type: 'connectionLine', fromId: from.id, toId: to.id, waypoints: [waypoint]};
  const agv = {id: 'agv', type: 'AGVpath', pathWidth: 1, nodes: [{x: 5, y: 20}, waypoint, {x: 10, y: 25}]};
  const straightAgv = {...agv, nodes: [{x: 5, y: 20}, {x: 5, y: 28}]};
  const scene = [wall, from, to];
  assert.equal(hasWallRouteCollision(scene, [connection]), false);
  assert.equal(hasWallRouteCollision(scene, [{...connection, waypoints: []}]), true);
  assert.equal(hasWallRouteCollision(scene, [{...connection, cornerRadii: [4]}]), true);
  assert.equal(hasWallRouteCollision(scene, [agv]), false);
  assert.equal(hasWallRouteCollision(scene, [{...straightAgv, pathWidth: 3}]), false);
  assert.equal(hasWallRouteCollision(scene, [{...straightAgv, pathWidth: 3.01}]), true);
  assert.equal(hasWallRouteCollision(scene, [{...agv, cornerRadii: [4]}]), true);
  assert.equal(hasWallRouteCollision([...scene, connection, agv], [{...wall, wallExits: []}]), true);
});

test('rectangular obstacles can be placed and resized using the same physical collision footprint', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentPosition, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'buffer', x: 4, y: -1.5}));
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {'component-placed': workspace.handleComponentPlaced});
  t.after(() => canvas.dispose());
  canvas.props.activeControl = {type: 'rectangularObstacle', name: '矩形障碍物', icon: 'rectangularObstacle.svg'};
  await vue.nextTick();
  await canvas.api.handleMouseDown(canvas.pointer(0, 0, {altKey: true}));
  const obstacle = workspace.placedComponents.value[1];
  assert.deepEqual([obstacle.width, obstacle.height], [3, 3]);
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: obstacle}),
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'isResizableComponent, handleDimensionChange, rotateSelectedComponent');
  assert.equal(panel.isResizableComponent.value, true);
  panel.handleDimensionChange('width', {target: {value: '8'}});
  assert.equal(obstacle.width, 8, 'the obstacle can touch the buffer');
  panel.handleDimensionChange('width', {target: {value: '9'}});
  assert.equal(obstacle.width, 8, 'an intersecting resize is rejected');
  panel.rotateSelectedComponent(1);
  const footprint = stations.getComponentFootprint(obstacle);
  assert.deepEqual([footprint.x, footprint.y, footprint.width, footprint.height], [-1.5, -4, 3, 8]);
});

test('a selected obstacle edge resizes a rotated footprint up to contact and undo restores the entire drag', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, canvasBoundary, handleComponentPlaced, ' +
    'handleFiniteCanvasToggle, saveDialog, handleResizeObstacleEdge, beginCanvasEdit, endCanvasEdit, undoCanvasEdit');
  workspace.handleFiniteCanvasToggle({target: {checked: true}});
  workspace.saveDialog({dialogType: 'finite-canvas', canvasSize: {length: 20, width: 16}});
  workspace.handleComponentPlaced(buffer({id: 'buffer', x: 3, y: -1, width: 2, height: 2}));
  workspace.handleComponentPlaced(buffer({id: 'pillar', type: 'rectangularObstacle', x: -2, y: -1, width: 4, height: 2, quarterTurns: 1}));
  const items = workspace.placedComponents.value;
  const obstacle = items[1];
  const canvas = createCanvas(items, undefined, {
    'canvas-drag-start': workspace.beginCanvasEdit,
    'canvas-drag-end': workspace.endCanvasEdit,
    'resize-obstacle-edge': workspace.handleResizeObstacleEdge,
  });
  t.after(() => canvas.dispose());
  canvas.props.canvasBoundary = workspace.canvasBoundary.value;
  canvas.props.selectedId = obstacle.id;
  const box = () => ({...stations.getComponentFootprint(obstacle)});
  canvas.api.handleMouseMove(canvas.pointer(1.2, 0));
  assert.equal(canvas.api.cursorStyle.value, 'ew-resize');
  await canvas.api.handleMouseDown(canvas.pointer(1.2, 0));
  canvas.api.handleMouseMove(canvas.pointer(1.2, 3));
  assert.deepEqual(box(), {x: -1, y: -2, width: 2, height: 4});
  canvas.api.handleMouseMove(canvas.pointer(2.2, 0));
  assert.deepEqual(box(), {x: -1, y: -2, width: 3, height: 4});
  canvas.api.handleMouseMove(canvas.pointer(15, 0));
  canvas.api.handleMouseUp();
  assert.deepEqual(box(), {x: -1, y: -2, width: 4, height: 4});

  workspace.undoCanvasEdit();
  assert.deepEqual({...stations.getComponentFootprint(workspace.placedComponents.value[1])}, {x: -1, y: -2, width: 2, height: 4});
});

test('obstacle corners are visual only and the other three edges preserve the rectangle and clamp at the canvas', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, canvasBoundary, handleComponentPlaced, ' +
    'handleFiniteCanvasToggle, saveDialog, handleResizeObstacleEdge');
  workspace.handleFiniteCanvasToggle({target: {checked: true}});
  workspace.saveDialog({dialogType: 'finite-canvas', canvasSize: {length: 16, width: 12}});
  workspace.handleComponentPlaced(buffer({id: 'obstacle', type: 'rectangularObstacle', x: -2, y: -2, width: 4, height: 4}));
  const [obstacle] = workspace.placedComponents.value;
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {'resize-obstacle-edge': workspace.handleResizeObstacleEdge});
  t.after(() => canvas.dispose());
  canvas.props.canvasBoundary = workspace.canvasBoundary.value;
  canvas.props.selectedId = obstacle.id;
  const drag = async (start, end) => {
    await canvas.api.handleMouseDown(canvas.pointer(...start));
    canvas.api.handleMouseMove(canvas.pointer(...end));
    canvas.api.handleMouseUp();
  };
  await drag([2, 2], [5, 5]);
  assert.deepEqual([obstacle.x, obstacle.y, obstacle.width, obstacle.height], [-2, -2, 4, 4]);
  assert.equal(canvas.events.some(event => event.type === 'resize-obstacle-edge' || event.type === 'update-component-position'), false);
  await drag([-2, 0], [-20, 1]);
  assert.deepEqual([obstacle.x, obstacle.y, obstacle.width, obstacle.height], [-8, -2, 10, 4]);
  canvas.api.handleMouseMove(canvas.pointer(0, 2));
  assert.equal(canvas.api.cursorStyle.value, 'ns-resize');
  await drag([0, 2], [1, 8]);
  assert.deepEqual([obstacle.y, obstacle.height], [-2, 8]);
  await drag([0, -2], [0, 10]);
  near(obstacle.height, 0.01);
  near(obstacle.y + obstacle.height, 6);
});

test('components can be placed against a finite boundary and a rotated group slides along the boundary', async (t) => {
  const rotated = buffer({id: 'turn', x: -3, y: -1, width: 6, height: 2, quarterTurns: 1});
  const neighbor = buffer({id: 'other', x: 4, y: -1});
  const c = createCanvas([rotated, neighbor]);
  t.after(() => c.dispose());
  c.props.canvasBoundary = {x: -10, y: -8, width: 20, height: 16};
  c.props.selectedId = 'turn';
  c.props.selectedIds = ['turn', 'other'];
  await c.api.handleMouseDown(c.pointer(0, 0));
  c.api.handleMouseMove(c.pointer(-35, 2, {altKey: true}));
  let footprint = stations.getComponentFootprint(rotated);
  assert.deepEqual([footprint.x, footprint.y, neighbor.x, neighbor.y], [-10, -1, -5, 1]);
  c.api.handleMouseMove(c.pointer(-35, 4, {altKey: true}));
  footprint = stations.getComponentFootprint(rotated);
  assert.deepEqual([footprint.x, footprint.y, neighbor.x, neighbor.y], [-10, 1, -5, 3]);
  c.api.handleMouseUp();

  c.props.activeControl = {type: 'buffer', name: '缓冲区', icon: 'buffer.svg'};
  await vue.nextTick();
  await c.api.handleMouseDown(c.pointer(11, 7));
  assert.equal(c.props.placedComponents.length, 2);
  c.api.handleMouseMove(c.pointer(9.8, 7.7, {altKey: true}));
  assert.deepEqual([c.api.cursorX.value, c.api.cursorY.value], [8.5, 6.5]);
  await c.api.handleMouseDown(c.pointer(9.8, 7.7, {altKey: true}));
  const placed = c.props.placedComponents.at(-1);
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [7, 5, 3, 3]);
});

test('dragging cannot jump through a component and can slide along its edge', async (t) => {
  const moving = buffer({id: 'moving', x: -6, y: 0});
  const obstacle = buffer({id: 'obstacle', x: 0, y: -4, width: 4, height: 14});
  const c = createCanvas([moving, obstacle]);
  t.after(() => c.dispose());
  await c.api.handleMouseDown(c.pointer(-4.5, 1.5));
  c.api.handleMouseMove(c.pointer(15, 1.5, {altKey: true}));
  assert.deepEqual([moving.x, moving.y], [-3, 0]);
  c.api.handleMouseMove(c.pointer(15, 5.5, {altKey: true}));
  assert.deepEqual([moving.x, moving.y], [-3, 4]);
  c.api.handleMouseUp();
});

test('group drag checks each physical footprint, allowing an obstacle between members', async (t) => {
  const bottom = buffer({id: 'bottom', x: -6, y: 0});
  const top = buffer({id: 'top', x: -6, y: 10});
  const gap = buffer({id: 'gap', x: 0, y: 5});
  const wall = buffer({id: 'wall', x: 5, y: 10});
  const c = createCanvas([bottom, top, gap, wall]);
  t.after(() => c.dispose());
  c.props.selectedIds = [bottom.id, top.id];
  c.props.selectedId = bottom.id;
  await c.api.handleMouseDown(c.pointer(-4.5, 1.5));
  c.api.handleMouseMove(c.pointer(20, 1.5, {altKey: true}));
  c.api.handleMouseUp();
  assert.deepEqual([bottom.x, bottom.y, top.x, top.y], [2, 0, 2, 10]);
});

test('placement and property edits allow touching but reject intersecting footprints', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentPosition, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'moving', x: 0, y: 0, width: 6, height: 2}));
  workspace.handleComponentPlaced(buffer({id: 'side', x: 6, y: 0}));
  workspace.handleComponentPlaced(buffer({id: 'above', x: 2, y: 3}));
  workspace.handleComponentPlaced(buffer({id: 'rejected', x: 5.9, y: 0}));
  assert.equal(workspace.placedComponents.value.length, 3);

  const c = createCanvas(workspace.placedComponents.value, undefined, {'component-placed': workspace.handleComponentPlaced});
  t.after(() => c.dispose());
  c.props.activeControl = {type: 'buffer', name: '缓冲区', icon: 'buffer.svg'};
  await vue.nextTick();
  await c.api.handleMouseDown(c.pointer(1.5, 1, {altKey: true}));
  assert.equal(c.events.filter(event => event.type === 'component-placed').length, 0);
  await c.api.handleMouseDown(c.pointer(10.5, 1.5, {altKey: true}));
  assert.equal(workspace.placedComponents.value.at(-1).x, 9);

  const [item] = workspace.placedComponents.value;
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: item}),
    defineEmits: () => (type, value) => (type === 'update-component-position'
      ? workspace.handleUpdateComponentPosition(value) : workspace.handleUpdateComponentProperties(value)),
  }, 'handleDimensionChange, handleDimensionBlur, handleCenterCoordinateChange, rotateSelectedComponent');
  const width = {target: {value: '10'}};
  panel.handleDimensionChange('width', width);
  panel.handleDimensionBlur('width', width);
  assert.equal(width.target.value, '6');
  const center = {target: {value: '5'}};
  panel.handleCenterCoordinateChange('x', center);
  assert.equal(center.target.value, '3');
  panel.rotateSelectedComponent(1);
  assert.deepEqual([item.x, item.width, item.quarterTurns], [0, 6, undefined]);
});

test('an already overlapping layout can be separated without increasing the overlap', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentPosition');
  workspace.placedComponents.value.push(buffer({id: 'left', x: 0, y: 0}), buffer({id: 'right', x: 2, y: 0}));
  const right = workspace.placedComponents.value[1];
  workspace.handleUpdateComponentPosition({id: 'right', x: 1, y: 0});
  assert.equal(right.x, 2);
  workspace.handleUpdateComponentPosition({id: 'right', x: 2.5, y: 0});
  assert.equal(right.x, 2.5);
  workspace.handleUpdateComponentPosition({id: 'right', x: 3, y: 0});
  assert.equal(right.x, 3);
});

test('finite canvas stays disabled until the floating size dialog confirms valid dimensions', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, canvasBoundary, canvasSizeSummary, finiteCanvas, activeDialog, minimumCanvasSize, ' +
    'handleFiniteCanvasToggle, saveDialog, undoCanvasEdit');
  const openEditor = () => {
    const target = {checked: true};
    workspace.handleFiniteCanvasToggle({target});
    assert.equal(target.checked, false);
    const dialog = workspace.activeDialog.value;
    return loadComponent('Dialog', {
      defineProps: () => ({item: null, dialogType: dialog.dialogType, canvasSize: dialog.canvasSize,
        get minimumCanvasSize() { return workspace.minimumCanvasSize.value; }}),
      defineEmits: () => (event, payload) => {
        if (event === 'save') workspace.saveDialog(payload);
        if (event === 'close') workspace.activeDialog.value = null;
      },
      window: {innerWidth: 1280, innerHeight: 800}, systemInputIcon: '',
    }, 'canvasSizeDraft, canvasSizeError, saveCanvasSize, emit');
  };
  assert.equal(workspace.canvasBoundary.value, null);
  assert.equal(workspace.canvasSizeSummary.value, '(+∞,+∞)');
  workspace.placedComponents.value.push(buffer({x: 23, y: 2}));
  const draft = openEditor();
  assert.deepEqual({...draft.canvasSizeDraft}, {length: 52, width: 24});
  draft.canvasSizeDraft.length = 51;
  assert.match(draft.canvasSizeError.value, /越界/);
  draft.saveCanvasSize();
  assert.equal(workspace.canvasBoundary.value, null);
  draft.emit('close');
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(workspace.finiteCanvas.value.enabled, false);
  assert.equal(workspace.canvasSizeSummary.value, '(+∞,+∞)');

  const confirmed = openEditor();
  confirmed.canvasSizeDraft.width = 0;
  assert.match(confirmed.canvasSizeError.value, /大于 0/);
  confirmed.canvasSizeDraft.width = 10;
  confirmed.saveCanvasSize();
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(workspace.finiteCanvas.value.enabled, true);
  assert.deepEqual({...workspace.canvasBoundary.value}, {x: -26, y: -5, width: 52, height: 10});
  assert.match(workspace.canvasSizeSummary.value, /^\(52[,，]\s*10\)$/);
  workspace.handleFiniteCanvasToggle({target: {checked: false}});
  assert.equal(workspace.canvasBoundary.value, null);
  workspace.undoCanvasEdit();
  assert.equal(workspace.finiteCanvas.value.enabled, true);
  workspace.undoCanvasEdit();
  assert.equal(workspace.canvasBoundary.value, null);
  assert.deepEqual([workspace.placedComponents.value[0].x, workspace.placedComponents.value[0].y], [23, 2]);
});

test('finite canvas guards model edits including component rotation and connected AGV corridors', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleFiniteCanvasToggle, saveDialog, ' +
    'handleComponentPlaced, handleUpdateComponentPosition, handleUpdateComponentProperties');
  workspace.handleFiniteCanvasToggle({target: {checked: true}});
  workspace.saveDialog({dialogType: 'finite-canvas', canvasSize: {length: 20, width: 16}});
  workspace.handleComponentPlaced({id: 'start', type: 'node', x: 0, y: 0, width: 3, height: 3});
  workspace.handleComponentPlaced({id: 'end', type: 'node', x: 5, y: 0, width: 3, height: 3});
  workspace.handleComponentPlaced({id: 'path', type: 'AGVpath', fromId: 'start', toId: 'end', pathWidth: 4,
    nodes: [{x: 0, y: 0}, {x: 2, y: 2}, {x: 5, y: 0}]});
  workspace.handleComponentPlaced(buffer({id: 'rect', x: -3, y: 5, width: 6, height: 2}));
  workspace.handleComponentPlaced(buffer({id: 'outside', x: 9, y: 0}));
  assert.equal(workspace.placedComponents.value.length, 4);
  const [, end, path, rect] = workspace.placedComponents.value;
  workspace.handleUpdateComponentPosition({id: 'end', x: 200, y: 3});
  assert.deepEqual([end.x, end.y], [8, 3]);
  assert.deepEqual({...path.nodes[2]}, {x: 8, y: 3});
  workspace.handleUpdateComponentProperties({id: 'path', pathWidth: 6});
  assert.equal(path.pathWidth, 4);
  workspace.handleUpdateComponentProperties({id: 'rect', rotationDelta: 1});
  workspace.handleUpdateComponentProperties({id: 'rect', height: 5});
  assert.equal(rect.quarterTurns, undefined);
  assert.equal(rect.height, 2);
});

test('Ctrl+Z undoes the last canvas edit while leaving editable controls to handle their own undo', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleComponentPlaced, undoCanvasEdit');
  const target = Object.assign(new EventTarget(), {document: {activeElement: null}, localStorage: {
    getItem: () => '{"repeat-last-tool":{"button":4}}',
  }});
  let mount;
  let unmount;
  const app = loadComponent('../App', {
    ...shortcuts, window: target,
    onMounted: callback => { mount = callback; },
    onBeforeUnmount: callback => { unmount = callback; },
  }, 'workspaceLayoutRef, activeShortcutBindings');
  app.workspaceLayoutRef.value = workspace;
  workspace.handleComponentPlaced(buffer({id: 'first'}));
  workspace.handleComponentPlaced(buffer({id: 'second', x: 15}));
  mount();
  assert.equal(app.activeShortcutBindings.value['repeat-last-tool'].button, 4);
  assert.equal(shortcuts.formatShortcutBinding(app.activeShortcutBindings.value['undo-canvas-edit']), 'Ctrl + Z');

  const press = (modifiers = {}) => {
    const event = Object.assign(new Event('keydown', {cancelable: true}), {key: 'z', ctrlKey: true, ...modifiers});
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  target.document.activeElement = {closest: selector => selector.includes('input')};
  assert.equal(press(), false);
  assert.equal(workspace.placedComponents.value.length, 2);
  target.document.activeElement = null;
  assert.equal(press({shiftKey: true}), false);
  assert.equal(press(), true);
  assert.deepEqual(Array.from(workspace.placedComponents.value, item => item.id), ['first']);
  assert.equal(press({repeat: true}), true);
  assert.equal(workspace.placedComponents.value.length, 1);
  assert.equal(press(), true);
  assert.equal(workspace.placedComponents.value.length, 0);
  unmount();
});

test('canvas undo groups pointer moves and restores a batch deletion with its connections', async (t) => {
  const workspace = loadComponent('WorkspaceLayout', {getComponentLabel: item => item.id},
    'placedComponents, designCanvas, selectedIds, handleComponentPlaced, handleSelectComponents, handleKeyDown, ' +
    'handleUpdateComponentPositions, handleUpdateComponentProperties, beginCanvasEdit, endCanvasEdit, undoCanvasEdit');
  workspace.handleComponentPlaced(buffer({id: 'a', x: 0, y: 0}));
  workspace.handleComponentPlaced(buffer({id: 'b', x: 10, y: 0}));
  workspace.handleComponentPlaced({id: 'line', type: 'connectionLine', fromId: 'a', toId: 'b'});
  workspace.handleSelectComponents(['a', 'b']);
  const canvas = createCanvas(workspace.placedComponents.value, undefined, {
    'canvas-drag-start': workspace.beginCanvasEdit,
    'canvas-drag-end': workspace.endCanvasEdit,
    'update-component-positions': workspace.handleUpdateComponentPositions,
  });
  t.after(() => canvas.dispose());
  canvas.props.selectedIds = ['a', 'b'];
  canvas.props.selectedId = 'a';
  workspace.designCanvas.value = canvas.api;
  const positions = () => Array.from(workspace.placedComponents.value.slice(0, 2), item => [item.x, item.y]);
  await canvas.api.handleMouseDown(canvas.pointer(1, 1));
  canvas.api.handleMouseMove(canvas.pointer(3, 4, {altKey: true}));
  await vue.nextTick();
  canvas.api.handleMouseMove(canvas.pointer(4, 5, {altKey: true}));
  canvas.api.handleMouseUp();
  assert.deepEqual(positions(), [[3, 4], [13, 4]]);

  workspace.handleUpdateComponentProperties({id: 'a', width: 5});
  workspace.handleUpdateComponentProperties({id: 'a', width: 5});
  workspace.undoCanvasEdit();
  assert.equal(workspace.placedComponents.value[0].width, 3);
  assert.deepEqual(positions(), [[3, 4], [13, 4]]);
  workspace.undoCanvasEdit();
  assert.deepEqual(positions(), [[0, 0], [10, 0]]);

  workspace.handleKeyDown({key: 'Delete', preventDefault() {}});
  assert.equal(workspace.placedComponents.value.length, 0);
  workspace.undoCanvasEdit();
  assert.deepEqual(Array.from(workspace.placedComponents.value, item => item.id), ['a', 'b', 'line']);
  assert.deepEqual(Array.from(workspace.selectedIds.value), ['a', 'b']);
});

test('the back mouse button restores a finished tool and leaves an active drawing alone', async (t) => {
  const {tabList, menuControls} = loadExports('config/controlMenuData.js', 'tabList,menuControls');
  const target = Object.assign(new EventTarget(), {document: {activeElement: null}});
  let mount;
  let unmount;
  const app = loadComponent('../App', {
    ...shortcuts, window: target,
    onMounted: callback => { mount = callback; },
    onBeforeUnmount: callback => { unmount = callback; },
  }, 'workspaceLayoutRef, controlPanelRef, handleControlChange, handlePlacementDone');
  const canvas = createCanvas([
    buffer({id: 'a', x: 3, y: -1}),
    buffer({id: 'b', x: 9, y: -1}),
    buffer({id: 'c', x: 15, y: -1}),
  ], app.handlePlacementDone);
  t.after(() => canvas.dispose());
  app.workspaceLayoutRef.value = {handleControlChange: control => { canvas.props.activeControl = control; }};
  const panel = loadComponent('ControlPanel', {
    tabList, menuControls,
    defineEmits: () => (_, control) => app.handleControlChange(control),
  }, 'handleClickControl, handleTabClick, resetToSelect, repeatLastTool, activeKey, activeControlInfo');
  app.controlPanelRef.value = panel;
  mount();

  const mouse = (type, button = 3, buttons = type === 'mousedown' ? 8 : 0) => {
    const event = Object.assign(new Event(type, {cancelable: true}), {button, buttons});
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const click = async (x) => {
    const event = canvas.pointer(x, 0);
    await canvas.api.handleMouseDown(event);
    canvas.api.handleMouseUp(event);
  };
  assert.equal(mouse('mousedown'), true);
  assert.equal(panel.activeControlInfo.value.type, 'select');
  panel.handleClickControl(menuControls.commonControl.find(item => item.type === 'connectionLine'));
  await vue.nextTick();
  await click(4.5);
  assert.equal(mouse('mousedown'), true);
  await click(10.5);
  await vue.nextTick();
  assert.equal(panel.activeControlInfo.value.type, 'select');
  assert.ok(canvas.props.placedComponents.some(item => item.type === 'connectionLine' && item.fromId === 'a' && item.toId === 'b'));
  canvas.props.selectedId = 'b';
  assert.equal(mouse('mouseup'), true);
  assert.equal(mouse('auxclick'), true);
  assert.equal(panel.activeControlInfo.value.type, 'select');
  assert.equal(mouse('mousedown', 4, 16), false);
  assert.equal(mouse('mousedown', 3, 9), true);
  assert.equal(panel.activeControlInfo.value.type, 'select');
  target.document.activeElement = {closest: () => true};
  mouse('mousedown');
  assert.equal(panel.activeControlInfo.value.type, 'select');
  target.document.activeElement = null;
  mouse('mousedown');
  await vue.nextTick();
  assert.equal(panel.activeControlInfo.value.type, 'connectionLine');
  await click(10.5);
  await click(16.5);
  assert.ok(canvas.props.placedComponents.some(item => item.type === 'connectionLine' && item.fromId === 'b' && item.toId === 'c'));

  panel.handleTabClick(tabList.find(tab => tab.id === 'logistics'));
  panel.handleClickControl(menuControls.logistics.find(item => item.type === 'AGVpath'));
  panel.handleTabClick(tabList[0]);
  mouse('mousedown');
  assert.equal(panel.activeKey.value, 'logistics');
  assert.equal(panel.activeControlInfo.value.type, 'AGVpath');
  panel.resetToSelect();
  unmount();
  assert.equal(mouse('mousedown'), false);
  assert.equal(panel.activeControlInfo.value.type, 'select');
});

test('Ctrl+A selects all model objects or the active console tab according to the focused panel', (t) => {
  const workspace = loadComponent('WorkspaceLayout', {getComponentLabel: item => item.id},
    'placedComponents, selectedIds, consolePanel, canSelectAll, selectAll, handleSelectComponent, handleKeyDown, undoCanvasEdit');
  workspace.placedComponents.value.push(
    buffer({id: 'input'}), buffer({id: 'output'}),
    {id: 'link', type: 'connectionLine', fromId: 'input', toId: 'output'},
  );
  let selectedContent;
  const doc = {
    getSelection() {
      return {
        removeAllRanges() { selectedContent = null; },
        addRange(range) { selectedContent = range.content; },
      };
    },
    createRange() {
      return {selectNodeContents(content) { this.content = content; }};
    },
  };
  const consoleView = loadComponent('ConsolePanel', {defineProps: () => ({logs: []})},
    'logList, consoleContent, activeTab, selectVisibleContent');
  consoleView.logList.value = vue.markRaw({ownerDocument: doc});
  consoleView.consoleContent.value = vue.markRaw({ownerDocument: doc});
  workspace.consolePanel.value = {selectVisibleContent: consoleView.selectVisibleContent};

  let activePanel = 'model-tree';
  let editing = false;
  const target = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    localStorage: {getItem: () => null},
    closest(selector) {
      if (selector === '[data-workspace-panel]') return {dataset: {workspacePanel: activePanel}};
      if (editing && selector.includes('input')) return this;
      return null;
    },
  });
  let mount, unmount;
  const app = loadComponent('../App', {
    ...shortcuts, window: target,
    onMounted: callback => { mount = callback; },
    onBeforeUnmount: callback => { unmount = callback; },
  }, 'workspaceLayoutRef');
  app.workspaceLayoutRef.value = workspace;
  mount();
  t.after(unmount);
  const ctrlA = () => {
    const event = Object.assign(new Event('keydown', {cancelable: true}), {key: 'a', ctrlKey: true});
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(ctrlA(), true);
  assert.deepEqual([...workspace.selectedIds.value], ['input', 'output', 'link']);
  workspace.handleSelectComponent('input');
  editing = true;
  assert.equal(ctrlA(), false, 'the search field keeps native select all');
  assert.deepEqual([...workspace.selectedIds.value], ['input']);
  editing = false;
  activePanel = 'canvas';
  assert.equal(ctrlA(), true);
  assert.deepEqual([...workspace.selectedIds.value], ['input', 'output', 'link']);

  activePanel = 'console';
  assert.equal(ctrlA(), true);
  assert.equal(selectedContent, consoleView.logList.value);
  consoleView.activeTab.value = 'console';
  assert.equal(ctrlA(), true);
  assert.equal(selectedContent, consoleView.consoleContent.value);
  const deleteKey = {key: 'Delete', target, preventDefault() {}};
  workspace.handleKeyDown(deleteKey);
  assert.equal(workspace.placedComponents.value.length, 3, 'Delete in the console leaves the model selection intact');
  activePanel = 'properties';
  assert.equal(ctrlA(), false);
  activePanel = 'model-tree';
  assert.equal(ctrlA(), true);
  assert.equal(selectedContent, null);
  workspace.handleKeyDown(deleteKey);
  assert.equal(workspace.placedComponents.value.length, 0);
  workspace.undoCanvasEdit();
  assert.equal(workspace.placedComponents.value.length, 3);
});

test('floating windows can move and resize within the viewport and let the editor consume Escape', () => {
  let emittedClose = 0;
  let recording = true;
  const floating = loadComponent('FloatingDialog', {
    defaultIcon: '',
    topDialogLayer: 1049,
    useId: () => 'floating-title',
    defineOptions() {},
    defineProps: () => ({defaultWidth: 480, defaultHeight: 260}),
    defineEmits: () => (event, nativeEvent) => {
      if (event === 'keydown' && recording) nativeEvent.preventDefault();
      if (event === 'close') emittedClose++;
    },
    window: {innerWidth: 1000, innerHeight: 700},
  }, 'dialog, bounds, startInteraction, moveInteraction, endInteraction, handleKeyDown');
  floating.dialog.value = {focus() {}};
  let captured;
  const handle = {
    setPointerCapture: id => { captured = id; },
    hasPointerCapture: id => captured === id,
    releasePointerCapture: () => { captured = null; },
  };
  const pointer = (clientX, clientY) => ({
    button: 0, pointerId: 1, clientX, clientY, currentTarget: handle, preventDefault() {},
  });
  floating.startInteraction(pointer(300, 130), 'move');
  floating.moveInteraction(pointer(900, 600));
  floating.endInteraction(pointer(900, 600));
  assert.equal(captured, null);
  assert.equal(floating.bounds.left, 520);
  assert.equal(floating.bounds.top, 440);
  floating.startInteraction(pointer(999, 699), 'se');
  floating.moveInteraction(pointer(950, 730));
  floating.endInteraction(pointer(950, 730));
  assert.equal(floating.bounds.width, 431);
  assert.equal(floating.bounds.height, 260);
  const escape = () => Object.assign(new Event('keydown', {cancelable: true}), {key: 'Escape'});
  floating.handleKeyDown(escape());
  assert.equal(emittedClose, 0);
  recording = false;
  floating.handleKeyDown(escape());
  assert.equal(emittedClose, 1);
});

test('shortcut settings record a draft, rebind on save and load the preference at the next start', () => {
  const stored = new Map();
  const target = Object.assign(new EventTarget(), {
    document: {activeElement: null},
    localStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, data) => stored.set(key, data)},
  });
  let executions = 0;
  const createApp = () => {
    let mount;
    let unmount;
    const app = loadComponent('../App', {
      ...shortcuts, window: target,
      onMounted: callback => { mount = callback; },
      onBeforeUnmount: callback => { unmount = callback; },
    }, 'controlPanelRef, activeShortcutBindings, showShortcutSettings, handleMenuAction, saveShortcutSettings');
    app.controlPanelRef.value = {repeatLastTool: () => { executions++; }};
    mount();
    return {app, unmount};
  };
  const {app, unmount} = createApp();
  const {topBarMenus} = loadExports('config/topBarMenuData.js', 'topBarMenus');
  const menuItem = topBarMenus.find(menu => menu.id === 'start').items.find(item => item.label === '快捷键设置');
  app.handleMenuAction(menuItem.id);
  assert.equal(app.showShortcutSettings.value, true);
  let emitted;
  const settings = loadComponent('ShortcutSettings', {
    ...shortcuts, defineProps: () => ({bindings: app.activeShortcutBindings.value}),
    defineEmits: () => (event) => { emitted = event; },
  }, 'draft, recordingId, toggleRecording, recordKey, recordMouse, restoreDefaults');
  const send = (type, fields) => {
    const event = Object.assign(new Event(type, {cancelable: true}), fields);
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const command = 'repeat-last-tool';
  const back = {button: 3, buttons: 8};
  const forward = {button: 4, buttons: 16};
  settings.toggleRecording(command);
  settings.recordMouse({...forward, preventDefault() {}});
  assert.equal(settings.draft.value[command].button, 4);
  assert.equal(app.activeShortcutBindings.value[command].button, 3);
  settings.toggleRecording(command);
  settings.recordKey({key: 'R', ctrlKey: true, shiftKey: true, preventDefault() {}});
  assert.equal(shortcuts.formatShortcutBinding(settings.draft.value[command]), 'Ctrl + Shift + R');
  target.document.activeElement = {closest: selector => selector.includes('dialog')};
  send('mousedown', back);
  assert.equal(executions, 0);
  target.document.activeElement = null;
  assert.equal(send('mousedown', back), true);
  assert.equal(executions, 1);
  app.saveShortcutSettings(settings.draft.value);
  assert.equal(app.showShortcutSettings.value, false);
  assert.equal(send('mousedown', back), false);
  assert.equal(send('keydown', {key: 'R', ctrlKey: true}), false);
  const combination = {key: 'R', ctrlKey: true, shiftKey: true};
  assert.equal(send('keydown', combination), true);
  assert.equal(send('keydown', {...combination, repeat: true}), true);
  assert.equal(executions, 2);
  unmount();

  const restarted = createApp();
  assert.equal(restarted.app.activeShortcutBindings.value[command].key, 'r');
  send('keydown', combination);
  assert.equal(executions, 3);
  settings.toggleRecording(command);
  const escape = Object.assign(new Event('keydown', {cancelable: true}), {key: 'Escape'});
  settings.recordKey(escape);
  assert.equal(settings.recordingId.value, null);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(emitted, undefined);
  settings.restoreDefaults();
  restarted.app.saveShortcutSettings(settings.draft.value);
  assert.equal(send('keydown', combination), false);
  assert.equal(send('mousedown', back), true);
  assert.equal(executions, 4);
  restarted.unmount();
});

test('input type is saved per input without changing its rule categories', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'input-1', type: 'systemInput'}));
  workspace.handleComponentPlaced(buffer({id: 'input-2', type: 'systemInput', x: 15}));
  const [first, second] = workspace.placedComponents.value;
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: first}),
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'inputProperties, handleInputPropertyChange');
  assert.equal(panel.inputProperties.value.inputType, 'Workpiece');
  panel.handleInputPropertyChange('inputType', {target: {value: 'Vehicle'}});
  assert.equal(first.inputType, 'Vehicle');
  assert.equal(second.inputType, 'Workpiece');
  assert.equal(first.inputRuleRows[0].partType, 'Workpiece');
  assert.equal(first.inputRuleRows[0].length, 500);
  assert.equal(first.inputRuleRows[0].width, 400);
  workspace.handleUpdateComponentProperties({id: first.id, inputType: 'AGV'});
  assert.equal(first.inputType, 'Vehicle');
});

test('buffer panel stores positive or unlimited capacity and a fixed duration in seconds', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, handleComponentPlaced, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer());
  const item = workspace.placedComponents.value[0];
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: item}),
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'bufferCapacity, minimumStayTime, handleBufferPropertyChange');
  assert.equal(panel.bufferCapacity.value, -1);
  assert.equal(panel.minimumStayTime.value, 0);
  panel.handleBufferPropertyChange('bufferCapacity', {target: {value: '2'}});
  for (const value of ['0', '-2', '2.5', '']) {
    const invalid = {target: {value}};
    panel.handleBufferPropertyChange('bufferCapacity', invalid);
    assert.equal(invalid.target.value, '2');
  }
  const stay = {target: {value: '1:00.250'}};
  panel.handleBufferPropertyChange('minimumStayTime', stay);
  assert.equal(item.bufferCapacity, 2);
  assert.equal(item.minimumStayTime, 60.25);
  assert.equal(stay.target.value, '1:0.25');
});

test('assembly panel adds and edits validated BOM drafts through the shared dialog', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, activeDialog, dialogItem, openDialog, saveDialog, handleComponentPlaced, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'assembly', type: 'assemblyWorkstation'}));
  const station = workspace.placedComponents.value[0];
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: station}),
    defineEmits: () => (event, payload) => {
      if (event === 'open-dialog') workspace.openDialog(payload);
      else workspace.handleUpdateComponentProperties(payload);
    },
  }, 'assemblyRecipes, assemblyUnitCount, handleAssemblyUnitCountChange, selectAssemblyRow, selectAssemblyMode, openAssemblyRecipe, deleteAssemblyRecipe');
  assert.equal(station.assemblyMode, 'parts');
  assert.equal(panel.assemblyUnitCount.value, 1);
  panel.handleAssemblyUnitCountChange({target: {value: '3'}});
  assert.equal(station.assemblyUnitCount, 3);
  const invalidCount = {target: {value: '1.5'}};
  panel.handleAssemblyUnitCountChange(invalidCount);
  assert.equal(invalidCount.target.value, '3');
  workspace.handleUpdateComponentProperties({id: station.id, assemblyUnitCount: 0});
  assert.equal(station.assemblyUnitCount, 3);
  assert.equal(panel.assemblyRecipes.value.length, 0);
  const createEditor = () => {
    const active = workspace.activeDialog.value;
    return loadComponent('Dialog', {
      defineProps: () => ({item: workspace.dialogItem.value, dialogType: active.dialogType,
        assemblyRecipe: active.recipe, assemblyMode: active.mode, assemblyPackingType: active.packingType}),
      defineEmits: () => (event, payload) => {
        if (event === 'save') workspace.saveDialog(payload);
        if (event === 'close') workspace.activeDialog.value = null;
      },
      window: {innerWidth: 1280, innerHeight: 800}, systemInputIcon: '',
    }, 'recipeDraft, bomError, addMaterialRow, saveBomRecipe, formatBomDuration, emit');
  };
  panel.openAssemblyRecipe(null);
  const create = createEditor();
  assert.equal(create.recipeDraft.assemblyTime, '5:0');
  assert.equal(create.recipeDraft.setupTime, '0:0');
  assert.equal(create.recipeDraft.fillColor, '#000000');
  assert.equal(create.recipeDraft.packingType, 'Workpiece');
  create.recipeDraft.productType = ' Assembly ';
  create.addMaterialRow();
  create.recipeDraft.materials[0].partType = ' Bolt ';
  create.saveBomRecipe();
  assert.match(create.bomError.value, /工件数量/);
  assert.equal(station.assemblyRecipes.length, 0);
  create.recipeDraft.materials[0].quantity = 2;
  assert.equal(create.bomError.value, '');
  create.saveBomRecipe();
  assert.equal(station.assemblyRecipes[0].materials[0].partType, 'Bolt');
  assert.equal(station.assemblyRecipes[0].materials[0].name, '');
  assert.equal(station.assemblyRecipes[0].assemblyTime, 300);
  assert.equal(station.assemblyRecipes[0].packingType, 'Workpiece');

  panel.selectAssemblyMode('container');
  panel.openAssemblyRecipe(null);
  assert.equal(createEditor().recipeDraft.packingType, 'Pallet');
  panel.selectAssemblyRow(0);
  panel.openAssemblyRecipe(0);
  assert.equal(createEditor().recipeDraft.packingType, 'Workpiece', 'a change made without a selection only affects new recipes');

  panel.selectAssemblyMode('container');
  panel.openAssemblyRecipe(0);
  const edit = createEditor();
  assert.equal(edit.recipeDraft.packingType, 'Pallet');
  edit.recipeDraft.packingType = 'AGV';
  edit.recipeDraft.assemblyTime = '30';
  edit.formatBomDuration('assemblyTime');
  assert.equal(edit.recipeDraft.assemblyTime, '0:30');
  edit.recipeDraft.setupTime = '1.005';
  edit.formatBomDuration('setupTime');
  assert.equal(edit.recipeDraft.setupTime, '0:1.005');
  edit.recipeDraft.setupTime = '1:90';
  edit.formatBomDuration('setupTime');
  assert.equal(edit.recipeDraft.setupTime, '1:90');
  assert.match(edit.bomError.value, /准备时长/);
  edit.recipeDraft.setupTime = '0:1.005';
  edit.recipeDraft.materials[0].quantity = 3;
  assert.equal(station.assemblyRecipes[0].materials[0].quantity, 2);
  assert.equal(station.assemblyRecipes[0].packingType, 'Workpiece');
  edit.saveBomRecipe();
  assert.equal(station.assemblyRecipes.length, 1);
  assert.equal(station.assemblyRecipes[0].packingType, 'AGV');
  assert.equal(station.assemblyRecipes[0].assemblyTime, 30);
  assert.equal(station.assemblyRecipes[0].setupTime, 1.005);
  assert.equal(station.assemblyRecipes[0].materials[0].quantity, 3);

  panel.openAssemblyRecipe(0);
  assert.equal(createEditor().recipeDraft.packingType, 'AGV');
  panel.selectAssemblyMode('parts');
  panel.openAssemblyRecipe(0);
  const cancelled = createEditor();
  assert.equal(cancelled.recipeDraft.packingType, 'Workpiece');
  cancelled.emit('close');
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(station.assemblyRecipes[0].packingType, 'AGV');
  panel.selectAssemblyMode('container');
  panel.openAssemblyRecipe(0);
  const switchedBack = createEditor();
  assert.equal(switchedBack.recipeDraft.packingType, 'Pallet', 'explicitly selecting a mode defaults to its first option');
  switchedBack.emit('close');
  assert.equal(station.assemblyRecipes[0].packingType, 'AGV');

  // 先切换站点模式，再选已有的 AGV 行，未为此行设置专门的模式。
  panel.selectAssemblyRow(0);
  panel.selectAssemblyMode('parts');
  panel.selectAssemblyRow(0);
  panel.openAssemblyRecipe(0);
  const fixedType = createEditor();
  assert.equal(workspace.activeDialog.value.mode, 'parts');
  assert.equal(fixedType.recipeDraft.packingType, 'Workpiece');
  assert.equal(station.assemblyRecipes[0].packingType, 'AGV');
  fixedType.saveBomRecipe();
  assert.equal(station.assemblyRecipes[0].packingType, 'Workpiece');

  panel.deleteAssemblyRecipe();
  assert.equal(station.assemblyRecipes.length, 0);
});

test('changing assembly mode preserves the visible type of legacy recipes', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleComponentPlaced, handleUpdateComponentProperties');
  for (const [id, x, previous, next, expected] of [
    ['old-container', 10, 'container', 'parts', 'AGV'],
    ['old-part', 15, 'parts', 'container', 'Workpiece'],
  ]) {
    workspace.handleComponentPlaced(buffer({id, x, type: 'assemblyWorkstation', assemblyMode: previous,
      assemblyRecipes: [{containerType: 'AGV'}]}));
    workspace.handleUpdateComponentProperties({id, assemblyMode: next});
    const station = workspace.placedComponents.value.find(item => item.id === id);
    assert.equal(station.assemblyRecipes[0].packingType, expected);
  }
});

test('disassembly station saves its own unit count, mode and selectable BOM rows', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, activeDialog, dialogItem, openDialog, saveDialog, handleComponentPlaced, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'split', type: 'disassemblyWorkstation'}));
  const station = workspace.placedComponents.value[0];
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: station}),
    defineEmits: () => (event, payload) => {
      if (event === 'open-dialog') workspace.openDialog(payload);
      else workspace.handleUpdateComponentProperties(payload);
    },
  }, 'disassemblyUnitCount, handleDisassemblyUnitCountChange, selectDisassemblyRow, openDisassemblyRecipe, deleteDisassemblyRecipe');
  assert.equal(panel.disassemblyUnitCount.value, 1);
  assert.equal(station.disassemblyMode, 'parts');
  assert.equal(station.disassemblyRecipes.length, 0);
  panel.handleDisassemblyUnitCountChange({target: {value: '3'}});
  const invalid = {target: {value: '1.5'}};
  panel.handleDisassemblyUnitCountChange(invalid);
  assert.equal(invalid.target.value, '3');
  assert.equal(station.disassemblyUnitCount, 3);

  const createEditor = () => {
    const active = workspace.activeDialog.value;
    return loadComponent('Dialog', {
      defineProps: () => ({item: workspace.dialogItem.value, dialogType: active.dialogType,
        disassemblyRecipe: active.recipe, disassemblyMode: active.mode}),
      defineEmits: () => (event, payload) => {
        if (event === 'save') workspace.saveDialog(payload);
        else if (event === 'close') workspace.activeDialog.value = null;
      },
      window: {innerWidth: 1280, innerHeight: 800}, systemInputIcon: '',
    }, 'recipeDraft, bomObjectLabel, bomError, addMaterialRow, deleteMaterialRow, saveBomRecipe, formatBomDuration, emit');
  };
  panel.openDisassemblyRecipe(null);
  const editor = createEditor();
  assert.equal(editor.bomObjectLabel.value, '部件');
  assert.equal(editor.recipeDraft.disassemblyTime, '5:0');
  assert.equal(editor.recipeDraft.setupTime, '0:0');
  editor.recipeDraft.productType = ' Kit ';
  editor.recipeDraft.name = ' 组合件 ';
  assert.match(editor.bomError.value, /至少编辑一行拆卸零件/);
  editor.saveBomRecipe();
  assert.equal(station.disassemblyRecipes.length, 0);
  editor.recipeDraft.disassemblyTime = '30';
  editor.formatBomDuration('disassemblyTime');
  assert.equal(editor.recipeDraft.disassemblyTime, '0:30');
  editor.addMaterialRow();
  const material = editor.recipeDraft.materials[0];
  assert.equal(material.fillColor, '#000000');
  material.partType = ' Bolt ';
  editor.saveBomRecipe();
  assert.match(editor.bomError.value, /零件数量/);
  assert.equal(station.disassemblyRecipes.length, 0);
  Object.assign(material, {quantity: 2, fillColor: '#123456'});
  editor.saveBomRecipe();
  assert.equal(station.disassemblyRecipes[0].productType, 'Kit');
  assert.equal(station.disassemblyRecipes[0].name, '组合件');
  assert.equal(station.disassemblyRecipes[0].disassemblyTime, 30);
  const savedMaterial = station.disassemblyRecipes[0].materials[0];
  assert.deepEqual({...savedMaterial}, {partType: 'Bolt', quantity: 2, name: '', fillColor: '#123456'});

  workspace.handleUpdateComponentProperties({id: 'split', disassemblyMode: 'container'});
  panel.selectDisassemblyRow(0);
  panel.openDisassemblyRecipe(0);
  const cancelled = createEditor();
  assert.equal(cancelled.bomObjectLabel.value, '容器');
  cancelled.recipeDraft.materials[0].fillColor = '#ff0000';
  cancelled.emit('close');
  assert.equal(station.disassemblyRecipes[0].materials[0].fillColor, '#123456');
  panel.openDisassemblyRecipe(0);
  const edit = createEditor();
  edit.addMaterialRow();
  edit.deleteMaterialRow();
  edit.recipeDraft.materials.pop();
  assert.equal(edit.bomError.value, '', 'a container rule may unload all parts with an empty list');
  edit.saveBomRecipe();
  assert.equal(station.disassemblyRecipes.length, 1);
  assert.equal(station.disassemblyRecipes[0].materials.length, 0);
  panel.deleteDisassemblyRecipe();
  assert.equal(station.disassemblyRecipes.length, 0);
});

test('workstations initialize fixed durations and preserve supplied values', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleComponentPlaced');
  workspace.handleComponentPlaced(buffer({id: 'machine-1', type: 'workstation'}));
  workspace.handleComponentPlaced(buffer({id: 'machine-2', x: 15, type: 'workstation', processingTime: 0, setupTime: 1.005}));
  const [first, second] = workspace.placedComponents.value;
  assert.equal(first.processingTime, 60);
  assert.equal(first.setupTime, 0);
  assert.equal(second.processingTime, 0);
  assert.equal(second.setupTime, 1.005);
});

test('parallel workstation properties initialize defaults, validate edits and preserve unique equipment IDs', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleComponentPlaced, handleUpdateComponentProperties');
  workspace.handleComponentPlaced(buffer({id: 'parallel-1', type: 'parallelWorkstation'}));
  workspace.handleComponentPlaced(buffer({id: 'parallel-2', x: 15, type: 'parallelWorkstation', equipmentCount: 4}));
  const [first, second] = workspace.placedComponents.value;
  assert.equal(first.equipmentCount, 1);
  assert.equal(first.processingTime, 60);
  assert.equal(first.setupTime, 0);
  const originalId = first.equipmentIds[0];
  const props = vue.reactive({selectedItem: first});
  let updates = 0;
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => props,
    defineEmits: () => (event, value) => { updates++; workspace.handleUpdateComponentProperties(value); },
  }, 'parallelWorkstationProperties, handleEquipmentCountChange, handleWorkstationTimeChange');
  panel.handleEquipmentCountChange({target: {value: '4'}});
  assert.equal(first.equipmentIds.length, 4);
  assert.equal(first.equipmentIds[0], originalId);
  assert.equal(new Set([...first.equipmentIds, ...second.equipmentIds]).size, 8);
  panel.handleEquipmentCountChange({target: {value: '4'}});
  assert.equal(updates, 1, 'blur does not commit the same count twice');
  for (const raw of ['', '0', '-1', '1.5', 'Infinity', '9007199254740992']) {
    const event = {target: {value: raw}};
    panel.handleEquipmentCountChange(event);
    assert.equal(event.target.value, '4');
    workspace.handleUpdateComponentProperties({id: first.id, equipmentCount: Number(raw)});
    assert.equal(first.equipmentCount, 4);
  }
  panel.handleWorkstationTimeChange('processingTime', {target: {value: '1:2:3:4.005'}});
  panel.handleWorkstationTimeChange('setupTime', {target: {value: '0:0.001'}});
  assert.equal(first.processingTime, 93784.005);
  assert.equal(first.setupTime, .001);
  const invalid = {target: {value: '-1'}};
  panel.handleWorkstationTimeChange('setupTime', invalid);
  assert.equal(invalid.target.value, '0:0.001');
  const removedIds = Array.from(first.equipmentIds.slice(1));
  panel.handleEquipmentCountChange({target: {value: '1'}});
  panel.handleEquipmentCountChange({target: {value: '4'}});
  assert.equal(first.equipmentIds[0], originalId);
  assert.ok(first.equipmentIds.slice(1).every(id => !removedIds.includes(id)));
  const restored = JSON.parse(JSON.stringify(first));
  workstationProperties.ensureParallelWorkstationEquipment(restored);
  assert.deepEqual(Array.from(restored.equipmentIds), Array.from(first.equipmentIds));
  props.selectedItem = second;
  assert.equal(panel.parallelWorkstationProperties.value.processingTime, 60);
  assert.equal(panel.parallelWorkstationProperties.value.setupTime, 0);
  const file = path.resolve(__dirname, '../src/components/PropertyPanel.vue');
  const {descriptor} = parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(compileTemplate({source: descriptor.template.content, filename: file, id: 'parallel-properties'}).errors, []);
});

test('workstation time edits preserve milliseconds, allow zero and stay with the selected device', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  const first = buffer({id: 'machine-1', type: 'workstation'});
  const second = buffer({id: 'machine-2', type: 'workstation'});
  workspace.placedComponents.value.push(first, second);
  const props = vue.reactive({selectedItem: workspace.placedComponents.value[0]});
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => props,
    defineEmits: () => (event, value) => workspace.handleUpdateComponentProperties(value),
  }, 'workstationProperties, handleWorkstationTimeChange');
  assert.equal(panel.workstationProperties.value.processingTime, 60);
  assert.equal(panel.workstationProperties.value.setupTime, 0);
  for (const [field, text, seconds] of [
    ['processingTime', '01:02:03:04.005', 93784.005], ['setupTime', '1:0.123', 60.123], ['processingTime', '0', 0],
  ]) {
    const event = {target: {value: text}};
    panel.handleWorkstationTimeChange(field, event);
    assert.equal(props.selectedItem[field], seconds);
    assert.equal(inputRules.parseGenerationInterval(event.target.value, {allowZero: true}), seconds);
  }
  props.selectedItem = workspace.placedComponents.value[1];
  assert.equal(panel.workstationProperties.value.processingTime, 60);
  assert.equal(panel.workstationProperties.value.setupTime, 0);
  panel.handleWorkstationTimeChange('setupTime', {target: {value: '0.001'}});
  assert.equal(props.selectedItem.setupTime, .001);
  props.selectedItem = workspace.placedComponents.value[0];
  assert.equal(panel.workstationProperties.value.processingTime, 0);
  assert.equal(panel.workstationProperties.value.setupTime, 60.123);
});

test('invalid workstation times restore the saved value and cannot change other component types', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(buffer({id: 'machine', type: 'workstation', processingTime: 60, setupTime: 0}));
  const props = vue.reactive({selectedItem: workspace.placedComponents.value[0]});
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => props,
    defineEmits: () => (event, value) => workspace.handleUpdateComponentProperties(value),
  }, 'handleWorkstationTimeChange');
  for (const text of ['', '-1', 'NaN', 'Infinity', '1:60', '1:24:0:0', '1:2:3:4:5', '0.0001', '9007199254740992']) {
    const event = {target: {value: text}};
    panel.handleWorkstationTimeChange('processingTime', event);
    assert.equal(event.target.value, '1:0', text);
    assert.equal(props.selectedItem.processingTime, 60);
  }
  for (const value of [-1, NaN, Infinity, '60', Number.MAX_VALUE]) {
    workspace.handleUpdateComponentProperties({id: 'machine', processingTime: value});
    assert.equal(props.selectedItem.processingTime, 60);
  }
  props.selectedItem.type = 'buffer';
  panel.handleWorkstationTimeChange('processingTime', {target: {value: '2:0'}});
  workspace.handleUpdateComponentProperties({id: 'machine', processingTime: 120});
  assert.equal(props.selectedItem.processingTime, 60);
  assert.ok(Number.isNaN(inputRules.parseGenerationInterval('0')), 'input intervals still reject zero');
});

test('port offsets are validated, clamped independently on resize and rotated with the component', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(
    {id: 'machine', type: 'workstation', x: -3, y: -2, width: 6, height: 4},
    {id: 'source', type: 'systemInput', x: -10, y: 0, width: 3, height: 3},
    {id: 'sink', type: 'systemOutput', x: 10, y: 0, width: 3, height: 3},
  );
  const [machine, source, sink] = workspace.placedComponents.value;
  const props = vue.reactive({selectedItem: machine});
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => props,
    defineEmits: () => (_, update) => workspace.handleUpdateComponentProperties(update),
  }, 'componentPorts, handlePortCoordinateChange, portError, handleDimensionChange, rotateSelectedComponent');
  const ports = () => Array.from(panel.componentPorts.value, ({key, offset}) => [key, offset.x, offset.y]);
  assert.deepEqual(ports(), [['loadPoint', -3, 0], ['unloadPoint', 3, 0]]);
  const edit = (key, axis, value) => {
    const target = {value};
    panel.handlePortCoordinateChange(key, axis, {target});
    return target.value;
  };
  assert.equal(edit('loadPoint', 'x', '-2.25'), '-2.25');
  assert.equal(edit('loadPoint', 'y', '1.75'), '1.75');
  assert.equal(edit('loadPoint', 'y', '2.01'), '1.75');
  assert.match(panel.portError.value, /上料点 Y.*-2 至 2/);
  assert.equal(edit('unloadPoint', 'x', '1'), '1');
  assert.equal(panel.portError.value, '');
  panel.handleDimensionChange('width', {target: {value: '4'}});
  assert.deepEqual(ports(), [['loadPoint', -2, 1.75], ['unloadPoint', 1, 0]]);
  panel.handleDimensionChange('width', {target: {value: '8'}});
  assert.deepEqual(ports(), [['loadPoint', -2, 1.75], ['unloadPoint', 1, 0]]);
  panel.rotateSelectedComponent(1);
  assert.deepEqual(ports(), [['loadPoint', 1.75, 2], ['unloadPoint', 0, -1]]);
  assert.equal(edit('loadPoint', 'y', '4'), '4');
  panel.handleDimensionChange('width', {target: {value: '2'}});
  assert.deepEqual(ports(), [['loadPoint', 1, 4], ['unloadPoint', 0, -1]]);
  assert.deepEqual({...stations.getComponentCenter(machine)}, {x: 0, y: 0});
  props.selectedItem = source;
  assert.deepEqual(ports(), [['unloadPoint', 1.5, 0]]);
  props.selectedItem = sink;
  assert.deepEqual(ports(), [['loadPoint', -1.5, 0]]);
});

test('connection lines and canvas rings use the same unloading and loading points', (t) => {
  const from = {id: 'from', type: 'systemInput', x: 0, y: 0, width: 4, height: 4, unloadPoint: {x: 1, y: 1}};
  const to = {id: 'to', type: 'systemOutput', x: 10, y: 0, width: 4, height: 4, loadPoint: {x: -1, y: -2}};
  const link = {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to'};
  const canvas = createCanvas([from, to, link]);
  t.after(() => canvas.dispose());
  const route = connectionGeometry.getConnectionGeometry(link, [from, to]);
  assert.deepEqual({...route.start}, {x: 3, y: 3});
  assert.deepEqual({...route.end}, {x: 11, y: 0});
  near(route.length, Math.hypot(8, 3));
  assert.equal(connectionGeometry.getConnectionGeometry({...link, fromId: 'to', toId: 'from'}, [from, to]), null);

  const rings = [];
  const ctx = canvas.element.getContext();
  let arc = null;
  ctx.beginPath = () => { arc = null; };
  ctx.arc = (x, y, radius) => { arc = {x, y, radius}; };
  ctx.stroke = () => { if (arc) rings.push({...arc, color: ctx.strokeStyle}); };
  canvas.api.drawGridNow();
  const endpoints = canvas.api.resolveLineEndpoints(link);
  assert.deepEqual(rings, [
    {...endpoints.start, radius: 4, color: '#dc2626'},
    {...endpoints.end, radius: 4, color: '#16a34a'},
  ]);
});

test('a connection using offsets set at the centers keeps its length when resized around those centers', () => {
  const from = buffer({id: 'from', x: -53, y: -14, width: 100, height: 20});
  const to = buffer({id: 'to', x: -.5, y: -40, width: 1, height: 80});
  const line = {type: 'connectionLine', fromId: 'from', toId: 'to'};
  near(connectionGeometry.getConnectionGeometry(line, [from, to]).length, 5);
  from.width = 200;
  from.x -= 50;
  to.height = 500;
  to.y -= 210;
  near(connectionGeometry.getConnectionGeometry(line, [from, to]).length, 5);
  assert.equal(connectionGeometry.getConnectionGeometry(line, [from]), null);
});

test('connection angle follows the positive X and Y axes and preserves equivalent signed angles', () => {
  const from = {id: 'from', x: 0, y: 0};
  const to = {id: 'to', x: 1, y: 0};
  const line = {type: 'connectionLine', fromId: 'from', toId: 'to'};
  for (const [x, y, angle] of [[1, 0, 0], [0, 1, 90], [-1, 0, 180], [0, -1, -90]]) {
    Object.assign(to, {x, y});
    near(connectionGeometry.getConnectionGeometry(line, [from, to]).angle, angle);
  }
  line.angle = 270;
  near(connectionGeometry.getConnectionGeometry(line, [from, to]).angle, 270);
  Object.assign(to, {x: 1, y: 1});
  near(connectionGeometry.getConnectionGeometry(line, [from, to]).angle, 45);
});

test('the floating radius editor stays with its corner and can consume the full shared straight', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, activeDialog, dialogItem, dialogConnectionCorner, openDialog, saveDialog');
  workspace.placedComponents.value.push(buffer({id: 'from', x: -1.5, y: -1.5}), buffer({id: 'to', x: 18.5, y: 8.5}),
    {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to', waypoints: [{x: 8, y: 0}, {x: 8, y: 10}]});
  const line = workspace.placedComponents.value[2];
  const selectedItem = vue.ref(line);
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({get selectedItem() { return selectedItem.value; }, placedComponents: workspace.placedComponents.value}),
    defineEmits: () => (event, update) => {
      if (event === 'open-dialog') workspace.openDialog(update);
    },
  }, 'connectionGeometry, openConnectionRadius');
  const openRadius = row => {
    panel.openConnectionRadius(row);
    return loadComponent('Dialog', {
      defineProps: () => ({item: workspace.dialogItem.value, dialogType: workspace.activeDialog.value.dialogType,
        get connectionCorner() { return workspace.dialogConnectionCorner.value; }}),
      defineEmits: () => (event, payload) => {
        if (event === 'save') workspace.saveDialog(payload);
        if (event === 'close') workspace.activeDialog.value = null;
      },
      window: {innerWidth: 1280, innerHeight: 800}, systemInputIcon: '',
    }, 'radiusDraft, radiusValid, saveConnectionRadius, emit');
  };
  const rows = () => panel.connectionGeometry.value.rows;
  assert.deepEqual(Array.from(rows(), row => row.type), ['Line', 'Point', 'Line', 'Point', 'Line']);
  const first = openRadius(rows()[1]);
  assert.equal(first.radiusDraft.value, 0);
  first.radiusDraft.value = rows()[1].maxRadius;
  selectedItem.value = workspace.placedComponents.value[0];
  assert.equal(workspace.dialogItem.value.id, line.id);
  first.saveConnectionRadius();
  assert.equal(workspace.activeDialog.value, null);
  selectedItem.value = line;
  near(rows()[1].radius, 8);
  near(rows()[0].length, 0);
  const second = openRadius(rows()[3]);
  near(workspace.dialogConnectionCorner.value.maxRadius, 2);
  second.radiusDraft.value = 3;
  assert.equal(second.radiusValid.value, false);
  second.saveConnectionRadius();
  assert.equal(rows()[3].type, 'Point');
  second.radiusDraft.value = workspace.dialogConnectionCorner.value.maxRadius;
  second.saveConnectionRadius();
  assert.deepEqual(Array.from(rows(), row => row.type), ['Line', 'Arc', 'Line', 'Arc', 'Line']);
  near(rows()[2].length, 0);
  assert.equal(rows()[2].angle, 90);
  assert.ok(rows().filter(row => row.type === 'Line').every(row => row.length >= 0));
  const cancel = openRadius(rows()[1]);
  near(cancel.radiusDraft.value, 8);
  cancel.radiusDraft.value = 0;
  cancel.emit('close');
  assert.equal(rows()[1].type, 'Arc');
  const reset = openRadius(rows()[1]);
  reset.radiusDraft.value = 0;
  reset.saveConnectionRadius();
  assert.equal(rows()[1].type, 'Point');
  assert.deepEqual({...rows()[1].point}, {x: 8, y: 0});
});

test('connection segment edits follow the chosen side and move components with their local ports', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, finiteCanvas, handleUpdateComponentProperties');
  workspace.finiteCanvas.value = {enabled: true, length: 60, width: 40};
  workspace.placedComponents.value.push(
    buffer({id: 'from', x: -1.5, y: -1.5, unloadPoint: {x: 1, y: 0}}),
    buffer({id: 'to', x: 18.5, y: 8.5, loadPoint: {x: -1, y: 0}}),
    {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to', affectedEndpoint: 'from',
      waypoints: [{x: 8, y: 0}, {x: 8, y: 10}], cornerRadii: [2, 1]});
  const [from, to, line] = workspace.placedComponents.value;
  const route = () => connectionGeometry.getConnectionGeometry(line, workspace.placedComponents.value);
  const edit = (index, fields) => workspace.handleUpdateComponentProperties({id: line.id, connectionSegment: {index, ...fields}});
  const initialLength = route().rows[0].length;
  edit(0, {length: 200});
  near(route().rows[0].length, initialLength);
  near(from.x, -1.5);
  edit(0, {length: 4});
  assert.equal(line.affectedEndpoint, 'from');
  near(route().rows[0].length, 4);
  assert.equal(route().rows[0].angle, 0);
  near(from.x, -0.5);
  assert.deepEqual({...from.unloadPoint}, {x: 1, y: 0});
  assert.deepEqual({...line.waypoints[0]}, {x: 8, y: 0});
  assert.deepEqual({...line.waypoints[1]}, {x: 8, y: 10});
  const lastLength = route().rows[4].length;
  workspace.handleUpdateComponentProperties({id: line.id, affectedEndpoint: 'to'});
  edit(2, {angle: 30});
  assert.equal(line.affectedEndpoint, 'to');
  near(route().rows[4].angle, 30);
  near(route().rows[4].length, lastLength);
  assert.notEqual(to.y, 8.5);
  assert.deepEqual({...to.loadPoint}, {x: -1, y: 0});
  assert.deepEqual({...line.waypoints[1]}, {x: 8, y: 10});
  const end = {...route().end};
  edit(1, {length: 5});
  near(route().rows[2].length, 5);
  assert.deepEqual({...line.waypoints[0]}, {x: 8, y: 0});
  assert.notEqual(line.waypoints[1].y, 10);
  near(route().start.x, 2);
  assert.deepEqual({...route().end}, end);
});

test('the shared parameter editor changes AGV waypoints and drawn arcs while keeping station links', () => {
  const workspace = loadComponent('WorkspaceLayout', {},
    'placedComponents, openDialog, activeDialog, dialogItem, dialogConnectionCorner, saveDialog, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(
    {id: 'start', type: 'node', x: 0, y: 0}, {id: 'end', type: 'node', x: 20, y: 10},
    {id: 'route', type: 'AGVpath', fromId: 'start', toId: 'end', affectedEndpoint: 'from',
      nodes: [{x: 0, y: 0}, {x: 8, y: 0}, {x: 20, y: 10}]},
  );
  const [start, end, route] = workspace.placedComponents.value;
  const panel = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: route, placedComponents: workspace.placedComponents.value}),
    defineEmits: () => (event, update) => {
      if (event === 'open-dialog') workspace.openDialog(update);
      if (event === 'update-component-properties') workspace.handleUpdateComponentProperties(update);
    },
  }, 'connectionGeometry, connectionCellEdit, startConnectionCellEdit, saveConnectionCellEdit, openConnectionRadius');
  const rows = () => panel.connectionGeometry.value.rows;
  panel.startConnectionCellEdit(rows()[0], 'length');
  panel.connectionCellEdit.value.value = '10';
  panel.saveConnectionCellEdit();
  near(rows()[0].length, 10);
  assert.equal(route.affectedEndpoint, 'from');
  assert.deepEqual({x: start.x, y: start.y}, {x: -2, y: 0});
  assert.deepEqual({...route.nodes[1]}, {x: 8, y: 0});
  workspace.handleUpdateComponentProperties({id: route.id, affectedEndpoint: 'to'});
  panel.startConnectionCellEdit(rows()[2], 'angle');
  panel.connectionCellEdit.value.value = '90';
  panel.saveConnectionCellEdit();
  near(rows()[2].angle, 90);
  assert.equal(route.affectedEndpoint, 'to');
  near(end.x, 8);
  near(end.y, Math.hypot(12, 10));
  assert.deepEqual({...route.nodes[1]}, {x: 8, y: 0});
  assert.deepEqual({...route.nodes[0]}, {x: start.x, y: start.y});
  assert.deepEqual({...route.nodes[2]}, {x: end.x, y: end.y});

  panel.openConnectionRadius(rows()[1]);
  const dialog = loadComponent('Dialog', {
    defineProps: () => ({item: workspace.dialogItem.value, dialogType: workspace.activeDialog.value.dialogType,
      connectionCorner: workspace.dialogConnectionCorner.value}),
    defineEmits: () => (event, payload) => { if (event === 'save') workspace.saveDialog(payload); },
    window: {innerWidth: 1280, innerHeight: 800}, systemInputIcon: '',
  }, 'isConnectionRadiusEditor, radiusDraft, saveConnectionRadius');
  assert.equal(dialog.isConnectionRadiusEditor.value, true);
  dialog.radiusDraft.value = 3;
  dialog.saveConnectionRadius();
  assert.equal(workspace.activeDialog.value, null);
  assert.equal(rows()[1].type, 'Arc');
  const drawn = agvGeometry.buildPathGeometry(route);
  near(drawn.find(segment => segment.type === 'arc').radius, 3);
  near(drawn.reduce((sum, segment) => sum + segment.length, 0), panel.connectionGeometry.value.length);

  workspace.placedComponents.value.push({id: 'straight', type: 'AGVpath', fromId: start.id, toId: end.id,
    nodes: [{x: start.x, y: start.y}, {x: end.x, y: end.y}]});
  workspace.handleUpdateComponentProperties({id: 'straight', affectedEndpoint: 'from'});
  workspace.handleUpdateComponentProperties({id: 'straight', connectionSegment: {index: 0, length: 15, angle: 0}});
  assert.deepEqual({x: start.x, y: start.y}, {x: end.x - 15, y: end.y});
  near(end.x, 8);
  near(end.y, Math.hypot(12, 10));
  assert.deepEqual({...route.nodes[0]}, {x: start.x, y: start.y});
});

test('editing connection length or angle moves only its endpoint and speed is stored independently', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties, handleComponentPlaced');
  workspace.placedComponents.value.push(
    buffer({id: 'from', x: 0, y: 0}), buffer({id: 'to', x: 3, y: 4}), buffer({id: 'other', x: 20, y: 30}),
  );
  workspace.handleComponentPlaced({id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to'});
  const [from, to, other, line] = workspace.placedComponents.value;
  assert.equal(line.workpieceSpeed, 1);
  assert.equal(line.affectedEndpoint, 'to');
  workspace.handleUpdateComponentProperties({id: 'line', length: 10});
  near(to.x, 6); near(to.y, 8);
  workspace.handleUpdateComponentProperties({id: 'line', angle: 90});
  near(to.x, 0); near(to.y, 10);
  workspace.handleUpdateComponentProperties({id: 'line', angle: -360});
  near(to.x, 10); near(to.y, 0);
  assert.equal(connectionGeometry.getConnectionGeometry(line, workspace.placedComponents.value).angle, -360);
  workspace.handleUpdateComponentProperties({id: 'line', workpieceSpeed: 2.5});
  assert.equal(line.workpieceSpeed, 2.5);
  assert.equal(from.x, 0); assert.equal(from.y, 0);
  assert.equal(other.x, 20); assert.equal(other.y, 30);
});

test('choosing the start endpoint preserves line direction and fixes the end center for unequal component sizes', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(
    buffer({id: 'from', x: 0, y: 0, width: 2, height: 4}),
    buffer({id: 'to', x: 5, y: 6, width: 4, height: 8}),
    {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to'},
    {id: 'other-line', type: 'connectionLine', fromId: 'from', toId: 'to'},
  );
  const [from, to, line, otherLine] = workspace.placedComponents.value;
  const props = vue.reactive({selectedItem: line, placedComponents: workspace.placedComponents.value});
  const properties = loadComponent('PropertyPanel', {defineProps: () => props}, 'connectionAffectedEndpoint');
  assert.equal(properties.connectionAffectedEndpoint.value, 'to');
  workspace.handleUpdateComponentProperties({id: 'line', affectedEndpoint: 'from'});
  assert.equal(properties.connectionAffectedEndpoint.value, 'from');
  near(from.x, 0); near(from.y, 0);
  workspace.handleUpdateComponentProperties({id: 'line', length: 8});
  near(from.x, 1.2); near(from.y, 1.6);
  workspace.handleUpdateComponentProperties({id: 'line', angle: 90});
  near(from.x, 6); near(from.y, 0);
  workspace.handleUpdateComponentProperties({id: 'line', angle: -360});
  near(from.x, -2); near(from.y, 8);
  workspace.handleUpdateComponentProperties({id: 'line', length: 0});
  near(from.x, -2); near(from.y, 8);
  workspace.handleUpdateComponentProperties({id: 'line', length: 3});
  near(from.x, 3); near(from.y, 8);
  workspace.handleUpdateComponentProperties({id: 'line', workpieceSpeed: 4});
  assert.equal(line.workpieceSpeed, 4);
  near(from.x, 3); near(from.y, 8);
  near(to.x, 5); near(to.y, 6);
  workspace.handleUpdateComponentProperties({id: 'line', affectedEndpoint: 'invalid'});
  assert.equal(line.affectedEndpoint, 'from');
  props.selectedItem = otherLine;
  assert.equal(properties.connectionAffectedEndpoint.value, 'to');
  workspace.handleUpdateComponentProperties({id: 'line', affectedEndpoint: 'to', length: 6});
  near(from.x, 3); near(from.y, 8);
  near(to.x, 8); near(to.y, 6);
});

test('connection geometry edits reject invalid numbers and retain direction through zero length', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(buffer({id: 'from', x: 0, y: 0, unloadPoint: {x: 0, y: 1.5}}),
    buffer({id: 'to', x: 0, y: 5, loadPoint: {x: 0, y: -1.5}}),
    {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to'});
  const to = workspace.placedComponents.value[1];
  for (const change of [{length: -1}, {length: Infinity}, {angle: 361}, {angle: NaN}, {workpieceSpeed: -1}]) {
    workspace.handleUpdateComponentProperties({id: 'line', ...change});
    near(to.x, 0); near(to.y, 5);
  }
  workspace.handleUpdateComponentProperties({id: 'line', length: 0});
  near(to.x, 0); near(to.y, 3);
  workspace.handleUpdateComponentProperties({id: 'line', length: 7});
  near(to.x, 0); near(to.y, 10);
});

test('connection table edits a segment without rounding untouched values or issuing duplicate updates', () => {
  const workspace = loadComponent('WorkspaceLayout', {}, 'placedComponents, handleUpdateComponentProperties');
  workspace.placedComponents.value.push(buffer({id: 'from', x: 0, y: 0}), buffer({id: 'to', x: 1, y: 1}),
    {id: 'line', type: 'connectionLine', fromId: 'from', toId: 'to'});
  const events = [];
  const properties = loadComponent('PropertyPanel', {
    defineProps: () => ({selectedItem: workspace.placedComponents.value[2], placedComponents: workspace.placedComponents.value}),
    defineEmits: () => (_, update) => {
      events.push(update);
      workspace.handleUpdateComponentProperties(update);
    },
  }, 'connectionGeometry, connectionCellEdit, startConnectionCellEdit, saveConnectionCellEdit, handleConnectionPropertyChange');
  properties.startConnectionCellEdit(properties.connectionGeometry.value.rows[0], 'length');
  properties.saveConnectionCellEdit();
  assert.equal(events.length, 0);
  near(properties.connectionGeometry.value.length, Math.SQRT2);
  properties.startConnectionCellEdit(properties.connectionGeometry.value.rows[0], 'length');
  properties.connectionCellEdit.value.value = '10';
  properties.saveConnectionCellEdit();
  properties.saveConnectionCellEdit();
  assert.equal(events.length, 1);
  near(properties.connectionGeometry.value.length, 10);
  properties.handleConnectionPropertyChange('workpieceSpeed', {target: {value: '5'}});
  assert.equal(workspace.placedComponents.value[2].workpieceSpeed, 5);
});

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

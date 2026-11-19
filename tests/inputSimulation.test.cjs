const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require('vue');
const {parse} = require('@vue/compiler-sfc');

const read = name => fs.readFileSync(path.resolve(__dirname, '../src', name), 'utf8');
const rules = vm.runInNewContext(read('utils/inputRules.js').replace(/export (const|function) /g, '$1 ') +
    '\n;({INPUT_PROPERTY_DEFAULTS,getInputRuleValidationMessage,sampleInputRule,getDefaultWorkpieceDimensions})');
const getComponentCenter = vm.runInNewContext(read('utils/stations.js').replace(/export const /g, 'const ') + '\n;getComponentCenter');
const connection = vm.runInNewContext(read('utils/connectionLine.js').replace(/^import .*;\r?$/gm, '')
    .replace(/export (const|function) /g, '$1 ') + '\n;({getConnectionGeometry,DEFAULT_WORKPIECE_SPEED})', {getComponentCenter});
const {createInputSimulation} = vm.runInNewContext(read('utils/inputSimulation.js')
    .replace(/^import .*;\r?$/gm, '').replace('export function ', 'function ') + '\n;({createInputSimulation})', {
    ...rules,
    ...connection,
    DEFAULT_COMPONENT_SIZES: {systemInput: {width: 3, height: 3}},
    getComponentLabel: input => `${input.name}${input.index}`,
});
const input = (id, overrides = {}) => ({
    id, type: 'systemInput', name: '输入', index: id, x: 10, y: 20, width: 3, height: 3,
    ...rules.INPUT_PROPERTY_DEFAULTS,
    inputRuleRows: [{partType: 'Part1', name: '零件', fillColor: '#22c55e', relativeWeight: 100}],
    ...overrides,
});

test('isolated input generates at time zero, uses physical dimensions and stacks with red borders', () => {
    const simulation = createInputSimulation(() => 0);
    const source = input('a', {width: 6, height: 3});
    assert.equal(simulation.advanceTo(0, [source]), true);
    assert.equal(simulation.workpieces.length, 1);
    const first = simulation.workpieces[0];
    assert.equal(first.sourceId, 'a');
    assert.equal(first.sourceName, '输入a');
    assert.equal(first.sequence, 1);
    assert.equal(first.width, 4);
    assert.equal(first.height, 1);
    assert.equal(first.x, 6);
    assert.equal(first.y, 21);
    assert.equal(first.borderColor, '#ff0000');
    simulation.advanceTo(60000, [source]);
    assert.equal(simulation.workpieces.length, 2);
    assert.equal(simulation.workpieces[1].sequence, 2);
    assert.equal(simulation.workpieces[1].generatedAt, 60);
    assert.ok(first.x > simulation.workpieces[1].x);
});

test('all input units use independent intervals, first times, limits and sequences', () => {
    const simulation = createInputSimulation();
    const sources = [input('a', {generationInterval: 1, maxOutputCount: 3}),
        input('b', {generationInterval: 2, firstGenerationTime: 1, maxOutputCount: 2})];
    simulation.advanceTo(0, sources);
    assert.equal(simulation.workpieces.length, 1);
    simulation.advanceTo(10000, sources);
    assert.deepEqual(Array.from(simulation.workpieces.filter(part => part.sourceId === 'a'), part => part.generatedAt), [0, 1, 2]);
    assert.deepEqual(Array.from(simulation.workpieces.filter(part => part.sourceId === 'b'), part => part.generatedAt), [1, 3]);
    assert.equal(new Set(simulation.workpieces.map(part => part.id)).size, 5);
    assert.equal(simulation.advanceTo(10000, sources), false);
});

test('each isolated input caps its visible stack at 25 while keeping all generated workpieces', () => {
    const simulation = createInputSimulation();
    const sources = [input('a', {generationInterval: 1, maxOutputCount: 30}),
        input('b', {generationInterval: 1, maxOutputCount: 40})];
    simulation.advanceTo(24000, sources);
    const positions = simulation.workpieces.map(part => part.x);
    simulation.advanceTo(50000, sources);
    assert.equal(simulation.workpieces.length, 70);
    for (const [sourceId, total] of [['a', 30], ['b', 40]]) {
        const parts = simulation.workpieces.filter(part => part.sourceId === sourceId);
        const visible = parts.filter(part => !part.stackHidden);
        assert.equal(parts.length, total);
        assert.equal(visible.length, 25);
        assert.equal(visible.at(-1).stackCount, total);
        assert.equal(visible.at(-1).sequence, 25);
    }
    assert.deepEqual(Array.from(simulation.workpieces.slice(0, 50), part => part.x), Array.from(positions));
});

test('closing time excludes events at and after closure and zero limits output nothing', () => {
    const simulation = createInputSimulation();
    simulation.advanceTo(10000, [input('a', {generationInterval: .25, inputCloseEnabled: true, inputCloseTime: 1}),
        input('b', {maxOutputCount: 0}), input('c', {inputCloseEnabled: true, inputCloseTime: 0})]);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.generatedAt), [0, .25, .5, .75]);
});

test('rule weights choose workpiece attributes and invalid or empty rules produce nothing', () => {
    const simulation = createInputSimulation(() => .75);
    const source = input('a', {inputRuleRows: [
        {partType: 'A', name: '甲', fillColor: '#112233', relativeWeight: 1},
        {partType: 'B', name: '乙', fillColor: '#abcdef', relativeWeight: 3},
    ]});
    simulation.advanceTo(0, [source, input('b', {inputRuleRows: []}), input('c', {generationInterval: 0})]);
    assert.equal(simulation.workpieces.length, 1);
    assert.equal(simulation.workpieces[0].partType, 'B');
    assert.equal(simulation.workpieces[0].name, '乙');
    assert.equal(simulation.workpieces[0].fillColor, '#abcdef');
});

test('connected inputs spawn their center on the line start and attach to the line', () => {
    const simulation = createInputSimulation();
    simulation.advanceTo(0, [input('a'), {id: 'b', type: 'systemOutput', x: 20, y: 20, width: 3, height: 3},
        {id: 'line', type: 'connectionLine', fromId: 'a', toId: 'b'}]);
    assert.equal(simulation.workpieces.length, 1);
    assert.equal(simulation.workpieces[0].x, 10.5);
    assert.equal(simulation.workpieces[0].position.x, 11.5);
    assert.equal(simulation.workpieces[0].position.y, 21.5);
    assert.equal(simulation.workpieces[0].attachedComponentId, 'line');
    assert.equal(simulation.workpieces[0].angle, 0);
    assert.equal(simulation.workpieces[0].status, 'moving');
});

const output = (overrides = {}) => ({id: 'out', type: 'systemOutput', x: 10, y: 30, width: 3, height: 3, ...overrides});
const line = (overrides = {}) => ({id: 'line', type: 'connectionLine', fromId: 'a', toId: 'out', workpieceSpeed: 2, ...overrides});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('workpieces move at line speed, rotate with the line and stop at the output center with zero angle', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {maxOutputCount: 1}), output(), line()];
    simulation.advanceTo(0, items);
    const part = simulation.workpieces[0];
    near(part.position.x, 11.5); near(part.position.y, 21.5);
    assert.equal(part.angle, 90);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(2000, items);
    near(part.position.y, 25.5);
    near(part.distanceTravelled, 4);
    assert.equal(part.attachedComponentId, 'line');
    simulation.advanceTo(5000, items);
    near(part.position.x, 11.5); near(part.position.y, 31.5);
    assert.equal(part.arrivedAt, 5);
    assert.equal(part.angle, 0);
    assert.equal(part.attachedComponentId, 'out');
    assert.equal(part.status, 'completed');
    assert.equal(simulation.isComplete(), true);
});

test('catch-up frames move each part only for the time elapsed after its own birth', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {maxOutputCount: 3, generationInterval: 1}), output({y: 120}), line()];
    simulation.advanceTo(1500, items);
    assert.equal(simulation.workpieces.length, 2);
    near(simulation.workpieces[0].distanceTravelled, 3);
    near(simulation.workpieces[1].distanceTravelled, 1);
    simulation.advanceTo(2500, items);
    assert.equal(simulation.workpieces.length, 3);
    near(simulation.workpieces[0].distanceTravelled, 5);
    near(simulation.workpieces[1].distanceTravelled, 3);
    near(simulation.workpieces[2].distanceTravelled, 1);
});

test('zero speed holds workpieces in transit and a speed change applies only to following time', () => {
    const simulation = createInputSimulation();
    const route = line({workpieceSpeed: 0});
    const items = [input('a', {maxOutputCount: 1}), output(), route];
    simulation.advanceTo(1000, items);
    near(simulation.workpieces[0].distanceTravelled, 0);
    assert.equal(simulation.isComplete(), false);
    route.workpieceSpeed = 2;
    simulation.advanceTo(2000, items);
    near(simulation.workpieces[0].distanceTravelled, 2);
});

test('motion uses true centers for unequal component sizes and follows a moved route while paused', () => {
    const simulation = createInputSimulation();
    const source = input('a', {width: 6, height: 2, maxOutputCount: 1});
    const target = output({x: 20, y: 20, width: 8, height: 2});
    const items = [source, target, line()];
    simulation.advanceTo(2000, items);
    const part = simulation.workpieces[0];
    near(connection.getConnectionGeometry(items[2], items).length, 11);
    near(part.position.x, 17);
    near(part.position.y, 21);
    source.x += 5; target.x += 5;
    source.y += 3; target.y += 3;
    simulation.syncAttachments(items);
    near(part.position.x, 22); near(part.position.y, 24);
    near(part.distanceTravelled, 4);
});

test('destination piles cap visible pieces at 25 and retain source metadata and zero resting angles', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {maxOutputCount: 30, generationInterval: .1}), output(), line({workpieceSpeed: 100})];
    simulation.advanceTo(5000, items);
    assert.equal(simulation.workpieces.length, 30);
    const visible = simulation.workpieces.filter(part => !part.stackHidden);
    assert.equal(visible.length, 25);
    assert.equal(visible.at(-1).stackCount, 30);
    assert.ok(simulation.workpieces.every(part => part.sourceId === 'a' && part.attachedComponentId === 'out' && part.angle === 0));
    assert.equal(simulation.isComplete(), true);
});

test('a workpiece arriving at a station with a following route waits with angle zero', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {maxOutputCount: 1}), output({id: 'station', type: 'workstation'}), output({y: 50}),
        line({toId: 'station'}), line({id: 'next', fromId: 'station'})];
    simulation.advanceTo(5000, items);
    assert.equal(simulation.workpieces[0].status, 'waiting');
    assert.equal(simulation.workpieces[0].angle, 0);
    assert.equal(simulation.workpieces[0].attachedComponentId, 'station');
    assert.equal(simulation.isComplete(), false);
});

test('display mode converts millimeters to meters and switches existing stacks without changing actual dimensions', () => {
    const simulation = createInputSimulation();
    const source = input('a', {generationInterval: 1, maxOutputCount: 30, inputRuleRows: [
        {partType: 'Part1', name: '', length: 400, width: 150, fillColor: '#22c55e', relativeWeight: 100},
    ]});
    simulation.advanceTo(30000, [source]);
    const part = simulation.workpieces[24];
    assert.equal(part.width, 2);
    assert.equal(part.height, 1);
    assert.equal(part.actualLength, .4);
    assert.equal(part.actualWidth, .15);
    source.workpieceDisplayMode = 'actual';
    simulation.syncAttachments([source]);
    assert.equal(part.width, .4);
    assert.equal(part.height, .15);
    assert.equal(part.offsetX, -.4);
    assert.equal(part.stackCount, 30);
    assert.equal(simulation.workpieces.filter(item => !item.stackHidden).length, 25);
    source.workpieceDisplayMode = 'recommended';
    simulation.syncAttachments([source]);
    assert.equal(part.width, 2);
    assert.equal(part.actualLength, .4);
    assert.equal(part.x, source.x - 2);
});

test('new workpieces in actual display mode use the chosen rule dimensions', () => {
    const simulation = createInputSimulation(() => .9);
    const source = input('a', {workpieceDisplayMode: 'actual', inputRuleRows: [
        {partType: 'A', length: 100, width: 50, relativeWeight: 1},
        {partType: 'B', length: 800, width: 300, relativeWeight: 1},
    ]});
    simulation.advanceTo(0, [source]);
    assert.equal(simulation.workpieces[0].partType, 'B');
    assert.equal(simulation.workpieces[0].width, .8);
    assert.equal(simulation.workpieces[0].height, .3);
});

test('all attached workpieces including hidden stack entries follow their current owner', () => {
    const simulation = createInputSimulation();
    const first = input('a', {generationInterval: 1, maxOutputCount: 30});
    const second = input('b', {maxOutputCount: 1});
    simulation.advanceTo(30000, [first, second]);
    const original = simulation.workpieces.map(part => ({x: part.x, y: part.y}));
    first.x += 7;
    first.y -= 4;
    simulation.syncAttachments([first, second]);
    simulation.workpieces.forEach((part, index) => {
        assert.equal(part.attachedComponentId, part.sourceId);
        assert.ok(Math.abs(part.x - original[index].x - (part.sourceId === 'a' ? 7 : 0)) < 1e-8);
        assert.ok(Math.abs(part.y - original[index].y - (part.sourceId === 'a' ? -4 : 0)) < 1e-8);
    });
    const part = simulation.workpieces[0];
    const station = {id: 'station', type: 'workstation', x: 50, y: 60};
    part.attachedComponentId = station.id;
    part.offsetX = 1;
    part.offsetY = 2;
    simulation.syncAttachments([first, second, station]);
    assert.equal(part.sourceId, 'a');
    assert.equal(part.x, 51);
    assert.equal(part.y, 62);
});

test('deleted owners remove their attached workpieces without leaving orphan stacks', () => {
    const simulation = createInputSimulation();
    const source = input('a');
    simulation.advanceTo(0, [source]);
    simulation.syncAttachments([]);
    assert.equal(simulation.workpieces.length, 0);
});

test('completion waits for future input events and all moving, processing or waiting workpieces', () => {
    const simulation = createInputSimulation();
    const source = input('a', {firstGenerationTime: 3, generationInterval: 2, maxOutputCount: 2});
    simulation.advanceTo(0, [source]);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(3000, [source]);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(5000, [source]);
    assert.equal(simulation.isComplete(), true);
    for (const status of ['waiting', 'moving', 'processing']) {
        simulation.workpieces[0].status = status;
        assert.equal(simulation.isComplete(), false);
    }
    simulation.workpieces[0].status = 'completed';
    assert.equal(simulation.isComplete(), true);
});

test('reset clears workpieces and restarts per-input sequences with new unique IDs', () => {
    const simulation = createInputSimulation();
    const source = input('a');
    simulation.advanceTo(0, [source]);
    const oldId = simulation.workpieces[0].id;
    simulation.reset();
    assert.equal(simulation.workpieces.length, 0);
    simulation.advanceTo(0, [source]);
    assert.equal(simulation.workpieces[0].sequence, 1);
    assert.notEqual(simulation.workpieces[0].id, oldId);
});

test('workspace start, pause, resume, stop and reset drive the actual simulation clock', () => {
    let now = 0;
    let tick;
    const source = read('components/WorkspaceLayout.vue');
    const script = parse(source).descriptor.scriptSetup.content.replace(/^import .*\r?$/gm, '');
    const scope = vue.effectScope();
    const state = scope.run(() => vm.runInNewContext(script +
        '\n;({placedComponents,workpieces,handleClickControl,simulationSpeed,elapsedMilliseconds,simulationStatus})', {
        ...vue, ...rules, createInputSimulation,
        createBootstrapTooltipDirective: () => ({}),
        defineEmits: () => () => {}, defineExpose() {},
        onMounted() {}, onUnmounted() {}, onBeforeUnmount() {},
        performance: {now: () => now},
        window: {setInterval: callback => {tick = callback; return 1;}, clearInterval() {}},
    }));
    state.placedComponents.value.push(input('a', {generationInterval: 1}));
    assert.equal(state.simulationStatus.value, 'not-started');
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.simulationStatus.value, 'running');
    assert.equal(state.workpieces.value.length, 1);
    state.simulationSpeed.value = 2;
    now = 500;
    tick();
    assert.equal(state.workpieces.value.length, 2);
    state.handleClickControl({id: 'pause-simulation'});
    assert.equal(state.simulationStatus.value, 'paused');
    now = 10000;
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.simulationStatus.value, 'running');
    assert.equal(state.workpieces.value.length, 2);
    now = 10500;
    tick();
    assert.equal(state.workpieces.value.length, 3);
    state.handleClickControl({id: 'stop-simulation'});
    assert.equal(state.simulationStatus.value, 'stopped');
    state.handleClickControl({id: 'reset-simulation'});
    assert.equal(state.simulationStatus.value, 'not-started');
    assert.equal(state.workpieces.value.length, 0);
    assert.equal(state.elapsedMilliseconds.value, 0);
    scope.stop();
});

test('workspace auto-finishes, clears the timer and keeps attachments following after completion', async () => {
    let now = 0;
    let tick;
    let cleared = 0;
    const script = parse(read('components/WorkspaceLayout.vue')).descriptor.scriptSetup.content.replace(/^import .*\r?$/gm, '');
    const scope = vue.effectScope();
    const state = scope.run(() => vm.runInNewContext(script +
        '\n;({placedComponents,workpieces,handleClickControl,isSimulationRunning,isResetEnabled,elapsedMilliseconds,logs,simulationStatus})', {
        ...vue, ...rules, createInputSimulation,
        createBootstrapTooltipDirective: () => ({}), defineEmits: () => () => {}, defineExpose() {},
        onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, performance: {now: () => now},
        window: {setInterval: callback => {tick = callback; return 1;}, clearInterval: () => {cleared++;}},
    }));
    state.placedComponents.value.push(input('a', {generationInterval: 1, maxOutputCount: 2}));
    await vue.nextTick();
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.isSimulationRunning.value, true);
    now = 1000;
    tick();
    assert.equal(state.isSimulationRunning.value, false);
    assert.equal(state.simulationStatus.value, 'completed');
    assert.equal(state.isResetEnabled.value, true);
    assert.equal(cleared, 1);
    assert.equal(state.elapsedMilliseconds.value, 1000);
    assert.equal(state.workpieces.value.length, 2);
    const previousX = state.workpieces.value[0].x;
    state.placedComponents.value[0].x += 5;
    await vue.nextTick();
    assert.equal(state.workpieces.value[0].x, previousX + 5);
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.workpieces.value.length, 1);
    assert.equal(state.workpieces.value[0].sequence, 1);
    assert.equal(state.elapsedMilliseconds.value, 0);
    scope.stop();
});

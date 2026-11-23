const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require('vue');
const {parse} = require('@vue/compiler-sfc');

const read = name => fs.readFileSync(path.resolve(__dirname, '../src', name), 'utf8');
const rules = vm.runInNewContext(read('utils/inputRules.js').replace(/export (const|function) /g, '$1 ') +
    '\n;({getInputType,getInputRuleCategory,INPUT_PROPERTY_DEFAULTS,getInputRuleValidationMessage,sampleInputRule,getDefaultWorkpieceDimensions})');
const stations = vm.runInNewContext(read('utils/stations.js').replace(/export const /g, 'const ') +
    '\n;({getComponentCenter,getComponentFootprint,getComponentBounds,getComponentQuarterTurns})');
const RESIZABLE_COMPONENT_TYPES = vm.runInNewContext(read('utils/componentAppearance.js').replace(/export const /g, 'const ') +
    '\n;RESIZABLE_COMPONENT_TYPES');
const getComponentPortPosition = vm.runInNewContext(read('utils/componentPorts.js').replace(/^import .*;\r?$/gm, '')
    .replace(/export function /g, 'function ') + '\n;getComponentPortPosition', {...stations, RESIZABLE_COMPONENT_TYPES});
const pathGeometry = vm.runInNewContext(read('utils/agvPath.js').replace(/export const /g, 'const ') +
    '\n;({buildPathArc,getPathCorner,pointOnPathSegment})');
const connection = vm.runInNewContext(read('utils/connectionLine.js').replace(/^import .*;\r?$/gm, '')
    .replace(/export (const|function) /g, '$1 ') + '\n;({getConnectionGeometry,getPointOnConnection,DEFAULT_WORKPIECE_SPEED})', {...stations, getComponentPortPosition, ...pathGeometry});
const workstationProperties = vm.runInNewContext(read('utils/workstationProperties.js')
    .replace(/export (const|function) /g, '$1 ') + '\n;({WORKSTATION_PROPERTY_DEFAULTS,PARALLEL_WORKSTATION_PROPERTY_DEFAULTS,isValidWorkstationProperty,isValidParallelWorkstationProperty,ensureParallelWorkstationEquipment})');
const assemblyRecipes = vm.runInNewContext(read('utils/assemblyRecipes.js').replace(/export (const|function) /g, '$1 ') +
    '\n;({ASSEMBLY_TIME_TOLERANCE_MS,CONTAINER_TYPES,findAssemblyBatch,getAssemblyPackingType,getAssemblyUnitCount})');
const disassemblyRecipes = vm.runInNewContext(read('utils/disassemblyRecipes.js').replace(/export (const|function) /g, '$1 ') +
    '\n;({findDisassemblyRecipe,getDisassemblyUnitCount})');
const bufferProperties = vm.runInNewContext(read('utils/bufferProperties.js').replace(/export (const|function) /g, '$1 ') +
    '\n;({getBufferProperty})');
const {createInputSimulation} = vm.runInNewContext(read('utils/inputSimulation.js')
    .replace(/^import .*;\r?$/gm, '').replace('export function ', 'function ') + '\n;({createInputSimulation})', {
    ...rules,
    ...connection,
    ...workstationProperties,
    ...assemblyRecipes,
    ...disassemblyRecipes,
    ...bufferProperties,
    ...stations,
    DEFAULT_COMPONENT_SIZES: {systemInput: {width: 3, height: 3}},
    getComponentLabel: input => `${input.name}${input.index}`,
});
const centerPorts = {loadPoint: {x: 0, y: 0}, unloadPoint: {x: 0, y: 0}};
const input = (id, overrides = {}) => ({
    id, type: 'systemInput', name: '输入', index: id, x: 10, y: 20, width: 3, height: 3,
    ...rules.INPUT_PROPERTY_DEFAULTS,
    unloadPoint: {x: 0, y: 0},
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

test('a rotated input shifts its staged workpieces to the edge of the new footprint', () => {
    const simulation = createInputSimulation();
    const source = input('a', {x: 0, y: 0, width: 6, height: 2, maxOutputCount: 1});
    simulation.advanceTo(0, [source]);
    const part = simulation.workpieces[0];
    assert.equal(part.x + part.width, 0);
    source.quarterTurns = 1;
    assert.equal(simulation.syncAttachments([source]), true);
    assert.equal(part.x + part.width, 2);
    assert.equal(part.position.y, 1);
    assert.equal(part.width, 4);
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

test('input type controls generated entities while rules supply their categories', () => {
    const simulation = createInputSimulation();
    const sources = [
        input('default', {inputRuleRows: undefined, maxOutputCount: 1}),
        input('pallet', {inputType: 'Pallet', inputRuleRows: [{entityType: 'Workpiece', relativeWeight: 1}], maxOutputCount: 1}),
        input('vehicle', {inputType: 'Vehicle', inputRuleRows: [{partType: '车架', name: '牵引车', relativeWeight: 1}], maxOutputCount: 1}),
        input('invalid', {inputRuleRows: [{partType: ' ', relativeWeight: 1}], maxOutputCount: 1}),
    ];
    simulation.advanceTo(0, sources);
    assert.deepEqual(Array.from(simulation.workpieces, part => [part.partType, part.packingType, part.name]), [
        ['Workpiece', 'Workpiece', ''], ['Workpiece', 'Pallet', ''], ['车架', 'Vehicle', '牵引车'],
    ]);
});

test('connected inputs start at the default unloading point on their right edge', () => {
    const simulation = createInputSimulation();
    simulation.advanceTo(0, [input('a', {unloadPoint: undefined}), {id: 'b', type: 'systemOutput', x: 20, y: 20, width: 3, height: 3},
        {id: 'line', type: 'connectionLine', fromId: 'a', toId: 'b'}]);
    assert.equal(simulation.workpieces.length, 1);
    assert.equal(simulation.workpieces[0].x, 12);
    assert.equal(simulation.workpieces[0].position.x, 13);
    assert.equal(simulation.workpieces[0].position.y, 21.5);
    assert.equal(simulation.workpieces[0].attachedComponentId, 'line');
    assert.equal(simulation.workpieces[0].angle, 0);
    assert.equal(simulation.workpieces[0].status, 'moving');
});

const output = (overrides = {}) => ({id: 'out', type: 'systemOutput', x: 10, y: 30, width: 3, height: 3,
    ...centerPorts, ...overrides});
const line = (overrides = {}) => ({id: 'line', type: 'connectionLine', fromId: 'a', toId: 'out', workpieceSpeed: 2, ...overrides});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const bufferStation = (overrides = {}) => ({...output({x: 10, y: 0}), id: 'buffer', type: 'buffer', ...overrides});

test('buffer capacity includes in-transit parts and replenishes exactly one slot when each part departs', () => {
    const simulation = createInputSimulation();
    const items = [
        input('a', {x: 0, y: 0, generationInterval: 1, maxOutputCount: 5}),
        bufferStation({bufferCapacity: 2, minimumStayTime: 60}), output({x: 20, y: 0}),
        line({id: 'to-buffer', toId: 'buffer', workpieceSpeed: 1}),
        line({id: 'to-output', fromId: 'buffer', workpieceSpeed: 1}),
    ];
    const owners = () => Array.from(simulation.workpieces, part => part.attachedComponentId);
    simulation.advanceTo(2000, items);
    assert.deepEqual(owners(), ['to-buffer', 'to-buffer', 'a']);
    assert.equal(simulation.workpieces[2].status, 'stacked');
    near(simulation.workpieces[2].position.x, -1);
    simulation.advanceTo(10500, items);
    assert.deepEqual(owners(), ['buffer', 'to-buffer', 'a', 'a', 'a']);
    simulation.advanceTo(69999, items);
    assert.deepEqual(owners(), ['buffer', 'buffer', 'a', 'a', 'a']);
    simulation.advanceTo(70000, items);
    assert.deepEqual(owners(), ['to-output', 'buffer', 'to-buffer', 'a', 'a']);
    near(simulation.workpieces[2].position.x, 1.5);
    simulation.advanceTo(71000, items);
    assert.deepEqual(owners(), ['to-output', 'to-output', 'to-buffer', 'to-buffer', 'a']);
    simulation.advanceTo(220000, items);
    assert.deepEqual(owners(), ['out', 'out', 'out', 'out', 'out']);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.arrivedAt), [80, 81, 150, 151, 220]);
    const coarse = createInputSimulation();
    coarse.advanceTo(220000, items);
    assert.deepEqual(Array.from(coarse.workpieces, part => part.arrivedAt), [80, 81, 150, 151, 220]);
    assert.equal(simulation.isComplete(), true);
});

test('a full downstream buffer and a stopped exit hold upstream reservations until transportation resumes', () => {
    const simulation = createInputSimulation();
    const exit = line({id: 'exit', fromId: 'second', workpieceSpeed: 0});
    const items = [
        input('a', {x: 0, y: 0, maxOutputCount: 3, generationInterval: 1}),
        bufferStation({bufferCapacity: 1}), bufferStation({id: 'second', x: 20, bufferCapacity: 1, minimumStayTime: 4}),
        output({x: 30, y: 0}), line({id: 'first', toId: 'buffer', workpieceSpeed: 10}),
        line({id: 'between', fromId: 'buffer', toId: 'second', workpieceSpeed: 10}), exit,
    ];
    simulation.advanceTo(1500, items);
    assert.equal(simulation.workpieces[0].attachedComponentId, 'between');
    assert.equal(simulation.workpieces[1].attachedComponentId, 'first');
    simulation.advanceTo(8000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.attachedComponentId), ['second', 'buffer', 'a']);
    exit.workpieceSpeed = 10;
    simulation.advanceTo(8000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.attachedComponentId), ['exit', 'between', 'first']);
    simulation.advanceTo(19000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.arrivedAt), [9, 14, 19]);
});

test('a buffer accepts only its first added incoming line, with unlimited capacity and zero stay by default', () => {
    const simulation = createInputSimulation();
    const items = [
        input('a', {x: 0, y: 0, maxOutputCount: 3, firstGenerationTime: 2, generationInterval: .5}),
        input('b', {x: 0, y: 0, maxOutputCount: 1}), bufferStation(), output({x: 20, y: 0}),
        line({id: 'first', toId: 'buffer', workpieceSpeed: 1}),
        line({id: 'ignored', fromId: 'b', toId: 'buffer', workpieceSpeed: 10}),
        line({id: 'exit', fromId: 'buffer', workpieceSpeed: 10}),
    ];
    simulation.advanceTo(3000, items);
    assert.equal(simulation.workpieces.filter(part => part.attachedComponentId === 'first').length, 3);
    assert.equal(simulation.workpieces.find(part => part.sourceId === 'b').attachedComponentId, 'b');
    simulation.advanceTo(12000, items);
    assert.equal(simulation.workpieces.find(part => part.sourceId === 'a' && part.sequence === 1).attachedComponentId, 'exit');
    simulation.advanceTo(14000, items);
    assert.equal(simulation.workpieces.filter(part => part.attachedComponentId === 'out').length, 3);
    assert.equal(simulation.isComplete(), true);
});

test('a completed workstation operation keeps its workpiece until a buffer reservation is granted', () => {
    const simulation = createInputSimulation();
    const items = [
        input('a', {x: 0, y: 0, maxOutputCount: 2, generationInterval: .5}),
        {id: 'device', type: 'workstation', x: 10, y: 0, width: 3, height: 3, processingTime: 0, ...centerPorts},
        bufferStation({x: 20, bufferCapacity: 1, minimumStayTime: 2}), output({x: 30, y: 0}),
        line({id: 'into-device', toId: 'device', workpieceSpeed: 10}),
        line({id: 'into-buffer', fromId: 'device', toId: 'buffer', workpieceSpeed: 10}),
        line({id: 'exit', fromId: 'buffer', workpieceSpeed: 10}),
    ];
    simulation.advanceTo(1500, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.attachedComponentId), ['into-buffer', 'device']);
    assert.equal(simulation.getEquipmentStates('device')[0].records[1].departedAt, null);
    simulation.advanceTo(4000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.attachedComponentId), ['exit', 'into-buffer']);
    assert.equal(simulation.getEquipmentStates('device')[0].records[1].departedAt, 4);
});

test('parts travel between custom ports and a blocked departure stays at the workstation center', () => {
    const simulation = createInputSimulation();
    const items = [
        input('a', {x: 0, y: 0, maxOutputCount: 2, generationInterval: 2, unloadPoint: {x: 1.5, y: .5}}),
        workstation({setupTime: 0, processingTime: 1, loadPoint: {x: -1.5, y: .5}, unloadPoint: {x: 1.5, y: -.5}}),
        bufferStation({x: 20, bufferCapacity: 1, minimumStayTime: 3, loadPoint: {x: -1.5, y: -.5}, unloadPoint: undefined}),
        output({x: 30, y: 0, loadPoint: undefined}),
        line({id: 'entry', toId: 'machine', workpieceSpeed: 7}),
        line({id: 'into-buffer', fromId: 'machine', toId: 'buffer', workpieceSpeed: 7}),
        line({id: 'exit', fromId: 'buffer', workpieceSpeed: 7}),
    ];
    simulation.advanceTo(0, items);
    const first = simulation.workpieces[0];
    const position = part => [part.position.x, part.position.y];
    assert.deepEqual(position(first), [3, 2]);
    simulation.advanceTo(500, items);
    assert.deepEqual(position(first), [6.5, 2]);
    simulation.advanceTo(1000, items);
    assert.equal(first.status, 'processing');
    assert.equal(first.arrivedAt, 1);
    assert.deepEqual(position(first), [11.5, 1.5]);
    simulation.advanceTo(2000, items);
    assert.equal(first.attachedComponentId, 'into-buffer');
    assert.deepEqual(position(first), [13, 1]);
    simulation.advanceTo(3000, items);
    assert.equal(first.attachedComponentId, 'buffer');
    assert.deepEqual(position(first), [21.5, 1.5]);
    simulation.advanceTo(5999, items);
    const second = simulation.workpieces[1];
    assert.equal(second.status, 'stacked');
    assert.deepEqual(position(second), [11.5, 1.5]);
    assert.equal(simulation.getEquipmentStates('machine')[0].records[1].departedAt, null);
    simulation.advanceTo(6000, items);
    assert.equal(first.attachedComponentId, 'exit');
    assert.deepEqual(position(first), [23, 1.5]);
    assert.equal(second.attachedComponentId, 'into-buffer');
    assert.deepEqual(position(second), [13, 1]);
    assert.equal(simulation.getEquipmentStates('machine')[0].records[1].departedAt, 6);
});

test('workpieces follow the rounded centerline at constant speed with the arc tangent as their heading', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {x: -1.5, y: -1.5, maxOutputCount: 1}), output({x: 8.5, y: 8.5}),
        line({workpieceSpeed: 1, waypoints: [{x: 10, y: 0}], cornerRadii: [2]})];
    const route = connection.getConnectionGeometry(items[2], items);
    near(route.length, 16 + Math.PI);
    simulation.advanceTo(4000, items);
    const part = simulation.workpieces[0];
    near(part.position.x, 4);
    near(part.position.y, 0);
    near(part.angle, 0);
    simulation.advanceTo(10000, items);
    near(part.position.x, 8 + 2 * Math.sin(1));
    near(part.position.y, 2 - 2 * Math.cos(1));
    near(part.angle, 180 / Math.PI);
    simulation.advanceTo(19000, items);
    assert.equal(part.status, 'moving');
    near(part.position.x, 10);
    near(part.angle, 90);
    simulation.advanceTo(20000, items);
    near(part.arrivedAt, 16 + Math.PI);
    assert.equal(part.status, 'completed');
    near(part.position.y, 10);
    near(part.angle, 0);
});

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

test('a workpiece arriving at a workstation begins its default processing with angle zero', () => {
    const simulation = createInputSimulation();
    const items = [input('a', {maxOutputCount: 1}), output({id: 'station', type: 'workstation'}), output({y: 50}),
        line({toId: 'station'}), line({id: 'next', fromId: 'station'})];
    simulation.advanceTo(5000, items);
    assert.equal(simulation.workpieces[0].status, 'processing');
    assert.equal(simulation.workpieces[0].angle, 0);
    assert.equal(simulation.workpieces[0].attachedComponentId, 'station');
    assert.equal(simulation.isComplete(), false);
});

const workstation = (overrides = {}) => ({
    id: 'machine', type: 'workstation', x: 10, y: 0, width: 3, height: 3,
    setupTime: 2, processingTime: 3, ...centerPorts, ...overrides,
});
const productionLine = (machineProperties = {}, sourceProperties = {}) => [
    input('a', {x: 0, y: 0, maxOutputCount: 1, ...sourceProperties}),
    workstation(machineProperties), output({x: 20, y: 0}),
    line({toId: 'machine', workpieceSpeed: 10}),
    line({id: 'next', fromId: 'machine', workpieceSpeed: 10}),
];

function assemblyLine(recipes, mode = 'parts') {
    return [
        input('named', {x: 0, y: 0, maxOutputCount: 1,
            inputRuleRows: [{partType: 'Bolt', name: '长螺栓', relativeWeight: 1}]}),
        input('generic', {x: 0, y: 0, firstGenerationTime: .5, maxOutputCount: 2, generationInterval: .25,
            inputRuleRows: [{partType: 'Bolt', name: '短螺栓', relativeWeight: 1}]}),
        {id: 'assembly', type: 'assemblyWorkstation', x: 10, y: 0, width: 3, height: 3,
            assemblyMode: mode, assemblyRecipes: recipes, ...centerPorts},
        output({x: 20, y: 0}),
        line({id: 'named-line', fromId: 'named', toId: 'assembly', workpieceSpeed: 10}),
        line({id: 'generic-line', fromId: 'generic', toId: 'assembly', workpieceSpeed: 10}),
        line({id: 'exit', fromId: 'assembly', workpieceSpeed: 5}),
    ];
}

const boltRecipe = {
    productType: 'Kit', name: '螺栓组合', fillColor: '#123456', containerType: 'AGV', setupTime: .25, assemblyTime: .5,
    materials: [{partType: 'Bolt', name: '', quantity: 1}, {partType: 'Bolt', name: '长螺栓', quantity: 1}],
};

function assemblyPriorityLine(unitCount, recipes, arrivals) {
    const station = {id: 'assembly', type: 'assemblyWorkstation', x: 10, y: 0, width: 3, height: 3,
        assemblyUnitCount: unitCount, assemblyRecipes: recipes, ...centerPorts};
    const sources = arrivals.flatMap(([id, partType, generatedAt]) => [
        input(id, {x: 0, y: 0, firstGenerationTime: generatedAt, maxOutputCount: 1,
            inputRuleRows: [{partType, relativeWeight: 1}]}),
        line({id: `line-${id}`, fromId: id, toId: station.id, workpieceSpeed: 10}),
    ]);
    return [station, ...sources];
}

function recipeFor(productType, categories, assemblyTime = 2) {
    return {...boltRecipe, productType, setupTime: 0, assemblyTime,
        materials: categories.map(partType => ({partType, quantity: 1, name: ''}))};
}

test('simultaneous arrivals are considered together and the lower BOM number reserves shared parts first', () => {
    const items = assemblyPriorityLine(2, [
        recipeFor('AB', ['A', 'B']),
        recipeFor('A-only', ['A']),
        recipeFor('C-only', ['C']),
    ], [['a', 'A', 0], ['c', 'C', 0], ['b', 'B', 0]]);
    const simulation = createInputSimulation();
    simulation.advanceTo(1000, items);
    assert.equal(simulation.workpieces.filter(part => part.status === 'processing').length, 3);
    simulation.advanceTo(3000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part =>
        [part.partType, part.assembly.unitNumber, part.assembly.assemblyStartedAt, part.assembly.completedAt]),
    [['AB', 1, 1, 3], ['C-only', 2, 1, 3]]);
    assert.equal(simulation.isComplete(), true);
});

test('an idle assembly unit takes a later BOM row as soon as it is ready', () => {
    const items = assemblyPriorityLine(undefined, [
        recipeFor('AB', ['A', 'B']),
        recipeFor('A-only', ['A']),
    ], [['a', 'A', 0], ['b', 'B', 1]]);
    const simulation = createInputSimulation();
    simulation.advanceTo(5000, items);
    const product = simulation.workpieces.find(part => part.assembly);
    assert.equal(product.partType, 'A-only');
    assert.equal(product.assembly.assemblyStartedAt, 1);
    assert.equal(product.assembly.completedAt, 3);
    assert.ok(simulation.workpieces.some(part => part.partType === 'B' && part.status === 'stacked'));
});

test('when a busy assembly unit becomes free the earlier ready batch wins regardless of the row number', () => {
    const items = assemblyPriorityLine(1, [
        recipeFor('A-product', ['A']),
        recipeFor('B-product', ['B']),
        recipeFor('Busy', ['C'], 4),
    ], [['c', 'C', 0], ['b', 'B', 1], ['a', 'A', 2]]);
    const coarse = createInputSimulation();
    const fine = createInputSimulation();
    coarse.advanceTo(9000, items);
    for (let at = 0; at <= 9000; at += 125) fine.advanceTo(at, items);
    const timings = simulation => Array.from(simulation.workpieces, part =>
        [part.partType, part.assembly.assemblyStartedAt, part.assembly.completedAt]);
    assert.deepEqual(timings(coarse), [['Busy', 1, 5], ['B-product', 5, 7], ['A-product', 7, 9]]);
    assert.deepEqual(timings(fine), timings(coarse));
});

test('assembly uses the first ready recipe and transports a product sized to its largest material', () => {
    const simulation = createInputSimulation();
    const items = assemblyLine([
        {...boltRecipe, productType: 'Incomplete', materials: [{partType: 'Missing', name: '', quantity: 1}]},
        boltRecipe,
        {...boltRecipe, productType: 'Lower priority'},
    ]);
    // 两个输入用相同推荐尺寸显示，但实际面积较大的工件并不是最长的。
    Object.assign(items[0].inputRuleRows[0], {length: 1800, width: 400});
    Object.assign(items[1].inputRuleRows[0], {length: 900, width: 1200});
    simulation.advanceTo(1499, items);
    assert.equal(simulation.workpieces.find(part => part.sourceId === 'named').status, 'stacked');
    simulation.advanceTo(1500, items);
    assert.equal(simulation.workpieces.filter(part => part.status === 'preparing').length, 2);
    simulation.advanceTo(1750, items);
    assert.equal(simulation.workpieces.filter(part => part.status === 'processing').length, 2);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(2250, items);
    const product = simulation.workpieces.find(part => part.partType === 'Kit');
    assert.equal(simulation.workpieces.length, 2);
    assert.equal(product.packingType, 'Workpiece');
    assert.equal(product.name, '螺栓组合');
    assert.equal(product.fillColor, '#123456');
    assert.deepEqual([product.actualLength, product.actualWidth, product.width, product.height], [.9, 1.2, .9, 1.2]);
    assert.equal(product.attachedComponentId, 'exit');
    assert.deepEqual(Array.from(product.assembly.materials, part => part.name), ['长螺栓', '短螺栓']);
    assert.equal(product.assembly.setupStartedAt, 1.5);
    assert.equal(product.assembly.assemblyStartedAt, 1.75);
    assert.equal(product.assembly.completedAt, 2.25);
    items[2].y -= 3;
    items[2].height = 9;
    simulation.advanceTo(3250, items);
    near(product.position.x, 16.5);
    assert.deepEqual([product.width, product.height], [.9, 1.2]);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(4250, items);
    assert.equal(product.attachedComponentId, 'out');
    assert.equal(product.status, 'completed');
    assert.deepEqual([product.width, product.height], [.9, 1.2]);
    assert.equal(simulation.workpieces.find(part => part !== product).attachedComponentId, 'assembly');
    assert.equal(simulation.isComplete(), true);
});

test('empty or unsatisfied BOMs leave all incoming parts stacked even with an outbound line', () => {
    const incomplete = {...boltRecipe, materials: [{partType: 'Bolt', name: '长螺栓', quantity: 2}]};
    for (const recipes of [[], [incomplete]]) {
        const simulation = createInputSimulation();
        simulation.advanceTo(10000, assemblyLine(recipes));
        assert.equal(simulation.workpieces.length, 3);
        assert.ok(simulation.workpieces.every(part => part.status === 'stacked' && part.attachedComponentId === 'assembly'));
        assert.equal(simulation.isComplete(), true);
    }
});

test('an unconfigured disassembly station retains incoming parts even with an outbound line', () => {
    const simulation = createInputSimulation();
    const items = assemblyLine([]);
    const station = items.find(item => item.id === 'assembly');
    station.type = 'disassemblyWorkstation';
    simulation.advanceTo(10000, items);
    assert.equal(simulation.workpieces.length, 3);
    assert.ok(simulation.workpieces.every(part => part.status === 'stacked' && part.attachedComponentId === station.id));
    assert.equal(simulation.isComplete(), true);
});

test('container unloading restores the actual loaded parts and sends only those parts downstream without a BOM', () => {
    const simulation = createInputSimulation();
    const items = assemblyLine([{...boltRecipe, packingType: 'Pallet'}], 'container');
    items[0].workpieceDisplayMode = 'actual';
    Object.assign(items[0].inputRuleRows[0], {fillColor: '#abcd12', length: 1200, width: 700});
    const sink = items.find(item => item.id === 'out');
    sink.x = 30;
    const split = {id: 'split', type: 'disassemblyWorkstation', disassemblyMode: 'container', x: 20, y: 0, width: 3, height: 3, ...centerPorts};
    items.find(item => item.id === 'exit').toId = split.id;
    items.push(split, line({id: 'unloaded', fromId: split.id, workpieceSpeed: 5}));
    simulation.advanceTo(1000, items);
    const originalBolt = simulation.workpieces.find(part => part.sourceId === 'named').id;
    simulation.advanceTo(4249, items);
    const container = simulation.workpieces.find(part => part.packingType === 'Pallet');
    assert.equal(container.contents.length, 2);
    assert.equal(container.status, 'moving');
    simulation.advanceTo(4250, items);
    assert.equal(container.contents.length, 0);
    assert.equal(container.unloadedAt, 4.25);
    assert.equal(container.attachedComponentId, split.id);
    const unloaded = simulation.workpieces.filter(part => part.attachedComponentId === 'unloaded');
    assert.equal(unloaded.length, 2);
    const bolt = unloaded.find(part => part.id === originalBolt);
    assert.equal(bolt.name, '长螺栓');
    assert.equal(bolt.sourceId, 'named');
    assert.equal(bolt.fillColor, '#abcd12');
    assert.deepEqual([bolt.width, bolt.height], [1.2, .7]);
    simulation.advanceTo(6250, items);
    assert.equal(simulation.workpieces.filter(part => part.attachedComponentId === 'out').length, 2);
    assert.equal(simulation.isComplete(), true);
    simulation.advanceTo(8000, items);
    assert.equal(simulation.workpieces.length, 4);
});

test('part disassembly matches the BOM, respects parallel capacity and transports its configured outputs', () => {
    const simulation = createInputSimulation();
    const kitSource = input('a', {x: 0, y: 0, maxOutputCount: 3, generationInterval: .1,
        inputRuleRows: [{partType: 'Kit', name: 'named', length: 900, width: 400, relativeWeight: 1}]});
    const recipe = {productType: 'Kit', name: 'named', setupTime: .25, disassemblyTime: .5,
        materials: [{partType: 'Bolt', quantity: 2, name: '', fillColor: '#123456'}]};
    const station = {id: 'split', type: 'disassemblyWorkstation', x: 10, y: 0, width: 3, height: 3,
        disassemblyUnitCount: 2, ...centerPorts, disassemblyRecipes: [
            {...recipe, name: '', materials: []},
            {...recipe, name: '', materials: [{partType: 'Fallback', quantity: 1, name: '', fillColor: '#000000'}]},
            recipe,
        ]};
    const items = [kitSource, station, output({x: 20, y: 0}),
        line({toId: station.id, workpieceSpeed: 10}), line({id: 'split-exit', fromId: station.id, workpieceSpeed: 10})];
    simulation.advanceTo(1200, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.status), ['preparing', 'preparing', 'stacked']);
    simulation.advanceTo(1749, items);
    assert.equal(simulation.workpieces.filter(part => part.status === 'processing').length, 2);
    assert.equal(simulation.workpieces.every(part => part.partType === 'Kit'), true);
    simulation.advanceTo(1750, items);
    const firstBatch = simulation.workpieces.filter(part => part.attachedComponentId === 'split-exit');
    assert.equal(firstBatch.length, 2);
    for (const part of firstBatch) {
        assert.equal(part.partType, 'Bolt');
        assert.equal(part.fillColor, '#123456');
        assert.deepEqual([part.width, part.height], [.9, .4]);
    }
    assert.equal(simulation.workpieces.filter(part => part.status === 'preparing').length, 1);
    simulation.advanceTo(3500, items);
    assert.equal(simulation.workpieces.length, 6);
    assert.ok(simulation.workpieces.every(part => part.status === 'completed' && part.partType === 'Bolt'));
    assert.deepEqual(Array.from(simulation.workpieces, part => part.disassembly.startedAt), [1.25, 1.25, 1.35, 1.35, 2, 2]);
    assert.equal(simulation.isComplete(), true);
});

test('assembly uses each recipe’s saved packing type even when the station’s mode differs', () => {
    for (const [packingType, mode, expectedType] of [
        ['Pallet', 'parts', 'Pallet'], ['Vehicle', 'parts', 'Vehicle'], ['AGV', 'parts', 'AGV'],
        ['Workpiece', 'container', 'Workpiece'], ['workpiece', 'container', 'Workpiece'],
    ]) {
        const {containerType, ...fields} = boltRecipe;
        const recipe = {...fields, packingType, setupTime: 0, assemblyTime: 0};
        const simulation = createInputSimulation();
        const items = assemblyLine([recipe], mode).filter(item => item.id !== 'exit');
        simulation.advanceTo(3500, items);
        const product = simulation.workpieces.find(part => part.partType === 'Kit');
        assert.equal(product.packingType, expectedType);
        assert.equal(product.status, 'stacked');
        assert.equal(product.attachedComponentId, 'assembly');
        assert.equal(product.assembly.materials.length, 2);
        if (expectedType !== 'Workpiece') assert.deepEqual([product.width, product.height], [2, 1]);
        assert.equal(simulation.isComplete(), true);
    }
});

test('a zero-time assembly loop does not spin inside a simulation tick when assembly creates a new ID', () => {
    const simulation = createInputSimulation();
    const recipe = {...boltRecipe, productType: 'Bolt', setupTime: 0, assemblyTime: 0,
        materials: [{partType: 'Bolt', name: '', quantity: 1}]};
    const items = assemblyLine([recipe]).filter(item => !['generic', 'generic-line', 'out', 'exit'].includes(item.id));
    const first = items.find(item => item.id === 'assembly');
    first.x = 0;
    items.push({...first, id: 'other'},
        line({id: 'forward', fromId: 'assembly', toId: 'other'}),
        line({id: 'back', fromId: 'other', toId: 'assembly'}));
    simulation.advanceTo(0, items);
    assert.equal(simulation.workpieces.length, 1);
    assert.equal(simulation.workpieces[0].status, 'stacked');
    assert.equal(simulation.isComplete(), true);
});

const parallelProductionLine = (machineProperties = {}, sourceProperties = {}) => productionLine({
    type: 'parallelWorkstation', equipmentCount: 4, ...machineProperties,
}, sourceProperties);

test('parallel equipment is initially idle with stable IDs unique across stations and resets', () => {
    const simulation = createInputSimulation();
    const items = parallelProductionLine({}, {firstGenerationTime: 10});
    items.push(workstation({id: 'other', type: 'parallelWorkstation', equipmentCount: 4}));
    simulation.advanceTo(0, items);
    const states = simulation.getEquipmentStates();
    assert.equal(states.length, 8);
    assert.equal(new Set(states.map(state => state.equipmentId)).size, 8);
    assert.ok(states.every(state => state.status === 'idle' && state.workpieceId === null && state.enabled && !state.records.length));
    const ids = states.map(state => state.equipmentId);
    simulation.reset();
    simulation.advanceTo(0, JSON.parse(JSON.stringify(items)));
    assert.deepEqual(simulation.getEquipmentStates().map(state => state.equipmentId), ids);
});

test('four devices prepare and process four parts concurrently while the fifth waits for a free device', () => {
    const simulation = createInputSimulation();
    const items = parallelProductionLine({}, {maxOutputCount: 5, generationInterval: .001});
    simulation.advanceTo(1004, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.status), ['preparing', 'preparing', 'preparing', 'preparing', 'waiting']);
    assert.equal(new Set(simulation.workpieces.slice(0, 4).map(part => part.equipmentId)).size, 4);
    assert.equal(simulation.workpieces[4].equipmentId, undefined);
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(3004, items);
    assert.ok(simulation.workpieces.slice(0, 4).every(part => part.status === 'processing'));
    simulation.advanceTo(6000, items);
    const [first, , , , fifth] = simulation.workpieces;
    assert.equal(first.status, 'moving');
    assert.equal(first.attachedComponentId, 'next');
    assert.equal(fifth.status, 'preparing');
    assert.equal(fifth.setupStartedAt, 6);
    assert.equal(fifth.equipmentId, first.equipmentId);
    simulation.advanceTo(12000, items);
    assert.equal(simulation.isComplete(), true);
    const equipment = simulation.getEquipmentStates('machine');
    assert.deepEqual(Array.from(equipment, slot => slot.records.length), [2, 1, 1, 1]);
    assert.ok(equipment.every(slot => slot.status === 'idle' && slot.workpieceId === null));
    const record = fifth.processingHistory[0];
    assert.equal(record.stationId, 'machine');
    assert.equal(record.workpieceId, fifth.id);
    assert.equal(record.equipmentId, fifth.equipmentId);
    assert.equal(record.queuedAt, 1.004);
    near(record.waitingTime, 4.996);
    assert.equal(record.setupStartedAt, 6);
    assert.equal(record.processingStartedAt, 8);
    assert.equal(record.processedAt, 11);
    assert.equal(record.departedAt, 11);
    assert.equal(record.setupTime, 2);
    assert.equal(record.processingTime, 3);
    assert.equal(record.status, 'completed');
    equipment[0].records[0].processedAt = -1;
    equipment[0].status = 'broken';
    assert.equal(simulation.getEquipmentStates('machine')[0].records[0].processedAt, 6);
    assert.equal(simulation.getEquipmentStates('machine')[0].status, 'idle');
});

test('one-device parallel stations use default durations and an unconnected station finishes only after processing', () => {
    const simulation = createInputSimulation();
    const items = parallelProductionLine({equipmentCount: 1, setupTime: undefined, processingTime: undefined})
        .filter(item => item.id !== 'next');
    simulation.advanceTo(1000, items);
    assert.equal(simulation.workpieces[0].status, 'processing');
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(61000, items);
    assert.equal(simulation.workpieces[0].status, 'stacked');
    assert.equal(simulation.isComplete(), true);
    const record = simulation.getEquipmentStates('machine')[0].records[0];
    assert.equal(record.processingStartedAt, 1);
    assert.equal(record.processedAt, 61);
    assert.equal(record.departedAt, null);
});

test('processing history survives onward transport and subsequent stations, including catch-up frames', () => {
    const items = parallelProductionLine({setupTime: .125, processingTime: .375}, {maxOutputCount: 9, generationInterval: .125});
    items.push(workstation({id: 'second', x: 15, setupTime: .25, processingTime: .5}),
        line({id: 'last', fromId: 'second', workpieceSpeed: 10}));
    items.find(item => item.id === 'next').toId = 'second';
    const coarse = createInputSimulation(() => 0);
    const fine = createInputSimulation(() => 0);
    coarse.advanceTo(10000, items);
    for (let time = 0; time <= 10000; time += 25) fine.advanceTo(time, items);
    assert.deepEqual(JSON.parse(JSON.stringify(coarse.getEquipmentStates())), JSON.parse(JSON.stringify(fine.getEquipmentStates())));
    assert.ok(coarse.workpieces.every(part => part.status === 'completed' && part.processingHistory.length === 2));
    assert.equal(coarse.isComplete(), true);
    const first = coarse.workpieces[0];
    assert.equal(first.processingHistory[0].stationId, 'machine');
    assert.equal(first.processingHistory[0].processedAt, 1.5);
    assert.equal(first.processingHistory[1].stationId, 'second');
    assert.equal(first.processingHistory[1].processedAt, 2.75);
    assert.notEqual(first.processingHistory[0].equipmentId, first.processingHistory[1].equipmentId);
    for (const equipment of coarse.getEquipmentStates()) {
        for (let index = 1; index < equipment.records.length; index++) {
            assert.ok(equipment.records[index].setupStartedAt >= equipment.records[index - 1].processedAt);
        }
    }
});

test('resizing a running parallel station drains removed devices and never reuses their IDs or history', () => {
    const simulation = createInputSimulation();
    const items = parallelProductionLine({setupTime: 0, processingTime: 2}, {maxOutputCount: 6, generationInterval: .001});
    simulation.advanceTo(1005, items);
    const ids = Array.from(items[1].equipmentIds);
    items[1].equipmentCount = 1;
    simulation.advanceTo(3005, items);
    const retired = simulation.getEquipmentStates('machine').filter(state => !state.enabled);
    assert.equal(retired.length, 3);
    assert.ok(retired.every(state => state.status === 'idle' && state.records.length === 1));
    assert.equal(simulation.workpieces[4].equipmentId, ids[0]);
    assert.equal(simulation.workpieces[5].status, 'waiting');
    items[1].equipmentCount = 2;
    simulation.advanceTo(3005, items);
    const added = items[1].equipmentIds[1];
    assert.ok(!ids.includes(added));
    assert.equal(simulation.workpieces[5].equipmentId, added);
    assert.equal(simulation.workpieces[5].setupStartedAt, 3.005);
    simulation.advanceTo(7000, items);
    assert.equal(simulation.isComplete(), true);
    assert.equal(simulation.getEquipmentStates('machine').length, 5);
    const savedIds = Array.from(items[1].equipmentIds);
    simulation.reset();
    simulation.advanceTo(0, items);
    const resetStates = simulation.getEquipmentStates('machine');
    assert.deepEqual(Array.from(resetStates, state => state.equipmentId), savedIds);
    assert.ok(resetStates.every(state => state.status === 'idle' && !state.records.length));
});

test('zero-time parallel jobs release devices and travel along downstream connections at the configured speed', () => {
    const simulation = createInputSimulation();
    const items = parallelProductionLine({setupTime: 0, processingTime: 0}, {maxOutputCount: 5, generationInterval: .001});
    items.find(item => item.id === 'next').workpieceSpeed = 0;
    simulation.advanceTo(2000, items);
    assert.ok(simulation.workpieces.every(part => part.status === 'moving' && part.attachedComponentId === 'next'));
    assert.ok(simulation.getEquipmentStates('machine').every(state => state.status === 'idle'));
    near(simulation.workpieces[0].position.x, 11.5);
    assert.equal(simulation.isComplete(), false);
    items.find(item => item.id === 'next').workpieceSpeed = 10;
    simulation.advanceTo(2500, items);
    near(simulation.workpieces[0].position.x, 16.5);
    simulation.advanceTo(3000, items);
    assert.equal(simulation.isComplete(), true);
});

test('preparation precedes processing, and only the time left after completion moves the part downstream', () => {
    const simulation = createInputSimulation();
    const items = productionLine();
    for (const [time, status, owner] of [
        [999, 'moving', 'line'], [1000, 'preparing', 'machine'], [2999, 'preparing', 'machine'],
        [3000, 'processing', 'machine'], [5999, 'processing', 'machine'], [6000, 'moving', 'next'],
        [6500, 'moving', 'next'], [7000, 'completed', 'out'],
    ]) {
        simulation.advanceTo(time, items);
        const part = simulation.workpieces[0];
        assert.equal(part.status, status, String(time));
        assert.equal(part.attachedComponentId, owner, String(time));
        if (owner === 'machine') { near(part.position.x, 11.5); near(part.position.y, 1.5); }
        if (time === 6500) { near(part.position.x, 16.5); near(part.distanceTravelled, 5); }
        assert.equal(simulation.isComplete(), status === 'completed');
    }
    const part = simulation.workpieces[0];
    assert.equal(part.setupStartedAt, 1);
    assert.equal(part.processingStartedAt, 3);
    assert.equal(part.processedAt, 6);
    assert.equal(part.arrivedAt, 7);
    assert.equal(simulation.advanceTo(7000, items), false);
});

test('one workstation serves FIFO and prepares every part before processing it', () => {
    const simulation = createInputSimulation();
    const items = productionLine({}, {maxOutputCount: 3, generationInterval: .5});
    simulation.advanceTo(2000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.status), ['preparing', 'waiting', 'waiting']);
    simulation.advanceTo(6000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.status), ['moving', 'preparing', 'waiting']);
    simulation.advanceTo(17000, items);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.setupStartedAt), [1, 6, 11]);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.processingStartedAt), [3, 8, 13]);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.processedAt), [6, 11, 16]);
    assert.deepEqual(Array.from(simulation.workpieces, part => part.arrivedAt), [7, 12, 17]);
    assert.ok(simulation.workpieces.every(part => part.status === 'completed'));
    assert.equal(simulation.isComplete(), true);
});

test('a catch-up frame and small time steps yield the same results across consecutive devices', () => {
    const items = productionLine({setupTime: .125, processingTime: .375}, {maxOutputCount: 5, generationInterval: .2});
    items.push(workstation({id: 'second', x: 15, setupTime: .001, processingTime: .499}),
        line({id: 'last', fromId: 'second', workpieceSpeed: 10}));
    items.find(item => item.id === 'next').toId = 'second';
    const coarse = createInputSimulation(() => 0);
    const fine = createInputSimulation(() => 0);
    coarse.advanceTo(5000, items);
    for (let time = 0; time <= 5000; time += 25) fine.advanceTo(time, items);
    const snapshot = simulation => Array.from(simulation.workpieces, part => ({
        sequence: part.sequence, status: part.status, owner: part.attachedComponentId,
        setupStartedAt: part.setupStartedAt, processingStartedAt: part.processingStartedAt,
        processedAt: part.processedAt, arrivedAt: part.arrivedAt, position: {...part.position},
        stackHidden: part.stackHidden, stackCount: part.stackCount,
    }));
    assert.deepEqual(snapshot(coarse), snapshot(fine));
    assert.equal(coarse.isComplete(), true);
    assert.equal(fine.isComplete(), true);
});

test('merging sources queue by arrival time rather than source or generation order', () => {
    const simulation = createInputSimulation();
    const items = [
        input('far', {x: -5, y: 0, maxOutputCount: 1}),
        input('near', {x: 5, y: 0, firstGenerationTime: .5, maxOutputCount: 1}),
        workstation({setupTime: 0, processingTime: 1}), output({x: 20, y: 0}),
        line({id: 'far-line', fromId: 'far', toId: 'machine', workpieceSpeed: 10}),
        line({id: 'near-line', fromId: 'near', toId: 'machine', workpieceSpeed: 10}),
        line({id: 'next', fromId: 'machine', workpieceSpeed: 10}),
    ];
    simulation.advanceTo(4000, items);
    const [far, nearPart] = simulation.workpieces;
    assert.equal(nearPart.setupStartedAt, 1);
    assert.equal(nearPart.processedAt, 2);
    assert.equal(far.setupStartedAt, 2);
    assert.equal(far.processedAt, 3);
    assert.equal(simulation.isComplete(), true);
});

test('an unconnected workstation completes its work before the simulation can finish', () => {
    const simulation = createInputSimulation();
    const items = productionLine().filter(item => item.id !== 'next');
    simulation.advanceTo(5000, items);
    assert.equal(simulation.workpieces[0].status, 'processing');
    assert.equal(simulation.isComplete(), false);
    simulation.advanceTo(6000, items);
    assert.equal(simulation.workpieces[0].status, 'stacked');
    assert.equal(simulation.workpieces[0].attachedComponentId, 'machine');
    assert.equal(simulation.workpieces[0].processedAt, 6);
    assert.equal(simulation.isComplete(), true);
});

test('zero durations and zero-length routes pass through without a frame delay, and cycles do not hang', () => {
    const simulation = createInputSimulation();
    const items = productionLine({x: 0, setupTime: 0, processingTime: 0});
    items.find(item => item.id === 'out').x = 0;
    simulation.advanceTo(0, items);
    assert.equal(simulation.workpieces[0].status, 'completed');
    assert.equal(simulation.workpieces[0].arrivedAt, 0);
    assert.equal(simulation.isComplete(), true);
    simulation.reset();
    items.find(item => item.id === 'next').toId = 'a';
    // 输入组件没有上料点，指向它的连线不会接收工件。
    simulation.advanceTo(0, items);
    assert.equal(simulation.workpieces[0].status, 'stacked');
    items.find(item => item.id === 'a').type = 'workstation';
    Object.assign(items[0], {setupTime: 0, processingTime: 0, ...centerPorts});
    simulation.reset();
    const source = input('new', {x: 0, y: 0, maxOutputCount: 1});
    items.push(source, line({id: 'entry', fromId: 'new', toId: 'a', workpieceSpeed: 10}));
    simulation.advanceTo(100, items);
    assert.equal(simulation.workpieces.length, 1);
    assert.equal(simulation.isComplete(), false);
});

test('device timings are captured per job; changed values apply to the next waiting job', () => {
    const simulation = createInputSimulation();
    const items = productionLine({}, {maxOutputCount: 2, generationInterval: .5});
    simulation.advanceTo(2000, items);
    Object.assign(items[1], {setupTime: .001, processingTime: .002});
    simulation.advanceTo(8000, items);
    const [first, second] = simulation.workpieces;
    assert.equal(first.processedAt, 6);
    assert.equal(second.setupStartedAt, 6);
    assert.equal(second.processingStartedAt, 6.001);
    assert.equal(second.processedAt, 6.003);
    assert.equal(second.arrivedAt, 7.003);
});

test('leaving a long device queue updates stack counts and reveals hidden waiting parts', () => {
    const simulation = createInputSimulation();
    const items = productionLine({setupTime: 0, processingTime: .01}, {maxOutputCount: 40, generationInterval: .001});
    items.find(item => item.id === 'line').workpieceSpeed = 10000;
    simulation.advanceTo(40, items);
    let attached = simulation.workpieces.filter(part => part.attachedComponentId === 'machine');
    assert.equal(attached.length, 37);
    assert.equal(attached.filter(part => !part.stackHidden).length, 25);
    assert.equal(attached.filter(part => !part.stackHidden).at(-1).stackCount, 37);
    simulation.advanceTo(200, items);
    attached = simulation.workpieces.filter(part => part.attachedComponentId === 'machine');
    assert.equal(attached.length, 21);
    assert.ok(attached.every(part => !part.stackHidden));
    assert.equal(attached.at(-1).stackCount, 21);
    assert.ok(simulation.workpieces.filter(part => part.status === 'moving').every(part => !part.stackHidden && part.stackCount === undefined));
    simulation.advanceTo(2000, items);
    assert.equal(simulation.isComplete(), true);
    assert.equal(simulation.workpieces.filter(part => !part.stackHidden).length, 25);
    assert.equal(simulation.workpieces.filter(part => !part.stackHidden).at(-1).stackCount, 40);
});

test('reset discards workstation occupancy, queues and in-progress timing', () => {
    const simulation = createInputSimulation();
    const items = productionLine({}, {maxOutputCount: 2, generationInterval: .5});
    simulation.advanceTo(2000, items);
    assert.equal(simulation.workpieces[1].status, 'waiting');
    simulation.reset();
    simulation.advanceTo(1000, items);
    assert.equal(simulation.workpieces[0].setupStartedAt, 1);
    assert.equal(simulation.workpieces[0].status, 'preparing');
    simulation.advanceTo(12000, items);
    assert.equal(simulation.workpieces[1].processedAt, 11);
    assert.equal(simulation.isComplete(), true);
});

test('deleting an occupied workstation clears its active and queued pieces without blocking completion', () => {
    const simulation = createInputSimulation();
    const items = productionLine({}, {maxOutputCount: 2, generationInterval: .5});
    simulation.advanceTo(2000, items);
    items.splice(items.findIndex(item => item.id === 'machine'), 1);
    simulation.advanceTo(3000, items);
    assert.equal(simulation.workpieces.length, 0);
    assert.equal(simulation.isComplete(), true);
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
    for (const status of ['waiting', 'moving', 'preparing', 'processing']) {
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

test('workspace pauses preparation, applies simulation speed to processing, and finishes after downstream transport', () => {
    let now = 0;
    let tick;
    const script = parse(read('components/WorkspaceLayout.vue')).descriptor.scriptSetup.content.replace(/^import .*\r?$/gm, '');
    const scope = vue.effectScope();
    const state = scope.run(() => vm.runInNewContext(script +
        '\n;({placedComponents,workpieces,handleClickControl,simulationSpeed,elapsedMilliseconds,simulationStatus})', {
        ...vue, ...rules, createInputSimulation,
        createBootstrapTooltipDirective: () => ({}), defineEmits: () => () => {}, defineExpose() {},
        onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, performance: {now: () => now},
        window: {setInterval: callback => {tick = callback; return 1;}, clearInterval() {}},
    }));
    state.placedComponents.value.push(...productionLine({setupTime: 1, processingTime: 2}));
    state.handleClickControl({id: 'start-simulation'});
    now = 1500;
    tick();
    assert.equal(state.workpieces.value[0].status, 'preparing');
    state.handleClickControl({id: 'pause-simulation'});
    assert.equal(state.simulationStatus.value, 'paused');
    now = 100000;
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.elapsedMilliseconds.value, 1500);
    assert.equal(state.workpieces.value[0].status, 'preparing');
    now = 100500;
    tick();
    assert.equal(state.elapsedMilliseconds.value, 2000);
    assert.equal(state.workpieces.value[0].status, 'processing');
    state.simulationSpeed.value = 2;
    now = 101500;
    tick();
    assert.equal(state.elapsedMilliseconds.value, 4000);
    assert.equal(state.workpieces.value[0].status, 'moving');
    assert.equal(state.workpieces.value[0].attachedComponentId, 'next');
    assert.equal(state.simulationStatus.value, 'running');
    now = 102000;
    tick();
    assert.equal(state.elapsedMilliseconds.value, 5000);
    assert.equal(state.workpieces.value[0].status, 'completed');
    assert.equal(state.simulationStatus.value, 'completed');
    scope.stop();
});

test('workspace exposes parallel equipment records, pauses their clocks and resets them to idle without changing IDs', async () => {
    let now = 0;
    let tick;
    const script = parse(read('components/WorkspaceLayout.vue')).descriptor.scriptSetup.content.replace(/^import .*\r?$/gm, '');
    const scope = vue.effectScope();
    const state = scope.run(() => vm.runInNewContext(script +
        '\n;({placedComponents,workpieces,handleClickControl,getEquipmentStates,simulationStatus,elapsedMilliseconds})', {
        ...vue, ...rules, ...workstationProperties, createInputSimulation,
        createBootstrapTooltipDirective: () => ({}), defineEmits: () => () => {}, defineExpose() {},
        onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, performance: {now: () => now},
        window: {setInterval: callback => {tick = callback; return 1;}, clearInterval() {}},
    }));
    state.placedComponents.value.push(...parallelProductionLine({}, {maxOutputCount: 5, generationInterval: .001}));
    await vue.nextTick();
    const ids = Array.from(state.getEquipmentStates('machine'), equipment => equipment.equipmentId);
    assert.equal(ids.length, 4);
    assert.ok(state.getEquipmentStates('machine').every(equipment => equipment.status === 'idle'));
    state.handleClickControl({id: 'start-simulation'});
    now = 2000;
    tick();
    assert.ok(state.getEquipmentStates('machine').every(equipment => equipment.status === 'preparing'));
    state.handleClickControl({id: 'pause-simulation'});
    const paused = JSON.parse(JSON.stringify(state.getEquipmentStates()));
    now = 100000;
    state.handleClickControl({id: 'start-simulation'});
    assert.equal(state.elapsedMilliseconds.value, 2000);
    assert.deepEqual(JSON.parse(JSON.stringify(state.getEquipmentStates())), paused);
    now = 110000;
    tick();
    assert.equal(state.simulationStatus.value, 'completed');
    assert.equal(state.getEquipmentStates('machine').reduce((count, equipment) => count + equipment.records.length, 0), 5);
    state.handleClickControl({id: 'reset-simulation'});
    assert.equal(state.workpieces.value.length, 0);
    assert.deepEqual(Array.from(state.getEquipmentStates('machine'), equipment => equipment.equipmentId), ids);
    assert.ok(state.getEquipmentStates('machine').every(equipment => equipment.status === 'idle' && equipment.records.length === 0));
    await vue.nextTick();
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

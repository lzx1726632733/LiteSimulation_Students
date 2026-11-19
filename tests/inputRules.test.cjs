const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require('vue');
const {parse, compileTemplate} = require('@vue/compiler-sfc');

const rules = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/utils/inputRules.js'), 'utf8')
    .replace(/export (const|function) /g, '$1 ') +
    '\n;({PART_COLORS, getInputRuleValidationMessage, getInputRuleProbabilities, sampleInputRule, INPUT_PROPERTY_DEFAULTS, isValidInputProperty, parseGenerationInterval, formatGenerationInterval, getDefaultWorkpieceDimensions})');
const makeRows = weights => weights.map((relativeWeight, index) => ({partType: `Part${index + 1}`, relativeWeight}));

test('generation interval defaults to one minute and supports duration formats with milliseconds', () => {
    assert.equal(rules.INPUT_PROPERTY_DEFAULTS.generationInterval, 60);
    for (const [text, seconds] of [['1:0', 60], ['90', 90], ['1:30', 90], ['1:2:3', 3723],
        ['1:2:3:4.005', 93784.005], ['0.001', .001], ['1.001', 1.001]]) {
        assert.equal(rules.parseGenerationInterval(text), seconds);
        assert.equal(rules.parseGenerationInterval(rules.formatGenerationInterval(seconds)), seconds);
    }
    assert.equal(rules.formatGenerationInterval(60), '1:0');
});

test('generation interval rejects zero, malformed values and invalid time segments', () => {
    for (const text of ['', '0', '-1', '1:', ':1', '1:60', '1:60:0', '1:24:0:0', '1:2:3:4:5', 'NaN', '0.0001']) {
        assert.ok(Number.isNaN(rules.parseGenerationInterval(text)), text);
    }
    assert.equal(rules.isValidInputProperty('generationInterval', 0), false);
    assert.equal(rules.isValidInputProperty('generationInterval', Infinity), false);
});

test('weights are normalized independently of 100 and remain finite for large values', () => {
    assert.deepEqual(Array.from(rules.getInputRuleProbabilities(makeRows([100, 100, 200]))), [.25, .25, .5]);
    assert.deepEqual(Array.from(rules.getInputRuleProbabilities(makeRows([1e308, 1e308]))), [.5, .5]);
    assert.deepEqual(Array.from(rules.getInputRuleProbabilities([])), []);
});

test('sampling respects boundaries, excludes zero weights and returns a copy', () => {
    const rows = makeRows([0, 100, 100, 200, 0]);
    assert.equal(rules.sampleInputRule(rows, () => 0).partType, 'Part2');
    assert.equal(rules.sampleInputRule(rows, () => .25).partType, 'Part3');
    assert.equal(rules.sampleInputRule(rows, () => .5).partType, 'Part4');
    assert.equal(rules.sampleInputRule(rows, () => 1 - Number.EPSILON).partType, 'Part4');
    const picked = rules.sampleInputRule(rows, () => 0);
    picked.partType = 'changed';
    assert.equal(rows[1].partType, 'Part2');
    assert.equal(rules.sampleInputRule([]), null);
});

test('uniform deterministic draws produce the expected weighted distribution', () => {
    const rows = makeRows([100, 100, 200]);
    const counts = {Part1: 0, Part2: 0, Part3: 0};
    for (let index = 0; index < 10000; index++) {
        counts[rules.sampleInputRule(rows, () => (index + .5) / 10000).partType]++;
    }
    assert.deepEqual(counts, {Part1: 2500, Part2: 2500, Part3: 5000});
});

test('invalid weights and random sources are rejected', () => {
    for (const weights of [[-1, 1], [NaN], [Infinity], [''], [0, 0]]) {
        assert.throws(() => rules.sampleInputRule(makeRows(weights)));
    }
    for (const value of [-1, 1, NaN]) {
        assert.throws(() => rules.sampleInputRule(makeRows([100]), () => value));
    }
});

const filename = path.resolve(__dirname, '../src/components/Dialog.vue');
const {descriptor} = parse(fs.readFileSync(filename, 'utf8'), {filename});
function createDialog(savedRows = []) {
    const events = [];
    const props = vue.reactive({item: {id: 'input-1', type: 'systemInput', inputRuleRows: savedRows}, dialogType: 'input-rule'});
    const scope = vue.effectScope();
    const context = {
        ...vue, ...rules,
        defineProps: () => props,
        defineEmits: () => (type, payload) => events.push({type, payload}),
        onMounted() {}, onBeforeUnmount() {},
        getComponentLabel: () => '输入1', systemInputIcon: '', dialogIcon: '',
        window: {innerWidth: 1440, innerHeight: 900},
    };
    const state = scope.run(() => vm.runInNewContext(descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, '') +
        '\n;({rows, selectedRow, validationMessage, addRow, deleteRow, clearRows, saveDialog, openColorPicker})', context));
    return {state, events, props, dispose: () => scope.stop()};
}

test('dialog edits four fields in a draft and saves to its captured item', () => {
    const savedRows = [{partType: 'Part1', name: 'old', length: 1000, width: 500, fillColor: '#00ff00', relativeWeight: 100}];
    const {state, events, dispose} = createDialog(savedRows);
    Object.assign(state.rows.value[0], {partType: 'Bolt', name: '螺栓', fillColor: '#123456', relativeWeight: 25});
    assert.equal(savedRows[0].partType, 'Part1');
    state.saveDialog();
    assert.equal(events[0].payload.itemId, 'input-1');
    assert.equal(events[0].payload.dialogType, 'input-rule');
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].payload.properties.inputRuleRows)),
        [{partType: 'Bolt', name: '螺栓', length: 1000, width: 500, fillColor: '#123456', relativeWeight: 25}]);
    dispose();
});

test('new rows use seven colors and keep increasing Part numbers after deletion', () => {
    const {state, dispose} = createDialog();
    for (let index = 0; index < 7; index++) state.addRow();
    assert.equal(new Set(state.rows.value.map(row => row.fillColor)).size, 7);
    state.deleteRow();
    state.addRow();
    assert.equal(state.rows.value.at(-1).partType, 'Part8');
    state.clearRows();
    state.addRow();
    assert.equal(state.rows.value[0].partType, 'Part1');
    dispose();
});

test('actual dimensions are editable positive numbers in millimeters and old rows receive defaults', () => {
    const {state, events, dispose} = createDialog([{partType: 'Part1', name: '', relativeWeight: 100}]);
    assert.equal(state.rows.value[0].length, 2000);
    assert.equal(state.rows.value[0].width, 1000);
    state.rows.value[0].length = 125.5;
    state.rows.value[0].width = 40;
    state.saveDialog();
    assert.equal(events[0].payload.properties.inputRuleRows[0].length, 125.5);
    assert.equal(events[0].payload.properties.inputRuleRows[0].width, 40);
    for (const value of [0, -1, '', Infinity]) {
        state.rows.value[0].length = value;
        assert.ok(state.validationMessage.value);
    }
    dispose();
});

test('invalid drafts cannot save and changing the item reloads its own draft', async () => {
    const {state, events, props, dispose} = createDialog();
    state.addRow();
    state.rows.value[0].relativeWeight = -1;
    state.saveDialog();
    assert.equal(events.length, 0);
    assert.ok(state.validationMessage.value);
    props.item = {id: 'input-2', type: 'systemInput', inputRuleRows: []};
    await vue.nextTick();
    assert.equal(state.rows.value.length, 0);
    dispose();
});

test('dialog template compiles and color action opens the native picker', () => {
    assert.deepEqual(compileTemplate({source: descriptor.template.content, filename, id: 'dialog-test'}).errors, []);
    const {state, dispose} = createDialog();
    let opened = false;
    state.openColorPicker({currentTarget: {showPicker: () => { opened = true; }}});
    assert.equal(opened, true);
    dispose();
});

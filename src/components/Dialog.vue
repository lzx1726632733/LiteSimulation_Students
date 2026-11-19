<template>
    <Teleport to="body">
        <section ref="dialog" class="floating-dialog" role="dialog" aria-labelledby="dialog-title"
                 tabindex="-1" :style="windowStyle" @keydown.stop @keydown.esc="emit('close')"
                 @pointerdown.stop @click.stop @dblclick.stop>
            <header class="dialog-titlebar" @pointerdown="startInteraction($event, 'move')"
                    @pointermove="moveInteraction" @pointerup="endInteraction" @pointercancel="endInteraction"
                    @lostpointercapture="endInteraction">
                <img :src="dialogDefinition?.icon || dialogIcon" alt="" draggable="false">
                <span id="dialog-title">{{ dialogTitle }}</span>
                <button class="close-button" type="button" aria-label="关闭" @pointerdown.stop @click="emit('close')">×</button>
            </header>

            <!-- 按控件类型和弹窗用途选择内容，后续弹窗统一在这里增加分支。 -->
            <template v-if="item.type === 'systemInput' && dialogType === 'input-rule'">
                <div class="dialog-toolbar">
                    <button type="button" @click="addRow">新增行</button>
                    <button type="button" :disabled="selectedRow === null" @click="deleteRow">删除行</button>
                    <button type="button" :disabled="rows.length === 0" @click="clearRows">清空</button>
                </div>

                <div class="table-container">
                    <table aria-label="输入规则">
                        <thead>
                            <tr>
                                <th scope="col" class="row-number"><span class="visually-hidden">行号</span></th>
                                <th v-for="column in columns" :key="column.key" scope="col" :title="column.title">{{ column.label }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in rows" :key="index" :class="{selected: selectedRow === index}"
                                tabindex="0" :aria-selected="selectedRow === index" @click="selectedRow = index"
                                @focus="selectedRow = index" @focusin="selectedRow = index" @keydown.delete.prevent="deleteRow">
                                <th scope="row" class="row-number">{{ index + 1 }}</th>
                                <td v-for="column in columns" :key="column.key">
                                    <input v-if="column.key === 'fillColor'" class="color-swatch" type="color"
                                           :value="row.fillColor" :aria-label="`第${index + 1}行填充色`"
                                           title="双击修改填充色，或按 Enter 打开颜色选择器"
                                           @click.prevent @dblclick="openColorPicker" @keydown.stop
                                           @keydown.enter.prevent="openColorPicker" @keydown.space.prevent="openColorPicker"
                                           @input="row.fillColor = $event.target.value"/>
                                    <div v-else-if="column.key === 'relativeWeight'" class="weight-cell">
                                        <input v-model.number="row.relativeWeight" class="cell-input" type="number" min="0" step="any"
                                               :aria-label="`第${index + 1}行相对比例值`" @keydown.stop/>
                                        <span class="probability">占比 {{ formatProbability(index) }}</span>
                                    </div>
                                    <input v-else-if="column.key === 'length' || column.key === 'width'"
                                           v-model.number="row[column.key]" class="cell-input" type="number" min="0" step="any"
                                           :aria-label="`第${index + 1}行${column.label}`" title="单位：毫米（mm），必须大于 0" @keydown.stop/>
                                    <input v-else v-model="row[column.key]" class="cell-input" type="text"
                                           :aria-label="`第${index + 1}行${column.label}`" @keydown.stop/>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="validationMessage" class="rule-error" role="alert">{{ validationMessage }}</p>
            </template>

            <footer class="dialog-footer">
                <button type="button" class="save-button" :disabled="!dialogDefinition || !!validationMessage" @click="saveDialog">保存退出</button>
                <button type="button" @click="emit('close')">退出</button>
            </footer>

            <div v-for="edge in resizeEdges" :key="edge" :class="['resize-handle', `resize-${edge}`]"
                 aria-hidden="true" @pointerdown="startInteraction($event, edge)" @pointermove="moveInteraction"
                 @pointerup="endInteraction" @pointercancel="endInteraction" @lostpointercapture="endInteraction"/>
        </section>
    </Teleport>
</template>

<script setup>
import {computed, onBeforeUnmount, onMounted, reactive, ref, watch} from 'vue';
import {getComponentLabel} from '../utils/componentLabel.js';
import systemInputIcon from '../assets/icons/systemInput.svg';
import dialogIcon from '../assets/icons/logo.svg';
import {PART_COLORS, getInputRuleProbabilities, getInputRuleValidationMessage, getDefaultWorkpieceDimensions} from '../utils/inputRules.js';

const props = defineProps({
    item: {type: Object, required: true},
    dialogType: {type: String, required: true},
});
const emit = defineEmits(['close', 'save']);
const dialog = ref(null);
// 第一层区分控件类型，第二层区分该控件的弹窗用途。
const dialogDefinitions = {
    systemInput: {
        'input-rule': {
            title: '产生的 Part 类型及相对比例',
            icon: systemInputIcon,
            dataField: 'inputRuleRows',
        },
    },
};
const dialogDefinition = computed(() => dialogDefinitions[props.item.type]?.[props.dialogType]);
const dialogTitle = computed(() => getComponentLabel(props.item) + (dialogDefinition.value?.title ?? '设置'));

// 输入规则窗口的草稿，仅在保存时写回对应控件。
const rows = ref([]);
const selectedRow = ref(null);
let nextPartNumber = 1;
watch(() => [props.item.id, props.item.type, props.dialogType], () => {
    const savedRows = props.item[dialogDefinition.value?.dataField];
    rows.value = Array.isArray(savedRows) ? savedRows.map((row, index) => ({
        ...row,
        partType: row.partType ?? `Part${index + 1}`,
        name: row.name ?? '',
        length: row.length ?? getDefaultWorkpieceDimensions(props.item).length,
        width: row.width ?? getDefaultWorkpieceDimensions(props.item).width,
        fillColor: row.fillColor ?? PART_COLORS[index % PART_COLORS.length],
        relativeWeight: row.relativeWeight ?? 100,
    })) : [];
    nextPartNumber = rows.value.reduce((max, row) => {
        const match = /^Part(\d+)$/.exec(row.partType);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    selectedRow.value = null;
}, {immediate: true});

const validationMessage = computed(() => getInputRuleValidationMessage(rows.value));
const probabilities = computed(() => validationMessage.value ? [] : getInputRuleProbabilities(rows.value));

function formatProbability(index) {
    const probability = probabilities.value[index];
    return probability === undefined ? '—' : `${Number((probability * 100).toFixed(2))}%`;
}

function openColorPicker(event) {
    event.currentTarget.showPicker();
}

function saveDialog() {
    if (!dialogDefinition.value || validationMessage.value) return;
    emit('save', {
        itemId: props.item.id,
        dialogType: props.dialogType,
        properties: {
            [dialogDefinition.value.dataField]: rows.value.map(row => ({
                ...row, partType: row.partType.trim(), name: row.name.trim(),
            })),
        },
    });
}
const columns = [
    {key: 'partType', label: 'Part类型'},
    {key: 'name', label: '名称'},
    {key: 'length', label: '实际长度', title: '单位：毫米（mm）'},
    {key: 'width', label: '实际宽度', title: '单位：毫米（mm）'},
    {key: 'fillColor', label: '填充色'},
    {key: 'relativeWeight', label: '相对比例值'}
];

function addRow() {
    rows.value.push({
        partType: `Part${nextPartNumber}`,
        name: '',
        ...getDefaultWorkpieceDimensions(props.item),
        fillColor: PART_COLORS[(nextPartNumber - 1) % PART_COLORS.length],
        relativeWeight: 100,
    });
    nextPartNumber++;
    selectedRow.value = rows.value.length - 1;
}

function deleteRow() {
    if (selectedRow.value === null) return;
    rows.value.splice(selectedRow.value, 1);
    selectedRow.value = rows.value.length ? Math.min(selectedRow.value, rows.value.length - 1) : null;
}

function clearRows() {
    rows.value = [];
    selectedRow.value = null;
    nextPartNumber = 1;
}

// 每次打开采用相同的默认位置和尺寸，小视口下自动缩小到可见范围。
const bounds = reactive({
    left: Math.max(8, (window.innerWidth - 920) / 2),
    top: Math.min(120, Math.max(8, window.innerHeight - 568)),
    width: Math.min(920, window.innerWidth - 16),
    height: Math.min(560, window.innerHeight - 16),
});
const windowStyle = computed(() => ({
    left: `${bounds.left}px`, top: `${bounds.top}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px`,
}));
const resizeEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
let interaction = null;

function startInteraction(event, mode) {
    if (event.button !== 0) return;
    event.preventDefault();
    dialog.value.focus({preventScroll: true});
    interaction = {mode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...bounds};
    event.currentTarget.setPointerCapture(event.pointerId);
}

function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const start = interaction;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.mode === 'move') {
        bounds.left = Math.max(0, Math.min(window.innerWidth - bounds.width, start.left + dx));
        bounds.top = Math.max(0, Math.min(window.innerHeight - bounds.height, start.top + dy));
        return;
    }

    const minWidth = Math.min(420, window.innerWidth);
    const minHeight = Math.min(260, window.innerHeight);
    if (start.mode.includes('e')) {
        bounds.width = Math.max(minWidth, Math.min(window.innerWidth - start.left, start.width + dx));
    }
    if (start.mode.includes('s')) {
        bounds.height = Math.max(minHeight, Math.min(window.innerHeight - start.top, start.height + dy));
    }
    if (start.mode.includes('w')) {
        bounds.left = Math.max(0, Math.min(start.left + start.width - minWidth, start.left + dx));
        bounds.width = start.left + start.width - bounds.left;
    }
    if (start.mode.includes('n')) {
        bounds.top = Math.max(0, Math.min(start.top + start.height - minHeight, start.top + dy));
        bounds.height = start.top + start.height - bounds.top;
    }
}

function endInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    interaction = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
}

function fitToViewport() {
    interaction = null;
    bounds.width = Math.min(bounds.width, window.innerWidth);
    bounds.height = Math.min(bounds.height, window.innerHeight);
    bounds.left = Math.max(0, Math.min(bounds.left, window.innerWidth - bounds.width));
    bounds.top = Math.max(0, Math.min(bounds.top, window.innerHeight - bounds.height));
}

let previousFocus;
onMounted(() => {
    previousFocus = document.activeElement;
    dialog.value.focus({preventScroll: true});
    window.addEventListener('resize', fitToViewport);
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', fitToViewport);
    if (dialog.value?.contains(document.activeElement) && previousFocus?.isConnected) {
        previousFocus.focus({preventScroll: true});
    }
});
</script>

<style scoped>
.floating-dialog {
    position: fixed;
    z-index: 1050;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid #858585;
    background: #f5f5f5;
    box-shadow: 0 3px 12px #0003;
    color: #1f2937;
    font-family: inherit;
    font-size: 13px;
    outline: none;
}
.dialog-titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding-left: 10px;
    cursor: move;
    touch-action: none;
    user-select: none;
}
.dialog-titlebar img { width: 22px; height: 22px; }
.dialog-titlebar span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #737b87; }
.floating-dialog button {
    min-width: 82px;
    padding: 5px 16px;
    border: 1px solid #d5d5d5;
    border-radius: 6px;
    background: #fff;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.floating-dialog button:hover { background: #eaf2ff; }
.floating-dialog button:focus-visible { outline: 2px solid #4b8dff; outline-offset: 1px; }
.floating-dialog button:disabled { opacity: .45; cursor: default; }
.floating-dialog .close-button {
    align-self: stretch;
    min-width: 42px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    font-size: 23px;
}
.floating-dialog .close-button:hover { background: #e81123; color: white; }
.dialog-toolbar { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; padding: 10px 8px 8px; }
.table-container { flex: 1; min-height: 0; margin: 0 7px; overflow: auto; border: 2px solid #5b96ff; background: white; }
table { width: 100%; min-width: 760px; border-collapse: collapse; table-layout: fixed; }
th, td { height: 26px; padding: 0 6px; text-align: center; font-weight: normal; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
thead { position: sticky; top: 0; z-index: 1; background: white; }
thead th { height: 30px; border-right: 1px solid #e9edf2; border-bottom: 1px solid #e9edf2; }
th:last-child { width: 24%; }
.row-number { width: 40px; background: white; color: #1f2937; }
tbody tr { cursor: default; }
tbody tr.selected td { background: #065de8; color: white; }
tbody tr:focus-visible { outline: 1px solid #111; outline-offset: -1px; }
.color-swatch {
    display: block;
    box-sizing: border-box;
    width: calc(100% + 12px);
    height: 42px;
    margin: 0 -6px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
}
.color-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.color-swatch::-webkit-color-swatch { border: none; }
.color-swatch::-moz-color-swatch { border: none; }
.cell-input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: center;
}
.cell-input:focus { outline: none; border-color: #4b8dff; background: white; color: #1f2937; }
.weight-cell { display: flex; flex-direction: column; align-items: center; }
.probability { font-size: 11px; opacity: .8; }
.rule-error { margin: 6px 8px 0; color: #b91c1c; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 8px 8px; }
.floating-dialog .save-button { border-color: #0780ff; background: #0780ff; color: white; }
.floating-dialog .save-button:hover { background: #006ad9; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.resize-handle { position: absolute; touch-action: none; }
.resize-n, .resize-s { left: 6px; right: 6px; height: 6px; cursor: ns-resize; }
.resize-n { top: -3px; } .resize-s { bottom: -3px; }
.resize-e, .resize-w { top: 6px; bottom: 6px; width: 6px; cursor: ew-resize; }
.resize-e { right: -3px; } .resize-w { left: -3px; }
.resize-ne, .resize-nw, .resize-se, .resize-sw { width: 10px; height: 10px; }
.resize-ne, .resize-sw { cursor: nesw-resize; }
.resize-nw, .resize-se { cursor: nwse-resize; }
.resize-ne { top: -3px; right: -3px; } .resize-nw { top: -3px; left: -3px; }
.resize-se { bottom: -3px; right: -3px; } .resize-sw { bottom: -3px; left: -3px; }
</style>

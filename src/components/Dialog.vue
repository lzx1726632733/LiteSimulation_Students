<template>
    <Teleport to="body">
        <section ref="dialog" class="floating-dialog" role="dialog" aria-labelledby="dialog-title"
                 tabindex="-1" :style="windowStyle" @keydown.stop @keydown.esc="emit('close')"
                 @pointerdown.stop @click.stop @dblclick.stop>
            <header class="dialog-titlebar" @pointerdown="startInteraction($event, 'move')"
                    @pointermove="moveInteraction" @pointerup="endInteraction" @pointercancel="endInteraction"
                    @lostpointercapture="endInteraction">
                <img :src="activeDialogIcon" alt="" draggable="false">
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

            <template v-else-if="isBomEditor">
                <div class="assembly-fields" :class="{'disassembly-fields': isDisassemblyEditor}">
                    <label>{{ bomObjectLabel }}类型 <input v-model="recipeDraft.productType" type="text" required></label>
                    <label v-if="isAssemblyEditor">类型
                        <select v-if="assemblyMode === 'container'" v-model="recipeDraft.packingType">
                            <option v-for="type in CONTAINER_TYPES" :key="type">{{ type }}</option>
                        </select>
                        <input v-else :value="recipeDraft.packingType" disabled>
                    </label>
                    <label>{{ isDisassemblyEditor ? '拆卸时长' : '装配时长' }}
                        <input v-model="recipeDraft[durationField]" title="dd:hh:mm:ss.ms" required
                               @blur="formatBomDuration(durationField)">
                    </label>
                    <label>{{ bomObjectLabel }}名称 <input v-model="recipeDraft.name" type="text"></label>
                    <label v-if="isAssemblyEditor">颜色
                        <input class="assembly-color" type="color" v-model="recipeDraft.fillColor"
                               :style="{'--assembly-fill': recipeDraft.fillColor}"
                               title="双击修改颜色，或按 Enter 打开颜色选择器"
                               @click.prevent @dblclick="openColorPicker"
                               @keydown.enter.prevent="openColorPicker" @keydown.space.prevent="openColorPicker">
                    </label>
                    <label>准备时长
                        <input v-model="recipeDraft.setupTime" title="dd:hh:mm:ss.ms" required
                               @blur="formatBomDuration('setupTime')">
                    </label>
                </div>
                <p v-if="isDisassemblyEditor && disassemblyMode === 'container'" class="bom-hint">提示：容器到站后自动卸下全部零件，无需填写 BOM。</p>
                <div class="table-container assembly-materials">
                    <table :aria-label="isDisassemblyEditor ? '拆卸零件清单' : '装配所需工件'">
                        <thead>
                            <tr>
                                <th scope="col">{{ materialTypeLabel }}</th>
                                <th scope="col">{{ materialLabel }}数量</th>
                                <th scope="col">{{ materialLabel }}名称</th>
                                <th v-if="isDisassemblyEditor" scope="col">零件颜色</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in recipeDraft.materials" :key="index" tabindex="0"
                                :class="{selected: selectedMaterialRow === index}" :aria-selected="selectedMaterialRow === index"
                                @click="selectedMaterialRow = index" @focusin="selectedMaterialRow = index">
                                <td><input v-model="row.partType" class="cell-input" :aria-label="`第 ${index + 1} 行${materialTypeLabel}`" required></td>
                                <td><input v-model.number="row.quantity" class="cell-input" type="number" min="1" step="1"
                                           :aria-label="`第 ${index + 1} 行${materialLabel}数量`" required></td>
                                <td><input v-model="row.name" class="cell-input" :aria-label="`第 ${index + 1} 行${materialLabel}名称`"></td>
                                <td v-if="isDisassemblyEditor">
                                    <input v-model="row.fillColor" class="color-swatch" type="color"
                                           :aria-label="`第 ${index + 1} 行零件颜色`"
                                           title="双击修改颜色，或按 Enter 打开颜色选择器"
                                           @click.prevent @dblclick="openColorPicker"
                                           @keydown.enter.prevent="openColorPicker" @keydown.space.prevent="openColorPicker">
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="bomError" class="rule-error" role="alert">{{ bomError }}</p>
            </template>

            <form v-else-if="isConnectionRadiusEditor" id="connection-radius-form" class="connection-radius-form"
                  @submit.prevent="saveConnectionRadius">
                <label for="connection-radius">半径（米）</label>
                <input ref="radiusInput" id="connection-radius" v-model.number="radiusDraft" type="number"
                       step="any" min="0" :max="connectionCorner?.maxRadius" required
                       aria-describedby="connection-radius-range"/>
                <p id="connection-radius-range" v-if="connectionCorner">
                    范围 0 至 {{ connectionCorner.maxRadius }} 米。输入 0 恢复为拐点。
                </p>
                <p id="connection-radius-range" v-else>当前拐点已不可用。</p>
            </form>

            <footer class="dialog-footer">
                <template v-if="isBomEditor">
                    <button type="button" @click="addMaterialRow">增加行</button>
                    <button type="button" :disabled="selectedMaterialRow === null" @click="deleteMaterialRow">删除行</button>
                    <button type="button" class="save-button" :disabled="!!bomError" @click="saveBomRecipe">确定</button>
                    <button type="button" @click="emit('close')">取消</button>
                </template>
                <template v-else-if="isConnectionRadiusEditor">
                    <button type="submit" form="connection-radius-form" class="save-button" :disabled="!radiusValid">确定</button>
                    <button type="button" @click="emit('close')">取消</button>
                </template>
                <template v-else>
                    <button type="button" class="save-button" :disabled="!dialogDefinition || !!validationMessage" @click="saveDialog">保存退出</button>
                    <button type="button" @click="emit('close')">退出</button>
                </template>
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
import assemblyIcon from '../assets/icons/assemblyWorkstation.svg';
import disassemblyIcon from '../assets/icons/disassemblyWorkstation.svg';
import connectionIcon from '../assets/icons/connectionLine.svg';
import {PART_COLORS, getInputType, getInputRuleCategory, getInputRuleProbabilities, getInputRuleValidationMessage, getDefaultWorkpieceDimensions, parseGenerationInterval, formatGenerationInterval} from '../utils/inputRules.js';
import {CONTAINER_TYPES, getAssemblyRecipeError} from '../utils/assemblyRecipes.js';
import {getDisassemblyRecipeError} from '../utils/disassemblyRecipes.js';

const props = defineProps({
    item: {type: Object, required: true},
    dialogType: {type: String, required: true},
    assemblyRecipe: {type: Object, default: null},
    assemblyMode: {type: String, default: 'parts'},
    assemblyPackingType: {type: String, default: 'Workpiece'},
    disassemblyRecipe: {type: Object, default: null},
    disassemblyMode: {type: String, default: 'parts'},
    connectionCorner: {type: Object, default: null},
});
const emit = defineEmits(['close', 'save']);
const dialog = ref(null);
const inputType = computed(() => getInputType(props.item));
// 第一层区分控件类型，第二层区分该控件的弹窗用途。
const dialogDefinitions = {
    systemInput: {
        'input-rule': {
            icon: systemInputIcon,
            dataField: 'inputRuleRows',
        },
    },
};
const dialogDefinition = computed(() => dialogDefinitions[props.item.type]?.[props.dialogType]);
const isAssemblyEditor = computed(() => props.item.type === 'assemblyWorkstation' && props.dialogType === 'assembly-recipe');
const isDisassemblyEditor = computed(() => props.item.type === 'disassemblyWorkstation' && props.dialogType === 'disassembly-recipe');
const isBomEditor = computed(() => isAssemblyEditor.value || isDisassemblyEditor.value);
const isConnectionRadiusEditor = computed(() => props.item.type === 'connectionLine' && props.dialogType === 'connection-radius');
const radiusInput = ref(null);
const radiusDraft = ref(props.connectionCorner?.radius ?? '');
const radiusValid = computed(() => Number.isFinite(radiusDraft.value) && radiusDraft.value >= 0 &&
    radiusDraft.value <= (props.connectionCorner?.maxRadius ?? -1));

function saveConnectionRadius() {
    if (!radiusValid.value) return;
    emit('save', {itemId: props.item.id, dialogType: props.dialogType, radius: radiusDraft.value});
}

const activeDialogIcon = computed(() => {
    if (isConnectionRadiusEditor.value) return connectionIcon;
    if (isDisassemblyEditor.value) return disassemblyIcon;
    if (isAssemblyEditor.value) return assemblyIcon;
    return dialogDefinition.value?.icon || dialogIcon;
});
const originalRecipe = isDisassemblyEditor.value ? props.disassemblyRecipe : props.assemblyRecipe;
const durationField = isDisassemblyEditor.value ? 'disassemblyTime' : 'assemblyTime';
const dialogTitle = computed(() => {
    if (isConnectionRadiusEditor.value) return `${getComponentLabel(props.item)} · 编辑圆弧半径`;
    if (isBomEditor.value) {
        const title = isDisassemblyEditor.value ? '拆卸 BOM 清单' : 'BOM清单';
        return `${title} · ${originalRecipe ? '编辑行' : '增加行'}`;
    }
    return getComponentLabel(props.item) + (dialogDefinition.value ? `产生的 ${inputType.value} 类别及相对比例` : '设置');
});
const bomObjectLabel = computed(() => {
    if (isDisassemblyEditor.value) return props.disassemblyMode === 'container' ? '容器' : '部件';
    return props.assemblyMode === 'container' ? '容器' : '装配件';
});
const materialLabel = computed(() => isDisassemblyEditor.value ? '零件' : '工件');
const materialTypeLabel = computed(() => isDisassemblyEditor.value ? '零件类型' : '工件类别');
const recipeDraft = reactive({
    productType: originalRecipe?.productType ?? '',
    name: originalRecipe?.name ?? '',
    ...(isAssemblyEditor.value ? {
        packingType: props.assemblyPackingType ?? 'Workpiece',
        fillColor: originalRecipe?.fillColor ?? '#000000',
    } : {}),
    [durationField]: isBomEditor.value ? formatGenerationInterval(originalRecipe?.[durationField] ?? 300) : '',
    setupTime: isBomEditor.value ? formatGenerationInterval(originalRecipe?.setupTime ?? 0) : '',
    materials: originalRecipe?.materials?.map(row => ({...row})) ?? [],
});
const selectedMaterialRow = ref(null);
const normalizedRecipe = computed(() => ({
    ...recipeDraft,
    productType: recipeDraft.productType.trim(),
    name: recipeDraft.name.trim(),
    [durationField]: parseGenerationInterval(recipeDraft[durationField], {allowZero: true}),
    setupTime: parseGenerationInterval(recipeDraft.setupTime, {allowZero: true}),
    materials: recipeDraft.materials.map(row => ({...row, partType: row.partType.trim(), name: row.name.trim()})),
}));
const bomError = computed(() => isDisassemblyEditor.value
    ? getDisassemblyRecipeError(normalizedRecipe.value, {allowEmpty: props.disassemblyMode === 'container'})
    : getAssemblyRecipeError(normalizedRecipe.value));

function formatBomDuration(field) {
    const seconds = parseGenerationInterval(recipeDraft[field], {allowZero: true});
    if (Number.isFinite(seconds)) recipeDraft[field] = formatGenerationInterval(seconds);
}

function addMaterialRow() {
    const row = {partType: '', quantity: '', name: ''};
    if (isDisassemblyEditor.value) row.fillColor = '#000000';
    recipeDraft.materials.push(row);
    selectedMaterialRow.value = recipeDraft.materials.length - 1;
}

function deleteMaterialRow() {
    if (selectedMaterialRow.value === null) return;
    recipeDraft.materials.splice(selectedMaterialRow.value, 1);
    selectedMaterialRow.value = null;
}

function saveBomRecipe() {
    if (!isBomEditor.value || bomError.value) return;
    const field = isDisassemblyEditor.value ? 'disassemblyRecipe' : 'assemblyRecipe';
    emit('save', {itemId: props.item.id, dialogType: props.dialogType, [field]: normalizedRecipe.value});
}

// 输入规则窗口的草稿，仅在保存时写回对应控件。
const rows = ref([]);
const selectedRow = ref(null);
let nextColorIndex = 0;
watch(() => [props.item.id, props.item.type, props.dialogType], () => {
    const savedRows = props.item[dialogDefinition.value?.dataField];
    rows.value = Array.isArray(savedRows) ? savedRows.map(({entityType, ...row}, index) => ({
        ...row,
        partType: getInputRuleCategory({...row, entityType}) ?? '',
        name: row.name ?? '',
        length: row.length ?? getDefaultWorkpieceDimensions(props.item).length,
        width: row.width ?? getDefaultWorkpieceDimensions(props.item).width,
        fillColor: row.fillColor ?? PART_COLORS[index % PART_COLORS.length],
        relativeWeight: row.relativeWeight ?? 100,
    })) : [];
    nextColorIndex = rows.value.length;
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
const columns = computed(() => [
    {key: 'partType', label: `${inputType.value}类别`},
    {key: 'name', label: `${inputType.value}名称`},
    {key: 'length', label: '实际长度', title: '单位：毫米（mm）'},
    {key: 'width', label: '实际宽度', title: '单位：毫米（mm）'},
    {key: 'fillColor', label: '填充色'},
    {key: 'relativeWeight', label: '相对比例值'}
]);

function addRow() {
    rows.value.push({
        partType: inputType.value,
        name: '',
        ...getDefaultWorkpieceDimensions(props.item),
        fillColor: PART_COLORS[nextColorIndex % PART_COLORS.length],
        relativeWeight: 100,
    });
    nextColorIndex++;
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
    nextColorIndex = 0;
}

// 每次打开采用相同的默认位置和尺寸，小视口下自动缩小到可见范围。
const defaultWidth = isConnectionRadiusEditor.value ? 440 : 920;
const defaultHeight = isConnectionRadiusEditor.value ? 260 : 560;
const bounds = reactive({
    left: Math.max(8, (window.innerWidth - defaultWidth) / 2),
    top: Math.min(120, Math.max(8, window.innerHeight - defaultHeight - 8)),
    width: Math.min(defaultWidth, window.innerWidth - 16),
    height: Math.min(defaultHeight, window.innerHeight - 16),
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
    const focusTarget = radiusInput.value ?? dialog.value;
    focusTarget.focus({preventScroll: true});
    radiusInput.value?.select();
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
.assembly-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 14px; padding: 8px 12px 12px; overflow: auto; }
.assembly-fields.disassembly-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bom-hint { margin: 0 12px 8px; color: #c02626; }
.assembly-fields label { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.assembly-fields input, .assembly-fields select { min-width: 0; flex: 1 1 90px; height: 28px; padding: 3px 6px; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
.assembly-fields input:disabled { background: #e9edf2; color: #4b5563; cursor: default; }
.assembly-fields .assembly-color {
    appearance: none;
    padding: 0;
    border-radius: 0;
    border-color: color-mix(in srgb, var(--assembly-fill) 75%, black);
    background-color: var(--assembly-fill);
    cursor: pointer;
}
.assembly-color::-webkit-color-swatch-wrapper { padding: 0; }
.assembly-color::-webkit-color-swatch { border: 0; }
.assembly-color::-moz-color-swatch { border: 0; }
.assembly-materials table { min-width: 300px; }
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
.connection-radius-form { display: grid; align-content: start; gap: 8px; flex: 1; padding: 16px 12px; overflow: auto; }
.connection-radius-form input { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
.connection-radius-form p { margin: 0; overflow-wrap: anywhere; }
.dialog-footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; padding: 12px 8px 8px; }
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

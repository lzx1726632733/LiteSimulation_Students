<template>
    <FloatingDialog :title="dialogTitle" :icon="activeDialogIcon"
                    :default-width="defaultWidth" :default-height="defaultHeight" @close="emit('close')">
        <!-- 按控件类型和弹窗用途选择内容，后续弹窗统一在这里增加分支。 -->
        <template v-if="dialogDefinition">
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

        <template v-else-if="isAgvConfigurationEditor">
            <div class="table-container">
                <table class="agv-configuration-table" aria-label="AGV配置清单">
                    <thead>
                        <tr>
                            <th class="row-number" scope="col">序号</th>
                            <th scope="col">AGV起始站点</th>
                            <th scope="col">AGV数量</th>
                            <th v-for="field in agvNumericFields" :key="field.key" scope="col" :title="`单位：${field.unit}`">{{ field.label }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(row, index) in agvRows" :key="index" :class="{selected: selectedAgvRow === index}"
                            @click="selectedAgvRow = index" @focusin="selectedAgvRow = index">
                            <th class="row-number" scope="row">{{ index + 1 }}</th>
                            <td>
                                <select class="cell-input" :value="row.stationId" :aria-label="`第 ${index + 1} 行 AGV起始站点`"
                                        @change="setAgvStation(row, $event.target.value)">
                                    <option value="">请选择</option>
                                    <option v-for="station in availableAgvStations(row)" :key="station.id" :value="station.id">
                                        {{ getComponentLabel(station) }}
                                    </option>
                                </select>
                            </td>
                            <td>
                                <select class="cell-input" v-model="row.count" :disabled="!agvCapacities[index]"
                                        :aria-label="`第 ${index + 1} 行 AGV数量`">
                                    <option value="" disabled>请选择</option>
                                    <option v-for="count in Math.min(agvCapacities[index], agvCountOptionLimit)"
                                            :key="count" :value="count">{{ count }}</option>
                                    <option v-if="row.count > agvCountOptionLimit && row.count <= agvCapacities[index]"
                                            :value="row.count">{{ row.count }}</option>
                                </select>
                                <input v-if="agvCapacities[index] > agvCountOptionLimit" class="cell-input"
                                       v-model.number="row.count" type="number" min="1" :max="agvCapacities[index]"
                                       step="1" :aria-label="`第 ${index + 1} 行直接输入 AGV数量`"
                                       :title="`可直接输入数量，最大 ${agvCapacities[index]} 辆`"/>
                            </td>
                            <td v-for="field in agvNumericFields" :key="field.key">
                                <input class="cell-input" v-model.number="row[field.key]" type="number" step="any"
                                       :aria-label="`第 ${index + 1} 行 ${field.label}（${field.unit}）`"
                                       :title="`单位：${field.unit}，须大于 0`"/>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="agvRowsError" class="rule-error" role="status">{{ agvRowsError }}</p>
        </template>

        <form v-else-if="isConnectionRadiusEditor" id="connection-radius-form" class="numeric-dialog-form"
              @submit.prevent="saveConnectionRadius">
            <label for="connection-radius">半径（米）</label>
            <input ref="initialNumericInput" id="connection-radius" v-model.number="radiusDraft" type="number"
                   step="any" min="0" :max="connectionCorner?.maxRadius" required
                   aria-describedby="connection-radius-range"/>
            <p id="connection-radius-range" v-if="connectionCorner">
                范围 0 至 {{ connectionCorner.maxRadius }} 米。输入 0 恢复为拐点。
            </p>
            <p id="connection-radius-range" v-else>当前拐点已不可用。</p>
        </form>

        <form v-else-if="isFiniteCanvasEditor" id="finite-canvas-form" class="numeric-dialog-form"
              @submit.prevent="saveCanvasSize">
            <label class="canvas-size-field">
                <span>长度</span>
                <input ref="initialNumericInput" v-model.number="canvasSizeDraft.length" type="number"
                       step="any" min="0" required aria-label="长度（米）" title="X 方向"/>
                <span>m</span>
            </label>
            <label class="canvas-size-field">
                <span>宽度</span>
                <input v-model.number="canvasSizeDraft.width" type="number"
                       step="any" min="0" required aria-label="宽度（米）" title="Y 方向"/>
                <span>m</span>
            </label>
            <p v-if="canvasSizeError" class="rule-error" role="status">{{ canvasSizeError }}</p>
        </form>

        <form v-else-if="isTriangleEditor" id="triangle-definition-form" class="numeric-dialog-form"
              novalidate @submit.prevent="saveTriangleDefinition">
            <div class="triangle-definition">
                <svg viewBox="0 0 224 186" role="img" aria-label="角 A 在上方，B 在左下，C 在右下。边 1 是 AB，边 2 是 AC，边 3 是 BC。">
                    <path d="M112 25 30 150H194Z" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
                    <path d="M99 45Q112 53 125 45 M44 129Q56 136 56 150 M180 129Q168 136 168 150"
                          fill="none" stroke="#64748b" stroke-width="1"/>
                    <g text-anchor="middle" fill="#1f2937">
                        <text x="112" y="67">A</text>
                        <text x="68" y="141">B</text>
                        <text x="156" y="141">C</text>
                        <text x="59" y="85">1</text>
                        <text x="165" y="85">2</text>
                        <text x="112" y="172">3</text>
                    </g>
                </svg>
                <div class="triangle-fields">
                    <label v-for="field in TRIANGLE_FIELDS" :key="field.key">
                        <span>{{ field.label }}</span>
                        <input v-model="triangleDraft[field.key]" type="number" step="any"
                               :placeholder="triangleSolution.parameters ? formatTriangleValue(triangleSolution.parameters[field.key]) : ''"
                               aria-describedby="triangle-definition-status"/>
                        <span>{{ field.unit }}</span>
                    </label>
                </div>
            </div>
            <p id="triangle-definition-status" role="status" :class="{'rule-error': triangleError}">
                {{ triangleError || triangleSolution.hint || '三角形已确定。空白输入框中的灰色数值为计算结果。' }}
            </p>
        </form>

        <template #footer>
            <template v-if="isBomEditor">
                <button type="button" @click="addMaterialRow">增加行</button>
                <button type="button" :disabled="selectedMaterialRow === null" @click="deleteMaterialRow">删除行</button>
                <button type="button" class="save-button" :disabled="!!bomError" @click="saveBomRecipe">确定</button>
                <button type="button" @click="emit('close')">取消</button>
            </template>
            <template v-else-if="isAgvConfigurationEditor">
                <button type="button" @click="addAgvRow">增加行</button>
                <button type="button" :disabled="selectedAgvRow === null" @click="deleteAgvRow">删除行</button>
                <button type="button" class="save-button" :disabled="!!agvRowsError" @click="saveAgvRows">确认</button>
                <button type="button" @click="emit('close')">取消</button>
            </template>
            <template v-else-if="isConnectionRadiusEditor || isFiniteCanvasEditor">
                <button type="submit" :form="isFiniteCanvasEditor ? 'finite-canvas-form' : 'connection-radius-form'"
                        class="save-button" :disabled="isFiniteCanvasEditor ? !!canvasSizeError : !radiusValid">确定</button>
                <button type="button" @click="emit('close')">取消</button>
            </template>
            <template v-else-if="isTriangleEditor">
                <button type="submit" form="triangle-definition-form" class="save-button"
                        :disabled="!triangleSolution.vertices || !!triangleError">确定</button>
                <button type="button" @click="emit('close')">取消</button>
            </template>
            <template v-else>
                <button type="button" class="save-button" :disabled="!dialogDefinition || !!validationMessage" @click="saveDialog">保存退出</button>
                <button type="button" @click="emit('close')">退出</button>
            </template>
        </template>
    </FloatingDialog>
</template>

<script setup>
import {computed, onMounted, reactive, ref, watch} from 'vue';
import FloatingDialog from './FloatingDialog.vue';
import {getComponentLabel} from '../utils/componentLabel.js';
import systemInputIcon from '../assets/icons/systemInput.svg';
import dialogIcon from '../assets/icons/logo.svg';
import assemblyIcon from '../assets/icons/assemblyWorkstation.svg';
import disassemblyIcon from '../assets/icons/disassemblyWorkstation.svg';
import connectionIcon from '../assets/icons/connectionLine.svg';
import canvasIcon from '../assets/icons/canvas.svg';
import triangleIcon from '../assets/icons/triangularObstacle.svg';
import {PART_COLORS, INPUT_RULE_DEFAULT_DIMENSIONS, getInputType, getInputRuleCategory, getInputRuleProbabilities, getInputRuleValidationMessage, parseGenerationInterval, formatGenerationInterval} from '../utils/inputRules.js';
import {CONTAINER_TYPES, getAssemblyRecipeError} from '../utils/assemblyRecipes.js';
import {getDisassemblyRecipeError} from '../utils/disassemblyRecipes.js';
import {getCanvasSizeError} from '../utils/canvasBoundary.js';
import {formatTriangleValue, solveTriangle, TRIANGLE_FIELDS} from '../utils/triangleObstacle.js';
import {AGV_CONFIGURATION_TYPE, DEFAULT_AGV_DIMENSIONS, DEFAULT_AGV_SPEED, getAgvDimensions, getAgvParkingStations, getAgvParkingCapacity, getAgvRowsError} from '../utils/agvConfiguration.js';

const props = defineProps({
    item: {type: Object, default: null},
    dialogType: {type: String, required: true},
    assemblyRecipe: {type: Object, default: null},
    assemblyMode: {type: String, default: 'parts'},
    assemblyPackingType: {type: String, default: 'Workpiece'},
    disassemblyRecipe: {type: Object, default: null},
    disassemblyMode: {type: String, default: 'parts'},
    connectionCorner: {type: Object, default: null},
    canvasSize: {type: Object, default: null},
    minimumCanvasSize: {type: Object, default: undefined},
    validateTriangle: {type: Function, default: null},
    placedComponents: {type: Array, default: () => []},
});
const emit = defineEmits(['close', 'save']);
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
const dialogDefinition = computed(() => dialogDefinitions[props.item?.type]?.[props.dialogType]);
const isAssemblyEditor = computed(() => props.item?.type === 'assemblyWorkstation' && props.dialogType === 'assembly-recipe');
const isDisassemblyEditor = computed(() => props.item?.type === 'disassemblyWorkstation' && props.dialogType === 'disassembly-recipe');
const isBomEditor = computed(() => isAssemblyEditor.value || isDisassemblyEditor.value);
const isConnectionRadiusEditor = computed(() => props.dialogType === 'connection-radius' &&
    (props.item?.type === 'connectionLine' || props.item?.type === 'AGVpath'));
const isFiniteCanvasEditor = computed(() => props.dialogType === 'finite-canvas');
const isTriangleEditor = computed(() => props.dialogType === 'triangle-definition');
const isAgvConfigurationEditor = computed(() => props.dialogType === 'agv-configuration' && props.item?.type === AGV_CONFIGURATION_TYPE);
const agvNumericFields = [
    {key: 'length', label: 'AGV长', unit: 'mm'},
    {key: 'width', label: 'AGV宽', unit: 'mm'},
    {key: 'emptySpeed', label: 'AGV空载速度', unit: 'm/s'},
    {key: 'loadedSpeed', label: 'AGV负载速度', unit: 'm/s'},
];
const agvCountOptionLimit = 500;
const agvRows = ref((props.item?.agvRows ?? []).map(row => ({...row, ...getAgvDimensions(row)})));
const selectedAgvRow = ref(null);
const agvParkingStations = computed(() => getAgvParkingStations(props.placedComponents));
const agvStationById = computed(() => new Map(agvParkingStations.value.map(station => [station.id, station])));
const agvCapacity = row => getAgvParkingCapacity(agvStationById.value.get(row.stationId), row);
const agvCapacities = computed(() => agvRows.value.map(agvCapacity));
const agvRowsError = computed(() => getAgvRowsError(agvRows.value, props.placedComponents));

function availableAgvStations(row) {
    const used = new Set(agvRows.value.filter(other => other !== row).map(other => other.stationId));
    return agvParkingStations.value.filter(station => station.id === row.stationId || !used.has(station.id));
}

function setAgvStation(row, stationId) {
    row.stationId = stationId;
    row.count = agvCapacity(row) ? 1 : '';
}

function addAgvRow() {
    agvRows.value.push({stationId: '', count: '', ...DEFAULT_AGV_DIMENSIONS, emptySpeed: DEFAULT_AGV_SPEED, loadedSpeed: DEFAULT_AGV_SPEED});
    selectedAgvRow.value = agvRows.value.length - 1;
}

function deleteAgvRow() {
    if (selectedAgvRow.value === null) return;
    agvRows.value.splice(selectedAgvRow.value, 1);
    selectedAgvRow.value = agvRows.value.length ? Math.min(selectedAgvRow.value, agvRows.value.length - 1) : null;
}

function saveAgvRows() {
    if (agvRowsError.value) return;
    emit('save', {itemId: props.item.id, dialogType: props.dialogType, agvRows: agvRows.value});
}

const triangleDraft = reactive({});
const triangleSolution = computed(() => solveTriangle(triangleDraft));
const triangleError = computed(() => triangleSolution.value.error ||
    (triangleSolution.value.vertices && props.validateTriangle?.(triangleSolution.value.vertices)));

function saveTriangleDefinition() {
    if (!triangleSolution.value.vertices || triangleError.value) return;
    emit('save', {itemId: props.item.id, dialogType: props.dialogType, triangleVertices: triangleSolution.value.vertices});
}
const initialNumericInput = ref(null);
const radiusDraft = ref(props.connectionCorner?.radius ?? '');
const radiusValid = computed(() => Number.isFinite(radiusDraft.value) && radiusDraft.value >= 0 &&
    radiusDraft.value <= (props.connectionCorner?.maxRadius ?? -1));

function saveConnectionRadius() {
    if (!radiusValid.value) return;
    emit('save', {itemId: props.item.id, dialogType: props.dialogType, radius: radiusDraft.value});
}

const canvasSizeDraft = reactive({length: props.canvasSize?.length ?? '', width: props.canvasSize?.width ?? ''});
const canvasSizeError = computed(() => getCanvasSizeError(canvasSizeDraft, props.minimumCanvasSize));

function saveCanvasSize() {
    if (canvasSizeError.value) return;
    emit('save', {dialogType: props.dialogType, canvasSize: {...canvasSizeDraft}});
}

const activeDialogIcon = computed(() => {
    if (isAgvConfigurationEditor.value) return props.item.icon || dialogIcon;
    if (isTriangleEditor.value) return triangleIcon;
    if (isFiniteCanvasEditor.value) return canvasIcon;
    if (isConnectionRadiusEditor.value) return props.item.icon || connectionIcon;
    if (isDisassemblyEditor.value) return disassemblyIcon;
    if (isAssemblyEditor.value) return assemblyIcon;
    return dialogDefinition.value?.icon || dialogIcon;
});
const originalRecipe = isDisassemblyEditor.value ? props.disassemblyRecipe : props.assemblyRecipe;
const durationField = isDisassemblyEditor.value ? 'disassemblyTime' : 'assemblyTime';
const dialogTitle = computed(() => {
    if (isAgvConfigurationEditor.value) return `${getComponentLabel(props.item)} · 编辑表格`;
    if (isTriangleEditor.value) return `${getComponentLabel(props.item)} · 定义三角形`;
    if (isFiniteCanvasEditor.value) return '有限画布';
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
watch(() => [props.item?.id, props.item?.type, props.dialogType], () => {
    const savedRows = props.item?.[dialogDefinition.value?.dataField];
    rows.value = Array.isArray(savedRows) ? savedRows.map(({entityType, ...row}, index) => ({
        ...row,
        partType: getInputRuleCategory({...row, entityType}) ?? '',
        name: row.name ?? '',
        length: row.length ?? INPUT_RULE_DEFAULT_DIMENSIONS.length,
        width: row.width ?? INPUT_RULE_DEFAULT_DIMENSIONS.width,
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
        ...INPUT_RULE_DEFAULT_DIMENSIONS,
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

const compactDialog = isConnectionRadiusEditor.value || isFiniteCanvasEditor.value;
const defaultWidth = isAgvConfigurationEditor.value ? 800 : isTriangleEditor.value ? 560 : compactDialog ? 440 : 920;
const defaultHeight = isAgvConfigurationEditor.value ? 420 : isTriangleEditor.value ? 370 : compactDialog ? 260 : 560;
onMounted(() => {
    initialNumericInput.value?.focus({preventScroll: true});
    initialNumericInput.value?.select();
});
</script>

<style scoped>
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
.agv-configuration-table { min-width: 620px; }
.agv-configuration-table th:last-child { width: auto; }
.agv-configuration-table option { background: white; color: #1f2937; }
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
.numeric-dialog-form { display: grid; align-content: start; gap: 8px; flex: 1; padding: 16px 12px; overflow: auto; }
.numeric-dialog-form input { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
.numeric-dialog-form p { margin: 0; overflow-wrap: anywhere; }
.canvas-size-field { display: grid; grid-template-columns: 3em minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.triangle-definition { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.triangle-definition svg { width: 100%; max-width: 224px; flex: 1 1 170px; margin-inline: auto; font-size: 15px; }
.triangle-fields { flex: 1 1 220px; min-width: 0; display: grid; gap: 6px; }
.triangle-fields label { display: grid; grid-template-columns: 6em minmax(0, 1fr) 1em; align-items: center; gap: 6px; }
.triangle-fields input::placeholder { color: #556274; opacity: 1; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>

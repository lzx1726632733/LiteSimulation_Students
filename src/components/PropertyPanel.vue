<template>
    <div class="property-panel">
        <div class="panel-header">
            <span class="panel-title">属性面板</span>
        </div>
        <div class="panel-content">
            <!-- 未选中任何元素 -->
            <div v-if="!selectedItem" class="empty-state">
                <div class="empty-icon">📋</div>
                <p class="empty-text">请在画布中选择一个元素</p>
            </div>

            <!-- 已选中元素 -->
            <div v-else class="prop-list">
                <!-- 基本信息 -->
                <div class="prop-section">
                    <div class="section-title">基本信息</div>
                    <div class="prop-row">
                        <span class="prop-key">名称</span>
                        <span class="prop-value">{{ getComponentLabel(selectedItem) }}</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">类型</span>
                        <span class="prop-value">{{ selectedItem.type === 'node' ? '站点' : selectedItem.type }}</span>
                    </div>
                </div>
                <!-- 站点 -->
                <div v-if="selectedItem.type === 'node'" class="prop-section">
                    <div class="section-title">站点设置</div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="station-type">站点类型</label>
                        <select id="station-type" class="property-input station-type-select" :value="stationStyle.value"
                                @change="handleStationTypeChange">
                            <option v-for="type in STATION_TYPES" :key="type.value" :value="type.value">{{
                                    type.label
                                }}
                            </option>
                        </select>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">区域颜色</span>
                        <span class="station-color"
                              :style="{ backgroundColor: stationStyle.fill, borderColor: stationStyle.color }"></span>
                        <span class="prop-value">随站点类型设置</span>
                    </div>
                </div>
                <!-- 是可调整大小的组件：“尺寸与外观” -->
                <div v-if="isResizableComponent" class="prop-section">
                    <div class="section-title">尺寸与外观</div>
                    <div class="prop-row dimension-row">
                        <span class="prop-key">水平尺寸</span>
                        <input class="property-input" type="number" min="0.01" step="0.01" :value="widthInMeters"
                               @input="handleDimensionChange('width', $event)"
                               @blur="handleDimensionBlur('width', $event)"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row dimension-row">
                        <span class="prop-key">垂直尺寸</span>
                        <input class="property-input" type="number" min="0.01" step="0.01" :value="heightInMeters"
                               @input="handleDimensionChange('height', $event)"
                               @blur="handleDimensionBlur('height', $event)"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div v-if="selectedItem.type !== 'node'" class="prop-row dimension-row">
                        <span class="prop-key">阴影颜色</span>
                        <input class="color-input" type="color" :value="shadowColor" @input="handleShadowColorChange"/>
                        <span class="color-value">{{ shadowColor }}</span>
                    </div>
                </div>

                <!-- 连接线：连接关系 -->
                <div v-if="selectedItem.type === 'connectionLine'" class="prop-section">
                    <div class="section-title">连接关系</div>
                    <div class="prop-row">
                        <span class="prop-key">起点</span>
                        <span class="prop-value">{{ fromLabel }}</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">终点</span>
                        <span class="prop-value">{{ toLabel }}</span>
                    </div>
                    <div class="section-title" style="margin-top: 10px">连接线属性</div>
                    <div class="prop-row dimension-row">
                        <span id="connection-affected-endpoint-label" class="prop-key">更改时影响</span>
                        <div class="connection-endpoint-options" role="radiogroup" aria-labelledby="connection-affected-endpoint-label"
                             title="仅修改实际长度和角度时移动所选端组件">
                            <label v-for="option in connectionEndpointOptions" :key="option.value" class="square-radio-label">
                                <input type="radio" class="square-radio" :name="`connection-endpoint-${selectedItem.id}`"
                                       :value="option.value" :checked="connectionAffectedEndpoint === option.value"
                                       @change="emit('update-component-properties', {id: selectedItem.id, affectedEndpoint: option.value})"/>
                                {{ option.label }}
                            </label>
                        </div>
                    </div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="connection-length">实际长度</label>
                        <input id="connection-length" class="property-input" type="number" min="0" step="0.01"
                               :value="connectionLength" :disabled="!connectionGeometry"
                               title="按起点和终点组件的中心坐标计算，单位为米"
                               @change="handleConnectionPropertyChange('length', $event)"
                               @blur="handleConnectionPropertyChange('length', $event)"
                               @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="connection-angle">角度</label>
                        <input id="connection-angle" class="property-input" type="number" min="-360" max="360" step="0.01"
                               :value="connectionAngle" :disabled="!connectionGeometry"
                               title="+X 方向为 0°，+Y 方向为 90°，范围 -360°～360°"
                               @change="handleConnectionPropertyChange('angle', $event)"
                               @blur="handleConnectionPropertyChange('angle', $event)"
                               @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">°</span>
                    </div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="connection-workpiece-speed">工件速度</label>
                        <input id="connection-workpiece-speed" class="property-input" type="number" min="0" step="0.01"
                               :value="connectionWorkpieceSpeed"
                               @change="handleConnectionPropertyChange('workpieceSpeed', $event)"
                               @blur="handleConnectionPropertyChange('workpieceSpeed', $event)"
                               @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m/s</span>
                    </div>
                </div>

                <!-- AGV 路径：连接关系和圆角设置 -->
                <div v-else-if="selectedItem.type === 'AGVpath'" class="prop-section">
                    <div class="section-title">路径区域</div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="agv-path-width">通道宽度</label>
                        <input id="agv-path-width" class="property-input" type="number" min="0.01" step="0.01"
                               :value="pathWidthInMeters" @change="handlePathWidthChange"
                               @blur="handlePathWidthChange"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">行驶方向</span>
                        <span class="prop-value">起点 → 终点</span>
                        <button class="path-direction-btn"
                                @click="emit('update-component-properties', { id: selectedItem.id, reverseDirection: true })">
                            反向
                        </button>
                    </div>
                    <div class="section-title">连接关系</div>
                    <div class="prop-row">
                        <span class="prop-key">起点站点</span>
                        <span class="prop-value">{{ fromLabel }}</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">终点站点</span>
                        <span class="prop-value">{{ toLabel }}</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">节点数</span>
                        <span class="prop-value">{{ selectedItem.nodes?.length || 0 }}</span>
                    </div>

                </div>

                <!-- 普通控件和站点：可编辑的中心点物理坐标 -->
                <div v-else class="prop-section">
                    <div class="section-title">中心点物理坐标</div>
                    <div v-for="axis in ['x', 'y']" :key="`${selectedItem.id}-${axis}`" class="prop-row dimension-row">
                        <label class="prop-key" :for="`center-coordinate-${axis}`">{{ axis.toUpperCase() }} 坐标</label>
                        <input
                            :id="`center-coordinate-${axis}`"
                            class="property-input"
                            type="number"
                            step="0.01"
                            :value="centerCoordinates[axis]"
                            @change="handleCenterCoordinateChange(axis, $event)"
                            @blur="handleCenterCoordinateChange(axis, $event)"
                            @keydown.enter.prevent="$event.target.blur()"
                        />
                        <span class="property-unit">m</span>
                    </div>
                </div>
                <!-- 矩形控件独特功能 -->
                <div class="prop-section" >
                    <!--  输入控件  -->
                    <div v-if="selectedItem.type === 'systemInput'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title" >工件属性</div>
                        <div class="prop-row input-property-row input-rule-row">
                            <label class="prop-key" for="input-rules">输入规则</label>
                            <select id="input-rules" name="inputRules" class="property-input">
                                <option value="default">默认方式</option>
                                <option value="order-form">订单表</option>
                                <option value="data-input">数据输入</option>
                                <option value="custom-method">自定义方法</option>
                            </select>
                            <button class="btn" type="button" aria-label="编辑输入规则"
                                    @click="emit('open-dialog', {itemId: selectedItem.id, dialogType: 'input-rule'})">
                                <img src="/src/assets/icons/edit.svg" alt="编辑" class="btn-img">
                            </button>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="generation-interval">工件产生间隔</label>
                            <input id="generation-interval" class="property-input" type="text" placeholder="分:秒"
                                   title="格式：dd:hh:mm:ss.ms"
                                   :value="formatGenerationInterval(inputProperties.generationInterval)"
                                   @change="handleGenerationIntervalChange" @blur="handleGenerationIntervalChange"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="first-generation-time">首次产生时间</label>
                            <input id="first-generation-time" class="property-input" type="number" min="0" step="0.01"
                                   :value="inputProperties.firstGenerationTime"
                                   @change="handleInputPropertyChange('firstGenerationTime', $event)"
                                   @blur="handleInputPropertyChange('firstGenerationTime', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">秒</span>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="max-output-count">最大输出个数</label>
                            <input id="max-output-count" class="property-input" type="number" min="0" step="1"
                                   :value="inputProperties.maxOutputCount"
                                   @change="handleInputPropertyChange('maxOutputCount', $event)"
                                   @blur="handleInputPropertyChange('maxOutputCount', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div class="prop-row input-property-row input-close-row">
                            <label class="prop-key" for="input-close-time">入口关闭时间</label>
                            <input id="input-close-time" class="property-input" type="number" min="0" step="0.01"
                                   :value="inputProperties.inputCloseTime" :disabled="!inputProperties.inputCloseEnabled"
                                   @change="handleInputPropertyChange('inputCloseTime', $event)"
                                   @blur="handleInputPropertyChange('inputCloseTime', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">秒</span>
                            <label class="input-close-toggle">
                                <input type="checkbox" :checked="inputProperties.inputCloseEnabled"
                                       @change="handleInputPropertyChange('inputCloseEnabled', $event)"/>
                                启用
                            </label>
                        </div>
                        <div class="prop-row input-property-row workpiece-display-row">
                            <span id="workpiece-display-label" class="prop-key">工件展示方式</span>
                            <div class="workpiece-display-options" role="radiogroup" aria-labelledby="workpiece-display-label">
                                <label v-for="option in workpieceDisplayOptions" :key="option.value" class="square-radio-label">
                                    <input type="radio" class="square-radio" :name="`workpiece-display-${selectedItem.id}`"
                                           :value="option.value" :checked="inputProperties.workpieceDisplayMode === option.value"
                                           @change="emit('update-component-properties', {id: selectedItem.id, workpieceDisplayMode: option.value})"/>
                                    {{ option.label }}
                                </label>
                            </div>
                        </div>
                    </div>
                    <!-- 设备 -->
                    <div v-if="selectedItem.type === 'workstation'" class="input-settings" :key="selectedItem.id" >
                        <div class="section-title" >设备属性</div>
<!--                    好，我们继续开发，看到PropertyPanel.vue249到252行，我给设备组件的属性面板添加了一栏设备属性，-->
                    </div>
                </div>

            </div>
        </div>
    </div>
</template>

<script setup>
import {computed} from "vue";
import {getComponentLabel} from "../utils/componentLabel.js";
import {STATION_TYPES, getStationType, getComponentBounds, getComponentCenter} from "../utils/stations.js";
import {getPathWidth} from "../utils/agvPath.js";
import {RESIZABLE_COMPONENT_TYPES, getDefaultShadowColor} from "../utils/componentAppearance.js";
import {INPUT_PROPERTY_DEFAULTS, isValidInputProperty, parseGenerationInterval, formatGenerationInterval} from "../utils/inputRules.js";
import {DEFAULT_WORKPIECE_SPEED, getConnectionGeometry} from "../utils/connectionLine.js";
// 声明接受父组件传来的两个对象
const props = defineProps({
    // 当前选中的控件对象（由父组件根据 selectedId 查出后传入）
    selectedItem: {
        type: Object,
        default: null,
    },
    // 已放置控件列表，用于解析连接线两端对象的名称
    placedComponents: {
        type: Array,
        default: () => [],
    },
});
const emit = defineEmits(["update-component-properties", "update-component-position", "open-dialog"]);
const connectionGeometry = computed(() => getConnectionGeometry(props.selectedItem, props.placedComponents));
const connectionLength = computed(() => connectionGeometry.value ? Number(connectionGeometry.value.length.toFixed(2)) : '');
const connectionAngle = computed(() => connectionGeometry.value ? Number(connectionGeometry.value.angle.toFixed(2)) : '');
const connectionWorkpieceSpeed = computed(() => props.selectedItem?.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED);
const connectionEndpointOptions = [{value: 'to', label: '终点'}, {value: 'from', label: '起点'}];
const connectionAffectedEndpoint = computed(() => props.selectedItem?.affectedEndpoint === 'from' ? 'from' : 'to');
const handleConnectionPropertyChange = (field, event) => {
    const item = props.selectedItem;
    if (item?.type !== 'connectionLine') return;
    const current = {length: connectionLength.value, angle: connectionAngle.value, workpieceSpeed: connectionWorkpieceSpeed.value};
    const raw = event.target.value.trim();
    const value = raw === '' ? NaN : Number(raw);
    const valid = Number.isFinite(value) && (field === 'angle' ? value >= -360 && value <= 360 : value >= 0);
    if (!valid || (field !== 'workpieceSpeed' && !connectionGeometry.value)) {
        event.target.value = String(current[field]);
        return;
    }
    if (value !== current[field]) emit('update-component-properties', {id: item.id, [field]: value});
};
const workpieceDisplayOptions = [
    {value: 'recommended', label: '按推荐大小'},
    {value: 'actual', label: '按实际大小'},
];
const inputProperties = computed(() => Object.fromEntries(
    Object.entries(INPUT_PROPERTY_DEFAULTS).map(([field, defaultValue]) =>
        [field, props.selectedItem?.[field] ?? defaultValue]),
));
const handleGenerationIntervalChange = (event) => {
    const item = props.selectedItem;
    if (item?.type !== 'systemInput') return;
    const seconds = parseGenerationInterval(event.target.value);
    if (!isValidInputProperty('generationInterval', seconds)) {
        event.target.value = formatGenerationInterval(inputProperties.value.generationInterval);
        return;
    }
    event.target.value = formatGenerationInterval(seconds);
    if (seconds !== inputProperties.value.generationInterval) {
        emit('update-component-properties', {id: item.id, generationInterval: seconds});
    }
};
const handleInputPropertyChange = (field, event) => {
    const item = props.selectedItem;
    if (item?.type !== 'systemInput') return;
    const raw = event.target.value.trim();
    const value = field === 'inputCloseEnabled' ? event.target.checked : (raw === '' ? NaN : Number(raw));
    if (!isValidInputProperty(field, value)) {
        event.target.value = String(inputProperties.value[field]);
        return;
    }
    if (value !== inputProperties.value[field]) {
        emit('update-component-properties', {id: item.id, [field]: value});
    }
};
const shadowColor = computed(() => props.selectedItem?.shadowColor || getDefaultShadowColor(props.selectedItem?.type));
const pathWidthInMeters = computed(() => props.selectedItem ? Number(getPathWidth(props.selectedItem).toFixed(2)) : 1);
const handlePathWidthChange = (event) => {
    const item = props.selectedItem;
    if (item?.type !== "AGVpath") return;
    const raw = event.target.value.trim();
    const value = Number(raw);
    const width = raw && Number.isFinite(value) ? Math.max(0.01, Number(value.toFixed(2))) : getPathWidth(item);
    event.target.value = String(width);
    if (width !== getPathWidth(item)) emit("update-component-properties", {id: item.id, pathWidth: width});
};
const stationStyle = computed(() => getStationType(props.selectedItem));
const handleStationTypeChange = (event) => {
    emit("update-component-properties", {id: props.selectedItem.id, stationType: event.target.value});
};

// 按 id 找出对象的显示名称（名称+序号），找不到则提示已删除
const resolveLabel = (id) => {
    const target = props.placedComponents.find((item) => item.id === id);
    return target ? getComponentLabel(target) : "（对象已删除）";
};

const fromLabel = computed(() =>
    props.selectedItem ? resolveLabel(props.selectedItem.fromId) : "",
);

const toLabel = computed(() =>
    props.selectedItem ? resolveLabel(props.selectedItem.toId) : "",
);

// 站点存中心，其他控件存左下角；统一按 0.01m 精度显示中心，允许负坐标。
const centerCoordinates = computed(() => {
    const item = props.selectedItem;
    if (!item || item.type === "connectionLine" || item.type === "AGVpath") return {x: 0, y: 0};
    const center = getComponentCenter(item);
    return {x: Number(center.x.toFixed(2)), y: Number(center.y.toFixed(2))};
});

// 完成输入后提交；清空或尚未输完负号时不移动控件，失焦恢复原坐标。
const handleCenterCoordinateChange = (axis, event) => {
    const item = props.selectedItem;
    if (!item || item.type === "connectionLine" || item.type === "AGVpath") return;
    const rawValue = event.target.value.trim();
    const inputValue = Number(rawValue);
    if (rawValue === "" || !Number.isFinite(inputValue)) {
        event.target.value = String(centerCoordinates.value[axis]);
        return;
    }
    const value = Number(inputValue.toFixed(2));
    event.target.value = String(value);
    if (value === centerCoordinates.value[axis]) return;
    const position = {id: item.id, x: item.x, y: item.y};
    const dimension = axis === "x" ? "width" : "height";
    const offset = item.type === "node" ? 0 : (item[dimension] ?? 0) / 2;
    position[axis] = Number((value - offset).toFixed(10));
    // 共用拖动的更新事件，使站点关联的 AGV 路径也同步更新。
    emit("update-component-position", position);
};

const isResizableComponent = computed(() =>
    Boolean(props.selectedItem && RESIZABLE_COMPONENT_TYPES.has(props.selectedItem.type)),
);
// 尺寸已直接以米存储，这里只做 2 位小数显示（与输入框 step 0.01 一致）
const widthInMeters = computed(() => props.selectedItem ? Number(getComponentBounds(props.selectedItem).width.toFixed(2)) : 0);
const heightInMeters = computed(() => props.selectedItem ? Number(getComponentBounds(props.selectedItem).height.toFixed(2)) : 0);

const handleDimensionChange = (dimension, event) => {
    const inputValue = Number(event.target.value);
    // 允许用户输入过程中的任意值（米），不做限制
    if (!isNaN(inputValue) && inputValue > 0) {
        emit("update-component-properties", {id: props.selectedItem.id, [dimension]: inputValue});
    }
};

const handleDimensionBlur = (dimension, event) => {
    const inputValue = Number(event.target.value);
    // 失焦时应用最小值限制（0.01 米）
    const meters = Math.max(0.01, inputValue || 0.01);
    if (meters !== inputValue) {
        emit("update-component-properties", {id: props.selectedItem.id, [dimension]: meters});
    }
};

const handleShadowColorChange = (event) => {
    emit("update-component-properties", {id: props.selectedItem.id, shadowColor: event.target.value});
};

</script>

<style scoped>
.input-settings { display: flex; flex-direction: column; gap: 10px; }
.prop-row.input-property-row { display: grid; }
.input-property-row { grid-template-columns: 84px minmax(0, 1fr) 14px; gap: 6px; }
.input-rule-row { grid-template-columns: 84px minmax(0, 1fr) 28px; }
.input-close-row { grid-template-columns: 84px minmax(0, 1fr) 14px auto; }
.input-property-row .property-input { box-sizing: border-box; width: 100%; min-width: 0; height: 28px; background: white; }
.input-property-row .property-input:focus { outline: 2px solid #93c5fd; outline-offset: 1px; }
.input-property-row .property-input:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }
.input-rule-row .btn { justify-content: center; margin: 0; padding: 4px; }
.input-rule-row .btn-img { margin: 0; }
.input-close-toggle { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; color: #6b7280; cursor: pointer; }
.input-close-toggle input { margin: 0; accent-color: #0780ff; }
.workpiece-display-row { grid-template-columns: 84px minmax(0, 1fr); align-items: start; }
.workpiece-display-options { display: flex; flex-direction: column; gap: 8px; }
.connection-endpoint-options { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.square-radio-label { display: inline-flex; align-items: center; gap: 6px; color: #374151; cursor: pointer; }
.square-radio {
    appearance: none;
    display: grid;
    place-content: center;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 1px solid #9ca3af;
    border-radius: 2px;
    background: white;
    cursor: pointer;
}
.square-radio:checked { border-color: #0780ff; background: #0780ff; }
.square-radio:checked::after { content: '✓'; color: white; font-size: 11px; line-height: 12px; }
.square-radio:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.path-direction-btn {
    padding: 3px 8px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    background: #f9fafb;
    color: #047857;
    cursor: pointer;
}
.btn {
    display: flex;
    border-radius: 8px;
    border: none;
    background-color: #fefefe;
    align-items: center;
    padding: 4px 6px;
    margin-right: 6px;
    user-select: none;
    cursor: pointer;
}
.btn:hover {
    background-color: #e8eaf0;
}
.btn-img {
    width: 18px;
    height: 18px;
    margin-right: 4px;
    user-select: none;
    -webkit-user-drag: none;
}

.station-type-select {
    flex: 1;
    min-width: 110px;
}

.station-color {
    width: 28px;
    height: 18px;
    border: 2px solid;
    border-radius: 2px;
}

.property-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.panel-header {
    background-color: #f9f9fe;
    padding: 8px 16px;
    border-bottom: 1px solid #e0e4e8;
}

.panel-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #000000;
    user-select: none;
    -webkit-user-drag: none;
}

.panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
}

/* 滚动条整体宽度（垂直滚动条）， 控制垂直滚动条粗细，设为6px细滚动条；水平滚动条用height属性 */
.panel-content::-webkit-scrollbar {
    width: 6px;
}

/* 滚动条滑动的底板背景色，浅灰底色 */
.panel-content::-webkit-scrollbar-track {
    background: #f3f4f6;
}

/* 拖动块默认浅灰色，圆角实现圆润效果（宽度 6px，圆角 3px 刚好半圆）。 */
.panel-content::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 3px;
}

/* 鼠标放上去滑块加深灰色，提升交互反馈 */
.panel-content::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #9ca3af;
}

.empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
    user-select: none;
    -webkit-user-drag: none;
}

.empty-text {
    font-size: 14px;
    margin: 0;
    user-select: none;
    -webkit-user-drag: none;
}

/* 属性列表 */
.prop-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.prop-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.dimension-row {
    align-items: center;
}

.property-input {
    width: 72px;
    padding: 4px 6px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    font-size: 13px;
    color: #1f2937;
}

.property-unit,
.color-value {
    color: #6b7280;
    font-size: 12px;
}

.color-input {
    width: 34px;
    height: 26px;
    padding: 1px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    background: #ffffff;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #1f2937;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
    user-select: none;
}

.prop-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}

.prop-key {
    flex: 0 0 auto;
    min-width: 60px;
    color: #6b7280;
    user-select: none;
    white-space: nowrap;
}

.prop-value {
    flex: 1;
    color: #374151;
    word-break: break-all;
}

</style>

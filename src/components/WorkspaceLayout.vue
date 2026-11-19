<template>
    <div class="workspace-layout">
        <!-- 左侧资源面板 -->
        <div class="left-panel panel-box" :style="{ width: leftPanelWidth + 'px' }">
            <ResourceSidebar
                :placedComponents="placedComponents"
                :selectedId="selectedId"
                :selectedIds="selectedIds"
                @select-component="handleSelectComponent"
                @toggle-component-selection="handleToggleComponentSelection"
                @focus-component="handleTreeFocusComponent"
                @remove-component="handleRemoveComponent"
                @add-log="handleAddLog"
            />
        </div>

        <!-- 左侧面板分割条 -->
        <div
            class="resizer resizer-vertical"
            @mousedown="startResizeLeft"
        >
            <div class="resizer-line"></div>
        </div>

        <!-- 中间区域容器 -->
        <div class="center-container">
            <!-- 画布上的工具栏 -->
            <div class="simulation-toolbar">
                <div v-for="item in simulationToolBarMenus" :key="item.id">
                    <!--     仿真运行时隐藏“开始仿真”按钮，仿真未运行时隐藏“暂停”按钮               -->
                    <span v-show="!item.id.includes('separator') && item.id !== 'simulation-speed' && !(item.id === 'start-simulation' && isSimulationRunning) && !(item.id === 'pause-simulation' && !isSimulationRunning)"
                          class="toolbar-button-tooltip"
                          v-bootstrap-tooltip data-bs-toggle="tooltip" data-bs-placement="top"
                          :data-bs-title="item.name">
                        <button v-if="item.id !== 'coordinate-system'" class="btn"
                                type="button"
                                :disabled="isControlDisabled(item)"
                                @click="handleClickControl(item)">
                            <img class="btn-img" :src="item.icon" :alt="item.name" />
                            <span v-if="item.id === 'clock'" class="control-btn-text" id="clock" >
                                {{ simulationTime }}
                            </span>
                        </button>
                        <label v-else class="btn coordinate-system-toggle">
                            <img class="btn-img" :src="item.icon" alt=""/>
                            <input v-model="showCoordinateSystem" type="checkbox" aria-label="显示坐标系"/>
                        </label>
                    </span>
                    <span v-if="item.id.includes('separator')">
                        <div class="separator"></div>
                    </span>
                    <span v-if="item.id === 'simulation-speed'" class="speed-control"
                          v-bootstrap-tooltip
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          :data-bs-title="item.name">
                        <img class="btn-img" :src="item.icon" :alt="item.name" />
                        <input v-model.number="simulationSpeed" class="speed-box" type="range" min="0.1" max="60" step="0.1"
                               :style="{ '--value-percent': `${((simulationSpeed - 0.1) / (60 - 0.1)) * 100}%` }"/>
                        <span class="speed-value">{{ simulationSpeed }}x</span>
                    </span>
                </div>
            </div>
            <!-- 上部画布区域 -->
            <div class="canvas-panel panel-box">
                <DesignCanvas
                    ref="designCanvas"
                    :activeControl="activeControl"  tips="父组件调用子组件时顺便传参"
                    :placedComponents="placedComponents"
                    :workpieces="workpieces"
                    :showCoordinateSystem="showCoordinateSystem"
                    :selectedId="selectedId"
                    :selectedIds="selectedIds"
                    @placement-done="emit('placement-done')"
                    @add-log="handleAddLog"
                    @component-placed="handleComponentPlaced"
                    @select-component="handleSelectComponent"
                    @select-components="handleSelectComponents"
                    @update-component-position="handleUpdateComponentPosition"
                    @update-component-positions="handleUpdateComponentPositions"
                    @update-component-properties="handleUpdateComponentProperties"
                    @rename-component="handleRenameComponent"
                />
            </div>

            <!-- 控制台分割条 -->
            <div
                class="resizer resizer-horizontal"
                @mousedown="startResizeBottom"
            >
                <div class="resizer-line"></div>
            </div>

            <!-- 底部控制台 -->
            <div class="bottom-panel panel-box" :style="{ height: bottomPanelHeight + 'px' }">
                <ConsolePanel :logs="logs"/>
            </div>
        </div>

        <!-- 右侧属性面板分割条 -->
        <div
            class="resizer resizer-vertical"
            @mousedown="startResizeRight"
        >
            <div class="resizer-line"></div>
        </div>

        <!-- 右侧属性面板 -->
        <div class="right-panel panel-box" :style="{ width: rightPanelWidth + 'px' }">
            <PropertyPanel
                :selectedItem="selectedComponent"
                :placedComponents="placedComponents"
                @update-component-properties="handleUpdateComponentProperties"
                @update-component-position="handleUpdateComponentPosition"
                @open-dialog="openDialog"
            />
        </div>
    </div>
    <Dialog v-if="activeDialog && dialogItem"
            :key="`${activeDialog.itemId}-${activeDialog.dialogType}`"
            :item="dialogItem" :dialog-type="activeDialog.dialogType"
            @close="activeDialog = null" @save="saveDialog"/>
</template>

<script setup>
import {ref, shallowRef, computed, watch, onMounted, onUnmounted, onBeforeUnmount} from 'vue'
import ResourceSidebar from './ResourceSidebar.vue'
import DesignCanvas from './DesignCanvas.vue'
import PropertyPanel from './PropertyPanel.vue'
import Dialog from './Dialog.vue'
import ConsolePanel from './ConsolePanel.vue'
import {getComponentLabel} from '../utils/componentLabel.js'
import {STATION_TYPES, getStationType, getNextStationIndex, getComponentCenter} from '../utils/stations.js'
import {getCornerMaxRadius} from '../utils/agvPath.js'
import {menuControls} from "@/config/controlMenuData";
import {simulationToolBarMenus} from '../config/simulationToolBarMenuData.js'
import {createBootstrapTooltipDirective} from '../assets/bootstrap/tooltipController.js'
import {INPUT_PROPERTY_DEFAULTS, isValidInputProperty, getDefaultWorkpieceDimensions} from '../utils/inputRules.js'
import {createInputSimulation} from '../utils/inputSimulation.js'
import {DEFAULT_WORKPIECE_SPEED, getConnectionGeometry} from '../utils/connectionLine.js'

const vBootstrapTooltip = createBootstrapTooltipDirective()

// 定义 emit
const emit = defineEmits(['placement-done', 'simulation-status-change'])

const elapsedMilliseconds = ref(0)  // 消逝的毫秒：保存已经累计的仿真时间
const elapsedSeconds = computed(() => Math.floor(elapsedMilliseconds.value / 1000)) // 向下取整
const isSimulationRunning = ref(false)
const isStopEnabled = ref(false)
const isResetEnabled = ref(false)
const isSimulationCompleted = ref(false)
const restartOnNextStart = ref(false)   // 用于判断上一次是否点击过“终止仿真”，需要从头开始。
// 由现有运行标志计算状态，使按钮行为和底部状态栏保持一致。
const simulationStatus = computed(() => {
    if (isSimulationRunning.value) return 'running'
    if (isSimulationCompleted.value) return 'completed'
    if (restartOnNextStart.value) return 'stopped'
    if (isStopEnabled.value) return 'paused'
    return 'not-started'
})
watch(simulationStatus, status => emit('simulation-status-change', status), {immediate: true})
let timerId = null  // 保存计时器的编号。`null` 表示目前没有运行中的计时器。
let lastTickAt = 0  // 记录上次更新时间的时间戳，单位是毫秒。计时器每次更新时会用当前时间减去它，算出这段真实时间。
const simulationSpeed = ref(1.0)
const showCoordinateSystem = ref(true)
const inputSimulation = createInputSimulation()
const workpieces = shallowRef(inputSimulation.workpieces)

function generateWorkpieces() {
    if (inputSimulation.advanceTo(elapsedMilliseconds.value, placedComponents.value)) {
        workpieces.value = [...inputSimulation.workpieces]
    }
}

function resetWorkpieces() {
    inputSimulation.reset()
    workpieces.value = []
}

function finishSimulationIfComplete() {
    if (!isSimulationRunning.value || !inputSimulation.isComplete()) return false
    if (timerId !== null) window.clearInterval(timerId)
    timerId = null
    isSimulationRunning.value = false
    isStopEnabled.value = false
    isResetEnabled.value = true
    restartOnNextStart.value = true
    isSimulationCompleted.value = true
    logs.value.push('所有输入已结束产生，所有工件已完成，仿真结束。')
    return true
}

const simulationTime = computed(() => {
    const hours = Math.floor(elapsedSeconds.value / 3600)
    const minutes = Math.floor((elapsedSeconds.value % 3600) / 60)
    const seconds = elapsedSeconds.value % 60
    // .padStart(2, '0')：不足两位时在前面补 0; .join(':')：用冒号把三部分连接起来
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
})

function startSimulationTimer() {
    if (timerId !== null) return // 防止重复点击后启动多个计时器
    lastTickAt = performance.now()  // 	记录当前时间，作为计时起点。`performance.now()` 返回页面运行(刷新)以来经过的毫秒数，适合计算时间间隔。
    // 启动一个重复执行的定时任务，50ms执行一次，并把它的编号保存到 timerId，之后可以用这个编号暂停定时器。
    timerId = window.setInterval(() => {
        const now = performance.now()
        elapsedMilliseconds.value += (now - lastTickAt) * simulationSpeed.value
        lastTickAt = now
        generateWorkpieces()
        finishSimulationIfComplete()
    }, 50)
}

function pauseSimulationTimer() {
    if (timerId === null) return
    const now = performance.now()
    elapsedMilliseconds.value += (now - lastTickAt) * simulationSpeed.value
    generateWorkpieces()
    window.clearInterval(timerId)
    timerId = null
    finishSimulationIfComplete()
}

function isControlDisabled(item) {
    if (item.id === 'stop-simulation') return !isStopEnabled.value
    if (item.id === 'reset-simulation') return !isResetEnabled.value
    return false
}

onUnmounted(() => {
    if (timerId !== null) window.clearInterval(timerId)
})
//控件点击事件
const handleClickControl = (item) => {
    if (item.id === 'start-simulation') {
        if (restartOnNextStart.value) {     // 	判断上一次是否点击过“终止仿真”，需要从头开始。
            elapsedMilliseconds.value = 0
            resetWorkpieces()
            restartOnNextStart.value = false
        }
        if (isResetEnabled.value) isResetEnabled.value = false  // 如果重置按钮可点击，就将它禁用。
        isSimulationCompleted.value = false
        isSimulationRunning.value = true
        isStopEnabled.value = true
        generateWorkpieces()
        if (!finishSimulationIfComplete()) startSimulationTimer()
    } else if (item.id === 'pause-simulation') {
        pauseSimulationTimer()
        isSimulationRunning.value = false
    } else if (item.id === 'stop-simulation' && isStopEnabled.value) {
        pauseSimulationTimer()
        isSimulationRunning.value = false   // 仿真结束
        isStopEnabled.value = false         // 自身不可再按
        isResetEnabled.value = true         // 重置按钮激活
        restartOnNextStart.value = true     // 下一次重新开始
        isSimulationCompleted.value = false
    } else if (item.id === 'reset-simulation' && isResetEnabled.value) {
        pauseSimulationTimer()
        elapsedMilliseconds.value = 0       // 重置计时器
        resetWorkpieces()
        isSimulationRunning.value = false   // 仿真结束
        isResetEnabled.value = false        // 自身不可再按
        restartOnNextStart.value = false
        isSimulationCompleted.value = false
    }
};

// 当前激活的控件信息
const activeControl = ref(null)

// 日志列表
const logs = ref([])

// 已放置控件列表（单一数据源，画布与模型树共享）
const placedComponents = ref([])

// 模型坐标改变时立即同步附着工件，暂停和仿真结束后拖动同样生效。
watch(placedComponents, () => {
    if (inputSimulation.syncAttachments(placedComponents.value)) {
        workpieces.value = [...inputSimulation.workpieces]
    }
    if (isSimulationRunning.value) {
        generateWorkpieces()
        finishSimulationIfComplete()
    }
}, {deep: true})

// 记录打开时的控件 ID 和弹窗用途，背景中的选择变化不会改变编辑目标。
const activeDialog = ref(null)
const dialogItem = computed(() => placedComponents.value.find(item => item.id === activeDialog.value?.itemId))
const openDialog = ({itemId, dialogType}) => {
    activeDialog.value = {itemId, dialogType}
}
const saveDialog = ({itemId, dialogType, properties}) => {
    if (itemId !== activeDialog.value?.itemId || dialogType !== activeDialog.value?.dialogType) return
    handleUpdateComponentProperties({id: itemId, ...properties})
    activeDialog.value = null
}

// 模型树中当前选中的控件 id
const selectedId = ref(null)
const selectedIds = ref([])
const designCanvas = ref(null)

// 右侧属性面板宽度
const rightPanelWidth = ref(280)
const isResizingRight = ref(false)

// 左侧资源面板宽度
const leftPanelWidth = ref(250)
const isResizingLeft = ref(false)

// 底部控制台高度
const bottomPanelHeight = ref(180)
const isResizingBottom = ref(false)

// 当前选中的控件对象（属性面板展示用）
const selectedComponent = computed(
    () => placedComponents.value.find((item) => item.id === selectedId.value) || null
)

// 处理控件变化，传给画布决定当前是选择、放置设备还是绘制路径等模式。
const handleControlChange = (controlInfo) => {
    activeControl.value = controlInfo
}

// 接收画布上报的日志
const handleAddLog = (message) => {
    logs.value.push(message)
}

// 画布放置控件后，加入统一列表
const handleComponentPlaced = (component) => {
    if (component.type === 'connectionLine' && component.affectedEndpoint === undefined) {
        component.affectedEndpoint = 'to'
    }
    if (component.type === 'connectionLine' && component.workpieceSpeed === undefined) {
        component.workpieceSpeed = DEFAULT_WORKPIECE_SPEED
    }
    if (component.type === 'systemInput') {
        for (const [field, defaultValue] of Object.entries(INPUT_PROPERTY_DEFAULTS)) {
            if (component[field] === undefined) component[field] = defaultValue
        }
    }
    if (component.type === 'systemInput' && component.inputRuleRows === undefined) {
        component.inputRuleRows = [{
            partType: 'Part1',
            name: '',
            ...getDefaultWorkpieceDimensions(component),
            fillColor: '#22c55e',
            relativeWeight: 100,
        }]
    }
    placedComponents.value.push(component)
    // 放置后自动选中该控件，效果与在模型树中选中一致（显示蓝色选中框）
    handleSelectComponent(component.id)
}

// 模型树单击和画布选择只更新选中态，保持视图稳定。
const handleSelectComponent = (id) => {
    selectedId.value = id
    selectedIds.value = id ? [id] : []
}

const handleSelectComponents = (ids) => {
    const existingIds = new Set(placedComponents.value.map((item) => item.id))  // 1. 收集当前确实存在的组件 ID
    selectedIds.value = [...new Set(ids)].filter((id) => existingIds.has(id))   // 2. 去重，过滤掉ids中在existingIds已经存在的 ID
    selectedId.value = selectedIds.value[0] ?? null     // 3. 把多选列表里的第一个 ID 作为主选中项，用于属性面板展示
}

const handleToggleComponentSelection = (id) => {
    const ids = selectedIds.value
    handleSelectComponents(ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id])
}

// 模型树双击时定位，即使双击的仍是当前选中对象。
const handleTreeFocusComponent = (id) => {
    handleSelectComponent(id)
    designCanvas.value?.focusComponent(id)
}

// 画布拖拽控件后，更新单一数据源中的位置
const handleUpdateComponentPosition = ({id, x, y, nodes}) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return
    // 如果提供了 nodes 参数，说明是在拖动 AGV 路径的拐点
    if (nodes) {
        target.nodes = nodes
        // 拐点移动后线段长度变化，修正可能超限的圆角
        clampAGVPathCornerRadii(target)
        return
    }
    // 普通控件位置更新
    target.x = x
    target.y = y
    // 如果拖动的是站点，需要同步更新所有连接到该站点的 AGV 路径
    if (target.type === 'node') {
        updateAGVPathsForNode(id, x, y)
    }
}

const handleUpdateComponentProperties = ({
                                             id,
                                             length,
                                             angle,
                                             workpieceSpeed,
                                             affectedEndpoint,
                                             width,
                                             height,
                                             shadowColor,
                                             stationType,
                                             pathWidth,
                                             cornerRadii,
                                             reverseDirection,
                                             inputRuleRows,
                                             generationInterval,
                                             firstGenerationTime,
                                             maxOutputCount,
                                             inputCloseTime,
                                             inputCloseEnabled,
                                             workpieceDisplayMode
                                         }) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return

    if (target.type === 'connectionLine') {
        if (affectedEndpoint === 'to' || affectedEndpoint === 'from') target.affectedEndpoint = affectedEndpoint
        if (Number.isFinite(workpieceSpeed) && workpieceSpeed >= 0) target.workpieceSpeed = workpieceSpeed
        if (length === undefined && angle === undefined) return
        if (length !== undefined && (!Number.isFinite(length) || length < 0)) return
        if (angle !== undefined && (!Number.isFinite(angle) || angle < -360 || angle > 360)) return
        const geometry = getConnectionGeometry(target, placedComponents.value)
        if (!geometry || geometry.from.id === geometry.to.id) return
        const nextLength = length ?? geometry.length
        const nextAngle = angle ?? geometry.angle
        const radians = nextAngle * Math.PI / 180
        // 角度始终表示起点到终点的方向，移动起点时从固定终点反推。
        const moveStart = target.affectedEndpoint === 'from'
        const movingComponent = moveStart ? geometry.from : geometry.to
        const fixedCenter = moveStart ? geometry.end : geometry.start
        const movingCenter = moveStart ? geometry.start : geometry.end
        const direction = moveStart ? -1 : 1
        const x = Number((movingComponent.x + fixedCenter.x + direction * nextLength * Math.cos(radians) - movingCenter.x).toFixed(10))
        const y = Number((movingComponent.y + fixedCenter.y + direction * nextLength * Math.sin(radians) - movingCenter.y).toFixed(10))
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        if (x !== movingComponent.x || y !== movingComponent.y) {
            handleUpdateComponentPosition({id: movingComponent.id, x, y})
        }
        target.angle = nextAngle
        return
    }

    if (target.type === 'systemInput') {
        const inputProperties = {generationInterval, firstGenerationTime, maxOutputCount, inputCloseTime, inputCloseEnabled, workpieceDisplayMode}
        for (const [field, value] of Object.entries(inputProperties)) {
            if (isValidInputProperty(field, value)) target[field] = value
        }
    }

    if (target.type === 'systemInput' && Array.isArray(inputRuleRows)) {
        target.inputRuleRows = inputRuleRows.map(row => ({...row}))
    }

    if (target.type === 'AGVpath') {
        if (Number.isFinite(pathWidth) && pathWidth > 0) target.pathWidth = Math.max(0.01, Number(pathWidth.toFixed(2)))
        if (Array.isArray(cornerRadii)) {
            target.cornerRadii = Array.from({length: Math.max(0, (target.nodes?.length || 0) - 2)}, (_, i) =>
                Number.isFinite(cornerRadii[i]) ? Math.max(0, cornerRadii[i]) : 0)
            clampAGVPathCornerRadii(target)
        }
        if (reverseDirection) {
            target.nodes = [...(target.nodes || [])].reverse()
            target.cornerRadii = [...(target.cornerRadii || [])].reverse()
            if (target.segments) target.segments = [...target.segments].reverse()
            ;
            [target.fromId, target.toId] = [target.toId, target.fromId]
            ;[target.fromName, target.toName] = [target.toName, target.fromName]
        }
        return
    }

    const {x: centerX, y: centerY} = getComponentCenter(target)
    const nextWidth = Number.isFinite(width) ? width : target.width
    const nextHeight = Number.isFinite(height) ? height : target.height

    if (Number.isFinite(width)) {
        target.width = nextWidth
        target.x = target.type === 'node' ? centerX : centerX - nextWidth / 2
    }
    if (Number.isFinite(height)) {
        target.height = nextHeight
        target.y = target.type === 'node' ? centerY : centerY - nextHeight / 2
    }
    if (typeof shadowColor === 'string') target.shadowColor = shadowColor
    const station = STATION_TYPES.find((type) => type.value === stationType)
    if (target.type === 'node' && station) {
        if (getStationType(target).value !== station.value) {
            target.index = getNextStationIndex(placedComponents.value, station.value, target.id)
        }
        target.stationType = station.value
        target.name = station.label
    }
}

// 多选拖动先同时更新控件，再同步站点关联路径，避免中间状态误缩小圆角。
const handleUpdateComponentPositions = (positions) => {
    const movedNodes = new Map()
    positions.forEach(({id, x, y}) => {
        const target = placedComponents.value.find((item) => item.id === id)
        if (!target || !Number.isFinite(x) || !Number.isFinite(y)) return
        target.x = x
        target.y = y
        if (target.type === 'node') movedNodes.set(id, {x, y})
    })
    placedComponents.value.forEach((component) => {
        if (component.type !== 'AGVpath' || !component.nodes?.length) return
        const from = movedNodes.get(component.fromId)
        const to = movedNodes.get(component.toId)
        if (!from && !to) return
        // 两端站点同向移动时整条路径一起平移，保持原有走向和圆角。
        const first = component.nodes[0]
        const last = component.nodes[component.nodes.length - 1]
        const dx = from ? from.x - first.x : 0
        const dy = from ? from.y - first.y : 0
        const moveWholePath = from && to &&
            Math.abs(to.x - last.x - dx) < 1e-8 && Math.abs(to.y - last.y - dy) < 1e-8
        component.nodes = component.nodes.map((point, index) => {
            if (index === 0 && from) return {...from}
            if (index === component.nodes.length - 1 && to) return {...to}
            return moveWholePath ? {x: point.x + dx, y: point.y + dy} : point
        })
        clampAGVPathCornerRadii(component)
    })
}

// 结合转弯角度和相邻线段长度，限制圆弧半径，避免相邻圆弧交叠。
const clampAGVPathCornerRadii = (component) => {
    if (!component.cornerRadii || !component.nodes) return

    let changed = false
    component.cornerRadii.forEach((radius, i) => {
        if (radius === 0) return

        // cornerRadii[i] 对应 nodes[i+1]（第 i 个拐点，不含起终点）
        const maxRadius = getCornerMaxRadius(component.nodes, i)

        if (radius > maxRadius) {
            component.cornerRadii[i] = maxRadius
            changed = true
        }
    })

    // 触发响应式更新
    if (changed) {
        component.cornerRadii = [...component.cornerRadii]
    }
}

// 更新所有连接到指定站点的 AGV 路径
const updateAGVPathsForNode = (nodeId, newX, newY) => {
    placedComponents.value.forEach((component) => {
        if (component.type !== 'AGVpath') return

        let updated = false

        // 更新起点
        if (component.fromId === nodeId && component.nodes.length > 0) {
            component.nodes[0].x = newX
            component.nodes[0].y = newY
            updated = true
        }

        // 更新终点
        if (component.toId === nodeId && component.nodes.length > 1) {
            const lastIdx = component.nodes.length - 1
            component.nodes[lastIdx].x = newX
            component.nodes[lastIdx].y = newY
            updated = true
        }

        if (updated) {
            // 触发响应式更新
            component.nodes = [...component.nodes]
            // 节点位置变了，线段长度随之改变，修正可能超限的圆角
            clampAGVPathCornerRadii(component)
        }
    })
}

// 画布上双击标签改名后，写回单一数据源。
// 只改 displayName，不动 name/index，序号复用等逻辑不受影响
const handleRenameComponent = ({id, displayName}) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return
    target.displayName = displayName
}

// 模型树删除控件（与画布同步）
const handleRemoveComponent = (id) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return

    // 连着被删控件的连接线会失去一端，必须一并删除，否则画布上会残留悬空的线
    const orphanLines = placedComponents.value.filter(
        (item) =>
            item.type === 'connectionLine' && (item.fromId === id || item.toId === id)
    )

    // 连着被删站点的 AGV 路径也必须一并删除
    const orphanAGVPaths = placedComponents.value.filter(
        (item) =>
            item.type === 'AGVpath' && (item.fromId === id || item.toId === id)
    )

    const removedIds = new Set([
        id,
        ...orphanLines.map((line) => line.id),
        ...orphanAGVPaths.map((path) => path.id)
    ])

    placedComponents.value = placedComponents.value.filter(
        (item) => !removedIds.has(item.id)
    )

    // 清理被删除及连带删除的选中项。
    handleSelectComponents(selectedIds.value.filter((selected) => !removedIds.has(selected)))

    // 输出日志：删除对象
    logs.value.push(`删除对象，类型：${target.type}，编号：${getComponentLabel(target)}`)

    // 连带删除的连接线也各自记录一条
    orphanLines.forEach((line) => {
        logs.value.push(
            `删除对象，类型：${line.type}，编号：${getComponentLabel(line)}（关联对象已删除）`
        )
    })

    // 连带删除的 AGV 路径也各自记录一条
    orphanAGVPaths.forEach((path) => {
        logs.value.push(
            `删除对象，类型：${path.type}，编号：${getComponentLabel(path)}（关联站点已删除）`
        )
    })
}

// 键盘删除：选中控件后按 Delete 删除该控件
const handleKeyDown = (e) => {
    if (e.key !== 'Delete') return

    // 正在输入框中编辑时不触发删除
    const target = e.target
    const tag = target && target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
        return
    }

    if (selectedId.value == null) return

    e.preventDefault()
    const ids = selectedIds.value.length ? [...selectedIds.value] : [selectedId.value]
    ids.forEach(handleRemoveComponent)
}

// 开始拖动右侧分割条
const startResizeRight = (e) => {
    isResizingRight.value = true
    e.preventDefault()
}

// 开始拖动左侧分割条
const startResizeLeft = (e) => {
    isResizingLeft.value = true
    e.preventDefault()
}

// 开始拖动底部分割条
const startResizeBottom = (e) => {
    isResizingBottom.value = true
    e.preventDefault()
}

// 拖动分割条
const handleMouseMove = (e) => {
    // 拖动右侧属性面板
    if (isResizingRight.value) {
        // 计算新宽度：从窗口右边缘到鼠标位置的距离
        const newWidth = window.innerWidth - e.clientX - 12 // 12px 是右侧 padding

        // 限制最小和最大宽度
        const minWidth = 250
        const maxWidth = 600
        rightPanelWidth.value = Math.max(minWidth, Math.min(maxWidth, newWidth))
    }

    // 拖动左侧资源面板
    if (isResizingLeft.value) {
        // 计算新宽度：鼠标位置减去左侧 padding
        const newWidth = e.clientX - 12 // 12px 是左侧 padding

        // 限制最小和最大宽度
        const minWidth = 200
        const maxWidth = 500
        leftPanelWidth.value = Math.max(minWidth, Math.min(maxWidth, newWidth))
    }

    // 拖动底部控制台
    if (isResizingBottom.value) {
        // 计算新高度：从窗口底部到鼠标位置的距离
        const newHeight = window.innerHeight - e.clientY - 42 // 42px = 24+12+6
        // 限制最小和最大高度
        const minHeight = 100
        const maxHeight = 400
        bottomPanelHeight.value = Math.max(minHeight, Math.min(maxHeight, newHeight))
    }
}

// 停止拖动分割条
const handleMouseUp = () => {
    isResizingRight.value = false
    isResizingLeft.value = false
    isResizingBottom.value = false
}

onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
})

// 暴露方法供 App.vue 调用
defineExpose({
    handleControlChange
})
</script>

<style scoped>
/* 主容器布局 */
.workspace-layout {
    display: flex;
    gap: 0;
    width: 100%;
    height: 100%;
    flex: 1;
    background-color: #f5f7f9;
    overflow: hidden;
    padding: 12px;
    box-sizing: border-box;
}

.simulation-toolbar {
    display: flex;
    flex-direction: row;
    height: 30px;
    width: 100%;
    background-color: #ffffff;
    align-items: center;
    user-select: none;
    border: 1px solid #e0e0e0;
    border-bottom: 0;
    border-radius: 5px 5px 0 0;
}
.toolbar-button-tooltip {
    display: inline-flex;
}
.btn {
    display: flex;
    border-radius: 8px;
    border: none;
    background-color: #fefefe;
    align-items: center;
    padding: 4px 6px 4px 6px;
    margin-left: 4px;
    user-select: none;
    cursor: pointer;
    position: relative
}
.btn.active {
    background-color: #eff6ff;
}
.coordinate-system-toggle { gap: 4px; }
.coordinate-system-toggle input { margin: 0; accent-color: #0780ff; cursor: pointer; }
.coordinate-system-toggle:has(input:focus-visible) { outline: 2px solid #93c5fd; outline-offset: 1px; }
.btn:not(:disabled):hover {
    background-color: #e8eaf0;
}
.btn:disabled {
    cursor: not-allowed;
    pointer-events: none;
}
.btn:disabled .btn-img {
    opacity: 0.4;
}
.btn-img {
    width: 20px;
    height: 20px;
    user-select: none;
    -webkit-user-drag: none;
}
/* 通用面板样式 - 每个面板都有圆角边框 */
.panel-box {
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 0 0 5px 5px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 左侧资源面板 */
.left-panel {
    flex: 0 0 auto;
    min-width: 200px;
    max-width: 500px;
    height: 100%;
}

/* 中间区域容器 */
.center-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    min-height: 0;
    height: 100%;
}

/* 画布面板 */
.canvas-panel {
    flex: 1;
    min-height: 0;
}

/* 底部控制台面板 */
.bottom-panel {
    flex: 0 0 auto;
    min-height: 100px;
    max-height: 400px;
}

/* 分割条 - 垂直方向（左右分割） */
.resizer-vertical {
    width: 12px;
    cursor: col-resize;
    background-color: transparent;
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 分割条 - 水平方向（上下分割） */
.resizer-horizontal {
    height: 12px;
    cursor: row-resize;
    background-color: transparent;
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 分割线 - 默认不可见 */
.resizer-line {
    background-color: transparent;
    transition: background-color 0.2s;
}

.resizer-vertical .resizer-line {
    width: 2px;
    height: 100%;
}

.resizer-horizontal .resizer-line {
    width: 100%;
    height: 2px;
}

/* 悬停时显示分割线 */
.resizer-vertical:hover .resizer-line {
    background-color: #d1d5db;
}

.resizer-horizontal:hover .resizer-line {
    background-color: #d1d5db;
}

/* 拖动时加深颜色 */
.resizer-vertical:active .resizer-line {
    background-color: #9ca3af;
}

.resizer-horizontal:active .resizer-line {
    background-color: #9ca3af;
}

/* 右侧属性面板 */
.right-panel {
    flex: 0 0 auto;
    min-width: 250px;
    max-width: 600px;
    height: 100%;
}
.separator {
    width: 1px;
    height: 20px;
    margin: 0 6px 0 10px;
    background-color: #c9d0d4;
    flex-shrink: 0;
    user-select: none;
}
.speed-box {
    width: 100px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: linear-gradient(to right,
    #1e5fc7 0%,
    #1e5fc7 var(--value-percent, 10%),
    #d1dae3 var(--value-percent, 10%),
    #d1dae3 100%);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    transition: opacity 0.2s;
}

.speed-box:hover {
    opacity: 0.9;
}

/* Chrome/Safari 滑块样式 */
.speed-box::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #1e5fc7;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: all 0.2s;
}

.speed-box::-webkit-slider-thumb:hover {
    width: 16px;
    height: 16px;
    box-shadow: 0 2px 6px rgba(30, 95, 199, 0.3);
}

.speed-box::-webkit-slider-thumb:active {
    width: 12px;
    height: 12px;
    background: #1551a8;
}

/* Firefox 滑块样式 */
.speed-box::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: #1e5fc7;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: all 0.2s;
}

.speed-box::-moz-range-thumb:hover {
    width: 16px;
    height: 16px;
    box-shadow: 0 2px 6px rgba(30, 95, 199, 0.3);
}

.speed-box::-moz-range-thumb:active {
    width: 12px;
    height: 12px;
    background: #1551a8;
}

/* Firefox 轨道样式 */
.speed-box::-moz-range-track {
    height: 4px;
    background: #f0f0f0;
    border-radius: 2px;
}

.speed-value {
    min-width: 32px;
    font-size: 13px;
    font-weight: 600;
    color: #1e5fc7;
    text-align: right;
}
.speed-control {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    background-color: #fefefe;
    border-radius: 8px;
    transition: background-color 0.2s;
}

.speed-control:hover {
    background-color: #eef1f4;
}
.control-btn-text {
    font-size: 13px;
    color: #5A5A5A;
    transition: color 0.2s ease;
    text-align: center;
}

</style>

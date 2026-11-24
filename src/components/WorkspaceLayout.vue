<template>
    <div class="workspace-layout">
        <!-- 左侧资源面板 -->
        <div class="left-panel panel-box" :style="{ width: leftPanelWidth + 'px' }"
             data-workspace-panel="model-tree" role="region" aria-label="模型树" tabindex="0" @pointerdown="focusPanel">
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
                        <label v-if="item.id === 'coordinate-system'" class="btn coordinate-system-toggle">
                            <img class="btn-img" :src="item.icon" alt=""/>
                            <input v-model="showCoordinateSystem" type="checkbox" aria-label="显示坐标系"/>
                        </label>
                        <div v-else-if="item.id === 'canvas'" class="canvas-limits">
                            <label class="btn coordinate-system-toggle">
                                <input type="checkbox" aria-label="有限画布" :checked="finiteCanvas.enabled"
                                       @change="handleFiniteCanvasToggle"/>
                                <img class="btn-img" :src="item.icon" alt=""/>
                                <span class="canvas-limit-summary">{{ canvasSizeSummary }}</span>
                            </label>
                        </div>
                        <button v-else class="btn"
                                type="button"
                                :disabled="isControlDisabled(item)"
                                @click="handleClickControl(item)">
                            <img class="btn-img" :src="item.icon" :alt="item.name" />
                            <span v-if="item.id === 'clock'" class="control-btn-text" id="clock" >
                                {{ simulationTime }}
                            </span>
                        </button>
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
            <div class="canvas-panel panel-box" data-workspace-panel="canvas"
                 role="region" aria-label="画布" tabindex="-1" @pointerdown="focusPanel">
                <DesignCanvas
                    ref="designCanvas"
                    :activeControl="activeControl"  tips="父组件调用子组件时顺便传参"
                    :placedComponents="placedComponents"
                    :workpieces="workpieces"
                    :showCoordinateSystem="showCoordinateSystem"
                    :canvas-boundary="canvasBoundary"
                    :selectedId="selectedId"
                    :selectedIds="selectedIds"
                    @placement-done="emit('placement-done')"
                    @add-log="handleAddLog"
                    @component-placed="handleComponentPlaced"
                    @select-component="handleSelectComponent"
                    @select-components="handleSelectComponents"
                    @canvas-drag-start="beginCanvasEdit"
                    @canvas-drag-end="endCanvasEdit"
                    @update-component-position="handleUpdateComponentPosition"
                    @update-component-positions="handleUpdateComponentPositions"
                    @resize-obstacle-edge="handleResizeObstacleEdge"
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
            <div class="bottom-panel panel-box" :style="{ height: bottomPanelHeight + 'px' }"
                 data-workspace-panel="console" role="region" aria-label="日志和控制台" tabindex="0" @pointerdown="focusPanel">
                <ConsolePanel ref="consolePanel" :logs="logs"/>
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
        <div class="right-panel panel-box" :style="{ width: rightPanelWidth + 'px' }"
             data-workspace-panel="properties" role="region" aria-label="属性面板" tabindex="0" @pointerdown="focusPanel">
            <PropertyPanel
                :selectedItem="selectedComponent"
                :placedComponents="placedComponents"
                :canvas-boundary="canvasBoundary"
                @update-component-properties="handleUpdateComponentProperties"
                @update-component-position="handleUpdateComponentPosition"
                @open-dialog="openDialog"
            />
        </div>
    </div>
    <WallExitDialog v-if="activeDialog?.dialogType === 'wall-exits' && dialogItem"
                    :key="activeDialog.key" :wall="dialogItem" :validate="validateWallExits"
                    @close="activeDialog = null" @save="saveDialog"/>
    <Dialog v-else-if="activeDialog && (dialogItem || activeDialog.dialogType === 'finite-canvas')"
            :key="activeDialog.key"
            :item="dialogItem" :dialog-type="activeDialog.dialogType"
            :assembly-recipe="activeDialog.dialogType === 'assembly-recipe' ? activeDialog.recipe : null"
            :assembly-mode="activeDialog.mode"
            :assembly-packing-type="activeDialog.packingType"
            :disassembly-recipe="activeDialog.dialogType === 'disassembly-recipe' ? activeDialog.recipe : null"
            :disassembly-mode="activeDialog.mode"
            :connection-corner="dialogConnectionCorner"
            :canvas-size="activeDialog.canvasSize"
            :minimum-canvas-size="activeDialog.dialogType === 'finite-canvas' ? minimumCanvasSize : undefined"
            :validate-triangle="getTriangleDefinitionError"
            @close="activeDialog = null" @save="saveDialog"/>
</template>

<script setup>
import {ref, shallowRef, computed, watch, onMounted, onUnmounted, onBeforeUnmount} from 'vue'
import ResourceSidebar from './ResourceSidebar.vue'
import DesignCanvas from './DesignCanvas.vue'
import PropertyPanel from './PropertyPanel.vue'
import Dialog from './Dialog.vue'
import WallExitDialog from './WallExitDialog.vue'
import ConsolePanel from './ConsolePanel.vue'
import {getComponentLabel} from '../utils/componentLabel.js'
import {STATION_TYPES, getStationType, getNextStationIndex, getComponentCenter, getComponentFootprint, getComponentQuarterTurns} from '../utils/stations.js'
import {CIRCULAR_OBSTACLE_TYPE, getCircleRadius, MIN_CIRCLE_RADIUS, RECTANGULAR_OBSTACLE_TYPE, RESIZABLE_COMPONENT_TYPES} from '../utils/componentAppearance.js'
import {getCornerMaxRadius} from '../utils/agvPath.js'
import {menuControls} from "@/config/controlMenuData";
import {simulationToolBarMenus} from '../config/simulationToolBarMenuData.js'
import {createBootstrapTooltipDirective} from '../assets/bootstrap/tooltipController.js'
import {INPUT_PROPERTY_DEFAULTS, getInputType, isValidInputProperty, getDefaultWorkpieceDimensions} from '../utils/inputRules.js'
import {WORKSTATION_PROPERTY_DEFAULTS, PARALLEL_WORKSTATION_PROPERTY_DEFAULTS, isValidWorkstationProperty, isValidParallelWorkstationProperty, ensureParallelWorkstationEquipment} from '../utils/workstationProperties.js'
import {ASSEMBLY_MODES, CONTAINER_TYPES, getAssemblyPackingType, getAssemblyRecipeError, getAssemblyUnitCount, isValidAssemblyUnitCount} from '../utils/assemblyRecipes.js'
import {DISASSEMBLY_MODES, getDisassemblyRecipeError, getDisassemblyUnitCount, isValidDisassemblyUnitCount} from '../utils/disassemblyRecipes.js'
import {BUFFER_PROPERTY_DEFAULTS, isValidBufferProperty} from '../utils/bufferProperties.js'
import {fitComponentPorts, getLocalComponentPorts, setComponentPortOffset} from '../utils/componentPorts.js'
import {createInputSimulation} from '../utils/inputSimulation.js'
import {DEFAULT_WORKPIECE_SPEED, getConnectionGeometry, getConnectionSegmentMove} from '../utils/connectionLine.js'
import {clampCanvasOffset, encloseCanvasBounds, fitsCanvasBounds, getCanvasItemBounds, getCanvasMoveBounds, getCanvasSizeError} from '../utils/canvasBoundary.js'
import {distanceToCollisionFootprint, getCollisionFootprint, hasComponentCollision, hasTriangleVertexSweepCollision, resolveComponentDrag} from '../utils/componentCollision.js'
import {getLocalTriangleVertices, getTriangleChanges, getTriangleVertices, orientTriangle, TRIANGULAR_OBSTACLE_TYPE} from '../utils/triangleObstacle.js'
import {getWallSettings, getWallValidationError, RECTANGULAR_WALL_TYPE} from '../utils/rectangularWall.js'
import {hasWallRouteCollision} from '../utils/wallRoutes.js'

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
    inputSimulation.syncAttachments(placedComponents.value)
    workpieces.value = []
}

function getEquipmentStates(stationId) {
    return inputSimulation.getEquipmentStates(stationId)
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
const finiteCanvas = ref({enabled: false, length: 40, width: 24})
const canvasSizeSummary = computed(() => finiteCanvas.value.enabled
    ? `(${finiteCanvas.value.length}, ${finiteCanvas.value.width})` : '(+∞,+∞)')
const getCanvasBoundary = ({length, width}) => ({x: -length / 2, y: -width / 2, width: length, height: width})
const canvasBoundary = computed(() => finiteCanvas.value.enabled ? getCanvasBoundary(finiteCanvas.value) : null)
const MAX_CANVAS_UNDO_STEPS = 100
const canvasHistory = []
let canvasEditBefore = null

function beginCanvasEdit() {
    if (canvasEditBefore) return false
    canvasEditBefore = {model: JSON.stringify(placedComponents.value), selection: [...selectedIds.value], canvas: finiteCanvas.value}
    return true
}

function endCanvasEdit() {
    const before = canvasEditBefore
    canvasEditBefore = null
    if (!before || (before.canvas === finiteCanvas.value && before.model === JSON.stringify(placedComponents.value))) return
    canvasHistory.push(before)
    if (canvasHistory.length > MAX_CANVAS_UNDO_STEPS) canvasHistory.shift()
}

// 拖动期间的逐帧更新和属性编辑引起的关联变更共用一次记录。
function recordCanvasEdit(edit) {
    return (...args) => {
        const started = beginCanvasEdit()
        try {
            return edit(...args)
        } finally {
            if (started) endCanvasEdit()
        }
    }
}

function undoCanvasEdit() {
    if (designCanvas.value?.undoDraftPoint()) return
    designCanvas.value?.finishCanvasDrag()
    const previous = canvasHistory.pop()
    if (!previous) return

    // 保留未修改对象的引用，避免打断它们已打开的属性编辑窗口。
    const current = new Map(placedComponents.value.map(item => [item.id, item]))
    const restored = JSON.parse(previous.model).map(item => {
        const existing = current.get(item.id)
        return existing && JSON.stringify(existing) === JSON.stringify(item) ? existing : item
    })
    if (dialogItem.value && !restored.includes(dialogItem.value)) activeDialog.value = null
    finiteCanvas.value = previous.canvas
    placedComponents.value = restored
    handleSelectComponents(previous.selection)
    handleAddLog('已撤回上一步画布操作。')
}

const minimumCanvasSize = computed(() => {
    const bounds = encloseCanvasBounds(placedComponents.value.map(getCanvasItemBounds).filter(Boolean))
    return bounds ? {
        length: 2 * Math.max(-bounds.x, bounds.x + bounds.width),
        width: 2 * Math.max(-bounds.y, bounds.y + bounds.height),
    } : {length: 0, width: 0}
})

const applyFiniteCanvas = recordCanvasEdit(settings => {
    finiteCanvas.value = settings
})

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
let nextDialogKey = 0
const handleFiniteCanvasToggle = (event) => {
    const current = finiteCanvas.value
    if (current.enabled) {
        applyFiniteCanvas({...current, enabled: false})
        return
    }

    // 点击复选框只打开编辑窗口，已应用的尺寸和勾选状态在确认前保持原样。
    event.target.checked = false
    if (activeDialog.value?.dialogType === 'finite-canvas') return
    const minimum = minimumCanvasSize.value
    activeDialog.value = {dialogType: 'finite-canvas', key: ++nextDialogKey, canvasSize: {
        length: Math.max(current.length, Math.ceil(minimum.length)),
        width: Math.max(current.width, Math.ceil(minimum.width)),
    }}
}
const dialogItem = computed(() => placedComponents.value.find(item => item.id === activeDialog.value?.itemId))
const findConnectionCorner = (item, index) => Number.isInteger(index) && index >= 0
    ? getConnectionGeometry(item, placedComponents.value)?.rows[index * 2 + 1]
    : null
const dialogConnectionCorner = computed(() => activeDialog.value?.dialogType === 'connection-radius'
    ? findConnectionCorner(dialogItem.value, activeDialog.value.rowIndex)
    : null)
const openDialog = ({itemId, dialogType, rowIndex = null, editMode}) => {
    const item = placedComponents.value.find(component => component.id === itemId)
    if (!item) return
    if (dialogType === 'connection-radius') {
        if (!findConnectionCorner(item, rowIndex)) return
        activeDialog.value = {itemId, dialogType, rowIndex, key: ++nextDialogKey}
        return
    }
    if (dialogType === 'triangle-definition') {
        if (item.type !== TRIANGULAR_OBSTACLE_TYPE) return
        activeDialog.value = {itemId, dialogType, key: ++nextDialogKey}
        return
    }
    if (dialogType === 'wall-exits') {
        if (item.type === RECTANGULAR_WALL_TYPE) activeDialog.value = {itemId, dialogType, key: ++nextDialogKey}
        return
    }
    const isDisassembly = dialogType === 'disassembly-recipe'
    if (isDisassembly && item.type !== 'disassemblyWorkstation') return
    const recipes = isDisassembly ? item.disassemblyRecipes : item.assemblyRecipes
    const recipe = rowIndex === null ? null : recipes?.[rowIndex]
    if (rowIndex !== null && !recipe) return
    let mode = isDisassembly ? (item.disassemblyMode ?? 'parts') : (editMode ?? item.assemblyMode ?? 'parts')
    let packingType
    if (dialogType === 'assembly-recipe') {
        if (mode === 'parts') {
            packingType = 'Workpiece'
        } else if (recipe && !editMode) {
            packingType = getAssemblyPackingType(recipe, mode)
            mode = CONTAINER_TYPES.includes(packingType) ? 'container' : 'parts'
        } else {
            packingType = CONTAINER_TYPES[0]
        }
    }
    activeDialog.value = {itemId, dialogType, recipe, mode, packingType, key: ++nextDialogKey}
}
const saveDialog = ({itemId, dialogType, properties, assemblyRecipe, disassemblyRecipe, radius, canvasSize, triangleVertices, wallExits}) => {
    if (itemId !== activeDialog.value?.itemId || dialogType !== activeDialog.value?.dialogType) return
    if (dialogType === 'finite-canvas') {
        if (getCanvasSizeError(canvasSize, minimumCanvasSize.value)) return
        applyFiniteCanvas({enabled: true, length: canvasSize.length, width: canvasSize.width})
    } else if (dialogType === 'assembly-recipe' || dialogType === 'disassembly-recipe') {
        const isDisassembly = dialogType === 'disassembly-recipe'
        const item = dialogItem.value
        const itemType = isDisassembly ? 'disassemblyWorkstation' : 'assemblyWorkstation'
        const field = isDisassembly ? 'disassemblyRecipes' : 'assemblyRecipes'
        const recipe = isDisassembly ? disassemblyRecipe : assemblyRecipe
        if (item?.type !== itemType) return
        const error = isDisassembly
            ? getDisassemblyRecipeError(recipe, {allowEmpty: activeDialog.value.mode === 'container'})
            : getAssemblyRecipeError(recipe)
        if (error) return
        const recipes = [...(item[field] ?? [])]
        const original = activeDialog.value.recipe
        const index = original ? recipes.indexOf(original) : recipes.length
        if (index !== -1) {
            recipes[index] = recipe
            handleUpdateComponentProperties({id: itemId, [field]: recipes})
        }
    } else if (dialogType === 'connection-radius') {
        const corner = dialogConnectionCorner.value
        if (!corner || !Number.isFinite(radius) || radius < 0 || radius > corner.maxRadius) return
        handleUpdateComponentProperties({id: itemId, connectionRadius: {index: corner.index, radius}})
    } else if (dialogType === 'triangle-definition') {
        if (!applyTriangleDefinition(triangleVertices)) return
    } else if (dialogType === 'wall-exits') {
        if (!applyWallExits(wallExits)) return
    } else {
        handleUpdateComponentProperties({id: itemId, ...properties})
    }
    activeDialog.value = null
}

// 模型树中当前选中的控件 id
const selectedId = ref(null)
const selectedIds = ref([])
const designCanvas = ref(null)
const consolePanel = ref(null)

function focusPanel(event) {
    const panel = event.currentTarget
    if (event.target.closest('[tabindex], button, input, select, textarea, a[href], [contenteditable]') === panel) {
        panel.focus({preventScroll: true})
    }
}

const getWorkspacePanel = target => target?.closest?.('[data-workspace-panel]')?.dataset.workspacePanel

function canSelectAll(target) {
    return ['model-tree', 'canvas', 'console'].includes(getWorkspacePanel(target))
}

function selectAll(target) {
    const panel = getWorkspacePanel(target)
    if (panel === 'console') {
        consolePanel.value?.selectVisibleContent()
    } else if (panel === 'model-tree' || panel === 'canvas') {
        target.ownerDocument?.getSelection()?.removeAllRanges()
        handleSelectComponents(placedComponents.value.map(item => item.id))
    }
}

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
const handleComponentPlaced = recordCanvasEdit((component) => {
    if (component.type === RECTANGULAR_WALL_TYPE) {
        const settings = getWallSettings(component)
        const error = getWallValidationError({...component, ...settings})
        if (error) {
            handleAddLog(error)
            return
        }
        Object.assign(component, {...settings, wallExits: settings.wallExits.map(exit => ({...exit}))})
    }
    if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds(component), canvasBoundary.value)) {
        handleAddLog('有限画布：组件或路径超出边界，无法放置。')
        return
    }
    if (hasComponentCollision(placedComponents.value, [component])) {
        handleAddLog('无法放置：组件占地与其他组件重叠。')
        return
    }
    if (hasWallRouteCollision(placedComponents.value, [component])) {
        handleAddLog('无法放置：连接线和 AGV 路径必须从围墙出口通过。')
        return
    }
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
    if (component.type === 'workstation') {
        for (const [field, defaultValue] of Object.entries(WORKSTATION_PROPERTY_DEFAULTS)) {
            if (component[field] === undefined) component[field] = defaultValue
        }
    }
    if (component.type === 'parallelWorkstation') {
        for (const [field, defaultValue] of Object.entries(PARALLEL_WORKSTATION_PROPERTY_DEFAULTS)) {
            if (component[field] === undefined) component[field] = defaultValue
        }
        ensureParallelWorkstationEquipment(component)
    }
    if (component.type === 'assemblyWorkstation') {
        component.assemblyUnitCount = getAssemblyUnitCount(component)
        component.assemblyMode ??= 'parts'
        component.assemblyRecipes ??= []
    }
    if (component.type === 'disassemblyWorkstation') {
        component.disassemblyUnitCount = getDisassemblyUnitCount(component)
        component.disassemblyMode ??= 'parts'
        component.disassemblyRecipes ??= []
    }
    if (component.type === 'buffer') {
        for (const [field, value] of Object.entries(BUFFER_PROPERTY_DEFAULTS)) component[field] ??= value
    }
    if (component.type === 'systemInput' && component.inputRuleRows === undefined) {
        component.inputRuleRows = [{
            partType: getInputType(component),
            name: '',
            ...getDefaultWorkpieceDimensions(component),
            fillColor: '#22c55e',
            relativeWeight: 100,
        }]
    }
    placedComponents.value.push(component)
    // 放置后自动选中该控件，效果与在模型树中选中一致（显示蓝色选中框）
    handleSelectComponent(component.id)
})

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

function resizeCircleObstacle(target, requested, clampToSpace = false) {
    if (!Number.isFinite(requested) || !Number.isFinite(2 * requested)) return
    const current = getCircleRadius(target)
    if (clampToSpace) requested = Math.max(MIN_CIRCLE_RADIUS, requested)
    if (requested < MIN_CIRCLE_RADIUS || Math.abs(requested - current) < 1e-10) return

    const center = getComponentCenter(target)
    const boundary = canvasBoundary.value
    let limit = boundary ? Math.min(
        center.x - boundary.x, boundary.x + boundary.width - center.x,
        center.y - boundary.y, boundary.y + boundary.height - center.y,
    ) : Infinity
    for (const item of placedComponents.value) {
        if (item.id === target.id) continue
        const footprint = getCollisionFootprint(item)
        // 已经重叠的旧模型可以缩小，不能继续扩张。
        if (footprint) limit = Math.min(limit, Math.max(current, distanceToCollisionFootprint(center, footprint)))
    }
    if (!clampToSpace && requested > limit + 1e-8) {
        handleAddLog('无法调整半径：圆形障碍物会超出有限画布或与其他组件重叠。')
        return
    }
    const radius = Math.min(requested, limit)
    if (radius < MIN_CIRCLE_RADIUS || Math.abs(radius - current) < 1e-10) return
    Object.assign(target, {x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius})
}

const handleResizeObstacleEdge = recordCanvasEdit(({id, axis, direction, coordinate, radius}) => {
    const target = placedComponents.value.find(item => item.id === id)
    if (target?.type === CIRCULAR_OBSTACLE_TYPE && axis === 'radius') {
        resizeCircleObstacle(target, radius, true)
        return
    }
    if (target?.type !== RECTANGULAR_OBSTACLE_TYPE || (axis !== 'x' && axis !== 'y') ||
        (direction !== -1 && direction !== 1) || !Number.isFinite(coordinate)) return

    const bounds = getComponentFootprint(target)
    const dimension = axis === 'x' ? 'width' : 'height'
    const start = bounds[axis]
    const end = start + bounds[dimension]
    const leading = direction === 1
    const oldEdge = leading ? end : start
    const fixedEdge = leading ? start : end
    const minSize = 0.01
    let edge = leading ? Math.max(coordinate, fixedEdge + minSize) : Math.min(coordinate, fixedEdge - minSize)
    const boundary = canvasBoundary.value
    if (boundary) edge = leading ? Math.min(edge, boundary[axis] + boundary[dimension]) : Math.max(edge, boundary[axis])
    if ((edge - oldEdge) * direction > 0) {
        // 扩张时只扫过被拉动的边，对边和其余尺寸始终固定。
        const face = {...bounds, [axis]: oldEdge, [dimension]: 0}
        const obstacles = placedComponents.value.filter(item => item.id !== id).map(getCollisionFootprint).filter(Boolean)
        const traveled = resolveComponentDrag([face], obstacles, {x: 0, y: 0, [axis]: edge - oldEdge})
        edge = oldEdge + traveled[axis]
    }
    if (Math.abs(edge - oldEdge) < 1e-10) return
    const resized = {...bounds, [axis]: Math.min(edge, fixedEdge), [dimension]: Math.abs(edge - fixedEdge)}

    // 画布拖动的是旋转后的外框，模型仍使用未旋转的长宽与左下角。
    const turned = getComponentQuarterTurns(target) % 2 !== 0
    const width = turned ? resized.height : resized.width
    const height = turned ? resized.width : resized.height
    const changes = {width, height, x: resized.x + (resized.width - width) / 2, y: resized.y + (resized.height - height) / 2}
    if (resized[dimension] < minSize - 1e-10 || !fitsCanvasBounds(resized, boundary) ||
        hasComponentCollision(placedComponents.value, [{...target, ...changes}])) return
    Object.assign(target, changes)
})

function getTriangleShapeError(target, changes) {
    if (!changes) return '请输入能构成有效三角形的参数。'
    const proposed = {...target, ...changes}
    if (!fitsCanvasBounds(getCanvasItemBounds(proposed), canvasBoundary.value)) return '这个三角形会超出有限画布。'
    if (hasComponentCollision(placedComponents.value, [proposed])) return '这个三角形会与其他组件重叠。'
    return ''
}

function getWallEditError(wall) {
    const error = getWallValidationError(wall)
    if (error) return error
    if (!fitsCanvasBounds(getCanvasItemBounds(wall), canvasBoundary.value)) return '墙体会超出有限画布。'
    if (hasComponentCollision(placedComponents.value, [wall])) return '墙体会与其他组件重叠。'
    if (hasWallRouteCollision(placedComponents.value, [wall])) return '墙体会挡住已有的连接线或 AGV 路径。'
    return ''
}

const validateWallExits = wallExits => dialogItem.value
    ? getWallEditError({...dialogItem.value, ...getWallSettings(dialogItem.value), wallExits}) : '矩形墙已不存在。'
const applyWallExits = recordCanvasEdit(wallExits => {
    if (dialogItem.value?.type !== RECTANGULAR_WALL_TYPE || !Array.isArray(wallExits) || validateWallExits(wallExits)) return false
    Object.assign(dialogItem.value, {...getWallSettings(dialogItem.value), wallExits: wallExits.map(exit => ({...exit}))})
    return true
})

function routeChangesAreClear(...proposed) {
    if (!hasWallRouteCollision(placedComponents.value, proposed)) return true
    handleAddLog('无法修改：连接线或 AGV 路径会穿过实体墙。')
    return false
}

function getTriangleDefinitionChanges(target, vertices) {
    if (target?.type !== TRIANGULAR_OBSTACLE_TYPE || !Array.isArray(vertices) || vertices.length !== 3 ||
        vertices.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null
    return getTriangleChanges(orientTriangle(vertices, getLocalTriangleVertices(target)), getComponentCenter(target))
}

function getTriangleDefinitionError(vertices) {
    const target = dialogItem.value
    return getTriangleShapeError(target, getTriangleDefinitionChanges(target, vertices))
}

const applyTriangleDefinition = recordCanvasEdit(vertices => {
    const target = dialogItem.value
    const changes = getTriangleDefinitionChanges(target, vertices)
    if (getTriangleShapeError(target, changes)) return false
    Object.assign(target, changes)
    return true
})

// 画布拖拽控件后，更新单一数据源中的位置
const handleUpdateComponentPosition = recordCanvasEdit(({id, x, y, nodes, connectionCorner, triangleVertex}) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return
    if (target.type === TRIANGULAR_OBSTACLE_TYPE && triangleVertex) {
        const {index, point} = triangleVertex
        const vertices = getTriangleVertices(target)
        const previous = vertices[index]
        if (!Number.isInteger(index) || !previous || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) ||
            (Math.abs(point.x - previous.x) < 1e-10 && Math.abs(point.y - previous.y) < 1e-10)) return
        vertices[index] = point
        const changes = getTriangleChanges(vertices)
        if (getTriangleShapeError(target, changes) ||
            hasTriangleVertexSweepCollision(placedComponents.value, target, index, point)) return
        Object.assign(target, changes)
        return
    }
    if (target.type === 'connectionLine') {
        const index = connectionCorner?.index
        const point = connectionCorner?.point
        if (!Number.isInteger(index) || !target.waypoints?.[index] || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return
        const waypoints = target.waypoints.map((waypoint, i) => i === index ? point : waypoint)
        if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds({...target, waypoints}), canvasBoundary.value)) return
        const radii = target.cornerRadii ?? []
        const proposed = {...target, waypoints, cornerRadii: waypoints.map((_, i) => i === index ? 0 : radii[i] ?? 0)}
        if (!routeChangesAreClear(proposed)) return
        target.waypoints = waypoints
        target.cornerRadii = getConnectionGeometry(proposed, placedComponents.value)?.cornerRadii ?? proposed.cornerRadii
        return
    }
    // 如果提供了 nodes 参数，说明是在拖动 AGV 路径的拐点
    if (target.type === 'AGVpath' && nodes) {
        if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds({...target, nodes}), canvasBoundary.value)) return
        if (!routeChangesAreClear({...target, nodes})) return
        target.nodes = nodes
        // 拐点移动后线段长度变化，修正可能超限的圆角
        clampAGVPathCornerRadii(target)
        return
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (canvasBoundary.value) {
        const offset = {x: x - target.x, y: y - target.y}
        const bounds = getCanvasMoveBounds(new Set([id]), placedComponents.value)
        const allowed = clampCanvasOffset(bounds, offset, canvasBoundary.value)
        if (!allowed) return
        x = target.x + allowed.x
        y = target.y + allowed.y
    }
    return handleUpdateComponentPositions([{id, x, y}])
})

const handleUpdateComponentProperties = recordCanvasEdit(({
                                             id,
                                             length,
                                             angle,
                                             workpieceSpeed,
                                             affectedEndpoint,
                                             connectionSegment,
                                             connectionRadius,
                                             circleRadius,
                                             wallThickness,
                                             wallThicknessMode,
                                             width,
                                             height,
                                             rotationDelta,
                                             portOffset,
                                             shadowColor,
                                             stationType,
                                             pathWidth,
                                             cornerRadii,
                                             reverseDirection,
                                             inputRuleRows,
                                             inputType,
                                             generationInterval,
                                             firstGenerationTime,
                                             maxOutputCount,
                                             inputCloseTime,
                                             inputCloseEnabled,
                                             workpieceDisplayMode,
                                             processingTime,
                                             setupTime,
                                             equipmentCount,
                                             assemblyUnitCount,
                                             assemblyMode,
                                             assemblyRecipes,
                                             disassemblyUnitCount,
                                             disassemblyMode,
                                             disassemblyRecipes,
                                             bufferCapacity,
                                             minimumStayTime
                                         }) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return

    if (target.type === CIRCULAR_OBSTACLE_TYPE) {
        resizeCircleObstacle(target, circleRadius)
        return
    }

    if (target.type === RECTANGULAR_WALL_TYPE) {
        const settings = getWallSettings(target)
        const nextWidth = width ?? settings.width, nextHeight = height ?? settings.height
        const changes = {
            ...settings, width: nextWidth, height: nextHeight,
            x: target.x + (settings.width - nextWidth) / 2,
            y: target.y + (settings.height - nextHeight) / 2,
            wallThickness: wallThickness ?? settings.wallThickness,
            wallThicknessMode: wallThicknessMode ?? settings.wallThicknessMode,
        }
        const error = getWallEditError({...target, ...changes})
        if (error) handleAddLog(error)
        else Object.assign(target, changes)
        return
    }

    if (target.type === 'connectionLine') {
        if (affectedEndpoint === 'to' || affectedEndpoint === 'from') target.affectedEndpoint = affectedEndpoint
        if (Number.isFinite(workpieceSpeed) && workpieceSpeed >= 0) target.workpieceSpeed = workpieceSpeed
        if (!connectionSegment && !connectionRadius && length === undefined && angle === undefined) return
        const geometry = getConnectionGeometry(target, placedComponents.value)
        if (!geometry || geometry.from.id === geometry.to.id) return
        if (connectionRadius) {
            const {index, radius} = connectionRadius
            const row = Number.isInteger(index) && index >= 0 ? geometry.rows[index * 2 + 1] : null
            if (!row || !Number.isFinite(radius) || radius < 0 || radius > row.maxRadius) return
            const cornerRadii = geometry.cornerRadii.map((current, i) => i === index ? radius : current)
            if (routeChangesAreClear({...target, cornerRadii})) target.cornerRadii = cornerRadii
            return
        }
        const edit = connectionSegment ?? {index: 0, length, angle}
        const update = getConnectionSegmentMove(geometry, edit.index, edit, target.affectedEndpoint ?? 'to')
        if (!update) return
        const {point, nodeIndex, endpoint} = update
        if (geometry.nodes.length === 2) {
            const moving = endpoint === 'from' ? geometry.from : geometry.to
            const port = geometry.nodes[nodeIndex]
            const x = Number((moving.x + point.x - port.x).toFixed(10))
            const y = Number((moving.y + point.y - port.y).toFixed(10))
            if (canvasBoundary.value) {
                const bounds = getCanvasMoveBounds(new Set([moving.id]), placedComponents.value)
                if (!fitsCanvasBounds({...bounds, x: bounds.x + x - moving.x, y: bounds.y + y - moving.y}, canvasBoundary.value)) {
                    handleAddLog('有限画布：调整连接线会使端点上的组件越界。')
                    return
                }
            }
            if ((x !== moving.x || y !== moving.y) && !handleUpdateComponentPosition({id: moving.id, x, y})) return
            target.angle = update.angle
        } else {
            const waypoints = target.waypoints.map((waypoint, i) => i === nodeIndex - 1 ? point : waypoint)
            if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds({...target, waypoints}), canvasBoundary.value)) {
                handleAddLog('有限画布：调整连接线会使拐点越界。')
                return
            }
            if (!routeChangesAreClear({...target, waypoints, cornerRadii: geometry.cornerRadii})) return
            target.waypoints = waypoints
            target.segmentAngles = geometry.rows.filter(row => row.type === 'Line').map(row => row.index === edit.index ? update.angle : row.angle)
            target.cornerRadii = geometry.cornerRadii
            const adjusted = getConnectionGeometry(target, placedComponents.value)
            if (adjusted) target.cornerRadii = adjusted.cornerRadii
        }
        target.affectedEndpoint = endpoint
        return
    }

    if (target.type === 'systemInput') {
        const inputProperties = {inputType, generationInterval, firstGenerationTime, maxOutputCount, inputCloseTime, inputCloseEnabled, workpieceDisplayMode}
        for (const [field, value] of Object.entries(inputProperties)) {
            if (isValidInputProperty(field, value)) target[field] = value
        }
    }

    if (target.type === 'systemInput' && Array.isArray(inputRuleRows)) {
        target.inputRuleRows = inputRuleRows.map(row => ({...row}))
    }

    if (target.type === 'workstation' || target.type === 'parallelWorkstation') {
        for (const [field, value] of Object.entries({processingTime, setupTime})) {
            if (isValidWorkstationProperty(field, value)) target[field] = value
        }
    }
    if (target.type === 'parallelWorkstation' && isValidParallelWorkstationProperty('equipmentCount', equipmentCount)) {
        target.equipmentCount = equipmentCount
        ensureParallelWorkstationEquipment(target)
    }
    if (target.type === 'assemblyWorkstation') {
        if (isValidAssemblyUnitCount(assemblyUnitCount)) target.assemblyUnitCount = assemblyUnitCount
        if (Array.isArray(assemblyRecipes) && assemblyRecipes.every(recipe => !getAssemblyRecipeError(recipe))) {
            target.assemblyRecipes = assemblyRecipes
        }
        if (ASSEMBLY_MODES.some(mode => mode.value === assemblyMode) && assemblyMode !== target.assemblyMode) {
            // 旧 BOM 没有行级类型，按切换前的显示值保留其打包类型。
            if (target.assemblyRecipes?.some(recipe => recipe.packingType == null)) {
                target.assemblyRecipes = target.assemblyRecipes.map(recipe => recipe.packingType != null ? recipe : {
                    ...recipe, packingType: getAssemblyPackingType(recipe, target.assemblyMode),
                })
            }
            target.assemblyMode = assemblyMode
        }
    }
    if (target.type === 'disassemblyWorkstation') {
        if (isValidDisassemblyUnitCount(disassemblyUnitCount)) target.disassemblyUnitCount = disassemblyUnitCount
        if (DISASSEMBLY_MODES.some(mode => mode.value === disassemblyMode)) target.disassemblyMode = disassemblyMode
        if (Array.isArray(disassemblyRecipes) && disassemblyRecipes.every(recipe => !getDisassemblyRecipeError(recipe, {allowEmpty: true}))) {
            target.disassemblyRecipes = disassemblyRecipes
        }
    }
    if (target.type === 'buffer') {
        for (const [field, value] of Object.entries({bufferCapacity, minimumStayTime})) {
            if (isValidBufferProperty(field, value)) target[field] = value
        }
    }

    if (target.type === 'AGVpath') {
        if (Number.isFinite(pathWidth) && pathWidth > 0) {
            const nextWidth = Math.max(0.01, Number(pathWidth.toFixed(2)))
            if (!canvasBoundary.value || fitsCanvasBounds(getCanvasItemBounds({...target, pathWidth: nextWidth}), canvasBoundary.value)) {
                if (routeChangesAreClear({...target, pathWidth: nextWidth})) target.pathWidth = nextWidth
            } else {
                handleAddLog('有限画布：此通道宽度会使 AGV 路径越界。')
            }
        }
        if (Array.isArray(cornerRadii)) {
            const radii = Array.from({length: Math.max(0, (target.nodes?.length || 0) - 2)}, (_, i) =>
                Number.isFinite(cornerRadii[i]) ? Math.max(0, cornerRadii[i]) : 0)
            const proposed = {...target, cornerRadii: radii}
            clampAGVPathCornerRadii(proposed)
            if (routeChangesAreClear(proposed)) target.cornerRadii = proposed.cornerRadii
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
    const hasRectangularDimensions = target.type !== TRIANGULAR_OBSTACLE_TYPE
    const updateWidth = hasRectangularDimensions && Number.isFinite(width) && width > 0 && width !== target.width
    const updateHeight = hasRectangularDimensions && Number.isFinite(height) && height > 0 && height !== target.height
    const isResizable = RESIZABLE_COMPONENT_TYPES.has(target.type)
    const rotate = (rotationDelta === 1 || rotationDelta === -1) && isResizable
    if (updateWidth || updateHeight || rotate) {
        const changes = {}
        if (updateWidth) Object.assign(changes, {width, x: target.type === 'node' ? centerX : centerX - width / 2})
        if (updateHeight) Object.assign(changes, {height, y: target.type === 'node' ? centerY : centerY - height / 2})
        if (rotate) changes.quarterTurns = (getComponentQuarterTurns(target) + rotationDelta + 4) % 4
        const proposed = {...target, ...changes}
        if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds(proposed), canvasBoundary.value)) {
            handleAddLog('有限画布：调整尺寸或方向会使组件越界。')
        } else if (hasComponentCollision(placedComponents.value, [proposed])) {
            handleAddLog('无法调整尺寸或方向：组件占地会与其他组件重叠。')
        } else {
            const previousPorts = (updateWidth || updateHeight) && isResizable ? getLocalComponentPorts(target) : null
            if (previousPorts) fitComponentPorts(proposed, previousPorts)
            if (routeChangesAreClear(proposed)) Object.assign(target, proposed)
        }
    }
    if (portOffset) {
        const proposed = {...target}
        setComponentPortOffset(proposed, portOffset.key, portOffset.point)
        if (routeChangesAreClear(proposed)) Object.assign(target, proposed)
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
})

// 多选拖动先同时更新控件，再同步站点关联路径，避免中间状态误缩小圆角。
const handleUpdateComponentPositions = recordCanvasEdit((positions) => {
    const movedNodes = new Map()
    const updates = []
    const paths = []
    for (const {id, x, y} of positions) {
        const target = placedComponents.value.find((item) => item.id === id)
        if (!target || !Number.isFinite(x) || !Number.isFinite(y)) continue
        if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds({...target, x, y}), canvasBoundary.value)) return
        updates.push({target, x, y})
        if (target.type === 'node') movedNodes.set(id, {x, y})
    }
    const movedComponents = updates.map(({target, x, y}) => ({...target, x, y}))
    if (hasComponentCollision(placedComponents.value, movedComponents)) {
        handleAddLog('无法移动：组件占地会与其他组件重叠。')
        return false
    }
    for (const component of movedNodes.size ? placedComponents.value : []) {
        if (component.type !== 'AGVpath' || !component.nodes?.length) continue
        const from = movedNodes.get(component.fromId)
        const to = movedNodes.get(component.toId)
        if (!from && !to) continue
        // 两端站点同向移动时整条路径一起平移，保持原有走向和圆角。
        const first = component.nodes[0]
        const last = component.nodes[component.nodes.length - 1]
        const dx = from ? from.x - first.x : 0
        const dy = from ? from.y - first.y : 0
        const moveWholePath = from && to && component.fromId !== component.toId &&
            Math.abs(to.x - last.x - dx) < 1e-8 && Math.abs(to.y - last.y - dy) < 1e-8
        const nodes = component.nodes.map((point, index) => {
            if (index === 0 && from) return {...from}
            if (index === component.nodes.length - 1 && to) return {...to}
            return moveWholePath ? {x: point.x + dx, y: point.y + dy} : point
        })
        if (canvasBoundary.value && !fitsCanvasBounds(getCanvasItemBounds({...component, nodes}), canvasBoundary.value)) return
        paths.push({component, nodes})
    }
    if (hasWallRouteCollision(placedComponents.value,
        [...movedComponents, ...paths.map(({component, nodes}) => ({...component, nodes}))])) return false
    for (const {target, x, y} of updates) Object.assign(target, {x, y})
    for (const {component, nodes} of paths) {
        component.nodes = nodes
        clampAGVPathCornerRadii(component)
    }
    return true
})

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

// 画布上双击标签改名后，写回单一数据源。
// 只改 displayName，不动 name/index，序号复用等逻辑不受影响
const handleRenameComponent = recordCanvasEdit(({id, displayName}) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target) return
    target.displayName = displayName
})

// 模型树删除控件（与画布同步）
const handleRemoveComponent = recordCanvasEdit((id) => {
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
})

const removeSelectedComponents = recordCanvasEdit(() => {
    const ids = selectedIds.value.length ? [...selectedIds.value] : [selectedId.value]
    ids.forEach(handleRemoveComponent)
})

// 键盘删除：选中控件后按 Delete 删除该控件
const handleKeyDown = (e) => {
    if (e.key !== 'Delete') return

    // 正在输入框中编辑时不触发删除
    const target = e.target
    const tag = target && target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable ||
        getWorkspacePanel(target) === 'console') {
        return
    }

    if (selectedId.value == null) return

    e.preventDefault()
    designCanvas.value?.finishCanvasDrag()
    removeSelectedComponents()
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
    handleControlChange,
    getEquipmentStates,
    undoCanvasEdit,
    canSelectAll,
    selectAll
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
    flex: 0 0 auto;
    min-height: 30px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    width: 100%;
    padding-block: 2px;
    background-color: #ffffff;
    align-items: center;
    user-select: none;
    border: 1px solid #e0e0e0;
    border-bottom: 0;
    border-radius: 5px 5px 0 0;
}
.simulation-toolbar > div { flex-shrink: 0; }
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
.canvas-limits { display: flex; align-items: center;  padding-right: 6px; }
.canvas-limit-summary { color: #4b5563; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
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

.panel-box:focus-within {
    outline: 2px solid #2566fd;
    outline-offset: -1px;
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
    position: relative;
    isolation: isolate;
}

.canvas-panel:focus-within {
    border-color: #2566fd;
    outline: none;
}

/* 焦点边框画在画布内部，避免覆盖相邻工具栏。 */
.canvas-panel:focus-within::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 11;
    border: 1px solid #2566fd;
    border-radius: 0 0 4px 4px;
    pointer-events: none;
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

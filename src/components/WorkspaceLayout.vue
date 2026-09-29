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
      <!-- 上部画布区域 -->
      <div class="canvas-panel panel-box">
        <DesignCanvas
          ref="designCanvas"
          :activeControl="activeControl"
          :placedComponents="placedComponents"
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
        <ConsolePanel :logs="logs" />
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
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import ResourceSidebar from './ResourceSidebar.vue'
import DesignCanvas from './DesignCanvas.vue'
import PropertyPanel from './PropertyPanel.vue'
import ConsolePanel from './ConsolePanel.vue'
import { getComponentLabel } from '../utils/componentLabel.js'
import { STATION_TYPES, getStationType, getNextStationIndex, getComponentCenter } from '../utils/stations.js'
import { getCornerMaxRadius } from '../utils/agvPath.js'

// 定义 emit
const emit = defineEmits(['placement-done'])

// 当前激活的控件信息
const activeControl = ref(null)

// 日志列表
const logs = ref([])

// 已放置控件列表（单一数据源，画布与模型树共享）
const placedComponents = ref([])

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

// 处理控件变化
const handleControlChange = (controlInfo) => {
  activeControl.value = controlInfo
}

// 接收画布上报的日志
const handleAddLog = (message) => {
  logs.value.push(message)
}

// 画布放置控件后，加入统一列表
const handleComponentPlaced = (component) => {
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
  const existingIds = new Set(placedComponents.value.map((item) => item.id))
  selectedIds.value = [...new Set(ids)].filter((id) => existingIds.has(id))
  selectedId.value = selectedIds.value[0] ?? null
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
const handleUpdateComponentPosition = ({ id, x, y, nodes }) => {
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

const handleUpdateComponentProperties = ({ id, width, height, shadowColor, stationType, pathWidth, cornerRadii, reverseDirection }) => {
  const target = placedComponents.value.find((item) => item.id === id)
  if (!target) return

  if (target.type === 'AGVpath') {
    if (Number.isFinite(pathWidth) && pathWidth > 0) target.pathWidth = Math.max(0.01, Number(pathWidth.toFixed(2)))
    if (Array.isArray(cornerRadii)) {
      target.cornerRadii = Array.from({ length: Math.max(0, (target.nodes?.length || 0) - 2) }, (_, i) =>
        Number.isFinite(cornerRadii[i]) ? Math.max(0, cornerRadii[i]) : 0)
      clampAGVPathCornerRadii(target)
    }
    if (reverseDirection) {
      target.nodes = [...(target.nodes || [])].reverse()
      target.cornerRadii = [...(target.cornerRadii || [])].reverse()
      if (target.segments) target.segments = [...target.segments].reverse()
      ;[target.fromId, target.toId] = [target.toId, target.fromId]
      ;[target.fromName, target.toName] = [target.toName, target.fromName]
    }
    return
  }

  const { x: centerX, y: centerY } = getComponentCenter(target)
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
  positions.forEach(({ id, x, y }) => {
    const target = placedComponents.value.find((item) => item.id === id)
    if (!target || !Number.isFinite(x) || !Number.isFinite(y)) return
    target.x = x
    target.y = y
    if (target.type === 'node') movedNodes.set(id, { x, y })
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
      if (index === 0 && from) return { ...from }
      if (index === component.nodes.length - 1 && to) return { ...to }
      return moveWholePath ? { x: point.x + dx, y: point.y + dy } : point
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
const handleRenameComponent = ({ id, displayName }) => {
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
    const newHeight = window.innerHeight - e.clientY - 12 // 12px 是底部 padding

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

/* 通用面板样式 - 每个面板都有圆角边框 */
.panel-box {
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
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
</style>

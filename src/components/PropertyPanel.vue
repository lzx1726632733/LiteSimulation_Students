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
            <span class="prop-value">{{ selectedItem.type }}</span>
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
        </div>

        <!-- AGV 路径：连接关系和圆角设置 -->
        <div v-else-if="selectedItem.type === 'AGVpath'" class="prop-section">
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

          <!-- 拐点圆角设置 -->
          <div v-if="cornerCount > 0" class="section-title" style="margin-top: 16px">拐点圆角</div>
          <div v-for="(radius, index) in selectedItem.cornerRadii" :key="index" class="corner-section">
            <div class="prop-row corner-input-row">
              <span class="prop-key">拐点 {{ index + 1 }}</span>
              <input
                type="number"
                min="0"
                step="0.1"
                :value="metersToRadius(radius)"
                @input="handleCornerRadiusChange(index, $event)"
                :class="['corner-input', { 'corner-error': isCornerRadiusTooLarge(index, radius) }]"
              />
              <span class="corner-unit">m</span>
            </div>
            <div v-if="isCornerRadiusTooLarge(index, radius)" class="corner-error-text">
              圆角过大，超出可用线段长度
            </div>
          </div>
        </div>

        <!-- 普通控件：坐标信息 -->
        <div v-else class="prop-section">
          <div class="section-title">坐标</div>
          <div class="prop-row">
            <span class="prop-key">中心点像素坐标</span>
            <span class="prop-value">{{ centerGridCoord }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-key">中心点物理坐标</span>
            <span class="prop-value">{{ centerPhysicalCoord }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { getComponentLabel } from "../utils/componentLabel.js";
import { settings } from "../store/settings.js";

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

// 与 DesignCanvas.vue 中的 SMALL_GRID_SIZE 保持一致：1 小网格 = 6 像素
const SMALL_GRID_SIZE = 6;

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

// 中心点像素坐标（以小网格为单位，整数）
const centerGridCoord = computed(() => {
  const item = props.selectedItem;
  if (!item || item.type === "connectionLine" || item.type === "AGVpath") return "";
  const cx = Math.round((item.x + item.width / 2) / SMALL_GRID_SIZE);
  const cy = Math.round((item.y + item.height / 2) / SMALL_GRID_SIZE);
  return `(${cx}, ${cy})`;
});

// 中心点物理坐标（以米为单位，去尾零）
const centerPhysicalCoord = computed(() => {
  const item = props.selectedItem;
  if (!item || item.type === "connectionLine" || item.type === "AGVpath") return "";
  const cx = (item.x + item.width / 2) / SMALL_GRID_SIZE;
  const cy = (item.y + item.height / 2) / SMALL_GRID_SIZE;
  const mx = cx * settings.metersPerGrid;
  const my = cy * settings.metersPerGrid;
  const fmt = (v) => String(+v.toPrecision(6));
  return `(${fmt(mx)}, ${fmt(my)}) m`;
});

// AGV 路径的拐点数量（不包括起点和终点站点）
const cornerCount = computed(() => {
  const item = props.selectedItem;
  if (!item || item.type !== "AGVpath") return 0;
  return Math.max(0, (item.nodes?.length || 0) - 2);
});

// 将像素半径转换为米
const metersToRadius = (radiusInPixels) => {
  // 半径单位从像素转换为米
  return Number((radiusInPixels / SMALL_GRID_SIZE * settings.metersPerGrid).toFixed(2));
};

// 将米转换为像素半径
const radiusToPixels = (radiusInMeters) => {
  // 半径单位从米转换为像素
  return radiusInMeters / settings.metersPerGrid * SMALL_GRID_SIZE;
};

// 检查圆角是否过大
const isCornerRadiusTooLarge = (cornerIndex, radiusInPixels) => {
  const item = props.selectedItem;
  if (!item || item.type !== "AGVpath" || !item.nodes) return false;

  const nodes = item.nodes;
  const actualIndex = cornerIndex + 1; // cornerRadii[0] 对应 nodes[1]

  if (actualIndex < 1 || actualIndex >= nodes.length - 1) return false;

  const prev = nodes[actualIndex - 1];
  const curr = nodes[actualIndex];
  const next = nodes[actualIndex + 1];

  // 计算前后两段线段的长度
  const dist1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const dist2 = Math.hypot(next.x - curr.x, next.y - curr.y);

  // 圆角半径不能超过任一线段长度的一半
  const maxRadius = Math.min(dist1, dist2) / 2;

  return radiusInPixels > maxRadius;
};

// 处理拐点圆角半径变化
const handleCornerRadiusChange = (index, event) => {
  const radiusInMeters = Number(event.target.value) || 0;
  if (!props.selectedItem || !props.selectedItem.cornerRadii) return;

  // 转换为像素
  const radiusInPixels = radiusToPixels(radiusInMeters);

  // 检查是否过大
  if (isCornerRadiusTooLarge(index, radiusInPixels)) {
    // 如果过大，计算最大允许值
    const nodes = props.selectedItem.nodes;
    const actualIndex = index + 1;
    const prev = nodes[actualIndex - 1];
    const curr = nodes[actualIndex];
    const next = nodes[actualIndex + 1];
    const dist1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dist2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const maxRadius = Math.min(dist1, dist2) / 2;

    // 设置为最大允许值
    props.selectedItem.cornerRadii[index] = maxRadius;
  } else {
    // 直接修改响应式对象
    props.selectedItem.cornerRadii[index] = Math.max(0, radiusInPixels);
  }
};

</script>

<style scoped>
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

/* 拐点圆角输入行 */
.corner-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.corner-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.corner-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  color: #374151;
  background-color: #ffffff;
  outline: none;
  transition: border-color 0.2s;
}

.corner-input:focus {
  border-color: #3b82f6;
}

.corner-input:hover {
  border-color: #9ca3af;
}

.corner-input.corner-error {
  border-color: #ef4444;
  background-color: #fef2f2;
}

.corner-input.corner-error:focus {
  border-color: #dc2626;
}

.corner-error-text {
  font-size: 12px;
  color: #ef4444;
  padding-left: 68px;
  margin-top: -2px;
}

.corner-unit {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 13px;
  user-select: none;
}

</style>

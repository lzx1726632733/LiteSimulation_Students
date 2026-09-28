<template>
  <div class="resource-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">模型树</span>
    </div>

    <div class="search-box">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索对象..."
        class="search-input"
      />
      <button class="refresh-btn" @click="refreshResources">
        <img
          src="/src/assets/icons/refresh.svg"
          alt="Refresh"
          class="refresh-icon"
        />
      </button>
    </div>

    <div class="resource-treebox">
      <!-- 空状态 -->
      <div v-if="treeData.length === 0" class="tree-empty">
        {{ searchQuery ? "未找到匹配的对象" : "暂无对象，请在画布中放置控件" }}
      </div>

      <!-- 分类 → 类型 → 实例 三级树 -->
      <ul v-else class="tree-root">
        <li v-for="category in treeData" :key="category.tabId" class="tree-node">
          <!-- 一级：分类（tab） -->
          <div class="tree-row category-row" @click="toggleNode(category.tabId)">
            <span class="tree-arrow" :class="{ expanded: !isCollapsed(category.tabId) }">▶</span>
            <img class="tree-icon" :src="category.icon" :alt="category.name" />
            <span class="tree-label">{{ category.name }}</span>
            <span class="tree-count">{{ category.total }}</span>
          </div>

          <ul v-show="!isCollapsed(category.tabId)" class="tree-children">
            <li v-for="group in category.types" :key="group.type" class="tree-node">
              <!-- 二级：控件类型 -->
              <div
                class="tree-row type-row"
                @click="toggleNode(`${category.tabId}:${group.type}`)"
              >
                <span
                  class="tree-arrow"
                  :class="{ expanded: !isCollapsed(`${category.tabId}:${group.type}`) }"
                >▶</span>
                <img class="tree-icon" :src="group.icon" :alt="group.name" />
                <span class="tree-label">{{ group.name }}</span>
                <span class="tree-count">{{ group.instances.length }}</span>
              </div>

              <ul
                v-show="!isCollapsed(`${category.tabId}:${group.type}`)"
                class="tree-children"
              >
                <!-- 三级：具体实例 -->
                <li
                  v-for="instance in group.instances"
                  :key="instance.id"
                  class="tree-row instance-row"
                  :class="{ selected: selectedIds.includes(instance.id) || instance.id === selectedId }"
                  @click="selectInstance(instance.id, $event)"
                  @dblclick="emit('focus-component', instance.id)"
                >
                  <img class="tree-icon" :src="instance.icon" :alt="instance.name" />
                  <span class="tree-label">{{ getComponentLabel(instance) }}</span>
                  <button
                    class="delete-btn"
                    title="删除"
                    @click.stop="removeInstance(instance.id)"
                    @dblclick.stop
                  >
                    ×
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { tabList, menuControls } from "/src/config/controlMenuData.js";
import { getComponentLabel } from "../utils/componentLabel.js";

// 接收父组件维护的已放置控件（单一数据源）与当前选中项
const props = defineProps({
  placedComponents: {
    type: Array,
    default: () => [],
  },
  selectedId: {
    type: String,
    default: null,
  },
  selectedIds: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["select-component", "toggle-component-selection", "focus-component", "remove-component", "add-log"]);

// 搜索关键字
const searchQuery = ref("");

// 手动折叠的节点 key 集合（默认全部展开）
const collapsedKeys = ref(new Set());

const isCollapsed = (key) => collapsedKeys.value.has(key);

const toggleNode = (key) => {
  // Set 需重新赋值以触发响应式更新
  const next = new Set(collapsedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedKeys.value = next;
};

// 按 controlMenuData.js 的顺序构建三级树，仅包含实际放置了控件的分类/类型
const treeData = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();

  return tabList
    .map((tab) => {
      const controls = menuControls[tab.id] || [];

      const types = controls
        .map((control) => {
          // 该类型下已放置的实例，按序号排序
          let instances = props.placedComponents
            .filter((item) => item.type === control.type)
            .slice()
            .sort((a, b) => a.index - b.index);

          // 搜索过滤：匹配 “名称+序号” 或 类型名
          if (keyword) {
            const typeMatched = control.name.toLowerCase().includes(keyword);
            if (!typeMatched) {
              instances = instances.filter((item) =>
                getComponentLabel(item).toLowerCase().includes(keyword),
              );
            }
          }

          return {
            type: control.type,
            name: control.name,
            icon: control.icon,
            instances,
          };
        })
        .filter((group) => group.instances.length > 0);

      const total = types.reduce((sum, group) => sum + group.instances.length, 0);

      return {
        tabId: tab.id,
        name: tab.name,
        icon: tab.icon,
        types,
        total,
      };
    })
    .filter((category) => category.types.length > 0);
});

// 选中实例
const selectInstance = (id, event) => {
  emit(event?.shiftKey ? "toggle-component-selection" : "select-component", id);
};

// 删除实例（通知父组件与画布同步）
const removeInstance = (id) => {
  emit("remove-component", id);
};

// 刷新：清空搜索并展开全部
const refreshResources = () => {
  searchQuery.value = "";
  collapsedKeys.value = new Set();
  emit("add-log", "刷新模型树");
};
</script>

<style scoped>
.resource-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #f9f9fe;
  padding: 8px 16px;
  border-bottom: 1px solid #e0e4e8;
}

.sidebar-title {
  margin: 0;
  margin-right: 12px;
  font-size: 16px;
  font-weight: 400;
  color: #000;
  font-weight: bold;
  user-select: none;
  -webkit-user-drag: none;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background-color: #fefefe;
  cursor: pointer;
  font-size: 18px;
  transition: all 0.2s;
}

.refresh-btn:hover {
  background-color: #bebebe;
  transform: rotate(180deg);
}

.refresh-icon {
    width: 22px;
    height: 22px;
    user-select: none;
    -webkit-user-drag: none;
}

.search-box {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background-color: #fefefe;
  border-bottom: 1px solid #e0e4e8;
}

.search-input {
  width: 100%;
  height: 24px;
  padding: 0 0 0 12px;
  margin-right: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: #1e5fc7;
}

.resource-treebox {
  flex: 1;  /* 让资源树占据剩余空间 */
  overflow-y: auto;  /* 允许垂直滚动 */
  overflow-x: auto;  /* 允许水平滚动 */
  margin: 6px 6px;
  background-color: #fefefe;
}

/* 空状态提示 */
.tree-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
  user-select: none;
}

/* 树列表通用 */
.tree-root,
.tree-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* 子级缩进 */
.tree-children {
  padding-left: 16px;
}

.tree-node {
  user-select: none;
}

/* 每一行 */
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s;
}

.tree-row:hover {
  background-color: #f0f7ff;
}

/* 展开箭头 */
.tree-arrow {
  display: inline-block;
  width: 12px;
  font-size: 10px;
  color: #9ca3af;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.tree-arrow.expanded {
  transform: rotate(90deg);
}

/* 图标 */
.tree-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  pointer-events: none;
  -webkit-user-drag: none;
}

/* 文本标签 */
.tree-label {
  flex: 1;
  font-size: 13px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
}

.category-row .tree-label {
  font-weight: 600;
  color: #1f2937;
}

/* 数量徽标 */
.tree-count {
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 16px;
  color: #6b7280;
  background-color: #eef1f5;
  border-radius: 8px;
  text-align: center;
  flex-shrink: 0;
}

/* 实例行：无箭头，左侧多缩进对齐 */
.instance-row {
  padding-left: 22px;
}

.instance-row.selected {
  background-color: #eff6ff;
}

.instance-row.selected .tree-label {
  color: #2566fd;
  font-weight: 600;
}

/* 删除按钮：默认隐藏，悬停行时显示 */
.delete-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: #9ca3af;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.instance-row:hover .delete-btn {
  display: flex;
}

.delete-btn:hover {
  background-color: #fee2e2;
  color: #dc2626;
}
</style>

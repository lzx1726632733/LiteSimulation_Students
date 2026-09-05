<template>
    <div class="control-panel">
        <div class="menu-label">
            <!-- 标签菜单栏 -->
            <span v-for="tab in tabList" :key="tab.id" class="tab-item" :class="{ active: activeKey === tab.id }"
                @click="handleTabClick(tab)">
                <img class="tab-icon" :src="tab.icon" :alt="tab.name" />
                {{ tab.name }}
            </span>
        </div>
        <!-- 菜单容器 -->
        <div v-if="panelVisible" class="menu-body">
                <button v-for="item in menuControls[activeKey]" :key="item.id"
                    class="control-panel-btn"
                    :class="{ active: activeControlId === `${activeKey}-${item.id}` }"
                    @click="handleClickControl(item)">
                    <img class="control-btn-img" :src="item.icon" :alt="item.name" />

                    <span class="control-btn-text">
                        {{ item.name }}
                    </span>
                </button>
            </div>
    </div>
</template>


<script setup>
import { ref, watch, computed } from "vue";
import { tabList, menuControls } from "/src/config/controlMenuData.js";

// 定义 emit
const emit = defineEmits(['control-change']);

//标签菜单中，默认取第一个tab的id为激活标识
const activeKey = ref(tabList[0].id);
// 控制面板是否展开，默认打开
const panelVisible = ref(true);
// 当前选中的控件，格式: "tabId-controlId"
// 初始化时选中第一个tab的第一个控件
const firstControl = menuControls[tabList[0].id]?.[0];
const activeControlId = ref(firstControl ? `${tabList[0].id}-${firstControl.id}` : null);

// 计算当前激活控件的完整信息
const activeControlInfo = computed(() => {
    if (!activeControlId.value) return null;

    const [tabId, controlId] = activeControlId.value.split('-');
    const controls = menuControls[tabId];
    if (!controls) return null;

    const control = controls.find(c => c.id === parseInt(controlId));
    if (!control) return null;

    return {
        tabId,
        controlId,
        ...control
    };
});

// 监听激活控件的变化，向外传递
watch(activeControlInfo, (newValue) => {
    emit('control-change', newValue);
}, { immediate: true });

// Tab点击处理函数
const handleTabClick = (tab) => {
    // 如果点击的是当前已激活的 tab，不执行任何操作
    if (activeKey.value === tab.id) {
        return;
    }
    // 切换标签
    activeKey.value = tab.id;
    // 重置为默认的"选择"控件
    const defaultControl = menuControls[tabList[0].id]?.[0];
    activeControlId.value = defaultControl ? `${tabList[0].id}-${defaultControl.id}` : null;
};

//控件点击事件
const handleClickControl = (item) => {
    // 设置当前激活的控件，组合 tab 和 控件 id
    activeControlId.value = `${activeKey.value}-${item.id}`;
};

// 重置为默认的"选择"控件（供父组件调用）
const resetToSelect = () => {
    const defaultControl = menuControls[tabList[0].id]?.[0];
    activeControlId.value = defaultControl ? `${tabList[0].id}-${defaultControl.id}` : null;
};

defineExpose({ resetToSelect });
</script>


<style scoped>
.control-panel {
    display: flex;
    flex-direction: column;
    margin: 0 10px;
    min-height: 100px;
    border-radius: 10px;
    border: 1px solid #c9d0d4;
    background-color: #ffffff;
}

.menu-label {
    display: flex;
    width: 100%;
    height: 36px;
    padding: 4px 10px;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid #e5e7eb;
}

.tab-item {
    display: flex;
    align-items: center;
    gap: 4px;
    background-color: transparent;
    border-radius: 6px 6px 0 0;
    padding: 6px 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #6b7280;
    font-size: 13px;
    position: relative;
    user-select: none; /* 禁止选中文本和图片 */
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
}

/* tab 悬停效果 */
.tab-item:hover {
    background-color: #f9fafb;
    color: #374151;
}

/* tab 激活状态 */
.tab-item.active {
    background-color: #eff6ff;
    color: #2566fd;
    font-weight: 600;
}

/* tab 激活状态下的下划线 */
.tab-item.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background-color: #2566fd;
}

/* tab 激活状态下的图标变为蓝色 */
.tab-item.active .tab-icon {
    filter: brightness(0) saturate(100%) invert(32%) sepia(98%) saturate(2084%) hue-rotate(212deg) brightness(98%) contrast(99%);
}

.tab-icon {
    width: 16px;
    height: 16px;
    transition: filter 0.2s ease;
    pointer-events: none; /* 禁止图片交互 */
    user-select: none; /* 禁止选中 */
    -webkit-user-drag: none; /* 禁止拖拽 */
}

.menu-body {
    display: flex;
    flex-wrap: wrap;
    padding: 4px 10px;
    gap: 16px; /* 按钮之间间距16px（左右各8px） */
}

.control-panel-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 8px 8px;
    background-color: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 70px;
    position: relative;
    user-select: none; /* 禁止选中文本和图片 */
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
}

/* 按钮之间的分割线 */
.control-panel-btn:not(:last-child)::after {
    content: '';
    position: absolute;
    right: -8px; /* 分割线距离按钮右侧4px */
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 60%;
    background-color: #e5e7eb;
    /* 确保分割线渲染一致 */
    will-change: transform;
    backface-visibility: hidden;
}

/* 悬停效果 */
.control-panel-btn:hover {
    background-color: #f0f7ff;
}

/* 激活状态 */
.control-panel-btn.active {
    background-color: #eff6ff;
}


/* 激活状态下的文字 */
.control-panel-btn.active .control-btn-text {
    color: #2566fd;
    font-weight: 600;
}

.control-btn-img {
    width: 28px;
    height: 28px;
    transition: filter 0.2s ease;
    pointer-events: none; /* 禁止图片交互 */
    user-select: none; /* 禁止选中 */
    -webkit-user-drag: none; /* 禁止拖拽 */
}

.control-btn-text {
    font-size: 13px;
    color: #374151;
    transition: color 0.2s ease;
    text-align: center;
}
</style>

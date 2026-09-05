<template>
  <div class="console-panel">
    <div class="header">
      <button
        class="header-btn"
        :class="{ active: activeTab === 'log' }"
        @click="activeTab = 'log'"
      >
        日志
      </button>
      <button
        class="header-btn"
        :class="{ active: activeTab === 'console' }"
        @click="activeTab = 'console'"
      >
        控制台
      </button>
    </div>

    <!-- 日志内容区域 -->
    <div ref="contentRef" class="content" @scroll="handleScroll">
      <div v-show="activeTab === 'log'" class="log-list">
        <div v-for="(log, index) in logs" :key="index" class="log-item">
          {{ log }}
        </div>
      </div>
      <div v-show="activeTab === 'console'" class="console-content">
      </div>
    </div>

    <!-- 回到底部按钮：向上滚动离开底部后出现 -->
    <transition name="fade">
      <button
        v-show="activeTab === 'log' && showBackToBottom"
        class="back-to-bottom"
        title="回到最新日志"
        @click="scrollToBottom"
      >
        <img :src="backToBottomIcon" alt="回到底部" />
      </button>
    </transition>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import backToBottomIcon from '@/assets/icons/backToTop.svg'

// 接收父组件传入的日志
const props = defineProps({
  logs: {
    type: Array,
    default: () => [],
  },
})

const activeTab = ref('log')

// 日志滚动容器
const contentRef = ref(null)

// 是否显示「回到底部」按钮
const showBackToBottom = ref(false)

// 判断当前是否已经贴在底部（留 20px 容差）
function isScrolledToBottom() {
  const el = contentRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 20
}

function scrollToBottom() {
  const el = contentRef.value
  if (el) el.scrollTop = el.scrollHeight
  showBackToBottom.value = false
}

// 滚动时更新按钮显隐：离开底部才显示
function handleScroll() {
  showBackToBottom.value = !isScrolledToBottom()
}

// 新日志到达时，若用户仍停留在底部则自动跟随最新日志；
// 若用户已向上翻看历史日志，则保持当前位置不打断。
watch(
  () => props.logs.length,
  () => {
    const stick = isScrolledToBottom()
    nextTick(() => {
      if (stick) scrollToBottom()
      else showBackToBottom.value = true
    })
  }
)

// 切回日志标签时滚到最新
watch(activeTab, (tab) => {
  if (tab === 'log') {
    nextTick(scrollToBottom)
  }
})
</script>

<style scoped>
.console-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #fefefe;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  background-color: #f9f9fe;
  padding: 6px 16px;
  border-bottom: 1px solid #e0e4e8;
  gap: 32px;
}

.header-btn {
  position: relative;
  font-size: 14px;
  color: #5A5A5A;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
  user-select: none;
  -webkit-user-drag: none;
}

.header-btn::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 0;
  right: 0;
  height: 2px;
  background-color: #2566fd;
  transform: scaleX(0);
  transition: transform 0.2s ease;
}

.header-btn:hover {
  color: #2566fd;
}

.header-btn.active {
  color: #2566fd;
  font-weight: 600;
}

.header-btn.active::after {
  transform: scaleX(1);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-item {
  font-size: 13px;
  color: #333;
  line-height: 1.6;
  font-family: "Consolas", "Monaco", monospace;
  user-select: text;
}

/* 回到底部按钮：无边框、悬浮圆形阴影 */
.back-to-bottom {
  position: absolute;
  right: 24px;
  bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
}

.back-to-bottom img {
  width: 16px;
  height: 16px;
  pointer-events: none;
  -webkit-user-drag: none;
}

.back-to-bottom:hover {
  background-color: #f5f8ff;
  box-shadow: 0 4px 14px rgba(37, 102, 253, 0.28);
  transform: translateY(-1px);
}

.back-to-bottom:active {
  transform: translateY(0);
  box-shadow: 0 2px 6px rgba(37, 102, 253, 0.22);
}

/* 淡入淡出过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

</style>

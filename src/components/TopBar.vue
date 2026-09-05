<!-- 顶部导航栏（包括软件logo、名称、顶栏菜单、窗口最小化最大化关闭） -->
<template>
  <div class="topbar">
    <!-- 左边图标按钮部分 -->
    <div class="topbar-left">
        <img class="logo" src="/src/assets/icons/logo.svg" alt="Logo" />
        <span class="name">LiteSimulation</span>
    </div>

    <!-- 中间菜单部分 -->
    <div class="topbar-center" ref="menuBar">
      <div
        v-for="menu in topBarMenus"
        :key="menu.id"
        class="menu-entry"
      >
        <button
          class="menu-btn"
          :class="{ active: openMenuId === menu.id }"
          @click="toggleMenu(menu.id)"
          @mouseenter="handleMenuHover(menu.id)"
        >
          {{ menu.label }}
        </button>

        <!-- 下拉菜单 -->
        <ul v-if="openMenuId === menu.id" class="menu-dropdown">
          <template v-for="item in menu.items" :key="item.id">
            <li v-if="item.dividerBefore" class="menu-divider" />
            <li
              class="menu-item"
              :class="{ disabled: item.disabled }"
              @click="handleMenuAction(item)"
            >
              {{ item.label }}
            </li>
          </template>
        </ul>
      </div>
    </div>

    <!-- 右边窗口按钮部分 -->
    <div class="topbar-right">
      <button class="window-btn minimize" @click="handleMinimize">
        <img
          class="window-btn-img minimize"
          src="/src/assets/icons/minimizeWindow.svg"
          alt="Minimize"
        />
      </button>
      <button
        class="window-btn maximize"
        :title="isMaximized ? '向下还原' : '最大化'"
        @click="handleMaximize"
      >
        <img
          class="window-btn-img maximize"
          :src="isMaximized ? restoreIcon : maximizeIcon"
          :alt="isMaximized ? 'Restore' : 'Maximize'"
        />
      </button>
      <button class="window-btn close" @click="handleClose">
        <img
          class="window-btn-img close"
          src="/src/assets/icons/closeWindow.svg"
          alt="Close"
        />
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import maximizeIcon from '@/assets/icons/maximizeWindow.svg'
import restoreIcon from '@/assets/icons/restoreWindow.svg'
import { topBarMenus } from '../config/topBarMenuData.js'

const emit = defineEmits(['menu-action'])

// 窗口是否处于最大化：决定按钮显示「最大化」还是「向下还原」
const isMaximized = ref(false)
let unsubscribe = null

// 窗口控制：调用 preload 暴露的 electronAPI
const handleMinimize = () => window.electronAPI?.winMin()
const handleMaximize = () => window.electronAPI?.winMax()
const handleClose   = () => window.electronAPI?.winClose()

// 当前展开的菜单 id（null 表示全部收起）
const openMenuId = ref(null)

// 菜单区域（按钮 + 下拉面板都在里面），用于判断点击是否发生在菜单之外
const menuBar = ref(null)

const toggleMenu = (id) => {
  openMenuId.value = openMenuId.value === id ? null : id
}

// 已经有菜单展开时，鼠标划过另一个菜单按钮就直接切换过去（收起旧的、展开新的），
// 不必再点一次。菜单全部收起时不响应 hover —— 否则鼠标只是路过顶栏就会弹出菜单
const handleMenuHover = (id) => {
  if (openMenuId.value === null) return
  openMenuId.value = id
}

const closeMenu = () => {
  openMenuId.value = null
}

// 点击菜单以外的任何地方都收起菜单。
// 用 pointerdown 而不是 click：按下的瞬间就收起，手感更接近系统菜单；
// 而且画布是在 mousedown 里处理拖拽/选中的，等 click 就太晚了。
// 挂在捕获阶段，避免子组件调用 stopPropagation 后这里收不到事件。
// 注意只收起菜单、不拦截事件本身，被点到的按钮/画布照常响应这一次点击
const handleOutsidePointerDown = (e) => {
  if (openMenuId.value === null) return
  if (menuBar.value?.contains(e.target)) return
  closeMenu()
}

// Esc 关闭菜单
const handleKeyDown = (e) => {
  if (e.key === 'Escape') closeMenu()
}

// 菜单项点击处理：disabled 项直接忽略，其余项向父组件冒泡 action id
const handleMenuAction = (item) => {
  if (item.disabled) return
  closeMenu()
  emit('menu-action', item.id)
}

onMounted(async () => {
  unsubscribe = window.electronAPI?.onMaximizedChange?.((value) => {
    isMaximized.value = value
  })
  isMaximized.value = (await window.electronAPI?.winIsMaximized?.()) ?? false

  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
  // 点到窗口外面（切到别的程序）时菜单也该收起，否则切回来还挂着
  window.addEventListener('blur', closeMenu)
})

onUnmounted(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  window.removeEventListener('blur', closeMenu)
})
</script>

<style scoped>
.topbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0;
  margin: 0;
  height: 40px;
  width: 100%;
  background-color: #f9f9fe;
  border-bottom: 1px solid #e0e4e8;
  user-select: none;
  -webkit-app-region: drag; /* 整条 TopBar 作为窗口拖动区域 */
}

/* ── 左侧 ── */
.topbar-left {
  display: flex;
  height: 100%;
  align-items: center;
}

.logo {
  width: 20px;
  height: 20px;
  margin: 0 10px 0 14px;
  user-select: none;
  -webkit-user-drag: none;
}

.name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.7px;
  color: black;
  user-select: none;
  -webkit-user-drag: none;
  white-space: nowrap;
}

/* ── 中间菜单 ── */
.topbar-center {
  display: flex;
  flex: 1;
  height: 100%;
  align-items: center;
  padding: 0 4px;
  /* 下拉菜单需要溢出显示，不要裁剪 */
  overflow: visible;
}

/* 每个顶栏菜单的锚点容器 */
.menu-entry {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  /* 每个菜单项之间的间距 */
  margin-left: 8px;
}

/* 顶栏菜单触发按钮 */
.menu-btn {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 13px;
  color: #1f2937;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s;
  -webkit-app-region: no-drag;
}

.menu-btn:hover,
.menu-btn.active {
  background-color: #e8eaf0;
}

/* 下拉面板 */
.menu-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  z-index: 9999;
  min-width: 160px;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background-color: #ffffff;
  border: 1px solid #e0e4e8;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  -webkit-app-region: no-drag;
}

/* 菜单项 */
.menu-item {
  padding: 7px 16px;
  font-size: 13px;
  /* 必须写成整数：line-height: normal 在雅黑 13px 下约为 17.4px，菜单项高度
     就成了小数，逐项累加后两条分割线会落在不同的小数位置上，1px 的线被
     分摊到两行物理像素时看起来就比另一条粗。定成 17px 后整个下拉里
     所有高度都是整数，两条线的相对间距 = 31 + 9 = 40px，在 100%/125%/
     150% 缩放下都能落在同一相位，粗细才一致 */
  line-height: 17px;
  color: #1f2937;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.1s;
}

.menu-item:hover {
  background-color: #f0f7ff;
  color: #2566fd;
}

.menu-item.disabled {
  color: #9ca3af;
  cursor: default;
}

.menu-item.disabled:hover {
  background-color: transparent;
  color: #9ca3af;
}

/* 分割线 */
.menu-divider {
  height: 1px;
  margin: 4px 8px;
  background-color: #e5e7eb;
  pointer-events: none;
}

/* ── 右侧窗口按钮 ── */
.topbar-right {
  display: flex;
  height: 100%;
  align-items: center;
}

/* 按钮不参与拖动，否则点不动 */
.window-btn {
  display: flex;
  height: 100%;
  width: 40px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 0;
  align-items: center;
  justify-content: center;
  background-color: #f9f9fc;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.window-btn.close:hover {
  background-color: #f15c5b;
}

.window-btn.minimize:hover,
.window-btn.maximize:hover {
  background-color: #d6dade;
}

.window-btn-img {
  display: block;
  width: 16px;
  height: 16px;
  user-select: none;
  -webkit-user-drag: none;
}
</style>

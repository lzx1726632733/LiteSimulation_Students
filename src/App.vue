<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Background from './components/Background.vue'
import TopBar from './components/TopBar.vue'
import TopToolbar from './components/TopToolbar.vue'
import ControlPanel from './components/ControlPanel.vue'
import WorkspaceLayout from './components/WorkspaceLayout.vue'
import BottomBar from './components/BottomBar.vue'
import ShortcutSettings from './components/ShortcutSettings.vue'
import { shortcutBindings } from './config/shortcuts.js'
import { installShortcuts, loadShortcutBindings, saveShortcutBindings } from './utils/shortcuts.js'

// 引用，获取组件实例对象
const workspaceLayoutRef = ref(null)
const controlPanelRef = ref(null)
const simulationStatus = ref('not-started')

// 处理控件变化
const handleControlChange = (controlInfo) => {
  if (workspaceLayoutRef.value) {
    workspaceLayoutRef.value.handleControlChange(controlInfo)
  }
}

// 放置完成后重置为"选择"控件
const handlePlacementDone = () => {
  controlPanelRef.value?.resetToSelect()
}

const shortcutCommands = {
  'repeat-last-tool': () => controlPanelRef.value?.repeatLastTool(),
}
const activeShortcutBindings = ref(shortcutBindings)
const showShortcutSettings = ref(false)
const shortcutSaveError = ref('')
let uninstallShortcuts

function registerShortcuts() {
  uninstallShortcuts?.()
  uninstallShortcuts = installShortcuts(window, activeShortcutBindings.value, shortcutCommands)
}

function saveShortcutSettings(bindings) {
  try {
    activeShortcutBindings.value = saveShortcutBindings(window, bindings, shortcutBindings)
  } catch {
    shortcutSaveError.value = '无法保存快捷键设置，请重试。'
    return
  }
  registerShortcuts()
  showShortcutSettings.value = false
}

onMounted(() => {
  activeShortcutBindings.value = loadShortcutBindings(window, shortcutBindings)
  registerShortcuts()
})
onBeforeUnmount(() => uninstallShortcuts?.())

// 顶栏菜单动作派发
const handleMenuAction = (id) => {
  if (id === 'shortcut-settings') {
    shortcutSaveError.value = ''
    showShortcutSettings.value = true
  }
}
</script>

<template>
    <Background>
        <TopBar @menu-action="handleMenuAction"></TopBar>
        <TopToolbar></TopToolbar>
        <ControlPanel ref="controlPanelRef" @control-change="handleControlChange"></ControlPanel>
        <WorkspaceLayout ref="workspaceLayoutRef" @placement-done="handlePlacementDone"
                         @simulation-status-change="simulationStatus = $event"></WorkspaceLayout>
        <BottomBar :simulation-status="simulationStatus"></BottomBar>
        <ShortcutSettings v-if="showShortcutSettings" :bindings="activeShortcutBindings" :save-error="shortcutSaveError"
                          @close="showShortcutSettings = false" @save="saveShortcutSettings"/>
    </Background>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  overflow: hidden;
  font-family: "Microsoft YaHei", system-ui, -apple-system, sans-serif;
}

</style>

<script setup>
import { ref } from 'vue'
import Background from './components/Background.vue'
import TopBar from './components/TopBar.vue'
import TopToolbar from './components/TopToolbar.vue'
import ControlPanel from './components/ControlPanel.vue'
import WorkspaceLayout from './components/WorkspaceLayout.vue'
import BottomBar from './components/BottomBar.vue'
import SettingsDialog from './components/SettingsDialog.vue'

// 引用
const workspaceLayoutRef = ref(null)
const controlPanelRef = ref(null)

// 设置对话框可见性
const showSettings = ref(false)

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

// 顶栏菜单动作派发
const handleMenuAction = (id) => {
  if (id === 'settings') {
    showSettings.value = true
  }
  // TODO: 其余 id（new-model、open-model、save 等）后续在此扩展
}
</script>

<template>
    <Background>
        <TopBar @menu-action="handleMenuAction"></TopBar>
        <TopToolbar></TopToolbar>
        <ControlPanel ref="controlPanelRef" @control-change="handleControlChange"></ControlPanel>
        <WorkspaceLayout ref="workspaceLayoutRef" @placement-done="handlePlacementDone"></WorkspaceLayout>
        <BottomBar></BottomBar>
    </Background>
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
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
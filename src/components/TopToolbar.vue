<!-- 顶部控件菜单栏 -->
<template>
  <div class="top-toolbar">
    <!-- 开始仿真、停止、重置按钮 -->
    <button class="btn startsimulation">
      <img class="btn-img startsimulation" src="/src/assets/icons/start.svg" alt="Start" />
      <span class="btn-text startsimulation">开始仿真</span>
    </button>
    <button class="btn stopsimulation">
      <img class="btn-img stopsimulation" src="/src/assets/icons/stop.svg" alt="Stop" />
      <span class="btn-text stopsimulation">停止</span>
    </button>
    <button class="btn resetSimulation">
      <img class="btn-img resetSimulation" src="/src/assets/icons/reset.svg" alt="Reset" />
      <span class="btn-text resetSimulation">重置</span>
    </button>
    <div class="separator"></div>
    <!-- 仿真速度调节、开始仿真、暂停仿真、终止仿真按钮 -->
    <div class="speed-control">
      <span class="speed-text">仿真速度</span>
      <input v-model="simulationSpeed" class="speed-box" type="range" min="0.1" max="10" step="0.1"
        :style="{ '--value-percent': `${((simulationSpeed - 0.1) / (10 - 0.1)) * 100}%` }" />
      <span class="speed-value">{{ simulationSpeed }}x</span>
    </div>
    <div class="separator"></div>
    <!-- 撤销、重做按钮 -->
    <button class="btn undo">
      <img class="btn-img undo" src="/src/assets/icons/undo.svg" alt="Undo" />
      <span class="btn-text undo">撤销</span>
    </button>
    <button class="btn redo">
      <img class="btn-img redo" src="/src/assets/icons/redo.svg" alt="Redo" />
      <span class="btn-text redo">重做</span>
    </button>
    <div class="separator"></div>
  </div>
</template>

<script setup>
import { ref } from "vue";
// 仿真速度初始值
const simulationSpeed = ref(1.0);
</script>

<style scoped>
.top-toolbar {
  display: flex;
  flex-direction: row;
  height: 40px;
  width: 100%;
  background-color: #ffffff;
  align-items: center;
  margin-left: 10px;
  user-select: none;
}

.btn {
  display: flex;
  border-radius: 8px;
  border: none;
  background-color: #fefefe;
  align-items: center;
  padding: 4px 6px;
  margin-right: 6px;
  user-select: none;
  cursor: pointer;
}

.btn-img {
  width: 20px;
  height: 20px;
  margin-right: 4px;
  user-select: none;
  -webkit-user-drag: none;
}

.btn-text {
  font-size: 14px;
  font-weight: 400;
  color: #5A5A5A;
  user-select: none;
  -webkit-user-drag: none;
}

.btn:hover {
  background-color: #2566fd;
}

.btn:hover .btn-img {
  filter: brightness(0) saturate(100%) invert(100%);
}

.btn:hover .btn-text {
  color: #ffffff;
}

.separator {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background-color: #c9d0d4;
  flex-shrink: 0;
  user-select: none;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 4px;
  padding: 4px 10px;
  background-color: #fefefe;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.speed-control:hover {
  background-color: #eef1f4;
}

.speed-text {
  font-size: 13px;
  color: #000000;
  white-space: nowrap;
  font-weight: 500;
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

.btn-img.start {
  height: 20px;
  width: 20px;
}
</style>

<!-- 大背景（浅灰色，参考WPS Office） -->
<template>
  <div class="background">
    <slot></slot>
  </div>
</template>

<script setup></script>

<style scoped>
.background {
  display: flex;
  flex-direction: column;
  width: 100vw; /* 视口宽度 */
  height: 100vh; /* 视口高度 */
  background-color: #ffffff;
  margin: 0; /* 清除默认边距 */
  overflow: hidden;
  -webkit-user-drag: none;
}
</style>

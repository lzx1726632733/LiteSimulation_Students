// 全局设置（单例响应式对象，所有组件共享同一引用）
import { reactive } from 'vue'

export const settings = reactive({
  // 比例尺：1 小网格对应的实际距离（米）。默认 1 格 = 1 米
  metersPerGrid: 1,
})

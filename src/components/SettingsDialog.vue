<!-- 设置对话框（双栏布局：左侧分类导航 + 右侧设置内容） -->
<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="handleCancel">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">

        <!-- 标题栏 -->
        <div class="dialog-header">
          <span id="dialog-title" class="dialog-title">设置</span>
          <button class="close-btn" @click="handleCancel" title="关闭">&#x2715;</button>
        </div>

        <!-- 双栏主体 -->
        <div class="dialog-body">

          <!-- 左侧分类导航 -->
          <nav class="nav-panel" aria-label="设置分类">
            <div class="nav-group-label">常规</div>
            <button
              v-for="cat in settingsCategories"
              :key="cat.id"
              class="nav-item"
              :class="{ active: activeCategory === cat.id }"
              @click="activeCategory = cat.id"
            >
              <span class="nav-indicator" aria-hidden="true"></span>
              <svg v-if="cat.id === 'scale'" class="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1" y="5.5" width="14" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
                <line x1="4" y1="5.5" x2="4" y2="10.5" stroke="currentColor" stroke-width="1.3"/>
                <line x1="8" y1="5.5" x2="8" y2="9.5"  stroke="currentColor" stroke-width="1.3"/>
                <line x1="12" y1="5.5" x2="12" y2="10.5" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              <span class="nav-label">{{ cat.label }}</span>
            </button>
          </nav>

          <!-- 右侧内容区 -->
          <div class="content-panel">

            <!-- ── 比例尺 ── -->
            <template v-if="activeCategory === 'scale'">
              <h2 class="content-title">比例尺</h2>
              <p class="content-desc">
                设置画布坐标与真实场景的对应关系，用于将画布上的网格距离换算为实际长度。
              </p>

              <div class="field-group">
                <div class="field-row">
                  <label class="field-label" for="input-scale">1 小网格对应距离</label>
                  <div class="field-control">
                    <input
                      id="input-scale"
                      ref="inputRef"
                      class="number-input"
                      :class="{ 'input-error': scaleError }"
                      type="number"
                      :value="rawScale"
                      min="0.001"
                      step="0.001"
                      @input="onScaleInput"
                      @keydown.enter.prevent="handleConfirm"
                      @keydown.esc.prevent="handleCancel"
                    />
                    <span class="input-unit">米</span>
                  </div>
                </div>
                <p v-if="scaleError" class="field-error">{{ scaleError }}</p>
                <p v-else class="field-hint">精确到毫米级，最多填写 3 位小数（最小 0.001 米）。</p>
              </div>

              <!-- 换算预览 -->
              <div class="preview-card">
                <div class="preview-title">换算预览</div>
                <div class="preview-formula">
                  <span class="pf-label">1 个小网格</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtM(draftMeters) }}</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtDm(draftMeters) }}</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtCm(draftMeters) }}</span>
                </div>
                <div class="preview-formula">
                  <span class="pf-label">1 个大网格</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-label">6 个小网格</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtM(draftMeters * 6) }}</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtDm(draftMeters * 6) }}</span>
                  <span class="pf-sep">=</span>
                  <span class="pf-val">{{ fmtCm(draftMeters * 6) }}</span>
                </div>
              </div>
            </template>

          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="dialog-footer">
          <button class="btn btn-cancel" @click="handleCancel">取消</button>
          <button class="btn btn-confirm" :disabled="!!scaleError" @click="handleConfirm">确定</button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { settings } from '../store/settings.js'
import { settingsCategories } from '../config/settingsCategories.js'

const emit = defineEmits(['close'])

const activeCategory = ref('scale')

// 用原始字符串存储，避免 parseFloat 掩盖精度问题（如 0.0001 解析后仍是数字）
const rawScale = ref(String(settings.metersPerGrid))
const inputRef = ref(null)

onMounted(() => {
  inputRef.value?.focus()
  inputRef.value?.select()
})

const onScaleInput = (e) => {
  rawScale.value = e.target.value
}

// 验证：正数 + 最小 0.001 + 最多 3 位小数
const scaleError = computed(() => {
  const s = rawScale.value.trim()
  if (!s) return '请输入有效的正数'
  const num = parseFloat(s)
  if (isNaN(num) || num <= 0) return '请输入有效的正数'
  if (num < 0.001) return '不能低于最小精度 0.001 米（1 毫米）'
  const dot = s.indexOf('.')
  if (dot !== -1 && s.length - dot - 1 > 3) return '超出最大精度，最多填写 3 位小数（精确到毫米）'
  return ''
})

// 当前有效数值，供换算预览使用
const draftMeters = computed(() => {
  const n = parseFloat(rawScale.value)
  return !isNaN(n) && n > 0 ? n : 0
})

// 格式化各单位，去掉尾随零
const fmt = (val) => (!isFinite(val) || val <= 0) ? '?' : String(+val.toPrecision(6))
const fmtM  = (m) => `${fmt(m)} m`
const fmtDm = (m) => `${fmt(m * 10)} dm`
const fmtCm = (m) => `${fmt(m * 100)} cm`

const handleConfirm = () => {
  if (scaleError.value) return
  settings.metersPerGrid = parseFloat(rawScale.value)
  emit('close')
}

const handleCancel = () => emit('close')
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.dialog {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  width: 640px;
  height: 460px;
  max-width: 94vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 13px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.dialog-title { font-size: 14px; font-weight: 600; color: #111827; }
.close-btn {
  width: 24px; height: 24px; border: none; background: transparent;
  color: #6b7280; font-size: 13px; cursor: pointer; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  padding: 0; transition: background-color 0.12s, color 0.12s;
}
.close-btn:hover { background-color: #f3f4f6; color: #111827; }
.dialog-body { display: flex; flex: 1; overflow: hidden; }

/* ── 左侧导航 ── */
.nav-panel {
  width: 168px; flex-shrink: 0;
  background-color: #f7f8fa; border-right: 1px solid #e5e7eb;
  padding: 12px 0 8px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 1px;
}
.nav-group-label {
  font-size: 11px; font-weight: 600; color: #9ca3af;
  text-transform: uppercase; letter-spacing: 0.6px;
  padding: 0 16px 8px;
}
.nav-item {
  position: relative; display: flex; align-items: center; gap: 8px;
  width: 100%; height: 34px; padding: 0 14px 0 16px;
  border: none; background: transparent; text-align: left;
  cursor: pointer; transition: background-color 0.1s;
  color: #374151; font-size: 13px;
}
.nav-item:hover { background-color: #eef0f4; }
.nav-item.active { background-color: #e8edf8; color: #2566fd; font-weight: 500; }
.nav-indicator {
  position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px;
  border-radius: 0 2px 2px 0; background-color: transparent;
  transition: background-color 0.1s;
}
.nav-item.active .nav-indicator { background-color: #2566fd; }
.nav-icon { width: 15px; height: 15px; flex-shrink: 0; color: inherit; }
.nav-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 右侧内容 ── */
.content-panel {
  flex: 1; overflow-y: auto; padding: 24px 28px;
  display: flex; flex-direction: column; gap: 20px;
}
.content-title { font-size: 16px; font-weight: 600; color: #111827; margin: 0; }
.content-desc  { font-size: 13px; color: #6b7280; line-height: 1.6; margin: 0; }

/* ── 字段 ── */
.field-group { display: flex; flex-direction: column; gap: 10px; }
.field-row   { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.field-label { font-size: 13px; color: #374151; flex-shrink: 0; cursor: default; }
.field-control { display: flex; align-items: center; gap: 6px; }
.number-input {
  width: 100px; height: 30px; padding: 0 8px; font-size: 13px;
  color: #111827; border: 1px solid #d1d5db; border-radius: 5px;
  outline: none; transition: border-color 0.15s, box-shadow 0.15s; user-select: text;
}
.number-input:focus { border-color: #2566fd; box-shadow: 0 0 0 2px rgba(37,102,253,0.15); }
.number-input.input-error { border-color: #ef4444; box-shadow: 0 0 0 2px rgba(239,68,68,0.15); }
.input-unit { font-size: 13px; color: #6b7280; }
.field-error { font-size: 12px; color: #ef4444; line-height: 1.5; margin: 0; }
.field-hint  { font-size: 12px; color: #9ca3af; line-height: 1.6; margin: 0; }
.field-hint strong { color: #6b7280; }

/* ── 换算预览 ── */
.preview-card {
  background-color: #f7f8fa; border: 1px solid #eceef2;
  border-radius: 6px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.preview-title {
  font-size: 11px; font-weight: 600; color: #9ca3af;
  text-transform: uppercase; letter-spacing: 0.6px;
}
.preview-formula {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 13px; color: #374151; line-height: 1.6;
}
.pf-label { color: #6b7280; }
.pf-sep   { color: #c3c8d1; }
.pf-val   { color: #111827; font-weight: 500; font-variant-numeric: tabular-nums; }

/* ── 底部按钮 ── */
.dialog-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  height: 52px; padding: 0 20px; flex-shrink: 0;
  border-top: 1px solid #eceef2; background-color: #fafbfc;
}
.btn {
  height: 30px; padding: 0 16px; font-size: 13px; border-radius: 5px;
  border: 1px solid transparent; cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
}
.btn-cancel { background-color: #fff; border-color: #d1d5db; color: #374151; }
.btn-cancel:hover { background-color: #f3f4f6; }
.btn-confirm { background-color: #2566fd; color: #fff; }
.btn-confirm:hover:not(:disabled) { background-color: #1d54d8; }
.btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>



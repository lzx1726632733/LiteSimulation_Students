<template>
    <FloatingDialog title="快捷键设置" :default-width="480" :default-height="260"
                    @close="emit('close')" @keydown="recordKey"
                    @mousedown="recordMouse" @mouseup="preventSideNavigation" @auxclick="preventSideNavigation">
        <div class="shortcut-content">
            <div class="shortcut-list">
                <div v-for="(binding, id) in draft" :key="id" class="shortcut-row">
                    <span class="command-label">{{ shortcutLabels[id] }}</span>
                    <kbd>{{ formatShortcutBinding(binding) }}</kbd>
                    <button type="button" :aria-pressed="recordingId === id" @click="toggleRecording(id)">
                        {{ recordingId === id ? '取消录入' : '更改' }}
                    </button>
                </div>
            </div>
            <p v-if="recordingId" class="recording-hint" role="status">按下键盘快捷键，或在窗口内按鼠标侧键。按 Esc 取消录入。</p>
            <p v-if="recordingError || saveError" class="shortcut-error" role="alert">{{ recordingError || saveError }}</p>
        </div>
        <template #footer>
            <button type="button" class="reset-button" @click="restoreDefaults">恢复默认</button>
            <button type="button" @click="emit('close')">取消</button>
            <button type="button" class="save-button" :disabled="recordingId !== null"
                    @click="emit('save', draft)">保存</button>
        </template>
    </FloatingDialog>
</template>

<script setup>
import {ref} from 'vue';
import FloatingDialog from './FloatingDialog.vue';
import {shortcutBindings, shortcutLabels} from '../config/shortcuts.js';
import {formatShortcutBinding, normalizeShortcutBinding} from '../utils/shortcuts.js';

const props = defineProps({
    bindings: {type: Object, required: true},
    saveError: {type: String, default: ''},
});
const emit = defineEmits(['close', 'save']);
const draft = ref({...props.bindings});
const recordingId = ref(null);
const recordingError = ref('');

function stopRecording() {
    recordingId.value = null;
    recordingError.value = '';
}

function toggleRecording(id) {
    const alreadyRecording = recordingId.value === id;
    stopRecording();
    if (!alreadyRecording) recordingId.value = id;
}

function setBinding(binding) {
    const id = recordingId.value;
    const label = formatShortcutBinding(binding);
    const conflict = Object.entries(draft.value).find(([otherId, other]) =>
        otherId !== id && formatShortcutBinding(other) === label);
    if (conflict) {
        recordingError.value = `${label}已绑定到「${shortcutLabels[conflict[0]]}」。`;
        return;
    }
    draft.value[id] = binding;
    stopRecording();
}

function recordKey(event) {
    if (recordingId.value === null || event.key === 'Tab' || event.isComposing) return;
    event.preventDefault();
    if (event.key === 'Escape') {
        stopRecording();
        return;
    }
    if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const binding = normalizeShortcutBinding(event);
    if (binding) setBinding(binding);
    else recordingError.value = '请使用字符键、功能键或鼠标侧键。';
}

function preventSideNavigation(event) {
    if (event.button === 3 || event.button === 4) event.preventDefault();
}

function recordMouse(event) {
    preventSideNavigation(event);
    if (recordingId.value === null) return;
    const binding = normalizeShortcutBinding(event);
    if (binding) setBinding(binding);
}

function restoreDefaults() {
    draft.value = {...shortcutBindings};
    stopRecording();
}
</script>

<style scoped>
.shortcut-content { flex: 1; min-height: 0; overflow: auto; }
.shortcut-list { padding: 6px 16px; }
.shortcut-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 0; }
.command-label { flex: 1; min-width: 96px; }
kbd { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; color: #334155; font: inherit; }
.reset-button { margin-right: auto; }
.recording-hint, .shortcut-error { margin: 0 16px 12px; }
.recording-hint { color: #1d4ed8; }
.shortcut-error { color: #b91c1c; }
</style>

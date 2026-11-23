<template>
    <Teleport to="body">
        <dialog ref="dialog" class="shortcut-settings" aria-labelledby="shortcut-settings-title"
                @cancel.prevent="cancel" @keydown.stop="recordKey"
                @mousedown="recordMouse" @mouseup="preventSideNavigation" @auxclick="preventSideNavigation">
            <header>
                <h2 id="shortcut-settings-title">快捷键设置</h2>
                <button class="close-button" type="button" aria-label="关闭" @click="emit('close')">×</button>
            </header>
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
            <footer>
                <button type="button" class="reset-button" @click="restoreDefaults">恢复默认</button>
                <button type="button" @click="emit('close')">取消</button>
                <button type="button" class="save-button" :disabled="recordingId !== null"
                        @click="emit('save', draft)">保存</button>
            </footer>
        </dialog>
    </Teleport>
</template>

<script setup>
import {onBeforeUnmount, onMounted, ref} from 'vue';
import {shortcutBindings, shortcutLabels} from '../config/shortcuts.js';
import {formatShortcutBinding, normalizeShortcutBinding} from '../utils/shortcuts.js';

const props = defineProps({
    bindings: {type: Object, required: true},
    saveError: {type: String, default: ''},
});
const emit = defineEmits(['close', 'save']);
const dialog = ref(null);
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

function cancel() {
    if (recordingId.value !== null) stopRecording();
    else emit('close');
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
    if (recordingId.value === null || event.key === 'Escape' || event.key === 'Tab' || event.isComposing) return;
    event.preventDefault();
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

onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => {
    if (dialog.value?.open) dialog.value.close();
});
</script>

<style scoped>
.shortcut-settings {
    width: min(480px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    margin: auto;
    padding: 0;
    border: 1px solid #dbe2ea;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 14px 36px #0f172a28;
    color: #1f2937;
    font-size: 13px;
}
.shortcut-settings::backdrop { background: #11182748; }
header, footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
header { justify-content: space-between; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
h2 { margin: 0; font-size: 16px; font-weight: 600; }
.shortcut-list { padding: 6px 16px; }
.shortcut-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 0; }
.command-label { flex: 1; min-width: 96px; }
kbd { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; color: #334155; font: inherit; }
footer { flex-wrap: wrap; justify-content: flex-end; border-top: 1px solid #e5e7eb; }
button { padding: 5px 12px; border: 1px solid #d4dce7; border-radius: 5px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
button:hover { background: #eff6ff; }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.close-button { border-color: transparent; background: transparent; padding: 0 6px; font-size: 20px; line-height: 24px; }
.reset-button { margin-right: auto; }
.save-button { border-color: #2563eb; background: #2563eb; color: #fff; }
.save-button:hover { background: #1d4ed8; }
.recording-hint, .shortcut-error { margin: 0 16px 12px; }
.recording-hint { color: #1d4ed8; }
.shortcut-error { color: #b91c1c; }
</style>

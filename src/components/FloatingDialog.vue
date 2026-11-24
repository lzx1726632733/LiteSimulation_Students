<template>
    <Teleport to="body">
        <section ref="dialog" v-bind="$attrs" class="floating-dialog" role="dialog" :aria-labelledby="titleId"
                 tabindex="-1" :style="windowStyle" @focusin="bringToFront" @keydown.stop="handleKeyDown"
                 @pointerdown.stop="bringToFront" @click.stop @dblclick.stop>
            <header class="dialog-titlebar" @pointerdown="startInteraction($event, 'move')"
                    @pointermove="moveInteraction" @pointerup="endInteraction" @pointercancel="endInteraction"
                    @lostpointercapture="endInteraction">
                <img :src="icon" alt="" draggable="false">
                <span :id="titleId">{{ title }}</span>
                <button class="close-button" type="button" aria-label="关闭" @pointerdown.stop @click="emit('close')">×</button>
            </header>

            <slot/>
            <footer v-if="$slots.footer" class="dialog-footer"><slot name="footer"/></footer>

            <div v-for="edge in resizeEdges" :key="edge" :class="['resize-handle', `resize-${edge}`]"
                 aria-hidden="true" @pointerdown="startInteraction($event, edge)" @pointermove="moveInteraction"
                 @pointerup="endInteraction" @pointercancel="endInteraction" @lostpointercapture="endInteraction"/>
        </section>
    </Teleport>
</template>

<script>
let topDialogLayer = 1049;
</script>

<script setup>
import {computed, onBeforeUnmount, onMounted, reactive, ref, useId} from 'vue';
import defaultIcon from '../assets/icons/logo.svg';

defineOptions({inheritAttrs: false});
const props = defineProps({
    title: {type: String, required: true},
    icon: {type: String, default: defaultIcon},
    defaultWidth: {type: Number, default: 920},
    defaultHeight: {type: Number, default: 560},
});
const emit = defineEmits(['close', 'keydown']);
const dialog = ref(null);
const titleId = useId();
const layer = ref(topDialogLayer);

const bounds = reactive({
    left: Math.max(8, (window.innerWidth - props.defaultWidth) / 2),
    top: Math.min(120, Math.max(8, window.innerHeight - props.defaultHeight - 8)),
    width: Math.min(props.defaultWidth, window.innerWidth - 16),
    height: Math.min(props.defaultHeight, window.innerHeight - 16),
});
const windowStyle = computed(() => ({
    left: `${bounds.left}px`, top: `${bounds.top}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: layer.value,
}));
const resizeEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
let interaction = null;

function bringToFront() {
    if (layer.value !== topDialogLayer) layer.value = ++topDialogLayer;
}

function handleKeyDown(event) {
    emit('keydown', event);
    if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        emit('close');
    }
}

function startInteraction(event, mode) {
    if (event.button !== 0) return;
    event.preventDefault();
    dialog.value.focus({preventScroll: true});
    interaction = {mode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...bounds};
    event.currentTarget.setPointerCapture(event.pointerId);
}

function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const start = interaction;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.mode === 'move') {
        bounds.left = Math.max(0, Math.min(window.innerWidth - bounds.width, start.left + dx));
        bounds.top = Math.max(0, Math.min(window.innerHeight - bounds.height, start.top + dy));
        return;
    }

    const minWidth = Math.min(420, start.width);
    const minHeight = Math.min(260, start.height);
    if (start.mode.includes('e')) {
        bounds.width = Math.max(minWidth, Math.min(window.innerWidth - start.left, start.width + dx));
    }
    if (start.mode.includes('s')) {
        bounds.height = Math.max(minHeight, Math.min(window.innerHeight - start.top, start.height + dy));
    }
    if (start.mode.includes('w')) {
        bounds.left = Math.max(0, Math.min(start.left + start.width - minWidth, start.left + dx));
        bounds.width = start.left + start.width - bounds.left;
    }
    if (start.mode.includes('n')) {
        bounds.top = Math.max(0, Math.min(start.top + start.height - minHeight, start.top + dy));
        bounds.height = start.top + start.height - bounds.top;
    }
}

function endInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    interaction = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
}

function fitToViewport() {
    interaction = null;
    bounds.width = Math.min(bounds.width, window.innerWidth);
    bounds.height = Math.min(bounds.height, window.innerHeight);
    bounds.left = Math.max(0, Math.min(bounds.left, window.innerWidth - bounds.width));
    bounds.top = Math.max(0, Math.min(bounds.top, window.innerHeight - bounds.height));
}

let previousFocus;
onMounted(() => {
    previousFocus = document.activeElement;
    layer.value = ++topDialogLayer;
    dialog.value.focus({preventScroll: true});
    window.addEventListener('resize', fitToViewport);
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', fitToViewport);
    if (dialog.value?.contains(document.activeElement) && previousFocus?.isConnected) {
        previousFocus.focus({preventScroll: true});
    }
});
</script>

<style scoped>
.floating-dialog {
    position: fixed;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid #858585;
    background: #f5f5f5;
    box-shadow: 0 3px 12px #0003;
    color: #1f2937;
    font-family: inherit;
    font-size: 13px;
    outline: none;
}
.dialog-titlebar {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 8px;
    min-height: 38px;
    padding-left: 10px;
    cursor: move;
    touch-action: none;
    user-select: none;
}
.dialog-titlebar img { width: 22px; height: 22px; }
.dialog-titlebar span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #737b87; }
.floating-dialog :deep(button) {
    min-width: 82px;
    padding: 5px 16px;
    border: 1px solid #d5d5d5;
    border-radius: 6px;
    background: #fff;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.floating-dialog :deep(button:hover) { background: #eaf2ff; }
.floating-dialog :deep(button:focus-visible) { outline: 2px solid #4b8dff; outline-offset: 1px; }
.floating-dialog :deep(button:disabled) { opacity: .45; cursor: default; }
.floating-dialog .close-button {
    align-self: stretch;
    min-width: 42px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    font-size: 23px;
}
.floating-dialog .close-button:hover { background: #e81123; color: white; }
.dialog-footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; padding: 12px 8px 8px; }
.floating-dialog :deep(.save-button) { border-color: #0780ff; background: #0780ff; color: white; }
.floating-dialog :deep(.save-button:hover) { background: #006ad9; }
.resize-handle { position: absolute; touch-action: none; }
.resize-n, .resize-s { left: 6px; right: 6px; height: 6px; cursor: ns-resize; }
.resize-n { top: -3px; } .resize-s { bottom: -3px; }
.resize-e, .resize-w { top: 6px; bottom: 6px; width: 6px; cursor: ew-resize; }
.resize-e { right: -3px; } .resize-w { left: -3px; }
.resize-ne, .resize-nw, .resize-se, .resize-sw { width: 10px; height: 10px; }
.resize-ne, .resize-sw { cursor: nesw-resize; }
.resize-nw, .resize-se { cursor: nwse-resize; }
.resize-ne { top: -3px; right: -3px; } .resize-nw { top: -3px; left: -3px; }
.resize-se { bottom: -3px; right: -3px; } .resize-sw { bottom: -3px; left: -3px; }
</style>

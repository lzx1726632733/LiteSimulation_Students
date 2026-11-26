<template>
    <FloatingDialog :title="getComponentLabel(item)" :icon="item.icon"
                    :default-width="550" :default-height="460" @close="emit('close')">
        <div class="component-properties-tabs" role="tablist" aria-label="组件属性">
            <button v-for="(tab, index) in tabs" :key="tab.id" :id="`${tabGroup}-${tab.id}-tab`"
                    class="component-properties-tab" type="button" role="tab"
                    :tabindex="activeTab === tab.id ? 0 : -1" :aria-selected="activeTab === tab.id"
                    :aria-controls="`${tabGroup}-${tab.id}-panel`"
                    @click="activeTab = tab.id" @keydown="moveTabFocus($event, index)">{{ tab.label }}</button>
        </div>
        <div v-show="activeTab === 'basic'" :id="`${tabGroup}-basic-panel`" class="component-properties-page"
             role="tabpanel" :aria-labelledby="`${tabGroup}-basic-tab`" tabindex="0">
            <PropertyPanel process-only :selected-item="item"
                           @update-component-properties="emit('update-component-properties', $event)"
                           @open-dialog="emit('open-dialog', $event)"/>
        </div>
        <div v-show="activeTab === 'call-agv'" :id="`${tabGroup}-call-agv-panel`" class="component-properties-page"
             role="tabpanel" :aria-labelledby="`${tabGroup}-call-agv-tab`" tabindex="0"/>
        <template #footer>
            <button type="button" @click="emit('close')">关闭</button>
        </template>
    </FloatingDialog>
</template>

<script setup>
import {ref, useId} from 'vue';
import FloatingDialog from './FloatingDialog.vue';
import PropertyPanel from './PropertyPanel.vue';
import {getComponentLabel} from '../utils/componentLabel.js';

defineProps({item: {type: Object, required: true}});
const emit = defineEmits(['close', 'update-component-properties', 'open-dialog']);
const tabs = [{id: 'basic', label: '基本属性'}, {id: 'call-agv', label: '呼叫AGV'}];
const tabGroup = useId();
const activeTab = ref(tabs[0].id);

function moveTabFocus(event, index) {
    const next = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    activeTab.value = tabs[next].id;
    document.getElementById(`${tabGroup}-${activeTab.value}-tab`)?.focus();
}
</script>

<style scoped>
.component-properties-tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    padding: 0 8px;
    border-block: 1px solid #dbe2eb;
}
.component-properties-tabs .component-properties-tab {
    padding: 8px 14px 6px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 4px 4px 0 0;
    background: transparent;
}
.component-properties-tabs .component-properties-tab:hover { background: #eef4ff; }
.component-properties-tabs .component-properties-tab[aria-selected='true'] {
    border-bottom-color: #0780ff;
    background: #eaf2ff;
    color: #1d4ed8;
}
.component-properties-page { flex: 1; min-height: 0; }
</style>

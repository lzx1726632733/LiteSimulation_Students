<template>
    <FloatingDialog :title="`${getComponentLabel(wall)} · 编辑出口`" :icon="wallIcon"
                    :default-width="680" :default-height="420" @close="emit('close')">
        <p class="exit-hint">相对距离从目标的内边框量到出口中心，宽度和距离均以米为单位。</p>
        <div class="exit-table-container">
            <table class="exit-table" aria-label="矩形墙出口">
                <thead>
                    <tr>
                        <th scope="col">序号</th>
                        <th scope="col">出口位置</th>
                        <th scope="col">出口宽度</th>
                        <th scope="col">相对目标</th>
                        <th scope="col">相对距离</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, index) in rows" :key="index" :class="{selected: selectedIndex === index}"
                        @click="selectedIndex = index" @focusin="selectedIndex = index">
                        <th scope="row">{{ index + 1 }}</th>
                        <td>
                            <select v-model="row.side" :aria-label="`第 ${index + 1} 行出口位置`">
                                <option value="">请选择</option>
                                <option v-for="side in getWallSideOptions(row.reference)" :key="side.value" :value="side.value">
                                    {{ side.label }}
                                </option>
                            </select>
                        </td>
                        <td>
                            <input v-model="row.width" type="number" min="0" step="any"
                                   :aria-label="`第 ${index + 1} 行出口宽度（米）`"/>
                        </td>
                        <td>
                            <select v-model="row.reference" :aria-label="`第 ${index + 1} 行相对目标`">
                                <option value="">请选择</option>
                                <option v-for="side in getWallSideOptions(row.side)" :key="side.value" :value="side.value">
                                    {{ side.label }}
                                </option>
                            </select>
                        </td>
                        <td>
                            <input v-model="row.distance" type="number" min="0" step="any"
                                   :aria-label="`第 ${index + 1} 行相对距离（米）`"/>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="validationError" class="exit-error" role="status">{{ validationError }}</p>
        <template #footer>
            <button type="button" @click="addRow">增加行</button>
            <button type="button" :disabled="selectedIndex === null" @click="removeRow">删除行</button>
            <button type="button" class="save-button" :disabled="!!validationError" @click="save">确认</button>
            <button type="button" @click="emit('close')">取消</button>
        </template>
    </FloatingDialog>
</template>

<script setup>
import {computed, ref} from 'vue';
import FloatingDialog from './FloatingDialog.vue';
import wallIcon from '../assets/icons/rectangularWall.svg';
import {getComponentLabel} from '../utils/componentLabel.js';
import {getWallSettings, getWallSideOptions} from '../utils/rectangularWall.js';

const props = defineProps({wall: {type: Object, required: true}, validate: {type: Function, required: true}});
const emit = defineEmits(['save', 'close']);
const rows = ref(getWallSettings(props.wall).wallExits.map(exit => ({...exit})));
const selectedIndex = ref(null);
const validationError = computed(() => props.validate(rows.value));

function addRow() {
    rows.value.push({side: '', width: '', reference: '', distance: ''});
    selectedIndex.value = rows.value.length - 1;
}

function removeRow() {
    if (selectedIndex.value === null) return;
    rows.value.splice(selectedIndex.value, 1);
    selectedIndex.value = rows.value.length ? Math.min(selectedIndex.value, rows.value.length - 1) : null;
}

function save() {
    if (validationError.value) return;
    emit('save', {itemId: props.wall.id, dialogType: 'wall-exits', wallExits: rows.value});
}
</script>

<style scoped>
.exit-hint, .exit-error { margin: 8px; }
.exit-error { color: #b91c1c; }
.exit-table-container { flex: 1; min-height: 0; margin: 0 7px; overflow: auto; border: 2px solid #5b96ff; background: white; }
.exit-table { width: 100%; min-width: 405px; border-collapse: collapse; table-layout: fixed; }
.exit-table th, .exit-table td { padding: 4px 6px; text-align: center; font-weight: normal; border-bottom: 1px solid #e9edf2; }
.exit-table thead { position: sticky; top: 0; background: white; }
.exit-table thead th:first-child { width: 46px; }
.exit-table tr.selected { background: #dbeafe; }
.exit-table input, .exit-table select {
    width: 100%;
    min-width: 0;
    padding: 4px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    font: inherit;
}
</style>

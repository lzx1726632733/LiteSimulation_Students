<!-- 底部状态栏 -->
<template>
    <div class="bottombar" role="status" aria-live="polite">
        <span>仿真状态：</span>
        <span class="status-value" :class="simulationStatus">{{ statusLabels[simulationStatus] ?? statusLabels['not-started'] }}</span>
    </div>
</template>

<script setup>
defineProps({
    simulationStatus: {type: String, default: 'not-started'},
});

const statusLabels = {
    'not-started': '未开始',
    running: '进行中',
    paused: '已暂停',
    stopped: '已终止',
    completed: '已完成',
};
</script>

<style scoped>
.bottombar {
    display: flex;
    align-items: center;
    height: 24px;
    flex-shrink: 0;
    padding: 0 12px;
    width: 100%;
    color: #6b7280;
    font-size: 12px;
    background-color: #f9f9fe;
    user-select: none;
    border-top: 1px solid #c9d0d4;
}
.status-value.running { color: #15803d; }
.status-value.paused { color: #a16207; }
.status-value.stopped { color: #b91c1c; }
.status-value.completed { color: #2563eb; }
</style>

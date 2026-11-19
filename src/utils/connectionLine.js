import {getComponentCenter} from './stations.js';

export const DEFAULT_WORKPIECE_SPEED = 1;

// 连接线属性、运动路径统一使用组件中心，忽略绘制时的图标边缘裁切。
export function getConnectionGeometry(line, components) {
    if (line?.type !== 'connectionLine') return null;
    const from = components.find(component => component.id === line.fromId);
    const to = components.find(component => component.id === line.toId);
    if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
    const start = getComponentCenter(from);
    const end = getComponentCenter(to);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) return null;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // 保留用户输入的等价角度，例如 270° 和 -90°，端点拖动后重新按坐标计算。
    if (Number.isFinite(line.angle) && line.angle >= -360 && line.angle <= 360) {
        const difference = ((line.angle - angle) % 360 + 360) % 360;
        if (length === 0 || Math.min(difference, 360 - difference) < 1e-8) angle = line.angle;
    }
    return {from, to, start, end, length, angle: Object.is(angle, -0) ? 0 : angle};
}


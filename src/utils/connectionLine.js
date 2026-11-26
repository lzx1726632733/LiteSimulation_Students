import {getComponentCenter} from './stations.js';
import {RESIZABLE_COMPONENT_TYPES_WITHOUT_PORTS} from './componentAppearance.js';
import {getComponentPortPosition} from './componentPorts.js';
import {getPathParameters, pointOnPathSegment} from './agvPath.js';

export const DEFAULT_WORKPIECE_SPEED = 1;
const EPS = 1e-9;

// 绘制、属性和运送统一使用起点的下料点及终点的上料点。
export function getConnectionGeometry(line, components) {
    if (line?.type !== 'connectionLine') return null;
    const from = components.find(component => component.id === line.fromId);
    const to = components.find(component => component.id === line.toId);
    if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
    if (RESIZABLE_COMPONENT_TYPES_WITHOUT_PORTS.has(from.type) || RESIZABLE_COMPONENT_TYPES_WITHOUT_PORTS.has(to.type) ||
        from.type === 'systemOutput' || to.type === 'systemInput') return null;
    const start = getComponentPortPosition(from, 'unloadPoint') ?? getComponentCenter(from);
    const end = getComponentPortPosition(to, 'loadPoint') ?? getComponentCenter(to);
    const waypoints = line.waypoints ?? [];
    const nodes = [start, ...waypoints, end];
    const path = getPathParameters(nodes, line);
    return Number.isFinite(path?.length) ? {from, to, start, end, ...path} : null;
}

export function getEditableRouteGeometry(item, components) {
    if (item?.type !== 'AGVpath') return getConnectionGeometry(item, components);
    const path = getPathParameters(item.nodes, item);
    if (!Number.isFinite(path?.length)) return null;
    const from = components.find(component => component.id === item.fromId && component.type === 'node');
    const to = components.find(component => component.id === item.toId && component.type === 'node');
    return {...path, from, to};
}

export function getPointOnConnection(route, distance) {
    let remaining = Math.max(0, distance);
    let last = null;
    for (const segment of route.segments) {
        if (!segment.length) continue;
        if (remaining <= segment.length) {
            const point = pointOnPathSegment(segment, remaining / segment.length);
            const angle = segment.angle ?? Math.atan2(point.uy, point.ux) * 180 / Math.PI;
            return {x: point.x, y: point.y, angle};
        }
        remaining -= segment.length;
        last = segment;
    }
    if (last?.type === 'arc') {
        const {ux, uy} = pointOnPathSegment(last, 1);
        return {...route.end, angle: Math.atan2(uy, ux) * 180 / Math.PI};
    }
    return {...route.end, angle: last?.angle ?? route.angle};
}

export function getConnectionSegmentMove(route, index, {length, angle}, item) {
    if (!Number.isInteger(index)) return null;
    const row = route.rows[index * 2];
    if (!row || (length !== undefined && (!Number.isFinite(length) || length < 0)) ||
        (angle !== undefined && (!Number.isFinite(angle) || Math.abs(angle) > 360))) return null;
    const moveStart = item.affectedEndpoint === 'from';
    const nodeIndex = moveStart ? index : index + 1;
    const lastNode = route.nodes.length - 1;
    const oppositeIndex = nodeIndex === 0 ? lastNode : nodeIndex === lastNode ? 0 : null;
    const cornerRadii = oppositeIndex === null ? route.cornerRadii : item.cornerRadii ?? [];
    const movesBothEnds = oppositeIndex !== null && route.from && route.from.id === route.to?.id;
    const fixed = route.nodes[moveStart ? index + 1 : index];
    const nextAngle = angle ?? row.angle;
    const wanted = length ?? row.length;
    const radians = nextAngle * Math.PI / 180;
    const direction = moveStart ? -1 : 1;
    const pointAt = span => ({x: fixed.x + direction * span * Math.cos(radians), y: fixed.y + direction * span * Math.sin(radians)});
    const nodes = [...route.nodes];
    const visibleLength = span => {
        nodes[nodeIndex] = pointAt(span);
        if (movesBothEnds) nodes[oppositeIndex] = nodes[nodeIndex];
        return getPathParameters(nodes, {cornerRadii})?.rows[index * 2].length ?? NaN;
    };

    let span = wanted;
    if (cornerRadii.some(radius => radius > 0)) {
        // 调整原始端点间距，使扣除相邻圆角后的可见直线达到请求的长度。
        span = row.rawLength;
        const tolerance = EPS * Math.max(1, wanted);
        if (Math.abs(visibleLength(span) - wanted) > tolerance) {
            let lower = 0, upper = Math.max(1, span, wanted);
            for (let i = 0; i < 52 && visibleLength(upper) < wanted; i++) upper *= 2;
            for (let i = 0; i < 52; i++) {
                const middle = (lower + upper) / 2;
                if (visibleLength(middle) <= wanted + (wanted === 0 ? EPS : 0)) lower = middle;
                else upper = middle;
            }
            span = wanted === 0 ? lower : (lower + upper) / 2;
            if (Math.abs(visibleLength(span) - wanted) > tolerance * 4) return null;
        }
    }
    const point = pointAt(span);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {point, nodeIndex, angle: nextAngle};
}

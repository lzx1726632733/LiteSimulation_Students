import {getComponentCenter} from './stations.js';
import {getComponentPortPosition} from './componentPorts.js';
import {buildPathArc, getPathCorner, pointOnPathSegment} from './agvPath.js';

export const DEFAULT_WORKPIECE_SPEED = 1;
const EPS = 1e-9;

function connectionAngle(start, end, length, savedAngle) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    if (Number.isFinite(savedAngle) && savedAngle >= -360 && savedAngle <= 360) {
        const difference = ((savedAngle - angle) % 360 + 360) % 360;
        if (length <= EPS || Math.min(difference, 360 - difference) < 1e-8) return savedAngle || 0;
    }
    return angle || 0;
}

function buildConnectionPath(nodes, line) {
    const lengths = nodes.slice(1).map((point, i) => Math.hypot(point.x - nodes[i].x, point.y - nodes[i].y));
    const corners = nodes.slice(1, -1).map((point, i) => ({point, ...getPathCorner(nodes, i + 1), setback: 0, radius: 0}));
    const radiusLimit = i => {
        const {factor} = corners[i];
        if (!factor) return 0;
        const before = lengths[i] - (corners[i - 1]?.setback ?? 0);
        const after = lengths[i + 1] - (corners[i + 1]?.setback ?? 0);
        return Math.max(0, Math.min(before, after) / factor);
    };
    // 相邻圆角共用一段直线，按路径顺序分配切点距离，兼容端口移动后的几何变化。
    for (const [i, corner] of corners.entries()) {
        const requested = line.cornerRadii?.[i];
        if (!Number.isFinite(requested) || requested <= 0 || !corner.factor) continue;
        corner.radius = Math.min(requested, radiusLimit(i));
        corner.setback = corner.radius * corner.factor;
        if (corner.radius > 0) corner.arc = buildPathArc(corner.point, corner, corner.radius);
    }

    const rows = [];
    const segments = [];
    for (const [i, rawLength] of lengths.entries()) {
        const previous = corners[i - 1], next = corners[i];
        const angle = connectionAngle(nodes[i], nodes[i + 1], rawLength,
            line.segmentAngles?.[i] ?? (lengths.length === 1 ? line.angle : undefined));
        const length = Math.max(0, rawLength - (previous?.setback ?? 0) - (next?.setback ?? 0));
        const start = previous?.arc?.end ?? nodes[i];
        const end = next?.arc?.start ?? nodes[i + 1];
        const segment = {type: 'line', start, end, length, angle};
        segments.push(segment);
        rows.push({type: 'Line', index: i, length, angle, rawLength});
        if (next) {
            if (next.arc) segments.push({...next.arc, cornerIndex: i});
            rows.push({type: next.arc ? 'Arc' : 'Point', index: i, point: next.point, radius: next.radius, maxRadius: radiusLimit(i)});
        }
    }
    return {nodes, rows, segments, cornerRadii: corners.map(corner => corner.radius),
        length: segments.reduce((sum, segment) => sum + segment.length, 0), angle: rows[0].angle};
}

// 绘制、属性和运送统一使用起点的下料点及终点的上料点。
export function getConnectionGeometry(line, components) {
    if (line?.type !== 'connectionLine') return null;
    const from = components.find(component => component.id === line.fromId);
    const to = components.find(component => component.id === line.toId);
    if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
    if (from.type === 'systemOutput' || to.type === 'systemInput') return null;
    const start = getComponentPortPosition(from, 'unloadPoint') ?? getComponentCenter(from);
    const end = getComponentPortPosition(to, 'loadPoint') ?? getComponentCenter(to);
    const waypoints = line.waypoints ?? [];
    const nodes = [start, ...waypoints, end];
    if (nodes.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
    const path = buildConnectionPath(nodes, line);
    return Number.isFinite(path.length) ? {from, to, start, end, ...path} : null;
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

export function getConnectionSegmentMove(route, index, {length, angle}, affectedEndpoint) {
    if (!Number.isInteger(index)) return null;
    const row = route.rows[index * 2];
    if (!row || (length !== undefined && (!Number.isFinite(length) || length < 0)) ||
        (angle !== undefined && (!Number.isFinite(angle) || Math.abs(angle) > 360))) return null;
    const last = route.nodes.length - 2;
    const endpoint = last === 0 ? affectedEndpoint : index === 0 ? 'to' : index === last ? 'from' : affectedEndpoint;
    const moveStart = endpoint === 'from';
    const nodeIndex = moveStart ? index : index + 1;
    const fixed = route.nodes[moveStart ? index + 1 : index];
    const nextAngle = angle ?? row.angle;
    const wanted = length ?? row.length;
    const radians = nextAngle * Math.PI / 180;
    const direction = moveStart ? -1 : 1;
    const pointAt = span => ({x: fixed.x + direction * span * Math.cos(radians), y: fixed.y + direction * span * Math.sin(radians)});
    const nodes = [...route.nodes];
    const visibleLength = span => {
        nodes[nodeIndex] = pointAt(span);
        return buildConnectionPath(nodes, {cornerRadii: route.cornerRadii}).rows[index * 2].length;
    };

    let span = wanted;
    if (route.cornerRadii.some(radius => radius > 0)) {
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
    return {point, nodeIndex, endpoint, angle: nextAngle};
}

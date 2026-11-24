import {angleOnArc, buildPathGeometry, getPathGeometryBounds, getPathWidth} from './agvPath.js';
import {getConnectionGeometry} from './connectionLine.js';
import {distanceToCollisionFootprint, footprintsOverlap} from './componentCollision.js';
import {getWallGeometry, RECTANGULAR_WALL_TYPE} from './rectangularWall.js';

const EPS = 1e-8;

function lineHitsWall({start, end}, wall) {
    let entry = 0, exit = 1;
    for (const [axis, dimension] of [['x', 'width'], ['y', 'height']]) {
        const delta = end[axis] - start[axis];
        const near = wall[axis] - EPS, far = wall[axis] + wall[dimension] + EPS;
        if (!delta) {
            if (start[axis] <= near || start[axis] >= far) return false;
            continue;
        }
        const first = (near - start[axis]) / delta, last = (far - start[axis]) / delta;
        entry = Math.max(entry, Math.min(first, last));
        exit = Math.min(exit, Math.max(first, last));
        if (entry >= exit) return false;
    }
    return true;
}

function agvLineFootprint({start, end, length}, half) {
    const dx = -(end.y - start.y) / length * half;
    const dy = (end.x - start.x) / length * half;
    const x = Math.min(start.x, end.x) - Math.abs(dx);
    const y = Math.min(start.y, end.y) - Math.abs(dy);
    return {
        x, y, width: Math.abs(start.x - end.x) + 2 * Math.abs(dx),
        height: Math.abs(start.y - end.y) + 2 * Math.abs(dy),
        vertices: [
            {x: start.x + dx - x, y: start.y + dy - y}, {x: end.x + dx - x, y: end.y + dy - y},
            {x: end.x - dx - x, y: end.y - dy - y}, {x: start.x - dx - x, y: start.y - dy - y},
        ],
    };
}

const arcPoint = ({center}, radius, angle) => ({
    x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle),
});

function arcHitsWall(arc, wall, radius = arc.radius) {
    const {center, startAngle, sweep} = arc;
    const xs = [wall.x, wall.x + wall.width], ys = [wall.y, wall.y + wall.height];
    const angles = [startAngle, startAngle + sweep, 0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (const x of xs) {
        const ratio = (x - center.x) / radius;
        if (Math.abs(ratio) <= 1) angles.push(Math.acos(ratio), -Math.acos(ratio));
    }
    for (const y of ys) {
        const ratio = (y - center.y) / radius;
        if (Math.abs(ratio) <= 1) angles.push(Math.asin(ratio), Math.PI - Math.asin(ratio));
    }
    return angles.filter(angle => angleOnArc(angle, arc)).some(angle => {
        const {x, y} = arcPoint(arc, radius, angle);
        return x >= xs[0] - EPS && x <= xs[1] + EPS && y >= ys[0] - EPS && y <= ys[1] + EPS;
    });
}

// AGV 圆弧占据的是两条同心弧及其端面之间的区域，接点另按圆角检测。
function arcBandHitsWall(arc, wall, inner, outer) {
    const inset = {x: wall.x + 2 * EPS, y: wall.y + 2 * EPS, width: wall.width - 4 * EPS, height: wall.height - 4 * EPS};
    if (inset.width <= 0 || inset.height <= 0) return false;
    if (arcHitsWall(arc, inset, outer) || (inner > 0 && arcHitsWall(arc, inset, inner))) return true;
    if ([arc.startAngle, arc.startAngle + arc.sweep].some(angle => lineHitsWall({
        start: arcPoint(arc, inner, angle), end: arcPoint(arc, outer, angle),
    }, inset))) return true;

    return [inset.x, inset.x + inset.width].some(x => [inset.y, inset.y + inset.height].some(y => {
        const dx = x - arc.center.x, dy = y - arc.center.y;
        const distance = Math.hypot(dx, dy);
        return distance > inner && distance < outer && angleOnArc(Math.atan2(dy, dx), arc);
    }));
}

function routeHitsWall(route, components, parts) {
    const isAgv = route.type === 'AGVpath';
    const segments = isAgv ? buildPathGeometry(route) : getConnectionGeometry(route, components)?.segments ?? [];
    const half = isAgv ? getPathWidth(route) / 2 : 0;
    const bounds = getPathGeometryBounds(segments, half);
    if (!bounds) return false;
    return parts.some(wall => {
        if (bounds.minX > wall.x + wall.width || bounds.maxX < wall.x ||
            bounds.minY > wall.y + wall.height || bounds.maxY < wall.y) return false;
        return segments.some((segment, index) => {
            if (half && index && distanceToCollisionFootprint(segment.start, wall) < half - EPS) return true;
            if (segment.type === 'arc') {
                if (!half) return arcHitsWall(segment, wall);
                const {radius} = segment;
                return arcBandHitsWall(segment, wall, Math.max(0, radius - half), radius + half) ||
                    (half > radius && arcBandHitsWall({...segment, startAngle: segment.startAngle + Math.PI},
                        wall, 0, half - radius));
            }
            return half ? footprintsOverlap(agvLineFootprint(segment, half), wall) : lineHitsWall(segment, wall);
        });
    });
}

// 只检查本次修改涉及的墙、路径和路径端点。
export function hasWallRouteCollision(components, proposed) {
    const isWall = item => item.type === RECTANGULAR_WALL_TYPE;
    if (!components.some(isWall) && !proposed.some(isWall)) return false;
    const changes = new Map(proposed.map(item => [item.id, item]));
    const scene = new Map([...components.map(item => [item.id, item]), ...changes]);
    const walls = [...scene.values()].filter(isWall);
    const allParts = walls.flatMap(wall => getWallGeometry(wall).parts);
    const changedParts = walls.filter(wall => changes.has(wall.id)).flatMap(wall => getWallGeometry(wall).parts);
    const items = [...scene.values()];
    return items.some(item => {
        if (item.type !== 'connectionLine' && item.type !== 'AGVpath') return false;
        const routeChanged = changes.has(item.id) || changes.has(item.fromId) || changes.has(item.toId);
        const parts = routeChanged ? allParts : changedParts;
        return parts.length && routeHitsWall(item, items, parts);
    });
}

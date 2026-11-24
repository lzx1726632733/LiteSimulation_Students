import {getComponentFootprint} from './stations.js';
import {getLocalTriangleVertices, getTriangleVertices, TRIANGULAR_OBSTACLE_TYPE} from './triangleObstacle.js';
import {CIRCULAR_OBSTACLE_TYPE} from './componentAppearance.js';
import {getWallGeometry, RECTANGULAR_WALL_TYPE} from './rectangularWall.js';

const EPSILON = 1e-8;

export function getCollisionFootprint(component) {
    if (component.type === 'connectionLine' || component.type === 'AGVpath') return null;
    if (component.type === RECTANGULAR_WALL_TYPE) {
        const {outer, parts} = getWallGeometry(component);
        return {...outer, parts: parts.map(part => ({...part, x: part.x - outer.x, y: part.y - outer.y}))};
    }
    const bounds = getComponentFootprint(component);
    if (component.type === TRIANGULAR_OBSTACLE_TYPE) bounds.vertices = getLocalTriangleVertices(component);
    if (component.type === CIRCULAR_OBSTACLE_TYPE) bounds.radius = bounds.width / 2;
    return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
        bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

function expandFootprint(footprint) {
    return footprint.parts?.map(part => ({...part, x: footprint.x + part.x, y: footprint.y + part.y})) ?? [footprint];
}

function overlapSize(a, b, axis, dimension) {
    return Math.min(a[axis] + a[dimension], b[axis] + b[dimension]) - Math.max(a[axis], b[axis]);
}

export function footprintsOverlap(a, b) {
    if (overlapSize(a, b, 'x', 'width') <= EPSILON || overlapSize(a, b, 'y', 'height') <= EPSILON) return false;
    if (a.parts || b.parts) {
        const obstacles = expandFootprint(b);
        return expandFootprint(a).some(part => obstacles.some(other => footprintsOverlap(part, other)));
    }
    if (a.radius || b.radius) {
        const [circle, obstacle] = a.radius ? [a, b] : [b, a];
        return distanceToCollisionFootprint(circleCenter(circle), obstacle) < circle.radius - EPSILON;
    }
    return !(a.vertices || b.vertices) || polygonAxes(a, b).every(axis => {
        const [aMin, aMax] = project(a, axis);
        const [bMin, bMax] = project(b, axis);
        return Math.min(aMax, bMax) - Math.max(aMin, bMin) > EPSILON;
    });
}

const circleCenter = ({x, y, radius}) => ({x: x + radius, y: y + radius});

function polygonVertices({x, y, width, height, vertices}) {
    return (vertices ?? [{x: 0, y: 0}, {x: width, y: 0}, {x: width, y: height}, {x: 0, y: height}])
        .map(point => ({x: x + point.x, y: y + point.y}));
}

export function distanceToCollisionFootprint(point, footprint) {
    if (footprint.parts) return Math.min(...expandFootprint(footprint).map(part => distanceToCollisionFootprint(point, part)));
    if (footprint.radius) {
        const center = circleCenter(footprint);
        return Math.max(0, Math.hypot(point.x - center.x, point.y - center.y) - footprint.radius);
    }
    const vertices = polygonVertices(footprint);
    let positive = false, negative = false, nearest = Infinity;
    for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        const dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        const ux = dx / length, uy = dy / length;
        const x = point.x - start.x, y = point.y - start.y;
        const cross = ux * y - uy * x;
        positive ||= cross > 0;
        negative ||= cross < 0;
        const along = Math.max(0, Math.min(length, x * ux + y * uy));
        nearest = Math.min(nearest, Math.hypot(x - along * ux, y - along * uy));
    }
    return positive && negative ? nearest : 0;
}

function polygonAxes(a, b) {
    const axes = [{x: 1, y: 0}, {x: 0, y: 1}];
    for (const {vertices} of [a, b]) {
        vertices?.forEach((point, index) => {
            const next = vertices[(index + 1) % vertices.length];
            const dx = next.x - point.x, dy = next.y - point.y;
            const length = Math.hypot(dx, dy);
            if (length) axes.push({x: -dy / length, y: dx / length});
        });
    }
    return axes;
}

function project(bounds, axis) {
    const origin = bounds.x * axis.x + bounds.y * axis.y;
    if (bounds.vertices) {
        const values = bounds.vertices.map(point => point.x * axis.x + point.y * axis.y);
        return [origin + Math.min(...values), origin + Math.max(...values)];
    }
    const x = bounds.width * axis.x, y = bounds.height * axis.y;
    return [origin + Math.min(0, x) + Math.min(0, y), origin + Math.max(0, x) + Math.max(0, y)];
}

// 拖动一个角点扫过的区域是旧、新三角形和两个扇形三角块的并集。
export function hasTriangleVertexSweepCollision(components, triangle, index, point) {
    const vertices = getTriangleVertices(triangle);
    const from = vertices[index];
    const swept = vertices.filter((_, i) => i !== index).map(anchor => {
        const origin = {x: Math.min(from.x, point.x, anchor.x), y: Math.min(from.y, point.y, anchor.y)};
        const cross = (point.x - from.x) * (anchor.y - from.y) - (point.y - from.y) * (anchor.x - from.x);
        return cross === 0 ? null : {
            ...origin,
            width: Math.max(from.x, point.x, anchor.x) - origin.x,
            height: Math.max(from.y, point.y, anchor.y) - origin.y,
            vertices: [from, point, anchor].map(vertex => ({x: vertex.x - origin.x, y: vertex.y - origin.y})),
        };
    }).filter(Boolean);
    const old = getCollisionFootprint(triangle);
    return components.some(component => {
        if (component.id === triangle.id) return false;
        const obstacle = getCollisionFootprint(component);
        return obstacle && !footprintsOverlap(old, obstacle) && swept.some(area => footprintsOverlap(area, obstacle));
    });
}

// 老模型中已经相交的组件可以拉开或缩小，位置修改不能加深原有重叠。
export function hasComponentCollision(components, proposed) {
    const updates = new Map(proposed.map(item => [item.id, getCollisionFootprint(item)]));
    if (!proposed.some(item => updates.get(item.id))) return false;
    const originals = new Map(components.map(item => [item.id, getCollisionFootprint(item)]));
    const next = new Map([...originals, ...updates]);
    for (const [id, bounds] of updates) {
        if (!bounds) continue;
        const original = originals.get(id);
        for (const [otherId, obstacle] of next) {
            if (otherId === id) continue;
            if (!obstacle || !footprintsOverlap(bounds, obstacle)) continue;
            const previous = originals.get(otherId);
            if (bounds.parts || obstacle.parts || !original || !previous || !footprintsOverlap(original, previous) ||
                overlapSize(bounds, obstacle, 'x', 'width') > overlapSize(original, previous, 'x', 'width') + EPSILON ||
                overlapSize(bounds, obstacle, 'y', 'height') > overlapSize(original, previous, 'y', 'height') + EPSILON) return true;
        }
    }
    return false;
}

function crossingTimes(start, end, wallStart, wallEnd, distance) {
    if (!distance) return end > wallStart + EPSILON && start < wallEnd - EPSILON ? [-Infinity, Infinity] : null;
    const first = (wallStart - end) / distance;
    const second = (wallEnd - start) / distance;
    return [Math.min(first, second), Math.max(first, second)];
}

function circleVertexContact(center, radius, vertex, velocity) {
    const travel = Math.hypot(velocity.x, velocity.y);
    if (!travel) return null;
    const ux = velocity.x / travel, uy = velocity.y / travel;
    const x = center.x - vertex.x, y = center.y - vertex.y;
    const along = -(x * ux + y * uy);
    const perpendicular = Math.abs(x * uy - y * ux);
    if (along <= 0 || perpendicular >= radius) return null;
    const distance = along - Math.sqrt((radius - perpendicular) * (radius + perpendicular));
    if (distance < -EPSILON || distance >= travel) return null;
    return contactOnNormal(Math.max(0, distance / travel), (x + ux * distance) / radius, (y + uy * distance) / radius);
}

function contactOnNormal(time, nx, ny) {
    return {time, blockX: Math.abs(nx) > EPSILON, blockY: Math.abs(ny) > EPSILON};
}

// 把平移换算成圆心相对于障碍物的运动，分别检测到顶点和边的首次接触。
function firstCircleContact(moving, obstacle, offset) {
    const [circle, other] = moving.radius ? [moving, obstacle] : [obstacle, moving];
    const velocity = moving.radius ? offset : {x: -offset.x, y: -offset.y};
    const center = circleCenter(circle);
    if (other.radius) return circleVertexContact(center, circle.radius + other.radius, circleCenter(other), velocity);

    const vertices = polygonVertices(other);
    let contact = null;
    for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const vertexContact = circleVertexContact(center, circle.radius, start, velocity);
        if (vertexContact && (!contact || vertexContact.time < contact.time)) contact = vertexContact;

        const end = vertices[(i + 1) % vertices.length];
        const dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        const ux = dx / length, uy = dy / length;
        const normalVelocity = ux * velocity.y - uy * velocity.x;
        if (!normalVelocity) continue;
        const x = center.x - start.x, y = center.y - start.y;
        const separation = ux * y - uy * x;
        const surface = -Math.sign(normalVelocity) * circle.radius;
        const time = Math.max(0, (surface - separation) / normalVelocity);
        if ((separation - surface) * Math.sign(normalVelocity) > EPSILON || time >= (contact?.time ?? 1)) continue;
        const along = (x + velocity.x * time) * ux + (y + velocity.y * time) * uy;
        if (along >= 0 && along <= length) contact = contactOnNormal(time, -uy, ux);
    }
    return contact;
}

function firstContact(moving, obstacle, offset) {
    if (footprintsOverlap(moving, obstacle)) return null;
    if (moving.radius || obstacle.radius) return firstCircleContact(moving, obstacle, offset);
    if (moving.vertices || obstacle.vertices) {
        let entry = -Infinity, exit = Infinity, normal;
        for (const axis of polygonAxes(moving, obstacle)) {
            const intervals = crossingTimes(...project(moving, axis), ...project(obstacle, axis),
                axis.x * offset.x + axis.y * offset.y);
            if (!intervals) return null;
            if (intervals[0] > entry) {
                entry = intervals[0];
                normal = axis;
            }
            exit = Math.min(exit, intervals[1]);
        }
        const time = Math.max(0, entry);
        if (!normal || time >= 1 || exit <= time) return null;
        return {time, blockX: Math.abs(normal.x) > EPSILON, blockY: Math.abs(normal.y) > EPSILON};
    }
    const x = crossingTimes(moving.x, moving.x + moving.width, obstacle.x, obstacle.x + obstacle.width, offset.x);
    const y = crossingTimes(moving.y, moving.y + moving.height, obstacle.y, obstacle.y + obstacle.height, offset.y);
    if (!x || !y) return null;
    const entry = Math.max(x[0], y[0]);
    const time = Math.max(0, entry);
    if (time >= 1 || Math.min(x[1], y[1]) <= time) return null;
    return {time, blockX: entry === x[0], blockY: entry === y[0]};
}

// 先沿指针方向找到首次接触，再沿未受阻的轴移动剩余距离；大步长也不会穿过组件。
export function resolveComponentDrag(moving, obstacles, offset) {
    const movingParts = moving.flatMap(expandFootprint);
    const obstacleParts = obstacles.flatMap(expandFootprint);
    const traveled = {x: 0, y: 0};
    let remaining = offset;
    while (remaining.x || remaining.y) {
        let contact = {time: 1, blockX: false, blockY: false};
        for (const bounds of movingParts) {
            const position = {...bounds, x: bounds.x + traveled.x, y: bounds.y + traveled.y};
            for (const obstacle of obstacleParts) {
                const hit = firstContact(position, obstacle, remaining);
                if (!hit) continue;
                if (hit.time < contact.time) contact = hit;
                else if (hit.time === contact.time) {
                    contact.blockX ||= hit.blockX;
                    contact.blockY ||= hit.blockY;
                }
            }
        }
        traveled.x += remaining.x * contact.time;
        traveled.y += remaining.y * contact.time;
        remaining = {
            x: contact.blockX ? 0 : remaining.x * (1 - contact.time),
            y: contact.blockY ? 0 : remaining.y * (1 - contact.time),
        };
    }
    return traveled;
}

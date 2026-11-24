import {getComponentFootprint} from './stations.js';
import {getPathWidth} from './agvPath.js';

const EPSILON = 1e-8;

export function getCanvasSizeError(size, minimum = {length: 0, width: 0}) {
    if (!Number.isFinite(size?.length) || size.length <= 0 || !Number.isFinite(size.width) || size.width <= 0) {
        return '请输入大于 0 的长度和宽度。';
    }
    if (size.length + 2 * EPSILON < minimum.length || size.width + 2 * EPSILON < minimum.width) {
        return '这个尺寸会使已有组件或路径越界。';
    }
    return '';
}

export function encloseCanvasBounds(bounds) {
    if (!bounds.length) return null;
    const x = Math.min(...bounds.map(item => item.x));
    const y = Math.min(...bounds.map(item => item.y));
    return {
        x, y,
        width: Math.max(...bounds.map(item => item.x + item.width)) - x,
        height: Math.max(...bounds.map(item => item.y + item.height)) - y,
    };
}

function pointFootprint(point, padding) {
    return {x: point.x - padding, y: point.y - padding, width: padding * 2, height: padding * 2};
}

export function getCanvasItemBounds(item) {
    if (item.type === 'connectionLine') {
        return encloseCanvasBounds((item.waypoints ?? []).map(point => pointFootprint(point, 0)));
    }
    if (item.type === 'AGVpath') {
        const padding = getPathWidth(item) / 2;
        return encloseCanvasBounds((item.nodes ?? []).map(point => pointFootprint(point, padding)));
    }
    return getComponentFootprint(item);
}

export function fitsCanvasBounds(bounds, boundary) {
    if (!boundary || !bounds) return true;
    return bounds.x >= boundary.x - EPSILON && bounds.y >= boundary.y - EPSILON &&
        bounds.x + bounds.width <= boundary.x + boundary.width + EPSILON &&
        bounds.y + bounds.height <= boundary.y + boundary.height + EPSILON;
}

export function clampCanvasOffset(bounds, offset, boundary) {
    if (!boundary || !bounds) return offset;
    if (bounds.width > boundary.width + EPSILON || bounds.height > boundary.height + EPSILON) return null;
    return {
        x: Math.max(boundary.x - bounds.x, Math.min(offset.x, boundary.x + boundary.width - bounds.x - bounds.width)),
        y: Math.max(boundary.y - bounds.y, Math.min(offset.y, boundary.y + boundary.height - bounds.y - bounds.height)),
    };
}

export function clampCanvasPoint(point, boundary, padding = 0) {
    const offset = clampCanvasOffset(pointFootprint(point, padding), {x: 0, y: 0}, boundary);
    return offset ? {x: point.x + offset.x, y: point.y + offset.y} : null;
}

// 站点移动时也要给相连的 AGV 通道留出半个通道宽度。
export function getCanvasMoveBounds(ids, components) {
    const bounds = [];
    for (const item of components) {
        if (ids.has(item.id)) {
            bounds.push(getCanvasItemBounds(item));
        } else if (item.type === 'AGVpath' && item.nodes?.length) {
            const movesStart = ids.has(item.fromId);
            const movesEnd = ids.has(item.toId);
            if (movesStart && movesEnd && item.fromId !== item.toId) {
                bounds.push(getCanvasItemBounds(item));
            } else {
                const padding = getPathWidth(item) / 2;
                if (movesStart) bounds.push(pointFootprint(item.nodes[0], padding));
                if (movesEnd) bounds.push(pointFootprint(item.nodes.at(-1), padding));
            }
        }
    }
    return encloseCanvasBounds(bounds.filter(Boolean));
}

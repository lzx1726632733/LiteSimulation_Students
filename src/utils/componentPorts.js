import {RECTANGULAR_OBSTACLE_TYPE, RESIZABLE_COMPONENT_TYPES} from './componentAppearance.js';
import {getComponentBounds, getComponentCenter, getComponentFootprint, getComponentQuarterTurns} from './stations.js';

const PORTS = [
    {key: 'loadPoint', label: '上料点', color: '#16a34a', side: -1, excludedType: 'systemInput'},
    {key: 'unloadPoint', label: '下料点', color: '#dc2626', side: 1, excludedType: 'systemOutput'},
];

export function getComponentPorts(component) {
    if (!RESIZABLE_COMPONENT_TYPES.has(component?.type) || component.type === RECTANGULAR_OBSTACLE_TYPE) return [];
    return PORTS.filter(port => port.excludedType !== component.type);
}

function rotateOffset({x, y}, turns) {
    switch (turns) {
        case 1: return {x: y || 0, y: -x || 0};
        case 2: return {x: -x || 0, y: -y || 0};
        case 3: return {x: -y || 0, y: x || 0};
        default: return {x, y};
    }
}

function fitOffset(point, {width, height}) {
    return {
        x: Math.max(-width / 2, Math.min(width / 2, point.x)),
        y: Math.max(-height / 2, Math.min(height / 2, point.y)),
    };
}

// 点位以组件自身轴存储，属性面板读写旋转后的画布坐标偏移。
function localOffset(component, {key, side}, bounds) {
    const saved = component[key];
    const point = Number.isFinite(saved?.x) && Number.isFinite(saved?.y)
        ? saved : {x: side * bounds.width / 2, y: 0};
    return fitOffset(point, bounds);
}

export function getLocalComponentPorts(component) {
    const bounds = getComponentBounds(component);
    return Object.fromEntries(getComponentPorts(component).map(port => [
        port.key, localOffset(component, port, bounds),
    ]));
}

export function getComponentPortOffset(component, key) {
    const port = getComponentPorts(component).find(entry => entry.key === key);
    if (!port) return null;
    return rotateOffset(localOffset(component, port, getComponentBounds(component)), getComponentQuarterTurns(component));
}

export function getComponentPortPosition(component, key) {
    const offset = getComponentPortOffset(component, key);
    if (!offset) return null;
    const center = getComponentCenter(component);
    return {x: center.x + offset.x, y: center.y + offset.y};
}

export function isValidComponentPortOffset(component, point) {
    const {width, height} = getComponentFootprint(component);
    return Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
        Math.abs(point.x) <= width / 2 && Math.abs(point.y) <= height / 2;
}

export function setComponentPortOffset(component, key, point) {
    if (!getComponentPorts(component).some(port => port.key === key) || !isValidComponentPortOffset(component, point)) return;
    component[key] = rotateOffset(point, (4 - getComponentQuarterTurns(component)) % 4);
}

export function fitComponentPorts(component, previousPorts) {
    const bounds = getComponentBounds(component);
    for (const [key, point] of Object.entries(previousPorts)) component[key] = fitOffset(point, bounds);
}

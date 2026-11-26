import {getComponentBounds, getStationType} from './stations.js';

export const AGV_CONFIGURATION_TYPE = 'AGVconfiguration';
export const DEFAULT_AGV_DIMENSIONS = {length: 900, width: 700};
export const DEFAULT_AGV_SPEED = 1;
export const DUPLICATE_AGV_CONFIGURATION_MESSAGE = '无法放置：画布中只能有一个 AGV 配置组件。';

export const findAgvConfiguration = components => components.find(item => item.type === AGV_CONFIGURATION_TYPE);

const isParkingStation = item => item?.type === 'node' && getStationType(item).value === 'parking';
export const getAgvParkingStations = components => components.filter(isParkingStation);

export function getAgvDimensions(row = {}) {
    const {length = DEFAULT_AGV_DIMENSIONS.length, width = DEFAULT_AGV_DIMENSIONS.width} = row;
    return {length, width};
}

const isPositiveNumber = value => Number.isFinite(value) && value > 0;

export function getAgvParkingGrid(station, row) {
    const vehicle = getAgvDimensions(row);
    if (!isParkingStation(station) || !isPositiveNumber(vehicle.length) || !isPositiveNumber(vehicle.width)) return null;
    const {width, height} = getComponentBounds(station);
    // 按站点本地长、宽排布，车辆占用独立的矩形位置，允许边缘相接。
    if (!isPositiveNumber(width) || !isPositiveNumber(height)) return null;
    const columns = Math.floor((width + 1e-9) / vehicle.length * 1000);
    const rows = Math.floor((height + 1e-9) / vehicle.width * 1000);
    if (!columns || !rows) return null;
    return {width, height, vehicleLength: vehicle.length / 1000, vehicleWidth: vehicle.width / 1000,
        columns, rows, capacity: Math.min(columns * rows, Number.MAX_SAFE_INTEGER)};
}

export function getAgvParkingCapacity(station, row) {
    return getAgvParkingGrid(station, row)?.capacity ?? 0;
}

export const isValidAgvRange = value => value === null || (Number.isFinite(value) && value >= 0);

export function parseAgvRange(text) {
    const input = text.trim();
    if (input === '∞' || input === '+∞') return null;
    const value = input === '' ? NaN : Number(input);
    return isValidAgvRange(value) ? value : undefined;
}

export function getAgvRowsError(rows, components) {
    if (!Array.isArray(rows)) return 'AGV 配置表无效。';
    const used = new Set();
    const stations = new Map(getAgvParkingStations(components).map(station => [station.id, station]));
    for (const [index, row] of rows.entries()) {
        const prefix = `第 ${index + 1} 行`;
        const station = stations.get(row?.stationId);
        if (!station) return `${prefix}请选择一个有效的停靠站点。`;
        if (used.has(row.stationId)) return `${prefix}的停靠站点已被选用。`;
        used.add(row.stationId);
        const {length, width} = getAgvDimensions(row);
        if (!isPositiveNumber(length) || !isPositiveNumber(width)) return `${prefix}的 AGV 长、宽都须大于 0。`;
        const capacity = getAgvParkingCapacity(station, row);
        if (!capacity) return `${prefix}所选的停靠站点放不下一辆 AGV。`;
        if (!Number.isSafeInteger(row.count) || row.count < 1 || row.count > capacity) {
            return `${prefix}的 AGV 数量须为 1 至 ${capacity}。`;
        }
        if (![row.emptySpeed, row.loadedSpeed].every(isPositiveNumber)) {
            return `${prefix}的空载速度和负载速度都须大于 0。`;
        }
    }
    return '';
}

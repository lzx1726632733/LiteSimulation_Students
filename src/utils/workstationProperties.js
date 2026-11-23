// 设备时长固定为定值，内部以秒存储，精确到毫秒。
export const WORKSTATION_PROPERTY_DEFAULTS = {
    processingTime: 60,
    setupTime: 0,
};

export const PARALLEL_WORKSTATION_PROPERTY_DEFAULTS = {
    equipmentCount: 1,
    ...WORKSTATION_PROPERTY_DEFAULTS,
};

export function isValidWorkstationProperty(field, value) {
    return Object.hasOwn(WORKSTATION_PROPERTY_DEFAULTS, field) &&
        Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000));
}

export function isValidParallelWorkstationProperty(field, value) {
    if (field === 'equipmentCount') return Number.isSafeInteger(value) && value >= 1;
    return isValidWorkstationProperty(field, value);
}

// ID 随模型保存；缩减后新增设备使用递增序号，避免历史加工记录关联到另一台设备。
export function ensureParallelWorkstationEquipment(station) {
    const count = isValidParallelWorkstationProperty('equipmentCount', station.equipmentCount) ?
        station.equipmentCount : PARALLEL_WORKSTATION_PROPERTY_DEFAULTS.equipmentCount;
    const prefix = `${station.id}:equipment:`;
    const ids = [...new Set((station.equipmentIds ?? []).filter(id => typeof id === 'string' &&
        id.startsWith(prefix) && /^[1-9]\d*$/.test(id.slice(prefix.length))))];
    let next = Math.max(1, Number.isSafeInteger(station.nextEquipmentIndex) ? station.nextEquipmentIndex : 1,
        ...ids.map(id => Number(id.slice(prefix.length)) + 1));
    ids.length = Math.min(ids.length, count);
    while (ids.length < count) ids.push(`${prefix}${next++}`);
    if (!station.equipmentIds || station.equipmentIds.length !== ids.length ||
        ids.some((id, index) => id !== station.equipmentIds[index])) station.equipmentIds = ids;
    if (station.nextEquipmentIndex !== next) station.nextEquipmentIndex = next;
    return station.equipmentIds;
}

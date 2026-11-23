export const ASSEMBLY_MODES = [
    {value: 'parts', label: '零件装配成配件'},
    {value: 'container', label: '零件装入容器'},
];

export const CONTAINER_TYPES = ['Pallet', 'Vehicle', 'AGV'];
export const ASSEMBLY_TIME_TOLERANCE_MS = 1e-6;

export function isValidAssemblyUnitCount(count) {
    return Number.isSafeInteger(count) && count >= 1;
}

export function getAssemblyUnitCount(station) {
    return isValidAssemblyUnitCount(station?.assemblyUnitCount) ? station.assemblyUnitCount : 1;
}

export function getAssemblyPackingType(recipe, legacyMode) {
    const type = recipe.packingType ?? (legacyMode === 'container' ? recipe.containerType : 'Workpiece');
    return type === 'workpiece' ? 'Workpiece' : type;
}

export function getAssemblyRecipeError(recipe) {
    if (typeof recipe?.productType !== 'string' || !recipe.productType.trim()) return '请填写装配件/容器类型。';
    const packingType = getAssemblyPackingType(recipe, 'container');
    if (packingType !== 'Workpiece' && !CONTAINER_TYPES.includes(packingType)) return '请选择有效的打包类型。';
    if (typeof recipe.name !== 'string' || !/^#[\da-f]{6}$/i.test(recipe.fillColor)) return '请检查名称和颜色。';
    for (const [label, value] of [['装配时长', recipe.assemblyTime], ['准备时长', recipe.setupTime]]) {
        if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 1000))) {
            return `请输入有效的${label}（dd:hh:mm:ss.ms）。`;
        }
    }
    if (!Array.isArray(recipe.materials) || !recipe.materials.length) return '请至少添加一行工件。';
    for (const [index, row] of recipe.materials.entries()) {
        if (typeof row?.partType !== 'string' || !row.partType.trim()) return `请填写第 ${index + 1} 行的工件类别。`;
        if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) return `第 ${index + 1} 行的工件数量必须是正整数。`;
        if (typeof row.name !== 'string') return `请检查第 ${index + 1} 行的工件名称。`;
    }
    return '';
}

// 先给指定名称的需求分配工件，避免不限定名称的需求提前占走它们。
export function findAssemblyBatch(recipes, waitingParts) {
    let earliestBatch = null;
    let earliestReadyAt = Infinity;
    for (const recipe of recipes ?? []) {
        if (getAssemblyRecipeError(recipe)) continue;
        const required = [...recipe.materials.filter(row => row.name), ...recipe.materials.filter(row => !row.name)];
        const used = new Set();
        let ready = true;
        for (const row of required) {
            let remaining = row.quantity;
            for (const part of waitingParts) {
                if (used.has(part) || part.partType !== row.partType || (row.name && part.name !== row.name)) continue;
                used.add(part);
                if (--remaining === 0) break;
            }
            if (remaining > 0) {
                ready = false;
                break;
            }
        }
        if (!ready) continue;
        const parts = waitingParts.filter(part => used.has(part));
        const readyAt = parts.reduce((latest, part) => Math.max(latest, part.arrivedAt), -Infinity);
        // 当前库存里最早能够凑齐这一批的时间。时间相同则保留表中靠前的配方。
        if (readyAt < earliestReadyAt - ASSEMBLY_TIME_TOLERANCE_MS / 1000) {
            earliestBatch = {recipe, parts};
            earliestReadyAt = readyAt;
        }
    }
    return earliestBatch;
}

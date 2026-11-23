export const DISASSEMBLY_MODES = [
    {value: 'parts', label: '部件拆卸成零件'},
    {value: 'container', label: '容器卸载零件'},
];

export function isValidDisassemblyUnitCount(count) {
    return Number.isSafeInteger(count) && count >= 1;
}

export function getDisassemblyUnitCount(station) {
    return isValidDisassemblyUnitCount(station?.disassemblyUnitCount) ? station.disassemblyUnitCount : 1;
}

export function getDisassemblyRecipeError(recipe, {allowEmpty = false} = {}) {
    if (Array.isArray(recipe?.materials) && !recipe.materials.length && !allowEmpty) {
        return '请至少编辑一行拆卸零件。';
    }
    if (typeof recipe?.productType !== 'string' || !recipe.productType.trim()) return '请填写部件/容器类型。';
    if (typeof recipe.name !== 'string') return '请检查部件/容器名称。';
    for (const [label, value] of [['拆卸时长', recipe.disassemblyTime], ['准备时长', recipe.setupTime]]) {
        if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 1000))) {
            return `请输入有效的${label}（dd:hh:mm:ss.ms）。`;
        }
    }
    if (!Array.isArray(recipe.materials)) return '请检查零件清单。';
    for (const [index, row] of recipe.materials.entries()) {
        if (typeof row?.partType !== 'string' || !row.partType.trim()) return `请填写第 ${index + 1} 行的零件类型。`;
        if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) return `第 ${index + 1} 行的零件数量必须是正整数。`;
        if (typeof row.name !== 'string') return `请检查第 ${index + 1} 行的零件名称。`;
        if (typeof row.fillColor !== 'string' || !/^#[\da-f]{6}$/i.test(row.fillColor)) {
            return `请选择第 ${index + 1} 行的零件颜色。`;
        }
    }
    return '';
}

export function findDisassemblyRecipe(recipes, part) {
    let generic = null;
    for (const recipe of recipes ?? []) {
        if (recipe?.productType !== part.partType || getDisassemblyRecipeError(recipe)) continue;
        if (recipe.name && recipe.name === part.name) return recipe;
        if (!recipe.name) generic ??= recipe;
    }
    return generic;
}

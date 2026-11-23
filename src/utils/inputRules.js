export const PART_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'];
export const INPUT_ENTITY_TYPES = ['Workpiece', 'Pallet', 'Vehicle'];
export const DEFAULT_INPUT_ENTITY_TYPE = INPUT_ENTITY_TYPES[0];

export function getInputType(input) {
    return INPUT_ENTITY_TYPES.includes(input?.inputType) ? input.inputType : DEFAULT_INPUT_ENTITY_TYPE;
}

export function getInputRuleCategory(rule) {
    // 旧规则只有实体类型时，将已有值保留为类别，供 BOM 匹配。
    return rule.partType ?? (INPUT_ENTITY_TYPES.includes(rule.entityType) ? rule.entityType : undefined);
}

// 时间统一使用仿真开始后的秒数。
export const INPUT_PROPERTY_DEFAULTS = {
    inputType: DEFAULT_INPUT_ENTITY_TYPE,
    generationInterval: 60,
    firstGenerationTime: 0,
    maxOutputCount: 100,
    inputCloseTime: 0,
    inputCloseEnabled: false,
    workpieceDisplayMode: 'recommended',
};

export function getDefaultWorkpieceDimensions(input) {
    return {
        length: Number(((input.width ?? 3) * 2 / 3 * 1000).toFixed(3)),
        width: Number(((input.height ?? 3) / 3 * 1000).toFixed(3)),
    };
}

export function isValidInputProperty(field, value) {
    if (field === 'inputType') return INPUT_ENTITY_TYPES.includes(value);
    if (field === 'workpieceDisplayMode') return value === 'recommended' || value === 'actual';
    if (field === 'generationInterval') return Number.isFinite(value) && value > 0 && Number.isSafeInteger(Math.round(value * 1000));
    if (field === 'inputCloseEnabled') return typeof value === 'boolean';
    if (field === 'maxOutputCount') return Number.isSafeInteger(value) && value >= 0;
    return (field === 'firstGenerationTime' || field === 'inputCloseTime') && Number.isFinite(value) && value >= 0;
}

// 支持 秒、分:秒、时:分:秒、天:时:分:秒，末段最多三位毫秒小数。
// 设备时长允许为 0；工件产生间隔仍必须大于 0。
export function parseGenerationInterval(text, {allowZero = false} = {}) {
    const parts = text.trim().split(':');
    if (parts.length > 4 || !parts.every((part, index) =>
        (index === parts.length - 1 ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/).test(part))) return NaN;
    const values = parts.map(Number);
    const last = values.length - 1;
    if (last >= 1 && values[last] >= 60) return NaN;
    if (last >= 2 && values[last - 1] >= 60) return NaN;
    if (last === 3 && values[1] >= 24) return NaN;
    const units = [1000, 60000, 3600000, 86400000];
    const milliseconds = values.reduce((total, value, index) => total + Math.round(value * units[last - index]), 0);
    return Number.isSafeInteger(milliseconds) && (allowZero ? milliseconds >= 0 : milliseconds > 0) ? milliseconds / 1000 : NaN;
}

export function formatGenerationInterval(seconds) {
    let remaining = Math.round(seconds * 1000);
    const days = Math.floor(remaining / 86400000);
    remaining %= 86400000;
    const hours = Math.floor(remaining / 3600000);
    remaining %= 3600000;
    const minutes = Math.floor(remaining / 60000);
    const lastSeconds = (remaining % 60000) / 1000;
    if (days) return `${days}:${hours}:${minutes}:${lastSeconds}`;
    if (hours) return `${hours}:${minutes}:${lastSeconds}`;
    return `${minutes}:${lastSeconds}`;
}

export function getInputRuleValidationMessage(rows) {
    for (const [index, row] of rows.entries()) {
        const category = getInputRuleCategory(row);
        if (typeof category !== 'string' || !category.trim()) {
            return `请填写第 ${index + 1} 行的类别。`;
        }
        for (const field of ['length', 'width']) {
            // 旧规则缺少尺寸时由输入组件的默认尺寸补齐。
            if (row[field] !== undefined && (!Number.isFinite(row[field]) || row[field] <= 0)) {
                return `第 ${index + 1} 行的实际${field === 'length' ? '长度' : '宽度'}必须是大于 0 的有限数字，单位为毫米。`;
            }
        }
        if (!Number.isFinite(row.relativeWeight) || row.relativeWeight < 0) {
            return `第 ${index + 1} 行的相对比例值必须是大于或等于 0 的有限数字。`;
        }
    }
    if (rows.length && !rows.some(row => row.relativeWeight > 0)) {
        return '至少需要一行的相对比例值大于 0。';
    }
    return '';
}

// 先按最大权重缩放，避免多个很大的有限权重相加后溢出。
export function getInputRuleProbabilities(rows) {
    const error = getInputRuleValidationMessage(rows);
    if (error) throw new RangeError(error);
    if (!rows.length) return [];
    const maximum = rows.reduce((max, row) => Math.max(max, row.relativeWeight), 0);
    const scaledWeights = rows.map(row => row.relativeWeight / maximum);
    const total = scaledWeights.reduce((sum, weight) => sum + weight, 0);
    return scaledWeights.map(weight => weight / total);
}

// 生成工件时传入输入单元的 inputRuleRows，返回抽中的规则副本。
// 未配置规则时返回 null，随机源可注入以支持可重复的仿真和测试。
export function sampleInputRule(rows, random = Math.random) {
    const probabilities = getInputRuleProbabilities(rows);
    if (!probabilities.length) return null;
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        throw new RangeError('随机数必须位于 [0, 1) 区间。');
    }
    let cumulative = 0;
    let lastPositiveIndex = 0;
    for (let index = 0; index < rows.length; index++) {
        if (probabilities[index] === 0) continue;
        lastPositiveIndex = index;
        cumulative += probabilities[index];
        if (draw < cumulative) return {...rows[index]};
    }
    // 浮点加法可能使累计值略小于 1，回退到最后一个正权重项。
    return {...rows[lastPositiveIndex]};
}

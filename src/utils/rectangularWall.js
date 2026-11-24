export const RECTANGULAR_WALL_TYPE = 'rectangularWall';
export const DEFAULT_WALL_SIZE = {width: 40, height: 24};
export const WALL_SIDES = [
    {value: 'top', label: '上边框'},
    {value: 'bottom', label: '下边框'},
    {value: 'left', label: '左边框'},
    {value: 'right', label: '右边框'},
];
export const WALL_THICKNESS_MODES = [
    {value: 'outside', label: '向外扩张'},
    {value: 'centered', label: '沿中心线两侧扩张'},
    {value: 'inside', label: '向内扩张'},
];

const DEFAULT_EXIT = {side: 'top', width: 3, reference: 'left', distance: 5};
const EPS = 1e-8;
const horizontal = side => side === 'top' || side === 'bottom';
const validSide = side => WALL_SIDES.some(option => option.value === side);

export function getWallSideOptions(otherSide) {
    return WALL_SIDES.filter(option => !validSide(otherSide) || horizontal(option.value) !== horizontal(otherSide));
}

export function getWallSettings(wall) {
    const wasIconOnly = wall.width === 3 && wall.height === 3 && wall.wallThickness == null &&
        wall.wallThicknessMode == null && wall.wallExits == null;
    return {
        width: !wasIconOnly && wall.width > 0 ? wall.width : DEFAULT_WALL_SIZE.width,
        height: !wasIconOnly && wall.height > 0 ? wall.height : DEFAULT_WALL_SIZE.height,
        wallThickness: wall.wallThickness ?? 0.3,
        wallThicknessMode: wall.wallThicknessMode ?? 'outside',
        wallExits: wall.wallExits ?? [DEFAULT_EXIT],
    };
}

export const getWallOuterBounds = wall => wallFrames(wall, getWallSettings(wall)).outer;

function wallFrames(wall, settings) {
    const {width, height, wallThickness: thickness, wallThicknessMode: mode} = settings;
    const inset = mode === 'inside' ? thickness : mode === 'centered' ? thickness / 2 : 0;
    const outset = thickness - inset;
    return {
        inner: {x: wall.x + inset, y: wall.y + inset, width: width - 2 * inset, height: height - 2 * inset},
        outer: {x: wall.x - outset, y: wall.y - outset, width: width + 2 * outset, height: height + 2 * outset},
    };
}

function exitInterval(exit, inner) {
    const span = horizontal(exit.side) ? inner.width : inner.height;
    const center = exit.reference === 'left' || exit.reference === 'bottom' ? exit.distance : span - exit.distance;
    return {start: center - exit.width / 2, end: center + exit.width / 2, center, span};
}

export function getWallValidationError(wall) {
    const settings = getWallSettings(wall);
    if (![wall.width, wall.height, settings.wallThickness].every(value => Number.isFinite(value) && value > 0)) {
        return '长、宽和墙体厚度必须大于 0。';
    }
    if (!WALL_THICKNESS_MODES.some(mode => mode.value === settings.wallThicknessMode)) return '请选择有效的厚度方向。';
    const {inner, outer} = wallFrames(wall, settings);
    if (inner.width <= EPS || inner.height <= EPS || ![outer.width, outer.height].every(Number.isFinite)) {
        return '墙体厚度必须为围墙留出内部空间。';
    }
    if (!Array.isArray(settings.wallExits)) return '出口表格式不正确。';
    const intervals = new Map();
    for (const [index, exit] of settings.wallExits.entries()) {
        if (!validSide(exit?.side) || !validSide(exit.reference) || horizontal(exit.side) === horizontal(exit.reference)) {
            return `第 ${index + 1} 行请选择出口边框及与其垂直的相对目标。`;
        }
        if (!Number.isFinite(exit.width) || exit.width <= 0 || !Number.isFinite(exit.distance) || exit.distance < 0) {
            return `第 ${index + 1} 行出口宽度必须大于 0，相对距离必须为非负数。`;
        }
        const interval = exitInterval(exit, inner);
        if (interval.start < -EPS || interval.end > interval.span + EPS) return `第 ${index + 1} 行出口超出了内边框范围。`;
        const sameSide = intervals.get(exit.side) ?? [];
        if (sameSide.some(other => interval.start < other.end - EPS && interval.end > other.start + EPS)) {
            return `第 ${index + 1} 行出口与同一边上的其他出口重叠。`;
        }
        intervals.set(exit.side, [...sameSide, interval]);
    }
    return '';
}

export function getWallGeometry(wall) {
    const settings = getWallSettings(wall);
    const {inner, outer} = wallFrames(wall, settings);
    const t = settings.wallThickness;
    const left = inner.x, right = left + inner.width, bottom = inner.y, top = bottom + inner.height;
    const sides = [
        {side: 'bottom', x: outer.x, y: outer.y, width: outer.width, height: t, offset: left, edge: bottom},
        {side: 'top', x: outer.x, y: top, width: outer.width, height: t, offset: left, edge: top},
        {side: 'left', x: outer.x, y: bottom, width: t, height: inner.height, offset: bottom, edge: left},
        {side: 'right', x: right, y: bottom, width: t, height: inner.height, offset: bottom, edge: right},
    ];
    const parts = [], exitPoints = [];
    for (const {side, x, y, width, height, offset, edge} of sides) {
        const alongX = horizontal(side);
        const start = alongX ? x : y;
        const end = start + (alongX ? width : height);
        const gaps = settings.wallExits.filter(exit => exit.side === side)
            .map(exit => exitInterval(exit, inner)).sort((a, b) => a.start - b.start);
        let cursor = start;
        const addWallPart = next => {
            if (next - cursor <= EPS) return;
            parts.push(alongX ? {x: cursor, y, width: next - cursor, height}
                : {x, y: cursor, width, height: next - cursor});
        };
        for (const gap of gaps) {
            addWallPart(offset + gap.start);
            cursor = offset + gap.end;
            exitPoints.push(alongX ? {x: offset + gap.center, y: edge} : {x: edge, y: offset + gap.center});
        }
        addWallPart(end);
    }
    return {outer, parts, exitPoints};
}

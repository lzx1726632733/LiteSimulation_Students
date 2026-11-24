export const TRIANGULAR_OBSTACLE_TYPE = 'triangularObstacle';
export const DEFAULT_TRIANGLE_SIZE = {width: 3, height: 3 * Math.sqrt(3) / 2};

// 顶点按 A、B、C 保存，边 1、2、3 分别是 AB、AC、BC。
const SIDE_KEYS = ['side3', 'side2', 'side1'];
const ANGLE_KEYS = ['angleA', 'angleB', 'angleC'];
const FIELD_TOLERANCE = 1e-6;
const SHAPE_TOLERANCE = 1e-10;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const radians = degrees => degrees * (Math.PI / 180);
export const formatTriangleValue = value => String(Number(value.toPrecision(8)));

export const TRIANGLE_FIELDS = [
    {key: 'side1', label: '边 1（AB）', shortLabel: '边AB', unit: 'm'},
    {key: 'side2', label: '边 2（AC）', shortLabel: '边AC', unit: 'm'},
    {key: 'side3', label: '边 3（BC）', shortLabel: '边BC', unit: 'm'},
    ...['A', 'B', 'C'].map(letter => ({key: `angle${letter}`, label: `角 ${letter}`, unit: '°'})),
];

export function getLocalTriangleVertices(component) {
    return component.triangleVertices ?? [
        {x: DEFAULT_TRIANGLE_SIZE.width / 2, y: DEFAULT_TRIANGLE_SIZE.height},
        {x: 0, y: 0},
        {x: DEFAULT_TRIANGLE_SIZE.width, y: 0},
    ];
}

export function getTriangleVertices(component) {
    return getLocalTriangleVertices(component).map(point => ({x: component.x + point.x, y: component.y + point.y}));
}

export function getTriangleChanges(vertices, center) {
    if (!getTriangleParameters(vertices)) return null;
    const x = Math.min(...vertices.map(point => point.x));
    const y = Math.min(...vertices.map(point => point.y));
    const width = Math.max(...vertices.map(point => point.x)) - x;
    const height = Math.max(...vertices.map(point => point.y)) - y;
    return {
        x: center ? center.x - width / 2 : x,
        y: center ? center.y - height / 2 : y,
        width, height,
        triangleVertices: vertices.map(point => ({x: point.x - x, y: point.y - y})),
    };
}

export function getTriangleParameters(vertices) {
    if (vertices?.length !== 3 || !vertices.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return null;
    const [a, b, c] = vertices;
    const sides = [distance(b, c), distance(a, c), distance(a, b)];
    const scale = Math.max(...sides);
    if (!Number.isFinite(scale) || !scale) return null;
    const angles = vertices.map((point, index) => {
        const next = vertices[(index + 1) % 3];
        const previous = vertices[(index + 2) % 3];
        const ux = (next.x - point.x) / scale, uy = (next.y - point.y) / scale;
        const vx = (previous.x - point.x) / scale, vy = (previous.y - point.y) / scale;
        const area = Math.abs(ux * vy - uy * vx);
        return area > SHAPE_TOLERANCE ? Math.atan2(area, ux * vx + uy * vy) * (180 / Math.PI) : 0;
    });
    if (angles.some(angle => angle === 0)) return null;
    return {side1: sides[2], side2: sides[1], side3: sides[0], angleA: angles[0], angleB: angles[1], angleC: angles[2]};
}

function verticesFromSides(sides) {
    if (sides.some(side => !Number.isFinite(side) || side <= 0)) return null;
    const scale = Math.max(...sides);
    const [base, ac, ab] = sides.map(side => side / scale);
    const [longest, middle, shortest] = [base, ac, ab].sort((a, b) => b - a);
    const gap = shortest - (longest - middle);
    if (gap <= 0) return null;
    const x = (base + (ab - ac) * (ab + ac) / base) / 2;
    const y = Math.sqrt((longest + (middle + shortest)) * gap *
        (shortest + (longest - middle)) * (longest + (middle - shortest))) / (2 * base);
    return [{x: x * scale, y: y * scale}, {x: 0, y: 0}, {x: sides[0], y: 0}];
}

function candidateSides(sides, angles, knownSides, knownAngles) {
    if (knownSides.length === 3) return [sides];
    if (knownAngles.length >= 2 && knownSides.length) {
        const [first, second] = knownAngles;
        const complete = [0, 1, 2].map(index => index === first || index === second
            ? angles[index] : 180 - angles[first] - angles[second]);
        if (complete.some(angle => angle <= 0)) return [];
        const [reference] = knownSides;
        return [complete.map((angle, index) => index === reference ? sides[reference]
            : sides[reference] * (Math.sin(radians(angle)) / Math.sin(radians(complete[reference]))))];
    }
    const [first, second] = knownSides;
    const [angleIndex] = knownAngles;
    const missing = 3 - first - second;
    const angle = radians(angles[angleIndex]);
    if (angleIndex === missing) {
        const result = [...sides];
        result[missing] = Math.hypot(sides[first] - sides[second],
            2 * Math.sin(angle / 2) * (Math.sqrt(sides[first]) * Math.sqrt(sides[second])));
        return [result];
    }

    const other = angleIndex === first ? second : first;
    const sine = (sides[other] / sides[angleIndex]) * Math.sin(angle);
    const sineTolerance = Number.EPSILON * 8;
    if (sine > 1 + sineTolerance) return [];
    const acute = Math.asin(sine >= 1 - sineTolerance ? 1 : sine);
    const otherAngles = acute === Math.PI / 2 ? [acute] : [acute, Math.PI - acute];
    return otherAngles.flatMap(otherAngle => {
        const remaining = Math.PI - angle - otherAngle;
        if (remaining <= 0) return [];
        const result = [...sides];
        result[missing] = sides[angleIndex] * (Math.sin(remaining) / Math.sin(angle));
        return [result];
    });
}

export function solveTriangle(fields) {
    const supplied = key => fields[key] !== undefined && fields[key] !== '';
    const sides = SIDE_KEYS.map(key => supplied(key) ? Number(fields[key]) : null);
    const angles = ANGLE_KEYS.map(key => supplied(key) ? Number(fields[key]) : null);
    if (sides.some(side => side !== null && (!Number.isFinite(side) || side <= 0))) {
        return {error: '边长必须是大于 0 的数。'};
    }
    if (angles.some(angle => angle !== null && (!Number.isFinite(angle) || angle <= 0 || angle >= 180))) {
        return {error: '角度必须大于 0° 且小于 180°。'};
    }
    const knownSides = [0, 1, 2].filter(index => sides[index] !== null);
    const knownAngles = [0, 1, 2].filter(index => angles[index] !== null);
    if (!knownSides.length || knownSides.length + knownAngles.length < 3) {
        return {hint: '至少填写三个参数，其中至少一个是边长。'};
    }
    const solutions = candidateSides(sides, angles, knownSides, knownAngles).flatMap(candidate => {
        const vertices = verticesFromSides(candidate);
        const parameters = getTriangleParameters(vertices);
        if (!parameters) return [];
        const matches = knownSides.every(index =>
            Math.abs(parameters[SIDE_KEYS[index]] / sides[index] - 1) <= FIELD_TOLERANCE)
            && knownAngles.every(index => Math.abs(parameters[ANGLE_KEYS[index]] - angles[index]) <= FIELD_TOLERANCE);
        return matches ? [{vertices, parameters}] : [];
    });
    if (!solutions.length) return {error: '这些参数无法构成三角形，请检查边长和角度。'};
    if (solutions.length > 1) return {hint: '当前参数有两组解，请再填写一条边或一个角。'};
    return solutions[0];
}

export function orientTriangle(vertices, current) {
    const [a, b, c] = current;
    const base = distance(b, c);
    const ux = (c.x - b.x) / base, uy = (c.y - b.y) / base;
    const sign = Math.sign(ux * (a.y - b.y) - uy * (a.x - b.x));
    return vertices.map(({x, y}) => ({x: ux * x - sign * uy * y, y: uy * x + sign * ux * y}));
}

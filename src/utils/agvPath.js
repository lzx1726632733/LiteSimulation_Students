// 路径由中心线与实际通道宽度定义，所有几何量均以米保存。
export const DEFAULT_PATH_WIDTH = 1;
const EPS = 1e-9;
const TAU = Math.PI * 2;

export const getPathWidth = (path) =>
  Number.isFinite(path.pathWidth) && path.pathWidth > 0 ? path.pathWidth : DEFAULT_PATH_WIDTH;

export const getPathCorner = (nodes, i) => {
  const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
  if (!a || !b || !c) return null;
  const before = Math.hypot(b.x - a.x, b.y - a.y);
  const after = Math.hypot(c.x - b.x, c.y - b.y);
  if (before < EPS || after < EPS) return null;
  const u = { x: (b.x - a.x) / before, y: (b.y - a.y) / before };
  const v = { x: (c.x - b.x) / after, y: (c.y - b.y) / after };
  const turn = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
  if (Math.abs(turn) < EPS || Math.PI - Math.abs(turn) < EPS) return null;
  const factor = Math.tan(Math.abs(turn) / 2);
  return {u, v, turn, factor};
};

export const buildPathArc = (point, {u, v, turn, factor}, radius) => {
  const distance = radius * factor;
  const start = {x: point.x - u.x * distance, y: point.y - u.y * distance};
  const end = {x: point.x + v.x * distance, y: point.y + v.y * distance};
  const sign = Math.sign(turn);
  const center = {x: start.x - u.y * radius * sign, y: start.y + u.x * radius * sign};
  return {type: 'arc', start, end, center, radius,
    startAngle: Math.atan2(start.y - center.y, start.x - center.x),
    sweep: turn, length: Math.abs(turn) * radius};
};

function connectionAngle(start, end, length, savedAngle) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    if (Number.isFinite(savedAngle) && savedAngle >= -360 && savedAngle <= 360) {
        const difference = ((savedAngle - angle) % 360 + 360) % 360;
        if (length <= EPS || Math.min(difference, 360 - difference) < 1e-8) return savedAngle || 0;
    }
    return angle || 0;
}

export const getPathParameters = (nodes, path) => {
    if (!nodes || nodes.length < 2 || nodes.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
    const lengths = nodes.slice(1).map((point, i) => Math.hypot(point.x - nodes[i].x, point.y - nodes[i].y));
    const corners = nodes.slice(1, -1).map((point, i) => ({point, ...getPathCorner(nodes, i + 1), setback: 0, radius: 0}));
    const radiusLimit = i => {
        const {factor} = corners[i];
        if (!factor) return 0;
        const before = lengths[i] - (corners[i - 1]?.setback ?? 0);
        const after = lengths[i + 1] - (corners[i + 1]?.setback ?? 0);
        return Math.max(0, Math.min(before, after) / factor);
    };
    // 相邻圆角共用一段直线，按路径顺序分配切点距离，兼容端口移动后的几何变化。
    for (const [i, corner] of corners.entries()) {
        const requested = path.cornerRadii?.[i];
        if (!Number.isFinite(requested) || requested <= 0 || !corner.factor) continue;
        corner.radius = Math.min(requested, radiusLimit(i));
        corner.setback = corner.radius * corner.factor;
        if (corner.radius > 0) corner.arc = buildPathArc(corner.point, corner, corner.radius);
    }

    const rows = [];
    const segments = [];
    for (const [i, rawLength] of lengths.entries()) {
        const previous = corners[i - 1], next = corners[i];
        const angle = connectionAngle(nodes[i], nodes[i + 1], rawLength,
            path.segmentAngles?.[i] ?? (lengths.length === 1 ? path.angle : undefined));
        const length = Math.max(0, rawLength - (previous?.setback ?? 0) - (next?.setback ?? 0));
        const start = previous?.arc?.end ?? nodes[i];
        const end = next?.arc?.start ?? nodes[i + 1];
        const segment = {type: 'line', start, end, length, angle};
        segments.push(segment);
        rows.push({type: 'Line', index: i, length, angle, rawLength});
        if (next) {
            if (next.arc) segments.push({...next.arc, cornerIndex: i});
            rows.push({type: next.arc ? 'Arc' : 'Point', index: i, point: next.point, radius: next.radius, maxRadius: radiusLimit(i)});
        }
    }
    return {nodes, rows, segments, cornerRadii: corners.map(corner => corner.radius),
        length: segments.reduce((sum, segment) => sum + segment.length, 0), angle: rows[0].angle};
};

export const buildPathGeometry = path =>
  getPathParameters(path.nodes, path)?.segments.filter(segment => segment.length > EPS) ?? [];

// 返回中心线上的位置及前进切向量，供直线和圆弧共用方向箭头。
export const pointOnPathSegment = (segment, fraction) => {
  if (segment.type === "line") {
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
    return { x: segment.start.x + dx * fraction, y: segment.start.y + dy * fraction,
      ux: dx / segment.length, uy: dy / segment.length };
  }
  const angle = segment.startAngle + segment.sweep * fraction;
  const sign = Math.sign(segment.sweep);
  return { x: segment.center.x + segment.radius * Math.cos(angle),
    y: segment.center.y + segment.radius * Math.sin(angle),
    ux: -Math.sin(angle) * sign, uy: Math.cos(angle) * sign };
};

export const tracePathGeometry = (ctx, segments, scale) => {
  ctx.beginPath();
  if (!segments.length) return;
  ctx.moveTo(segments[0].start.x * scale, -segments[0].start.y * scale);
  for (const segment of segments) {
    if (segment.type === "line") ctx.lineTo(segment.end.x * scale, -segment.end.y * scale);
    else ctx.arc(segment.center.x * scale, -segment.center.y * scale, segment.radius * scale,
      -segment.startAngle, -(segment.startAngle + segment.sweep), segment.sweep > 0);
  }
};

export const angleOnArc = (angle, segment) => {
  const travel = ((angle - segment.startAngle) * Math.sign(segment.sweep) % TAU + TAU) % TAU;
  return travel <= Math.abs(segment.sweep) + EPS || TAU - travel < EPS;
};

export const distanceToPathSegment = (segment, x, y) => {
  const {start, end} = segment;
  if (segment.type === 'arc') {
    const dx = x - segment.center.x, dy = y - segment.center.y;
    if (angleOnArc(Math.atan2(dy, dx), segment)) return Math.abs(Math.hypot(dx, dy) - segment.radius);
    return Math.min(Math.hypot(x - start.x, y - start.y), Math.hypot(x - end.x, y - end.y));
  }
  if (!segment.length) return Math.hypot(x - start.x, y - start.y);
  const {ux, uy} = pointOnPathSegment(segment, 0);
  const along = Math.max(0, Math.min(segment.length, (x - start.x) * ux + (y - start.y) * uy));
  return Math.hypot(x - start.x - along * ux, y - start.y - along * uy);
};

// 与 butt 端帽、round 接角的通道区域一致；允许调用方加入少量屏幕抓取余量。
export const isPointInPathArea = (path, x, y, margin = 0) => {
  const segments = buildPathGeometry(path);
  const half = getPathWidth(path) / 2 + margin;
  for (const segment of segments) {
    if (segment.type === "line") {
      const p = pointOnPathSegment(segment, 0);
      const dx = x - p.x, dy = y - p.y;
      const along = dx * p.ux + dy * p.uy;
      if (along >= -margin && along <= segment.length + margin && Math.abs(dx * p.uy - dy * p.ux) <= half) return true;
    } else {
      const dx = x - segment.center.x, dy = y - segment.center.y;
      if (Math.abs(Math.hypot(dx, dy) - segment.radius) <= half && angleOnArc(Math.atan2(dy, dx), segment)) return true;
    }
  }
  // 仅在内部接点补圆形连接，不将直线路径首尾延伸成圆头。
  return segments.slice(1).some((segment) => Math.hypot(x - segment.start.x, y - segment.start.y) <= half);
};

export const getPathGeometryBounds = (segments, half = 0) => {
  const points = [];
  for (const segment of segments) {
    points.push(segment.start, segment.end);
    if (segment.type === "arc") {
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        if (angleOnArc(angle, segment)) points.push({ x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) });
      }
    }
  }
  if (!points.length) return null;
  return { minX: Math.min(...points.map((p) => p.x)) - half, maxX: Math.max(...points.map((p) => p.x)) + half,
    minY: Math.min(...points.map((p) => p.y)) - half, maxY: Math.max(...points.map((p) => p.y)) + half };
};

export const getPathBounds = (path) => getPathGeometryBounds(buildPathGeometry(path), getPathWidth(path) / 2);

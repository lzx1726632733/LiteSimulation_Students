// 路径由中心线与实际通道宽度定义，所有几何量均以米保存。
export const DEFAULT_PATH_WIDTH = 1;
const EPS = 1e-9;
const TAU = Math.PI * 2;

export const getPathWidth = (path) =>
  Number.isFinite(path.pathWidth) && path.pathWidth > 0 ? path.pathWidth : DEFAULT_PATH_WIDTH;

const cornerGeometry = (nodes, i) => {
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
  // 相邻圆弧各占共享线段的一半；首尾线段可以全部用于圆弧。
  const available = Math.min(before / (i > 1 ? 2 : 1), after / (i < nodes.length - 2 ? 2 : 1));
  return { u, v, turn, factor, maxRadius: available / factor };
};

export const getCornerMaxRadius = (nodes, cornerIndex) =>
  cornerGeometry(nodes || [], cornerIndex + 1)?.maxRadius || 0;

export const buildPathGeometry = (path) => {
  const nodes = path.nodes || [];
  if (nodes.length < 2 || nodes.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  const segments = [];
  let cursor = nodes[0];
  const lineTo = (end) => {
    const length = Math.hypot(end.x - cursor.x, end.y - cursor.y);
    if (length > EPS) segments.push({ type: "line", start: cursor, end, length });
    cursor = end;
  };
  for (let i = 1; i < nodes.length - 1; i++) {
    const corner = cornerGeometry(nodes, i);
    const requested = path.cornerRadii?.[i - 1];
    const radius = corner && Number.isFinite(requested) ? Math.max(0, Math.min(requested, corner.maxRadius)) : 0;
    if (radius < EPS) { lineTo(nodes[i]); continue; }
    const { u, v, turn, factor } = corner;
    const distance = radius * factor;
    const start = { x: nodes[i].x - u.x * distance, y: nodes[i].y - u.y * distance };
    const end = { x: nodes[i].x + v.x * distance, y: nodes[i].y + v.y * distance };
    const sign = Math.sign(turn);
    const center = { x: start.x - u.y * radius * sign, y: start.y + u.x * radius * sign };
    lineTo(start);
    segments.push({ type: "arc", start, end, center, radius,
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      sweep: turn, length: Math.abs(turn) * radius });
    cursor = end;
  }
  lineTo(nodes[nodes.length - 1]);
  return segments;
};

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

const angleOnArc = (angle, segment) => {
  const travel = ((angle - segment.startAngle) * Math.sign(segment.sweep) % TAU + TAU) % TAU;
  return travel <= Math.abs(segment.sweep) + EPS || TAU - travel < EPS;
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

export const getPathBounds = (path) => {
  const points = [];
  for (const segment of buildPathGeometry(path)) {
    points.push(segment.start, segment.end);
    if (segment.type === "arc") {
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        if (angleOnArc(angle, segment)) points.push({ x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) });
      }
    }
  }
  if (!points.length) return null;
  const half = getPathWidth(path) / 2;
  return { minX: Math.min(...points.map((p) => p.x)) - half, maxX: Math.max(...points.map((p) => p.x)) + half,
    minY: Math.min(...points.map((p) => p.y)) - half, maxY: Math.max(...points.map((p) => p.y)) + half };
};

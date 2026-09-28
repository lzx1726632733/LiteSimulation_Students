// 所有矩形使用物理坐标：左下角 x/y，正数 width/height。
// raw 是鼠标未经网格吸附的位置，fallback 是 0.1m 步长后的候选位置。
export const alignBounds = (raw, fallback, targets, threshold, lockedAxis = null) => {
  const anchors = (bounds, axis) => {
    const size = axis === "x" ? bounds.width : bounds.height;
    return [
      { value: bounds[axis], kind: "edge" },
      { value: bounds[axis] + size / 2, kind: "center" },
      { value: bounds[axis] + size, kind: "edge" },
    ];
  };
  const matches = {};
  for (const axis of ["x", "y"]) {
    if (axis === lockedAxis) continue;
    let best = null;
    for (const target of targets) {
      for (const sourceAnchor of anchors(raw, axis)) {
        for (const targetAnchor of anchors(target, axis)) {
          // 中线对中线；同侧边缘对齐及相邻边缘贴合。
          if (sourceAnchor.kind !== targetAnchor.kind) continue;
          const delta = targetAnchor.value - sourceAnchor.value;
          const distance = Math.abs(delta);
          if (distance > threshold + 1e-10) continue;
          if (!best || distance < best.distance - 1e-10 ||
            (Math.abs(distance - best.distance) <= 1e-10 &&
              sourceAnchor.kind === "center" && best.kind !== "center")) {
            best = { delta, distance, target, value: targetAnchor.value, kind: sourceAnchor.kind };
          }
        }
      }
    }
    if (best) matches[axis] = best;
  }

  const aligned = {
    ...fallback,
    x: matches.x ? raw.x + matches.x.delta : fallback.x,
    y: matches.y ? raw.y + matches.y.delta : fallback.y,
  };
  const guides = Object.entries(matches).map(([axis, match]) => {
    const other = axis === "x" ? "y" : "x";
    const size = axis === "x" ? "height" : "width";
    return {
      axis, value: match.value, kind: match.kind, targetId: match.target.id,
      from: Math.min(aligned[other], match.target[other]),
      to: Math.max(aligned[other] + aligned[size], match.target[other] + match.target[size]),
    };
  });
  return { x: Number(aligned.x.toFixed(10)), y: Number(aligned.y.toFixed(10)), guides };
};

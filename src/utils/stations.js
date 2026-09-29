// 站点的 x/y 始终表示中心，尺寸以米保存。
export const STATION_TYPES = [
  { value: "parking", label: "停靠站点", color: "#3b82f6", fill: "#dbeafe" },
  { value: "charging", label: "充电站点", color: "#16a34a", fill: "#dcfce7" },
  { value: "junction", label: "路径节点", color: "#9333ea", fill: "#f3e8ff" },
  { value: "loading", label: "装卸站点", color: "#ea580c", fill: "#ffedd5" },
];

export const DEFAULT_STATION_SIZE = { width: 3, height: 3 };

export const getStationType = (component) =>
  STATION_TYPES.find((type) => type.value === component?.stationType) || STATION_TYPES[0];

// 每种站点独立编号；删除或转出分类后，空出的序号可再次使用。
export const getNextStationIndex = (components, stationType, excludedId) => {
  const used = new Set(components
    .filter((item) => item.type === "node" && item.id !== excludedId &&
      getStationType(item).value === stationType)
    .map((item) => item.index));
  let index = 1;
  while (used.has(index)) index += 1;
  return index;
};

// 同时兼容原来没有尺寸的站点。
export const getComponentBounds = (component) => {
  const isStation = component.type === "node";
  const width = isStation ? (component.width > 0 ? component.width : DEFAULT_STATION_SIZE.width) : (component.width ?? 0);
  const height = isStation ? (component.height > 0 ? component.height : DEFAULT_STATION_SIZE.height) : (component.height ?? 0);
  return {
    x: component.x - (isStation ? width / 2 : 0),
    y: component.y - (isStation ? height / 2 : 0),
    width,
    height,
  };
};

export const getComponentCenter = (component) => {
  if (component.type === "node") return { x: component.x, y: component.y };
  return { x: component.x + (component.width ?? 0) / 2, y: component.y + (component.height ?? 0) / 2 };
};

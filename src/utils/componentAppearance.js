// 有实际矩形占地、可编辑宽高的控件类型。
export const RESIZABLE_COMPONENT_TYPES = new Set([
  "node",
  "systemInput",
  "systemOutput",
  "workstation",
  "parallelWorkstation",
  "assemblyWorkstation",
  "disassemblyWorkstation",
  "buffer",
]);

export const DEFAULT_COMPONENT_SHADOW_COLORS = {
  systemInput: "#cffafe",
  systemOutput: "#ffe4e6",
  workstation: "#dbeafe",
  parallelWorkstation: "#dcfce7",
  assemblyWorkstation: "#fef3c7",
  disassemblyWorkstation: "#fce7f3",
  buffer: "#ede9fe",
};

export const DEFAULT_COMPONENT_SIZES = {
  systemInput: { width: 3, height: 3 },
  systemOutput: { width: 3, height: 3 },
  workstation: { width: 3, height: 3 },
  parallelWorkstation: { width: 3, height: 3 },
  assemblyWorkstation: { width: 3, height: 3 },
  disassemblyWorkstation: { width: 3, height: 3 },
  buffer: { width: 3, height: 3 },
};

export const getDefaultShadowColor = (type) => DEFAULT_COMPONENT_SHADOW_COLORS[type] || "#dbeafe";

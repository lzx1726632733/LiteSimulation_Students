import {DEFAULT_TRIANGLE_SIZE, TRIANGULAR_OBSTACLE_TYPE} from './triangleObstacle.js';
import {DEFAULT_WALL_SIZE, RECTANGULAR_WALL_TYPE} from './rectangularWall.js';

export const RECTANGULAR_OBSTACLE_TYPE = "rectangularObstacle";
export const CIRCULAR_OBSTACLE_TYPE = "circularObstacle";
export const OBSTACLE_COMPONENT_TYPES = new Set([
  RECTANGULAR_OBSTACLE_TYPE,
  TRIANGULAR_OBSTACLE_TYPE,
  CIRCULAR_OBSTACLE_TYPE,
  RECTANGULAR_WALL_TYPE,
]);

export const MIN_CIRCLE_RADIUS = 0.01;
const DEFAULT_CIRCLE_RADIUS = 1.5;
export const getCircleRadius = (component) => Number.isFinite(component.width) && component.width > 0
  ? component.width / 2 : DEFAULT_CIRCLE_RADIUS;

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
  RECTANGULAR_OBSTACLE_TYPE,
]);

export const DEFAULT_COMPONENT_SHADOW_COLORS = {
  systemInput: "#cffafe",
  systemOutput: "#ffe4e6",
  workstation: "#dbeafe",
  parallelWorkstation: "#dcfce7",
  assemblyWorkstation: "#fef3c7",
  disassemblyWorkstation: "#fce7f3",
  buffer: "#ede9fe",
  [RECTANGULAR_OBSTACLE_TYPE]: "#f3f4f6",
  [TRIANGULAR_OBSTACLE_TYPE]: "#f3f4f6",
  [CIRCULAR_OBSTACLE_TYPE]: "#f3f4f6",
  [RECTANGULAR_WALL_TYPE]: "#f3f4f6",
};

export const DEFAULT_COMPONENT_SIZES = {
  systemInput: { width: 3, height: 3 },
  systemOutput: { width: 3, height: 3 },
  workstation: { width: 3, height: 3 },
  parallelWorkstation: { width: 3, height: 3 },
  assemblyWorkstation: { width: 3, height: 3 },
  disassemblyWorkstation: { width: 3, height: 3 },
  buffer: { width: 3, height: 3 },
  [RECTANGULAR_OBSTACLE_TYPE]: { width: 3, height: 3 },
  [TRIANGULAR_OBSTACLE_TYPE]: DEFAULT_TRIANGLE_SIZE,
  [CIRCULAR_OBSTACLE_TYPE]: { width: 2 * DEFAULT_CIRCLE_RADIUS, height: 2 * DEFAULT_CIRCLE_RADIUS },
  [RECTANGULAR_WALL_TYPE]: DEFAULT_WALL_SIZE,
};

export const getDefaultShadowColor = (type) => DEFAULT_COMPONENT_SHADOW_COLORS[type] || "#dbeafe";

<template>
  <div class="design-canvas">
    <div
      class="canvas-container"
      ref="canvasContainer"
      :style="{ padding: CONTAINER_PADDING + 'px' }"
    >
      <canvas
        ref="canvas"
        :width="totalCanvasWidth"
        :height="totalCanvasHeight"
        :style="{ cursor: cursorStyle }"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
        @mouseenter="handleMouseEnter"
        @dblclick="handleDoubleClick"
      ></canvas>

      <!-- 双击名称标签时，在标签原位覆盖一个输入框用于改名 -->
      <input
        v-if="editingId"
        ref="labelInput"
        v-model="editingText"
        class="label-editor"
        :style="labelEditorStyle"
        :maxlength="LABEL_MAX_LENGTH"
        @keydown.enter.prevent="commitLabelEdit"
        @keydown.esc.prevent.stop="cancelLabelEdit"
        @blur="commitLabelEdit"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from "vue";
import { getComponentLabel } from "../utils/componentLabel.js";
import { settings } from "../store/settings.js";

// 定义 props
const props = defineProps({
  activeControl: {
    type: Object,
    default: null,
  },
  // 已放置控件列表（由父组件统一维护，与模型树共享同一数据源）
  placedComponents: {
    type: Array,
    default: () => [],
  },
  // 当前在模型树中选中的控件 id
  selectedId: {
    type: String,
    default: null,
  },
});

// 定义 emit
const emit = defineEmits([
  "placement-done",
  "add-log",
  "component-placed",
  "select-component",
  "update-component-position",
  "rename-component",
]);

// 控件唯一 id 计数器（序号 index 会在删除后被复用，因此需要独立的稳定 id）
//
// 计数器不能只靠自增：它是本组件的局部状态，而 placedComponents 由父组件持有。
// 一旦本组件的 setup 重新执行而父组件的数组还在（热更新最容易触发），计数器归零，
// 新控件会拿到已被占用的 id。id 撞车后按 id 匹配的地方全部失准——选中一个会同时
// 框住两个、拖拽会挪错对象。所以每次取 id 都从现有数据里重新求一次下界。
let componentIdCounter = 0;

// 生成一个在当前 placedComponents 中确定唯一的 id。
// 先把计数器推到已占用的最大编号之上，再自增，因此计数器被重置也不会撞车
const createComponentId = () => {
  const usedNumbers = props.placedComponents
    .map((item) => /^component-(\d+)$/.exec(item.id ?? ""))
    .filter(Boolean)
    .map((matched) => Number(matched[1]));

  const maxUsed = usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0;
  componentIdCounter = Math.max(componentIdCounter, maxUsed) + 1;

  return `component-${componentIdCounter}`;
};

// 画布参数
const SMALL_GRID_SIZE = 6; // 小网格大小（像素）
const GRID_RATIO = 6; // 一个大网格由 GRID_RATIO × GRID_RATIO 个小网格组成
const LARGE_GRID_SIZE = SMALL_GRID_SIZE * GRID_RATIO; // 大网格大小（= 6×6 小网格）
const INITIAL_GRID_COUNT = 60; // 初始大网格数量（横向和纵向）
const EXPAND_THRESHOLD = 25; // 距离边缘多少个小网格时扩展画布

// 网格颜色
const SMALL_GRID_COLOR = "#f0f0f0"; // 小网格颜色（浅色）
const LARGE_GRID_COLOR = "#e3e3e3"; // 大网格颜色（深色）
const BACKGROUND_COLOR = "#fefefe"; // 背景色

// 坐标标尺参数
// 画布四周预留的空白（像素），用于绘制坐标数字。网格与控件都会向内偏移这么多
const AXIS_GUTTER = 22;
// 每隔多少个小网格标注一次坐标（每格标注会过于拥挤，这里按大网格间隔标注）
const AXIS_LABEL_STEP = GRID_RATIO; // = 6 格（一个大网格的小网格数）
const AXIS_LABEL_COLOR = "#9aa0a6"; // 坐标数字颜色（浅灰）
const AXIS_LABEL_FONT = "10px sans-serif";

// 画布容器内边距（像素）。作为单一来源同时驱动 JS 坐标换算与 CSS 样式，避免两处不一致
const CONTAINER_PADDING = 0;

// 引用
const canvas = ref(null);
const canvasContainer = ref(null);

// 画布尺寸（指网格区域大小，不含四周标尺留白）
const canvasWidth = ref(INITIAL_GRID_COUNT * LARGE_GRID_SIZE);
const canvasHeight = ref(INITIAL_GRID_COUNT * LARGE_GRID_SIZE);

// canvas 元素实际尺寸 = 网格区域 + 四周各留一条标尺留白
const totalCanvasWidth = computed(() => canvasWidth.value + AXIS_GUTTER * 2);
const totalCanvasHeight = computed(() => canvasHeight.value + AXIS_GUTTER * 2);

// 光标状态
const showCursor = ref(false);
// 光标锚点：小网格线的交点坐标（含滚动偏移）。6×6 大网格中心恰好落在线上，
// 因此锚点取交点而非格子中心，放置控件时以此交点为中心
const cursorX = ref(0);
const cursorY = ref(0);
const mouseInsideCanvas = ref(false);
// 鼠标在视口中的位置（相对于画布元素左上角，不含滚动偏移）
const mouseViewportX = ref(0);
const mouseViewportY = ref(0);

// 拖拽已放置控件的状态
const dragging = ref(false); // 是否正在拖拽控件
const dragId = ref(null); // 正在拖拽的控件 id
// 鼠标按下点相对于控件左上角的偏移，保证拖拽时控件不会”跳”到鼠标处
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);
// 控件在本次拖拽开始时的原始位置（Shift 锁定主方向时用作被锁定轴的固定值）
const dragOriginX = ref(0);
const dragOriginY = ref(0);
// 是否发生过实际移动（用于区分”点击选中”与”拖拽移动”，避免多余日志/更新）
const dragMoved = ref(false);

// 拖拽 AGV 路径拐点的状态
const draggingCorner = ref(false); // 是否正在拖拽拐点
const dragPathId = ref(null); // 正在拖拽拐点所属的路径 id
const dragCornerIndex = ref(null); // 正在拖拽的拐点在 nodes 数组中的索引
const dragCornerOriginX = ref(0); // 拐点原始位置 x
const dragCornerOriginY = ref(0); // 拐点原始位置 y

// 名称标签样式（绘制与输入框共用，保证改名时文字不跳动）
const LABEL_FONT_SIZE = 12;
const LABEL_FONT = `${LABEL_FONT_SIZE}px sans-serif`;
const LABEL_GAP = 2; // 标签与控件图标之间的间距
const LABEL_HIT_PADDING = 3; // 标签命中区域的外扩量（文字太窄，纯文字区不好点）
const LABEL_MAX_LENGTH = 32; // 改名长度上限，避免超长名称糊住画布

// 每个控件名称标签的实际包围盒（绘制时记录），供双击命中判定与输入框定位共用，
// 保证"看到的标签"和"点得到的区域"以及输入框位置三者一致。
// key = 控件 id，value = { x, y, width, height }（网格坐标系）
const labelRects = new Map();

// 正在改名的控件 id（null 表示没有在改名）
const editingId = ref(null);
// 输入框中的文本
const editingText = ref("");
const labelInput = ref(null);

// 连接线模式状态
const connectionLineMode = ref(false); // 是否处于连接线模式
const firstComponent = ref(null); // 第一个被点击的控件
const tempLineEnd = ref(null); // 临时连接线终点（鼠标位置）

// AGV 路径模式状态
const agvPathMode = ref(false); // 是否处于 AGV 路径绘制模式
const agvStartNode = ref(null); // AGV 路径的起点站点
const agvPathPoints = ref([]); // 当前 AGV 路径的所有点（包括起点站点、中间拐点）
const tempAGVPoint = ref(null); // 临时 AGV 路径点（鼠标位置）

// 图片缓存对象
const imageCache = new Map();

// 预加载图片
const preloadImage = (src) => {
  return new Promise((resolve, reject) => {
    // 如果已经缓存，直接返回
    if (imageCache.has(src)) {
      resolve(imageCache.get(src));
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
};

// 计算光标样式
const cursorStyle = computed(() => {
  if (connectionLineMode.value || agvPathMode.value) {
    return "crosshair";
  }
  return "default";
});

// 判断是否应该显示自定义光标
const shouldShowCustomCursor = computed(() => {
  return (
    mouseInsideCanvas.value &&
    props.activeControl &&
    props.activeControl.type !== "select" &&
    props.activeControl.type !== "connectionLine" &&
    props.activeControl.type !== "AGVpath"
  );
});

// 监听激活控件变化，判断是否进入连接线模式或 AGV 路径模式
watch(
  () => props.activeControl,
  (newControl, oldControl) => {
    const isLineMode = newControl?.type === "connectionLine";
    const wasLineMode = oldControl?.type === "connectionLine";
    const isAGVPathMode = newControl?.type === "AGVpath";
    const wasAGVPathMode = oldControl?.type === "AGVpath";

    connectionLineMode.value = isLineMode;
    agvPathMode.value = isAGVPathMode;

    // 重置连接线状态
    if (!isLineMode) {
      firstComponent.value = null;
      tempLineEnd.value = null;
    }

    // 重置 AGV 路径状态
    if (!isAGVPathMode) {
      agvStartNode.value = null;
      agvPathPoints.value = [];
      tempAGVPoint.value = null;
    }

    // 刚切到连接线或 AGV 路径模式：清掉上一步残留的选中态
    if ((isLineMode && !wasLineMode) || (isAGVPathMode && !wasAGVPathMode)) {
      emit("select-component", null);
    }

    drawGrid();
  }
);

// 绘制网格
const drawGrid = () => {
  // 控件切换等时机可能在挂载前触发重绘，此处兜底
  if (!canvas.value) return;

  const ctx = canvas.value.getContext("2d");

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const width = canvasWidth.value; // 网格区域宽度（不含四周标尺留白）
  const height = canvasHeight.value; // 网格区域高度
  const totalWidth = totalCanvasWidth.value; // 含标尺留白的画布总宽度
  const totalHeight = totalCanvasHeight.value;

  // 获取设备像素比
  const dpr = window.devicePixelRatio || 1;

  // 设置 canvas 实际大小（考虑 DPI），含四周标尺留白
  canvas.value.width = totalWidth * dpr;
  canvas.value.height = totalHeight * dpr;

  // 设置 canvas CSS 显示大小
  canvas.value.style.width = totalWidth + "px";
  canvas.value.style.height = totalHeight + "px";

  // 缩放绘图上下文
  ctx.scale(dpr, dpr);

  // 清空整块画布（含留白）并填充背景色
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // 先在留白区绘制坐标数字（此时坐标系原点仍在画布左上角）
  drawAxisLabels(ctx, width, height);

  // 将坐标系平移到网格区域左上角，之后所有网格/控件/光标都用"网格坐标"绘制，
  // 与 placedComponents 里存的 x/y 保持一致，无需在各处手动加留白偏移
  ctx.save();
  ctx.translate(AXIS_GUTTER, AXIS_GUTTER);

  // 绘制小网格（跳过大网格位置）
  ctx.strokeStyle = SMALL_GRID_COLOR;
  ctx.lineWidth = 0.5;

  for (let x = 0; x <= width; x += SMALL_GRID_SIZE) {
    // 跳过大网格线的位置
    if (x % LARGE_GRID_SIZE === 0) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += SMALL_GRID_SIZE) {
    // 跳过大网格线的位置
    if (y % LARGE_GRID_SIZE === 0) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 绘制大网格（会覆盖小网格线）
  ctx.strokeStyle = LARGE_GRID_COLOR;
  ctx.lineWidth = 1;

  for (let x = 0; x <= width; x += LARGE_GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += LARGE_GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 绘制坐标轴（原点在网格左上角，X 向右，Y 向下）
  drawOriginAxes(ctx);

  // 绘制已放置的控件
  drawPlacedComponents(ctx);

  // 绘制黄色方框光标
  if (showCursor.value) {
    drawCursor(ctx);
  }

  ctx.restore();
};

// 在画布四周的留白区绘制坐标数字（单位：小网格，从原点 0 开始）
// 按大网格间隔标注（每 AXIS_LABEL_STEP 个小网格一个数字），避免逐格标注过于拥挤
const drawAxisLabels = (ctx, width, height) => {
  ctx.fillStyle = AXIS_LABEL_COLOR;
  ctx.font = AXIS_LABEL_FONT;

  const step = AXIS_LABEL_STEP * SMALL_GRID_SIZE; // 相邻数字之间的像素间隔（= 大网格）

  // 顶部与底部：沿 x 轴标注列号
  ctx.textAlign = "center";
  for (let x = 0; x <= width; x += step) {
    const label = String(Math.round(x / SMALL_GRID_SIZE));
    const px = AXIS_GUTTER + x; // 网格线在画布中的实际横坐标

    // 顶部留白垂直居中
    ctx.textBaseline = "middle";
    ctx.fillText(label, px, AXIS_GUTTER / 2);

    // 底部留白垂直居中
    ctx.fillText(label, px, AXIS_GUTTER + height + AXIS_GUTTER / 2);
  }

  // 左侧与右侧：沿 y 轴标注行号
  ctx.textBaseline = "middle";
  for (let y = 0; y <= height; y += step) {
    const label = String(Math.round(y / SMALL_GRID_SIZE));
    const py = AXIS_GUTTER + y; // 网格线在画布中的实际纵坐标

    // 左侧留白水平居中
    ctx.textAlign = "center";
    ctx.fillText(label, AXIS_GUTTER / 2, py);

    // 右侧留白水平居中
    ctx.fillText(label, AXIS_GUTTER + width + AXIS_GUTTER / 2, py);
  }
};

// 在网格坐标系原点（左上角）绘制坐标轴：X 轴向右，Y 轴向下
const drawOriginAxes = (ctx) => {
  const LENGTH = LARGE_GRID_SIZE * 2;  // 坐标轴长度（2 个大网格，72px）
  const ARROW = 7;                     // 箭头长度
  const COLOR = "#888888";
  const LABEL_OFFSET = 5;

  ctx.save();
  ctx.strokeStyle = COLOR;
  ctx.fillStyle = COLOR;
  ctx.lineWidth = 1.5;
  ctx.font = "bold 11px sans-serif";

  // X 轴（向右）
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(LENGTH, 0);
  ctx.stroke();

  // X 轴箭头（实心三角）
  ctx.beginPath();
  ctx.moveTo(LENGTH, 0);
  ctx.lineTo(LENGTH - ARROW, -ARROW * 0.4);
  ctx.lineTo(LENGTH - ARROW,  ARROW * 0.4);
  ctx.closePath();
  ctx.fill();

  // X 轴标签
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("X", LENGTH + LABEL_OFFSET, 0);

  // Y 轴（向下）
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, LENGTH);
  ctx.stroke();

  // Y 轴箭头
  ctx.beginPath();
  ctx.moveTo(0, LENGTH);
  ctx.lineTo(-ARROW * 0.4, LENGTH - ARROW);
  ctx.lineTo( ARROW * 0.4, LENGTH - ARROW);
  ctx.closePath();
  ctx.fill();

  // Y 轴标签
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Y", 0, LENGTH + LABEL_OFFSET);

  // 原点小圆点
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 绘制已放置的控件
// 先画连接线再画控件图标，保证线不会盖住图标
const drawPlacedComponents = (ctx) => {
  // 标签包围盒每帧重算，避免控件删除/移动后留下过期的命中区域
  labelRects.clear();

  props.placedComponents
    .filter((component) => component.type === "connectionLine")
    .forEach((line) => drawConnectionLine(ctx, line));

  props.placedComponents.forEach((component) => {
    // 连接线已在上一轮绘制
    if (component.type === "connectionLine") {
      return;
    }

    // AGV 路径单独绘制
    if (component.type === "AGVpath") {
      drawAGVPath(ctx, component);
      return;
    }

    // 站点单独绘制（不需要图片，直接画圆点）
    if (component.type === "node") {
      drawNodeComponent(ctx, component);
      return;
    }

    // 选中的控件先绘制高亮底框
    if (component.id === props.selectedId) {
      ctx.strokeStyle = "#2566fd";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        component.x - 1,
        component.y - 1,
        component.width + 2,
        component.height + 2,
      );
      ctx.fillStyle = "rgba(37, 102, 253, 0.08)";
      ctx.fillRect(component.x, component.y, component.width, component.height);
    }

    // 从缓存中获取图片
    const img = imageCache.get(component.icon);
    if (img && img.complete) {
      // 图片已加载，直接绘制
      ctx.drawImage(
        img,
        component.x,
        component.y,
        LARGE_GRID_SIZE,
        LARGE_GRID_SIZE,
      );
    } else if (!imageCache.has(component.icon)) {
      // 图片未缓存，预加载
      preloadImage(component.icon).then(() => {
        // 图片加载完成后重绘
        drawGrid();
      });
    }

    // 在图片下方绘制控件名称（如：输入1）
    drawComponentLabel(ctx, component);
  });

  // 绘制临时连接线（连接线模式且已选中第一个控件）
  if (connectionLineMode.value && firstComponent.value && tempLineEnd.value) {
    drawTempConnectionLine(ctx);
  }

  // 绘制临时 AGV 路径（AGV 路径模式且已选中起点站点）
  if (agvPathMode.value && agvStartNode.value && agvPathPoints.value.length > 0) {
    drawTempAGVPath(ctx);
  }
};

// 站点尺寸参数
const NODE_SIZE = SMALL_GRID_SIZE; // 站点大小为一个小网格
const NODE_RADIUS = 4; // 站点圆点半径

// 绘制站点控件（小圆点，放置在网格交点上）
const drawNodeComponent = (ctx, component) => {
  // 站点中心就是其 x, y 坐标（已对齐到小网格交点）
  const centerX = component.x;
  const centerY = component.y;

  // 选中的站点先绘制高亮底框
  if (component.id === props.selectedId) {
    ctx.strokeStyle = "#2566fd";
    ctx.lineWidth = 2;
    const halfSize = NODE_SIZE / 2;
    ctx.strokeRect(
      centerX - halfSize - 1,
      centerY - halfSize - 1,
      NODE_SIZE + 2,
      NODE_SIZE + 2,
    );
    ctx.fillStyle = "rgba(37, 102, 253, 0.08)";
    ctx.fillRect(centerX - halfSize, centerY - halfSize, NODE_SIZE, NODE_SIZE);
  }

  // 绘制站点圆点
  ctx.beginPath();
  ctx.arc(centerX, centerY, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#f59e0b"; // 橙色站点
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 在站点旁边绘制名称标签
  drawComponentLabel(ctx, component);
};

// 在控件图片下方绘制名称标签，并记录其包围盒供双击改名使用
const drawComponentLabel = (ctx, component) => {
  const label = getComponentLabel(component);

  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#333333";

  let centerX, labelY;

  // 站点的标签显示在右侧
  if (component.type === "node") {
    centerX = component.x + NODE_RADIUS + 8;
    labelY = component.y - LABEL_FONT_SIZE / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
  } else {
    // 其他控件标签居中于控件正下方
    centerX = component.x + component.width / 2;
    labelY = component.y + component.height + LABEL_GAP;
  }

  // 用当前字体量出文本宽度，得到与绘制结果一致的包围盒
  const textWidth = ctx.measureText(label).width;
  labelRects.set(component.id, {
    x: component.type === "node" ? centerX : centerX - textWidth / 2,
    y: labelY,
    width: textWidth,
    height: LABEL_FONT_SIZE,
  });

  // 正在改名的标签由 HTML 输入框接管显示，画布上不再画一遍，避免文字重影
  if (editingId.value === component.id) return;

  ctx.fillText(label, centerX, labelY);
};

// 连接线颜色
const LINE_COLOR = "#3b82f6"; // 蓝色
const LINE_COLOR_SELECTED = "#2566fd"; // 选中时的深蓝

// 连接线几何参数
const LINE_WIDTH = 2; // 线宽
const LINE_WIDTH_SELECTED = 3; // 选中时线宽
const ARROW_SLANT = 10; // 箭头斜边长度（箭尖到两个后角的距离）
const ARROW_HALF_ANGLE = Math.PI / 7; // 箭头张角的一半

// 箭头沿线方向实际占据的长度。注意它不等于斜边长：
// 斜边与轴线有夹角，投影到轴上是 slant × cos(halfAngle)，约 9.01px 而非 10px。
// 箭头画在线段中点，用这个长度把三角形沿轴向居中
const ARROW_AXIAL = ARROW_SLANT * Math.cos(ARROW_HALF_ANGLE);

// 求中心连线与控件矩形边框的交点，让线从图标边缘起止而不是从中心穿出，
// 避免线体钻进图标下方
const clipToComponentEdge = (component, centerX, centerY, dirX, dirY) => {
  if (dirX === 0 && dirY === 0) return { x: centerX, y: centerY };

  const halfW = component.width / 2;
  const halfH = component.height / 2;

  // 分别求与竖边、横边相交所需的缩放系数，取先碰到的那条边
  const scaleX = dirX === 0 ? Infinity : halfW / Math.abs(dirX);
  const scaleY = dirY === 0 ? Infinity : halfH / Math.abs(dirY);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: centerX + dirX * scale,
    y: centerY + dirY * scale,
  };
};

// 由两点算出一条带箭头的线段的完整几何：
// start    起点（已收缩到起点控件边缘）
// end      终点（已收缩到终点控件边缘），线体一直画到这里
// arrowTip 箭尖位置。箭头画在线段中点并沿轴向居中，因此箭尖落在
//          中点前方半个箭头长度处，三角形整体正好被中点平分
// slant    本次实际使用的箭头斜边长（空间不足时等比缩小）
// length   start 到 end 的可见长度
// 返回 null 表示两控件贴得太近，没有可见线段
const computeLineGeometry = (startPoint, endPoint) => {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);

  // 长度为 0：两控件中心重合或完全遮挡，无可绘制内容
  if (length < 0.5) return null;

  // 单位方向向量，后续所有沿线偏移都基于它，避免重复三角函数运算
  const ux = dx / length;
  const uy = dy / length;

  // 可见长度不足以容纳完整箭头时，把箭头等比缩小到刚好填满整段
  let slant = ARROW_SLANT;
  let axial = ARROW_AXIAL;
  if (axial > length) {
    const shrink = length / axial;
    slant = ARROW_SLANT * shrink;
    axial = length;
  }

  // 箭头沿轴向居中于线段中点：箭尖前移半个箭头长度，底边则落在中点后方同样距离
  const midX = startPoint.x + ux * (length / 2);
  const midY = startPoint.y + uy * (length / 2);

  return {
    start: startPoint,
    end: endPoint,
    arrowTip: {
      x: midX + ux * (axial / 2),
      y: midY + uy * (axial / 2),
    },
    ux,
    uy,
    slant,
    axial,
    length,
  };
};

// 解出一条连接线的两个端点（各自收缩到控件图标边缘）
// 绘制与命中判定共用，保证"看到的线"和"点得到的线"完全一致
const resolveLineEndpoints = (line) => {
  const fromComp = props.placedComponents.find((c) => c.id === line.fromId);
  const toComp = props.placedComponents.find((c) => c.id === line.toId);
  if (!fromComp || !toComp) return null;

  const fromCenterX = fromComp.x + fromComp.width / 2;
  const fromCenterY = fromComp.y + fromComp.height / 2;
  const toCenterX = toComp.x + toComp.width / 2;
  const toCenterY = toComp.y + toComp.height / 2;

  const dirX = toCenterX - fromCenterX;
  const dirY = toCenterY - fromCenterY;

  return {
    start: clipToComponentEdge(fromComp, fromCenterX, fromCenterY, dirX, dirY),
    end: clipToComponentEdge(toComp, toCenterX, toCenterY, -dirX, -dirY),
  };
};

// 绘制连接线（已放置的）
const drawConnectionLine = (ctx, line) => {
  const endpoints = resolveLineEndpoints(line);
  if (!endpoints) return;

  const geo = computeLineGeometry(endpoints.start, endpoints.end);
  if (!geo) return;

  // 选中状态高亮
  const isSelected = line.id === props.selectedId;
  const color = isSelected ? LINE_COLOR_SELECTED : LINE_COLOR;

  // 线体：整段画满。箭头在中间且为实心，会盖住下面这段线，不会露出接缝
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? LINE_WIDTH_SELECTED : LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(geo.start.x, geo.start.y);
  ctx.lineTo(geo.end.x, geo.end.y);
  ctx.stroke();

  // 箭头（在线段中点，指向第二个被点击的控件）
  drawArrow(ctx, geo, color);

  // 线上不画名称：后续要在线上跑动画，标签会挡住。
  // 名称在模型树和属性面板里可以看到
};

// 绘制实心三角箭头。箭尖位置由 geo.arrowTip 给出（线段中点前方半个箭头），
// 方向由 geo 的单位向量给出，直接旋转 ±halfAngle 得到两个后角，无需再算 atan2
const drawArrow = (ctx, geo, color) => {
  const { arrowTip: tip, ux, uy, slant } = geo;

  const cos = Math.cos(ARROW_HALF_ANGLE);
  const sin = Math.sin(ARROW_HALF_ANGLE);

  // 把 -u 方向分别旋转 +halfAngle 与 -halfAngle，再乘斜边长
  const leftX = tip.x - slant * (ux * cos - uy * sin);
  const leftY = tip.y - slant * (uy * cos + ux * sin);
  const rightX = tip.x - slant * (ux * cos + uy * sin);
  const rightY = tip.y - slant * (uy * cos - ux * sin);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
};

// 绘制临时连接线（已点第一个控件，虚线跟随鼠标预览）
const drawTempConnectionLine = (ctx) => {
  const from = firstComponent.value;
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const tip = { x: tempLineEnd.value.x, y: tempLineEnd.value.y };

  // 起点收缩到图标边缘；终点是鼠标位置，不收缩
  const start = clipToComponentEdge(
    from,
    fromCenterX,
    fromCenterY,
    tip.x - fromCenterX,
    tip.y - fromCenterY,
  );

  // 高亮起点控件，提示当前正从它拉线（线可能很短，先画框保证一直可见）
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeRect(from.x - 1, from.y - 1, from.width + 2, from.height + 2);

  const geo = computeLineGeometry(start, tip);
  if (!geo) return;

  // 虚线表示尚未确认，同样画满全长
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(geo.start.x, geo.start.y);
  ctx.lineTo(geo.end.x, geo.end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 箭头压在虚线中点上，方向即当前拉线方向
  drawArrow(ctx, geo, LINE_COLOR);
};

// AGV 路径颜色
const AGV_PATH_COLOR = "#10b981"; // 绿色
const AGV_PATH_COLOR_SELECTED = "#059669"; // 选中时的深绿
const AGV_PATH_WIDTH = 3; // 路径线宽
const AGV_PATH_WIDTH_SELECTED = 4; // 选中时线宽
const CORNER_RADIUS = 5; // 拐点圆点半径
const CORNER_GRAB_MARGIN = 3; // 拐点抓取余量

// 绘制 AGV 路径（已放置的）
const drawAGVPath = (ctx, pathComponent) => {
  const { nodes, cornerRadii } = pathComponent;
  if (!nodes || nodes.length < 2) return;

  // 选中状态高亮
  const isSelected = pathComponent.id === props.selectedId;
  const color = isSelected ? AGV_PATH_COLOR_SELECTED : AGV_PATH_COLOR;
  const lineWidth = isSelected ? AGV_PATH_WIDTH_SELECTED : AGV_PATH_WIDTH;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round"; // 圆角连接
  ctx.lineCap = "round";

  // 如果没有设置圆角，直接绘制折线
  if (!cornerRadii || cornerRadii.every(r => r === 0)) {
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    ctx.stroke();
  } else {
    // 有圆角，使用 arcTo 绘制圆角路径
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);

    for (let i = 1; i < nodes.length - 1; i++) {
      const curr = nodes[i];
      const next = nodes[i + 1];
      const radius = cornerRadii[i - 1] || 0;

      if (radius > 0) {
        // 使用 arcTo 绘制圆角
        ctx.arcTo(curr.x, curr.y, next.x, next.y, radius);
      } else {
        // 无圆角，直接连线
        ctx.lineTo(curr.x, curr.y);
      }
    }

    // 连接到最后一个点
    ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
    ctx.stroke();
  }

  // 绘制拐点（不包括起点和终点站点）
  if (isSelected) {
    for (let i = 1; i < nodes.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(nodes[i].x, nodes[i].y, CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // 在路径中点附近绘制路径名称
  if (nodes.length >= 2) {
    const midIdx = Math.floor((nodes.length - 1) / 2);
    const midNode = nodes[midIdx];
    drawAGVPathLabel(ctx, pathComponent, midNode);
  }
};

// 在 AGV 路径中点附近绘制名称标签
const drawAGVPathLabel = (ctx, pathComponent, midNode) => {
  const label = getComponentLabel(pathComponent);

  ctx.font = LABEL_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#333333";

  // 标签显示在路径中点右上方
  const labelX = midNode.x + 8;
  const labelY = midNode.y - 8;

  // 记录包围盒供双击改名使用
  const textWidth = ctx.measureText(label).width;
  labelRects.set(pathComponent.id, {
    x: labelX,
    y: labelY - LABEL_FONT_SIZE / 2,
    width: textWidth,
    height: LABEL_FONT_SIZE,
  });

  // 正在改名的标签由 HTML 输入框接管显示
  if (editingId.value === pathComponent.id) return;

  ctx.fillText(label, labelX, labelY);
};

// 绘制临时 AGV 路径（正在绘制中，虚线跟随鼠标预览）
const drawTempAGVPath = (ctx) => {
  if (!agvStartNode.value || agvPathPoints.value.length === 0) return;

  const points = agvPathPoints.value;

  // 绘制已确认的路径段（实线）
  ctx.strokeStyle = AGV_PATH_COLOR;
  ctx.lineWidth = AGV_PATH_WIDTH;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // 绘制临时预览线段（虚线，从最后一个点到鼠标位置）
  if (tempAGVPoint.value) {
    const lastPoint = points[points.length - 1];
    ctx.strokeStyle = AGV_PATH_COLOR;
    ctx.lineWidth = AGV_PATH_WIDTH;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(tempAGVPoint.value.x, tempAGVPoint.value.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 绘制已确认的拐点（小圆点，不包括起点站点）
  for (let i = 1; i < points.length; i++) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = AGV_PATH_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 绘制临时预览点
  if (tempAGVPoint.value) {
    ctx.beginPath();
    ctx.arc(tempAGVPoint.value.x, tempAGVPoint.value.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(16, 185, 129, 0.3)";
    ctx.fill();
    ctx.strokeStyle = AGV_PATH_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 高亮起点站点，提示当前正从它拉线
  ctx.strokeStyle = AGV_PATH_COLOR;
  ctx.lineWidth = 2;
  const halfSize = NODE_SIZE / 2;
  ctx.strokeRect(
    agvStartNode.value.x - halfSize - 1,
    agvStartNode.value.y - halfSize - 1,
    NODE_SIZE + 2,
    NODE_SIZE + 2
  );
};

// 绘制光标：以网格线交点（cursorX/cursorY）为中心
// 用一个居中于交点的黄色方框表示放置锚点，方框中心即控件放置后的中心
const drawCursor = (ctx) => {
  const half = SMALL_GRID_SIZE / 2;
  const left = cursorX.value - half;
  const top = cursorY.value - half;

  // 半透明黄色填充
  ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
  ctx.fillRect(left, top, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

  // 黄色边框
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

  // 交点十字标记，强调锚点在线上而非格子中心
  ctx.beginPath();
  ctx.moveTo(cursorX.value - half, cursorY.value);
  ctx.lineTo(cursorX.value + half, cursorY.value);
  ctx.moveTo(cursorX.value, cursorY.value - half);
  ctx.lineTo(cursorX.value, cursorY.value + half);
  ctx.stroke();
};

// 扩展画布
const expandCanvas = (newWidth, newHeight) => {
  const oldWidth = canvasWidth.value;
  const oldHeight = canvasHeight.value;

  // 只在需要扩展时才扩展
  if (newWidth > oldWidth || newHeight > oldHeight) {
    canvasWidth.value = Math.max(newWidth, oldWidth);
    canvasHeight.value = Math.max(newHeight, oldHeight);

    nextTick(() => {
      drawGrid();
    });
  }
};

// 检查控件位置并扩展画布（当控件接近边缘时）
const checkAndExpandCanvas = (
  componentX,
  componentY,
  componentWidth,
  componentHeight,
) => {
  const threshold = EXPAND_THRESHOLD * SMALL_GRID_SIZE;

  // 计算控件的右边界和下边界
  const rightEdge = componentX + componentWidth;
  const bottomEdge = componentY + componentHeight;

  // 检查是否需要向右扩展
  if (rightEdge > canvasWidth.value - threshold) {
    const newWidth =
      Math.ceil((rightEdge + threshold) / LARGE_GRID_SIZE) * LARGE_GRID_SIZE;
    expandCanvas(newWidth, canvasHeight.value);
  }

  // 检查是否需要向下扩展
  if (bottomEdge > canvasHeight.value - threshold) {
    const newHeight =
      Math.ceil((bottomEdge + threshold) / LARGE_GRID_SIZE) * LARGE_GRID_SIZE;
    expandCanvas(canvasWidth.value, newHeight);
  }
};

// 获取鼠标在"网格坐标系"中的位置（与 placedComponents 的 x/y 同一坐标系）
// 需依次扣除：容器内边距 padding、画布四周标尺留白 AXIS_GUTTER；并加回滚动偏移
const getCanvasMousePosition = (e) => {
  const containerRect = canvasContainer.value.getBoundingClientRect();

  const x =
    e.clientX -
    containerRect.left -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollLeft;
  const y =
    e.clientY -
    containerRect.top -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollTop;
  return {
    x,
    y,
  };
};

// 将坐标向下对齐到小网格线（用于拖拽时控件左上角落在网格线上）
const snapToSmallGrid = (value) => {
  return Math.floor(value / SMALL_GRID_SIZE) * SMALL_GRID_SIZE;
};

// 将坐标对齐到最近的小网格线交点（用于放置光标：锚点在线上，最小移动单位仍是一个小网格）
const snapToNearestGridLine = (value) => {
  return Math.round(value / SMALL_GRID_SIZE) * SMALL_GRID_SIZE;
};

// 将光标锚点限制在网格区域内（[0, 网格宽/高]），避免黄色方框跑到四周坐标标尺留白区
const clampCursorToGrid = (x, y) => ({
  x: Math.min(Math.max(x, 0), canvasWidth.value),
  y: Math.min(Math.max(y, 0), canvasHeight.value),
});

// 为指定类型计算下一个可用的序号（填补空缺）
// 取当前已放置的同类型控件占用序号中，最小的未被使用的正整数
const getNextIndexForType = (type) => {
  const usedIndexes = new Set(
    props.placedComponents
      .filter((component) => component.type === type)
      .map((component) => component.index),
  );

  let index = 1;
  while (usedIndexes.has(index)) {
    index += 1;
  }
  return index;
};

// 命中测试：返回鼠标坐标下最上层的控件（后放置的优先），无则返回 null
// 连接线和 AGV 路径没有矩形包围盒，按"点到线段的距离"判定，因此单独处理；
// 图标控件优先于连接线和路径，避免线经过图标时抢走点击
const hitTestComponent = (x, y) => {
  for (let i = props.placedComponents.length - 1; i >= 0; i -= 1) {
    const component = props.placedComponents[i];
    if (component.type === "connectionLine" || component.type === "AGVpath") continue;

    // 站点使用圆形命中测试
    if (component.type === "node") {
      const dist = Math.hypot(x - component.x, y - component.y);
      if (dist <= NODE_RADIUS + LINE_GRAB_MARGIN) {
        return component;
      }
      continue;
    }

    // 其他控件使用矩形命中测试
    if (
      x >= component.x &&
      x <= component.x + component.width &&
      y >= component.y &&
      y <= component.y + component.height
    ) {
      return component;
    }
  }

  for (let i = props.placedComponents.length - 1; i >= 0; i -= 1) {
    const line = props.placedComponents[i];
    if (line.type !== "connectionLine") continue;
    if (hitTestConnectionLine(line, x, y)) {
      return line;
    }
  }

  for (let i = props.placedComponents.length - 1; i >= 0; i -= 1) {
    const path = props.placedComponents[i];
    if (path.type !== "AGVpath") continue;
    if (hitTestAGVPath(path, x, y)) {
      return path;
    }
  }

  return null;
};

// 命中测试：检测鼠标是否点击了 AGV 路径的拐点
// 返回 { pathId, cornerIndex } 或 null
const hitTestAGVCorner = (x, y) => {
  // 只有选中的路径才显示拐点，因此只检测选中的路径
  const selectedPath = props.placedComponents.find(
    (c) => c.id === props.selectedId && c.type === "AGVpath"
  );

  if (!selectedPath || !selectedPath.nodes) return null;

  // 检测拐点（不包括起点和终点站点）
  for (let i = 1; i < selectedPath.nodes.length - 1; i++) {
    const node = selectedPath.nodes[i];
    const dist = Math.hypot(x - node.x, y - node.y);
    if (dist <= CORNER_RADIUS + CORNER_GRAB_MARGIN) {
      return { pathId: selectedPath.id, cornerIndex: i };
    }
  }

  return null;
};

// 命中测试：返回名称标签落在鼠标坐标下的控件（后放置的优先），无则返回 null。
// 包围盒来自绘制时记录的 labelRects，外扩 LABEL_HIT_PADDING 便于点中
const hitTestLabel = (x, y) => {
  for (let i = props.placedComponents.length - 1; i >= 0; i -= 1) {
    const component = props.placedComponents[i];
    const rect = labelRects.get(component.id);
    if (!rect) continue;

    if (
      x >= rect.x - LABEL_HIT_PADDING &&
      x <= rect.x + rect.width + LABEL_HIT_PADDING &&
      y >= rect.y - LABEL_HIT_PADDING &&
      y <= rect.y + rect.height + LABEL_HIT_PADDING
    ) {
      return component;
    }
  }

  return null;
};

// 细线难以精确点中，在实际绘制宽度外再放宽这些像素作为抓取余量
const LINE_GRAB_MARGIN = 3;

// 点到线段的距离（超出端点时取到端点的距离，而非到无限延长线的距离）
const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  // 线段退化为点
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  // 投影参数夹到 [0,1]，保证落点在线段内
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// 连接线命中判定：命中区域 = 线体（按线宽加抓取余量）∪ 箭头三角形
// 两者都按实际绘制出来的几何计算，所以"点得到的"和"看到的"一致
const hitTestConnectionLine = (line, x, y) => {
  const endpoints = resolveLineEndpoints(line);
  if (!endpoints) return false;

  const geo = computeLineGeometry(endpoints.start, endpoints.end);
  if (!geo) return false;

  // 线体：容差取半线宽 + 抓取余量。选中时线更粗，用较大的那个保证一致手感
  const halfWidth = LINE_WIDTH_SELECTED / 2;
  const tolerance = halfWidth + LINE_GRAB_MARGIN;

  // 用 start→end 整段做距离判定，顺带覆盖箭头的中轴区域
  if (
    distanceToSegment(x, y, geo.start.x, geo.start.y, geo.end.x, geo.end.y) <=
    tolerance
  ) {
    return true;
  }

  // 箭头两侧比线宽得多，单靠中轴距离判不到，补一次三角形内部判定
  return isPointInArrow(x, y, geo);
};

// 判断点是否落在箭头三角形内（含 LINE_GRAB_MARGIN 的外扩）。
// 箭头挪到中间后它整体落在线体的判定带附近，这一步多数情况是冗余的；
// 但箭头比线宽得多，保留它才能保证以后调大箭头时命中区仍然跟着变
const isPointInArrow = (px, py, geo) => {
  const { arrowTip: tip, ux, uy, slant } = geo;

  // 沿轴向的投影距离：0 在箭尖，正值朝线体方向
  const axialDist = (tip.x - px) * ux + (tip.y - py) * uy;

  // 轴向超出箭头范围（含余量）直接排除
  if (axialDist < -LINE_GRAB_MARGIN || axialDist > geo.axial + LINE_GRAB_MARGIN) {
    return false;
  }

  // 垂直于轴的偏移距离
  const lateralDist = Math.abs(-(tip.y - py) * ux + (tip.x - px) * uy);

  // 三角形在该轴向位置的半宽随距箭尖的距离线性增长
  const halfWidthHere =
    Math.max(0, axialDist) * Math.tan(ARROW_HALF_ANGLE) + LINE_GRAB_MARGIN;

  // slant 缩小时（短线）三角形整体变小，半宽同样按比例受 axial 限制
  return lateralDist <= halfWidthHere && slant > 0;
};

// AGV 路径命中判定：使用 isPointInStroke 精确判断（支持圆角）
const hitTestAGVPath = (path, x, y) => {
  const { nodes, cornerRadii } = path;
  if (!nodes || nodes.length < 2) return false;

  // 创建临时 canvas context 用于命中测试
  const tempCanvas = document.createElement('canvas');
  const ctx = tempCanvas.getContext('2d');

  ctx.lineWidth = AGV_PATH_WIDTH_SELECTED + LINE_GRAB_MARGIN * 2; // 增加容差
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 重新绘制路径（与 drawAGVPath 逻辑一致）
  if (!cornerRadii || cornerRadii.every(r => r === 0)) {
    // 无圆角，直线路径
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      ctx.lineTo(nodes[i].x, nodes[i].y);
    }
  } else {
    // 有圆角，使用 arcTo
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);

    for (let i = 1; i < nodes.length - 1; i++) {
      const curr = nodes[i];
      const next = nodes[i + 1];
      const radius = cornerRadii[i - 1] || 0;

      if (radius > 0) {
        ctx.arcTo(curr.x, curr.y, next.x, next.y, radius);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
    }

    ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
  }

  // 使用 isPointInStroke 判断点是否在路径上
  return ctx.isPointInStroke(x, y);
};

// 输入框在容器中的绝对定位样式。
// labelRects 存的是"网格坐标"，需加回标尺留白与容器内边距换算成容器内坐标；
// 容器滚动时输入框随内容一起滚（absolute 定位在滚动内容里），无需再补 scroll 偏移
const labelEditorStyle = computed(() => {
  const rect = editingId.value ? labelRects.get(editingId.value) : null;
  if (!rect) return { display: "none" };

  // 文字很短时输入框会窄到没法点，给一个下限；同时留出光标和左右内边距的余量
  const width = Math.max(rect.width + 16, 64);
  const centerX = rect.x + rect.width / 2;

  return {
    left: `${CONTAINER_PADDING + AXIS_GUTTER + centerX - width / 2}px`,
    top: `${CONTAINER_PADDING + AXIS_GUTTER + rect.y}px`,
    width: `${width}px`,
  };
});

// 进入改名状态：把当前标签文本放进输入框并全选，直接输入即可覆盖
const startLabelEdit = (component) => {
  editingId.value = component.id;
  editingText.value = getComponentLabel(component);

  // 改名时同步选中该控件，属性面板与模型树保持一致
  emit("select-component", component.id);

  nextTick(() => {
    labelInput.value?.focus();
    labelInput.value?.select();
  });

  // 画布上那一行文字要让位给输入框
  drawGrid();
};

// 退出改名状态（不写回数据）
const closeLabelEdit = () => {
  editingId.value = null;
  editingText.value = "";
  drawGrid();
};

const cancelLabelEdit = () => {
  if (!editingId.value) return;
  closeLabelEdit();
};

// 提交改名。空名称、与原名相同、与其他控件重名都按"不修改"处理
const commitLabelEdit = () => {
  // blur 会在 closeLabelEdit 移除输入框时再触发一次，这里直接短路
  if (!editingId.value) return;

  const id = editingId.value;
  const target = props.placedComponents.find((item) => item.id === id);
  if (!target) {
    closeLabelEdit();
    return;
  }

  const oldLabel = getComponentLabel(target);
  const newLabel = editingText.value.trim().slice(0, LABEL_MAX_LENGTH);

  // 空名称视为放弃修改，保留原名（否则画布上会出现没有标签的控件）
  if (newLabel === "" || newLabel === oldLabel) {
    closeLabelEdit();
    return;
  }

  // 重名会让模型树和日志无法区分对象，拒绝并提示
  const duplicated = props.placedComponents.some(
    (item) => item.id !== id && getComponentLabel(item) === newLabel,
  );
  if (duplicated) {
    emit("add-log", `重命名失败：名称 ${newLabel} 已被占用`);
    closeLabelEdit();
    return;
  }

  emit("rename-component", { id, displayName: newLabel });
  emit("add-log", `重命名对象，${oldLabel} → ${newLabel}`);
  closeLabelEdit();
};

// 创建 AGV 路径对象并通知父组件
const createAGVPath = (endNode) => {
  // 计算序号
  const index = getNextIndexForType("AGVpath");

  // 生成唯一 id
  const id = createComponentId();

  // 创建 AGV 路径对象
  const agvPath = {
    id,
    type: "AGVpath",
    name: "AGV路径",
    icon: props.activeControl.icon,
    tabId: props.activeControl.tabId,
    index,
    fromId: agvStartNode.value.id,
    toId: endNode.id,
    fromName: getComponentLabel(agvStartNode.value),
    toName: getComponentLabel(endNode),
    nodes: [...agvPathPoints.value], // 深拷贝所有路径点（包括起点站点、中间拐点、终点站点）
    // 每两个点之间是一条线段
    segments: agvPathPoints.value.slice(1).map(() => ({ type: "line", radius: 0 })),
    // 每个拐点的圆角半径（不包括起点和终点站点）
    cornerRadii: Array(Math.max(0, agvPathPoints.value.length - 2)).fill(0),
  };

  // 通知父组件新增控件
  emit("component-placed", agvPath);

  // 输出日志
  const pointCount = agvPathPoints.value.length;
  emit(
    "add-log",
    `新建对象，类型：AGVpath，编号：AGV路径${index}，连接：${agvPath.fromName} → ${agvPath.toName}，点数：${pointCount}`
  );

  // 重置状态
  agvStartNode.value = null;
  agvPathPoints.value = [];
  tempAGVPoint.value = null;

  // 通知父组件放置完成，重置为"选择"状态
  emit("placement-done");

  drawGrid();
};

// 双击名称标签进入改名。放置控件/连接线模式下不响应，避免与放置操作打架
const handleDoubleClick = (e) => {
  if (connectionLineMode.value || shouldShowCustomCursor.value) return;

  const pos = getCanvasMousePosition(e);
  const hit = hitTestLabel(pos.x, pos.y);
  if (!hit) return;

  startLabelEdit(hit);
};

// 鼠标事件处理
const handleMouseDown = async (e) => {
  // 改名中点击画布：先提交当前修改，这一次点击只用于收起输入框
  if (editingId.value) {
    commitLabelEdit();
    return;
  }

  // AGV 路径模式：点击站点开始绘制，左键添加拐点，点击站点结束
  if (agvPathMode.value) {
    const pos = getCanvasMousePosition(e);
    const hit = hitTestComponent(pos.x, pos.y);

    // 如果还没有起点站点，必须先点击站点
    if (!agvStartNode.value) {
      if (!hit || hit.type !== "node") {
        emit("add-log", "AGV 路径：请点击起点站点");
        return;
      }

      // 记录起点站点
      agvStartNode.value = hit;
      // 路径点数组的第一个点就是起点站点坐标
      agvPathPoints.value = [{ x: hit.x, y: hit.y }];
      emit("add-log", `AGV 路径：已选择起点 ${getComponentLabel(hit)}`);
      drawGrid();
      return;
    }

    // 已经有起点站点，检查是否点击了站点（终点）
    if (hit && hit.type === "node") {
      // 不能连接同一个站点
      if (hit.id === agvStartNode.value.id && agvPathPoints.value.length === 1) {
        emit("add-log", "AGV 路径：不能连接同一个站点");
        return;
      }

      // 添加终点站点坐标到路径点数组
      agvPathPoints.value.push({ x: hit.x, y: hit.y });

      // 至少需要 2 个点（起点站点 + 终点站点）才能形成路径
      if (agvPathPoints.value.length < 2) {
        emit("add-log", "AGV 路径：至少需要起点和终点两个站点");
        agvStartNode.value = null;
        agvPathPoints.value = [];
        tempAGVPoint.value = null;
        drawGrid();
        return;
      }

      // 创建 AGV 路径
      createAGVPath(hit);
      return;
    }

    // 点击空白处或其他控件：添加拐点
    // 对齐到小网格线交点
    const pointX = snapToNearestGridLine(pos.x);
    const pointY = snapToNearestGridLine(pos.y);

    // 确保拐点不会放置在负坐标
    const finalX = Math.max(0, pointX);
    const finalY = Math.max(0, pointY);

    // 添加拐点到路径
    agvPathPoints.value.push({ x: finalX, y: finalY });
    emit("add-log", `AGV 路径：添加拐点 (${Math.round(finalX / SMALL_GRID_SIZE)}, ${Math.round(finalY / SMALL_GRID_SIZE)})`);

    // 检查是否需要扩展画布
    checkAndExpandCanvas(finalX, finalY, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

    drawGrid();
    return;
  }

  // 连接线模式：点击控件选择起点和终点
  if (connectionLineMode.value) {
    const pos = getCanvasMousePosition(e);
    const hit = hitTestComponent(pos.x, pos.y);

    // 忽略点击连接线自身
    if (hit && hit.type === "connectionLine") {
      return;
    }

    if (!hit) {
      // 点击空白处，取消连接线模式
      firstComponent.value = null;
      tempLineEnd.value = null;
      drawGrid();
      return;
    }

    if (!firstComponent.value) {
      // 选择第一个控件
      firstComponent.value = hit;
      emit("add-log", `连接线：已选择起点 ${getComponentLabel(hit)}`);
      drawGrid();
    } else {
      // 选择第二个控件，创建连接线
      if (hit.id === firstComponent.value.id) {
        // 不能连接自己
        emit("add-log", `连接线：不能连接同一个控件`);
        return;
      }

      // 计算序号
      const index = getNextIndexForType("connectionLine");

      // 生成唯一 id
      const id = createComponentId();

      // 创建连接线对象
      const connectionLine = {
        id,
        type: "connectionLine",
        name: "连接线",
        icon: props.activeControl.icon,
        tabId: props.activeControl.tabId,
        index,
        fromId: firstComponent.value.id,
        toId: hit.id,
        fromName: getComponentLabel(firstComponent.value),
        toName: getComponentLabel(hit),
      };

      // 通知父组件新增控件
      emit("component-placed", connectionLine);

      // 输出日志
      emit(
        "add-log",
        `新建对象，类型：connectionLine，编号：连接线${index}，连接：${connectionLine.fromName} → ${connectionLine.toName}`
      );

      // 重置状态
      firstComponent.value = null;
      tempLineEnd.value = null;

      // 通知父组件放置完成，重置为"选择"状态
      emit("placement-done");

      drawGrid();
    }
    return;
  }

  // 非放置状态（选择模式）：点击控件则选中并进入拖拽，点击空白则取消选中
  if (!shouldShowCustomCursor.value) {
    const pos = getCanvasMousePosition(e);

    // 优先检测是否点击了 AGV 路径的拐点
    const cornerHit = hitTestAGVCorner(pos.x, pos.y);
    if (cornerHit) {
      // 开始拖拽拐点
      draggingCorner.value = true;
      dragPathId.value = cornerHit.pathId;
      dragCornerIndex.value = cornerHit.cornerIndex;

      const path = props.placedComponents.find((c) => c.id === cornerHit.pathId);
      const corner = path.nodes[cornerHit.cornerIndex];
      dragCornerOriginX.value = corner.x;
      dragCornerOriginY.value = corner.y;

      return;
    }

    const hit = hitTestComponent(pos.x, pos.y);

    // 点在名称标签上：只选中不拖拽。双击改名的第一次 mousedown 会走到这里，
    // 若按"空白处"处理会先把控件取消选中，标签闪一下再进输入框
    if (!hit) {
      const labelHit = hitTestLabel(pos.x, pos.y);
      if (labelHit) {
        emit("select-component", labelHit.id);
        return;
      }
    }

    emit("select-component", hit ? hit.id : null);

    // 连接线和 AGV 路径不能拖拽，其他控件（包括站点）都可以拖拽
    if (hit && hit.type !== "connectionLine" && hit.type !== "AGVpath") {
      // 记录拖拽初始状态：命中控件、按下点相对控件左上角的偏移、原始位置
      dragging.value = true;
      dragId.value = hit.id;
      dragOffsetX.value = pos.x - hit.x;
      dragOffsetY.value = pos.y - hit.y;
      dragOriginX.value = hit.x;
      dragOriginY.value = hit.y;
      dragMoved.value = false;
    }
    return;
  }

  // 光标锚点即网格线交点，将作为控件的中心
  const anchorX = cursorX.value;
  const anchorY = cursorY.value;

  // 站点放置在网格线交点上（不偏移，直接使用锚点坐标）
  if (props.activeControl.type === "node") {
    // 确保站点不会放置在负坐标
    const finalX = Math.max(0, anchorX);
    const finalY = Math.max(0, anchorY);

    // 计算同类型控件的序号
    const index = getNextIndexForType(props.activeControl.type);

    // 生成稳定唯一 id
    const id = createComponentId();

    // 通知父组件新增站点控件
    emit("component-placed", {
      id,
      type: props.activeControl.type,
      name: props.activeControl.name,
      icon: props.activeControl.icon,
      tabId: props.activeControl.tabId,
      index,
      x: finalX,
      y: finalY,
      width: NODE_SIZE, // 站点宽度为一个小网格
      height: NODE_SIZE, // 站点高度为一个小网格
    });

    // 输出日志
    emit(
      "add-log",
      `新建对象，类型：${props.activeControl.type}，编号：${props.activeControl.name}${index}`,
    );

    // 检查是否需要扩展画布
    checkAndExpandCanvas(finalX, finalY, NODE_SIZE, NODE_SIZE);

    // 通知父组件放置完成，重置为"选择"状态
    emit("placement-done");

    // prop 变更是异步的，立即手动隐藏游标并重绘，避免黄框残留
    showCursor.value = false;
    drawGrid();
    return;
  }

  // 其他控件：由中心反推大网格左上角
  const centerOffset = (GRID_RATIO * SMALL_GRID_SIZE) / 2;
  const componentX = anchorX - centerOffset;
  const componentY = anchorY - centerOffset;

  // 确保控件不会放置在负坐标
  const finalX = Math.max(0, componentX);
  const finalY = Math.max(0, componentY);

  // 预加载图片
  await preloadImage(props.activeControl.icon);

  // 计算同类型控件的序号（填补被删除控件留下的空缺）
  const index = getNextIndexForType(props.activeControl.type);

  // 生成稳定唯一 id（序号 index 会被复用，不能当作 id）
  const id = createComponentId();

  // 通知父组件新增控件（父组件维护 placedComponents 单一数据源，模型树共享）
  emit("component-placed", {
    id,
    type: props.activeControl.type,
    name: props.activeControl.name,
    icon: props.activeControl.icon,
    tabId: props.activeControl.tabId,
    index,
    x: finalX,
    y: finalY,
    width: LARGE_GRID_SIZE,
    height: LARGE_GRID_SIZE,
  });

  // 输出日志：新建对象，类型：<type>，编号：<name><序号>
  emit(
    "add-log",
    `新建对象，类型：${props.activeControl.type}，编号：${props.activeControl.name}${index}`,
  );

  // 检查是否需要扩展画布
  checkAndExpandCanvas(finalX, finalY, LARGE_GRID_SIZE, LARGE_GRID_SIZE);

  // 通知父组件放置完成，重置为"选择"状态
  emit("placement-done");

  // prop 变更是异步的，立即手动隐藏游标并重绘，避免黄框残留
  // placedComponents 更新后会由 watch 触发重绘
  showCursor.value = false;
  drawGrid();
};

const handleMouseMove = (e) => {
  const containerRect = canvasContainer.value.getBoundingClientRect();

  // 保存鼠标相对于可视区域的位置
  mouseViewportX.value = e.clientX - containerRect.left;

  mouseViewportY.value = e.clientY - containerRect.top;

  const pos = getCanvasMousePosition(e);

  // 拖拽 AGV 路径拐点：拐点跟随鼠标，对齐到小网格线交点
  if (draggingCorner.value && dragPathId.value !== null && dragCornerIndex.value !== null) {
    const path = props.placedComponents.find((c) => c.id === dragPathId.value);
    if (!path || !path.nodes) return;

    // 对齐到小网格线交点
    let newX = snapToNearestGridLine(pos.x);
    let newY = snapToNearestGridLine(pos.y);

    // 不允许拖到负坐标
    newX = Math.max(0, newX);
    newY = Math.max(0, newY);

    // 按住 Shift：锁定到位移较大的主方向（水平或垂直）
    if (e.shiftKey) {
      const deltaX = Math.abs(newX - dragCornerOriginX.value);
      const deltaY = Math.abs(newY - dragCornerOriginY.value);
      if (deltaX >= deltaY) {
        newY = dragCornerOriginY.value; // 锁定水平移动
      } else {
        newX = dragCornerOriginX.value; // 锁定垂直移动
      }
    }

    // 更新拐点坐标
    const updatedNodes = [...path.nodes];
    updatedNodes[dragCornerIndex.value] = { x: newX, y: newY };

    // 通知父组件更新路径
    emit("update-component-position", {
      id: dragPathId.value,
      nodes: updatedNodes,
    });

    // 检查是否需要扩展画布
    checkAndExpandCanvas(newX, newY, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

    drawGrid();
    return;
  }

  // AGV 路径模式且已选中起点站点：更新临时预览点
  if (agvPathMode.value && agvStartNode.value) {
    const nodeX = snapToNearestGridLine(pos.x);
    const nodeY = snapToNearestGridLine(pos.y);
    tempAGVPoint.value = {
      x: Math.max(0, nodeX),
      y: Math.max(0, nodeY)
    };
    drawGrid();
    return;
  }

  // 连接线模式且已选中第一个控件：更新临时连接线终点
  if (connectionLineMode.value && firstComponent.value) {
    tempLineEnd.value = { x: pos.x, y: pos.y };
    drawGrid();
    return;
  }

  // 拖拽已放置控件：控件跟随鼠标，对齐到小网格
  if (dragging.value && dragId.value) {
    const draggedComponent = props.placedComponents.find((c) => c.id === dragId.value);
    if (!draggedComponent) return;

    // 保持按下时的抓取点，位置对齐到小网格，避免控件跳动
    let newX = snapToSmallGrid(pos.x - dragOffsetX.value);
    let newY = snapToSmallGrid(pos.y - dragOffsetY.value);

    // 站点需要对齐到网格线交点（而非网格格子）
    if (draggedComponent.type === "node") {
      newX = snapToNearestGridLine(pos.x);
      newY = snapToNearestGridLine(pos.y);
    }

    // 不允许拖到负坐标
    newX = Math.max(0, newX);
    newY = Math.max(0, newY);

    // 按住 Shift：锁定到位移较大的主方向（水平或垂直）
    if (e.shiftKey) {
      const deltaX = Math.abs(newX - dragOriginX.value);
      const deltaY = Math.abs(newY - dragOriginY.value);
      if (deltaX >= deltaY) {
        newY = dragOriginY.value; // 锁定水平移动
      } else {
        newX = dragOriginX.value; // 锁定垂直移动
      }
    }

    dragMoved.value = true;

    // 通知父组件更新位置（单一数据源），watch 会触发重绘
    emit("update-component-position", { id: dragId.value, x: newX, y: newY });

    // 控件被拖近边缘时扩展画布
    const size = draggedComponent.type === "node" ? NODE_SIZE : LARGE_GRID_SIZE;
    checkAndExpandCanvas(newX, newY, size, size);
    return;
  }

  const anchor = clampCursorToGrid(
    snapToNearestGridLine(pos.x),
    snapToNearestGridLine(pos.y),
  );
  cursorX.value = anchor.x;
  cursorY.value = anchor.y;

  showCursor.value = shouldShowCustomCursor.value;

  if (showCursor.value) {
    drawGrid();
  }
};

const endDrag = () => {
  // 仅在发生过实际移动时输出日志（纯点击选中不记录）
  if (dragMoved.value && dragId.value) {
    const moved = props.placedComponents.find(
      (component) => component.id === dragId.value,
    );
    if (moved) {
      // 计算中心点坐标（小网格为单位，整数）
      const halfW = moved.width / 2;
      const halfH = moved.height / 2;
      const fromCX = Math.round((dragOriginX.value + halfW) / SMALL_GRID_SIZE);
      const fromCY = Math.round((dragOriginY.value + halfH) / SMALL_GRID_SIZE);
      const toCX   = Math.round((moved.x + halfW) / SMALL_GRID_SIZE);
      const toCY   = Math.round((moved.y + halfH) / SMALL_GRID_SIZE);

      // 中心点物理坐标（米，去尾零）
      const fmt = (v) => String(+v.toPrecision(6));
      const fromMx = fmt(fromCX * settings.metersPerGrid);
      const fromMy = fmt(fromCY * settings.metersPerGrid);
      const toMx   = fmt(toCX   * settings.metersPerGrid);
      const toMy   = fmt(toCY   * settings.metersPerGrid);

      emit(
        "add-log",
        `移动对象，编号：${getComponentLabel(moved)}` +
        `，中心点像素坐标：(${fromCX}, ${fromCY}) → (${toCX}, ${toCY})` +
        `，中心点物理坐标：(${fromMx} m, ${fromMy} m) → (${toMx} m, ${toMy} m)`,
      );
    }
  }

  dragging.value = false;
  dragId.value = null;
  dragMoved.value = false;
};

const handleMouseUp = () => {
  // 结束拐点拖拽
  if (draggingCorner.value) {
    const path = props.placedComponents.find((c) => c.id === dragPathId.value);
    if (path && dragCornerIndex.value !== null) {
      const corner = path.nodes[dragCornerIndex.value];
      const originX = dragCornerOriginX.value;
      const originY = dragCornerOriginY.value;

      // 如果拐点位置发生了变化，输出日志
      if (corner.x !== originX || corner.y !== originY) {
        const fromCX = Math.round(originX / SMALL_GRID_SIZE);
        const fromCY = Math.round(originY / SMALL_GRID_SIZE);
        const toCX = Math.round(corner.x / SMALL_GRID_SIZE);
        const toCY = Math.round(corner.y / SMALL_GRID_SIZE);

        const fmt = (v) => String(+v.toPrecision(6));
        const fromMx = fmt(fromCX * settings.metersPerGrid);
        const fromMy = fmt(fromCY * settings.metersPerGrid);
        const toMx = fmt(toCX * settings.metersPerGrid);
        const toMy = fmt(toCY * settings.metersPerGrid);

        emit(
          "add-log",
          `移动拐点，路径：${getComponentLabel(path)}，拐点索引：${dragCornerIndex.value}` +
          `，像素坐标：(${fromCX}, ${fromCY}) → (${toCX}, ${toCY})` +
          `，物理坐标：(${fromMx} m, ${fromMy} m) → (${toMx} m, ${toMy} m)`,
        );
      }
    }

    draggingCorner.value = false;
    dragPathId.value = null;
    dragCornerIndex.value = null;
    return;
  }

  // 结束控件拖拽
  if (dragging.value) {
    endDrag();
  }
};

const handleMouseLeave = () => {
  // 鼠标离开画布时隐藏自定义光标
  mouseInsideCanvas.value = false;
  showCursor.value = false;

  // 鼠标离开画布时结束拖拽，避免状态残留
  if (dragging.value) {
    endDrag();
  }

  // 鼠标离开画布时结束拐点拖拽
  if (draggingCorner.value) {
    draggingCorner.value = false;
    dragPathId.value = null;
    dragCornerIndex.value = null;
  }

  // 鼠标离开时，清除连接线临时状态（但保留第一个控件的选择）
  if (connectionLineMode.value) {
    tempLineEnd.value = null;
  }

  // 鼠标离开时，清除 AGV 路径临时预览点
  if (agvPathMode.value) {
    tempAGVPoint.value = null;
  }

  // 重绘画布以移除光标
  drawGrid();
};

const handleMouseEnter = () => {
  // 鼠标进入画布
  mouseInsideCanvas.value = true;
};

// 画布容器滚动时，根据视口坐标重算内容坐标，更新网格高亮
const handleContainerScroll = () => {
  if (!shouldShowCustomCursor.value || !mouseInsideCanvas.value) {
    return;
  }

  const x =
    mouseViewportX.value -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollLeft;

  const y =
    mouseViewportY.value -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollTop;

  const anchor = clampCursorToGrid(
    snapToNearestGridLine(x),
    snapToNearestGridLine(y),
  );
  cursorX.value = anchor.x;
  cursorY.value = anchor.y;

  drawGrid();
};

// 暴露方法供父组件调用
defineExpose({
  checkAndExpandCanvas,
  canvasWidth,
  canvasHeight,
  SMALL_GRID_SIZE,
});

// 已放置控件或选中项变化时（含模型树的删除、选中），重绘画布
watch(
  () => [props.placedComponents, props.selectedId],
  () => {
    // 改名中的控件被删除（如模型树里点了×）时收起输入框，避免悬空
    if (
      editingId.value &&
      !props.placedComponents.some((item) => item.id === editingId.value)
    ) {
      editingId.value = null;
      editingText.value = "";
    }

    if (canvas.value) {
      drawGrid();
    }
  },
  { deep: true },
);

// Esc 取消连接线绘制（已点了起点时撤回起点，否则退出连接线模式）
// 或取消 AGV 路径绘制
const handleCanvasKeyDown = (e) => {
  if (e.key !== "Escape") return;

  if (connectionLineMode.value) {
    if (firstComponent.value) {
      firstComponent.value = null;
      tempLineEnd.value = null;
      emit("add-log", "连接线：已取消当前绘制");
      drawGrid();
    } else {
      // 未选起点时直接退出连接线模式，回到"选择"
      emit("placement-done");
    }
  }

  if (agvPathMode.value) {
    if (agvStartNode.value) {
      // 已选择起点站点，清空当前路径
      agvStartNode.value = null;
      agvPathPoints.value = [];
      tempAGVPoint.value = null;
      emit("add-log", "AGV 路径：已取消当前绘制");
      drawGrid();
    } else {
      // 未选择起点时直接退出 AGV 路径模式，回到"选择"
      emit("placement-done");
    }
  }
};

// 初始化
onMounted(() => {
  drawGrid();

  canvasContainer.value.addEventListener("scroll", handleContainerScroll);
  window.addEventListener("keydown", handleCanvasKeyDown);
});

onBeforeUnmount(() => {
  canvasContainer.value?.removeEventListener("scroll", handleContainerScroll);
  window.removeEventListener("keydown", handleCanvasKeyDown);
});
</script>

<style scoped>
.design-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #fefefe;
  overflow: hidden;
}

.canvas-container {
  flex: 1;
  overflow: auto;
  /* 内边距由 CONTAINER_PADDING 常量通过内联样式驱动，避免 JS 坐标换算与 CSS 不一致 */
  position: relative;
}

canvas {
  display: block;
  border: 1px solid #ffffff;
}

/* 名称标签改名输入框：覆盖在标签原位，字体与画布绘制保持一致 */
.label-editor {
  position: absolute;
  /* 字号/行高与 LABEL_FONT_SIZE 对齐，文字位置与原标签重合 */
  font: 12px sans-serif;
  line-height: 12px;
  height: 18px;
  /* 上下各留 2px 内边距凑出 18px 高度，文字仍落在原标签的基线上 */
  padding: 2px 4px;
  margin: -3px 0 0 0;
  box-sizing: border-box;
  text-align: center;
  color: #333333;
  background-color: #ffffff;
  border: 1px solid #2566fd;
  border-radius: 2px;
  outline: none;
}
</style>

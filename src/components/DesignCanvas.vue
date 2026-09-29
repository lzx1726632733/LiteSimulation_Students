<template>
  <div class="design-canvas">
    <div
      class="canvas-container"
      ref="canvasContainer"
      :style="{ padding: CONTAINER_PADDING + 'px' }"
    >
      <!-- Canvas 只覆盖视口；模型位置和尺寸始终以米保存。 -->
      <canvas
        ref="canvas"
        :style="{ cursor: cursorStyle }"
        tabindex="0"
        aria-label="设计画布：左键选择、拖动或框选控件，按住中键平移画布，滚轮缩放，移动步长 0.01 米，靠近控件中线或边缘自动对齐，Alt 暂停自动对齐"
        @pointerdown="handleMouseDown"
        @pointermove="handleMouseMove"
        @pointerup="handleMouseUp"
        @pointercancel="handlePointerCancel"
        @lostpointercapture="handlePointerCancel"
        @pointerleave="handleMouseLeave"
        @pointerenter="handleMouseEnter"
        @wheel.prevent="handleWheel"
        @auxclick.prevent
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

    <!-- 恢复全局视图；缩放使用滚轮，移动精度固定为 0.01m。 -->
    <div class="zoom-controls">
      <button
        class="zoom-btn"
        title="恢复全局缩放，显示全部控件"
        @click="resetZoom"
      >显示全部</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from "vue";
import { getComponentLabel } from "../utils/componentLabel.js";
import { alignBounds } from "../utils/alignment.js";
import { DEFAULT_STATION_SIZE, getStationType, getNextStationIndex, getComponentBounds, getComponentCenter } from "../utils/stations.js";
import { DEFAULT_PATH_WIDTH, getPathWidth, buildPathGeometry, pointOnPathSegment, tracePathGeometry, isPointInPathArea, getPathBounds } from "../utils/agvPath.js";
import { RESIZABLE_COMPONENT_TYPES, DEFAULT_COMPONENT_SHADOW_COLORS, DEFAULT_COMPONENT_SIZES } from "../utils/componentAppearance.js";

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
  selectedIds: {
    type: Array,
    default: () => [],
  },
});

// 定义 emit
const emit = defineEmits([
  "placement-done",
  "add-log",
  "component-placed",
  "select-component",
  "select-components",
  "update-component-position",
  "update-component-positions",
  "update-component-properties",
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

// 模型以米保存；视图比例、原点与固定移动步长相互独立。
const SNAP_STEP = 0.01;
const ALIGNMENT_THRESHOLD_PX = 6;
const alignmentGuides = ref([]);
const DEFAULT_PPM = 10;
const MIN_PPM = 0.001;
const MAX_PPM = 1000;
const SMALL_GRID_SIZE = 10; // 站点和放置光标的屏幕尺寸
const ppm = ref(DEFAULT_PPM);
// 视口左上角对应的物理坐标；X 向右、Y 向上，均允许负数。
const viewOrigin = ref({ x: 0, y: 0 });
const viewportWidth = ref(1);
const viewportHeight = ref(1);

// 网格只负责显示，自动选择 1、2、5 系列间距，最细显示 0.01m。
const metersPerCell = computed(() => {
  const target = Math.max(SNAP_STEP, 12 / ppm.value);
  const base = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].find((factor) => factor * base >= target) * base;
});

// 可调整尺寸控件的默认实际尺寸与阴影颜色共用 componentAppearance 配置。

// 网格与背景颜色
const GRID_COLOR = "#e0e0e0"; // 网格线颜色（浅灰，需与背景有足够对比度）
const BACKGROUND_COLOR = "#fefefe"; // 背景色

// 画布容器内边距（像素）。作为单一来源同时驱动 JS 坐标换算与 CSS 样式，避免两处不一致
const CONTAINER_PADDING = 0;

// 引用
const canvas = ref(null);
const canvasContainer = ref(null);

// 位图始终与视口同大，平移和缩放不会改变模型的可用范围。
const canvasWidth = computed(() => viewportWidth.value);
const canvasHeight = computed(() => viewportHeight.value);
const totalCanvasWidth = computed(() => viewportWidth.value);
const totalCanvasHeight = computed(() => viewportHeight.value);
const viewOffsetX = computed(() => -viewOrigin.value.x * ppm.value);
const viewOffsetY = computed(() => viewOrigin.value.y * ppm.value);
const panning = ref(false);
const selectionBox = ref(null);
const selectedIdSet = computed(() => new Set(
  props.selectedIds?.length ? props.selectedIds : props.selectedId ? [props.selectedId] : [],
));
const isComponentSelected = (id) => selectedIdSet.value.has(id);
const isMovableComponent = (component) =>
  component.type !== "connectionLine" && component.type !== "AGVpath";
let panStart = null;
let resizeObserver = null;

// 光标状态
const showCursor = ref(false);
// 放置锚点的世界坐标（米），以此点作为控件中心；优先对齐控件，否则按 0.01m 吸附。
const cursorX = ref(0);
const cursorY = ref(0);
const mouseInsideCanvas = ref(false);

// 拖拽已放置控件的状态
const dragging = ref(false); // 是否正在拖拽控件
const dragId = ref(null); // 正在拖拽的控件 id
// 鼠标按下点相对于控件左下角的偏移，保证拖拽时控件不会”跳”到鼠标处
const dragOffsetX = ref(0);
const dragOffsetY = ref(0);
// 控件在本次拖拽开始时的原始位置（Shift 锁定主方向时用作被锁定轴的固定值）
const dragOriginX = ref(0);
const dragOriginY = ref(0);
// 是否发生过实际移动（用于区分”点击选中”与”拖拽移动”，避免多余日志/更新）
const dragMoved = ref(false);
let dragOrigins = [];
let shiftClickId = null;
let keepSelectionOnClick = false;

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
  if (panning.value) return "grabbing";
  if (selectionBox.value) return "crosshair";
  if (dragging.value) return "move";
  if (connectionLineMode.value || agvPathMode.value) {
    return "crosshair";
  }
  return "default";
});

// 判断是否应该显示自定义光标
const shouldShowCustomCursor = computed(() => {
  return (
    mouseInsideCanvas.value &&
    !panning.value &&
    !selectionBox.value &&
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
    alignmentGuides.value = [];
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

// 绘制上下文与后备缓冲尺寸缓存。
//
// 给 canvas.width/height 赋值会让浏览器丢弃并重新分配整块像素缓冲区
// 并重置全部 context 状态，写 style.width/height 还会触发 layout。这些开销与"画什么"无关，
// 只取决于画布多大，所以从每帧的 drawGrid 里挪出来，仅在尺寸或设备像素比真正变化时执行。
let canvasCtx = null;
let backingWidth = 0; // 上次同步时的画布总宽（CSS 像素）
let backingHeight = 0;
let backingDpr = 0;

// 按需同步 canvas 后备缓冲尺寸。返回 2D context，画布不可用时返回 null。
// 尺寸未变时只重置变换矩阵，不碰 width/height
const syncCanvasSize = () => {
  const el = canvas.value;
  if (!el) return null;

  // context 取一次就够，反复 getContext 拿到的也是同一个对象
  if (!canvasCtx) canvasCtx = el.getContext("2d");

  const totalWidth = totalCanvasWidth.value;
  const totalHeight = totalCanvasHeight.value;
  const dpr = window.devicePixelRatio || 1;

  if (
    backingWidth !== totalWidth ||
    backingHeight !== totalHeight ||
    backingDpr !== dpr
  ) {
    // 后备缓冲按设备像素比放大，保证高 DPI 屏下线条不发虚
    el.width = totalWidth * dpr;
    el.height = totalHeight * dpr;
    // CSS 尺寸仍用逻辑像素，浏览器负责缩放显示
    el.style.width = totalWidth + "px";
    el.style.height = totalHeight + "px";

    backingWidth = totalWidth;
    backingHeight = totalHeight;
    backingDpr = dpr;
  }

  // 重建缓冲会清空变换矩阵，未重建时上一帧的 scale 还在，两种情况都要重设。
  // 直接给出最终矩阵，省掉 setTransform + scale 两步
  canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return canvasCtx;
};

// 按世界坐标绘制可见网格，平移时网格与控件一起移动。
const drawGridLines = (ctx) => {
  const step = metersPerCell.value;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  const startX = Math.ceil(viewOrigin.value.x / step);
  const endX = Math.floor((viewOrigin.value.x + canvasWidth.value / ppm.value) / step);
  const startY = Math.ceil((viewOrigin.value.y - canvasHeight.value / ppm.value) / step);
  const endY = Math.floor(viewOrigin.value.y / step);
  for (let cell = startX; cell <= endX; cell++) {
    const x = viewOffsetX.value + cell * step * ppm.value;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalCanvasHeight.value);
  }
  for (let cell = startY; cell <= endY; cell++) {
    const y = viewOffsetY.value - cell * step * ppm.value;
    ctx.moveTo(0, y);
    ctx.lineTo(totalCanvasWidth.value, y);
  }
  ctx.stroke();
};

// 合并到动画帧重绘视口，避免缩放时创建整张模型大小的位图。
const drawGridNow = () => {
  const ctx = syncCanvasSize();
  if (!ctx) return;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, totalCanvasWidth.value, totalCanvasHeight.value);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasWidth.value, canvasHeight.value);
  ctx.clip();
  drawGridLines(ctx);
  ctx.translate(viewOffsetX.value, viewOffsetY.value);
  drawPlacedComponents(ctx);
  drawOriginMarker(ctx);
  if (showCursor.value) drawCursor(ctx);
  drawAlignmentGuides(ctx);
  drawSelectionBox(ctx);
  ctx.restore();
};

// 标记实际原点 (0, 0)。箭头固定为屏幕上的短线。
const drawOriginMarker = (ctx) => {
  // 原点移出视口时不单独留下箭头，以免被误认为固定在屏幕上的方向标。
  if (
    viewOffsetX.value < 0 || viewOffsetX.value > canvasWidth.value ||
    viewOffsetY.value < 0 || viewOffsetY.value > canvasHeight.value
  ) return;

  const length = 40;
  const arrowSize = 6;
  const originColor = "#dc2626";
  const xColor = "#2563eb";
  const yColor = "#15803d";
  ctx.save();
  ctx.lineWidth = 1.5;

  // X 轴和箭头使用蓝色，Y 轴和箭头使用绿色。
  ctx.strokeStyle = xColor;
  ctx.fillStyle = xColor;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(length, 0);
  ctx.lineTo(length - arrowSize, -arrowSize / 2);
  ctx.lineTo(length - arrowSize, arrowSize / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = yColor;
  ctx.fillStyle = yColor;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -length);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -length);
  ctx.lineTo(-arrowSize / 2, -length + arrowSize);
  ctx.lineTo(arrowSize / 2, -length + arrowSize);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = originColor;
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("0", -5, -5);
  ctx.fillStyle = xColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("X", length + 5, 0);
  ctx.fillStyle = yColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Y", 0, -length - 5);
  ctx.restore();
};

// 重绘调度：把一帧内的多次重绘请求合并成一次。
//
// 原生 mousemove 在高精度鼠标上可达数百 Hz，远超屏幕刷新率，同步重绘出来的多数帧
// 会直接被丢弃。另外一次拖拽 mousemove 往往会请求两次重绘（处理函数显式调用一次，
// emit 改动父组件数据后 deep watch 又触发一次），合并后这类重复也一并消失。
let drawScheduled = false;
let rafId = 0;

// 请求一次重绘。同一帧内多次调用只会真正画一次
const drawGrid = () => {
  if (drawScheduled) return;
  drawScheduled = true;

  rafId = requestAnimationFrame(() => {
    drawScheduled = false;
    rafId = 0;
    drawGridNow();
  });
};

// 取消已排队但未执行的重绘（组件卸载时用，避免回调落在已销毁的画布上）
const cancelScheduledDraw = () => {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
  drawScheduled = false;
};

// 米 ↔ 像素换算。数据层存米，绘制时用 toPx 投影像素；反算用 toMeters
const toPx = (meters) => meters * ppm.value;
// 世界坐标 X 向右、Y 向上；矩形 x/y 是左下角，尺寸始终为正。
// 只转换位置的 Y，长度、文字和图标保持正常的屏幕方向。
const toScreenY = (y) => -toPx(y);
const toMeters = (px) => px / ppm.value;
// 米转显示字符串（去尾零），供日志与坐标显示使用
const fmtMeters = (m) => String(+m.toPrecision(6));

// 控件图标在屏幕上的最大尺寸（像素）。图标视觉大小固定，不随缩放/控件尺寸无限放大
const ICON_SIZE_PX = 32;

// 绘制单个非连接线控件（普通控件 / 站点 / AGV 路径）。
const drawSingleComponent = (ctx, component) => {
  // AGV 路径单独绘制
  if (component.type === "AGVpath") {
    drawAGVPath(ctx, component);
    return;
  }

  // 站点按实际尺寸绘制，并以类型颜色区分。
  if (component.type === "node") {
    drawNodeComponent(ctx, component);
    return;
  }

  // 控件矩形（世界坐标 → 像素）
  const px = toPx(component.x);
  const py = toScreenY(component.y + component.height);
  const pw = toPx(component.width);
  const ph = toPx(component.height);

  if (RESIZABLE_COMPONENT_TYPES.has(component.type)) {
    const shadowColor = component.shadowColor || DEFAULT_COMPONENT_SHADOW_COLORS[component.type];
    ctx.fillStyle = shadowColor;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = isComponentSelected(component.id) ? "#2566fd" : "rgba(100, 116, 139, 0.45)";
    ctx.lineWidth = isComponentSelected(component.id) ? 2 : 1;
    ctx.strokeRect(px, py, pw, ph);
  }

  // 选中的控件先绘制高亮底框（外扩 1px 的视觉高亮，不随缩放变化）
  if (isComponentSelected(component.id)) {
    ctx.strokeStyle = "#2566fd";
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 1, py - 1, pw + 2, ph + 2);
    ctx.fillStyle = "rgba(37, 102, 253, 0.08)";
    ctx.fillRect(px, py, pw, ph);
  }

  // 从缓存中获取图片
  const img = imageCache.get(component.icon);
  if (img && img.complete) {
    // 图标居中绘制，大小取固定值与控件像素尺寸的较小者，避免小控件上图标溢出
    const iconSize = Math.min(ICON_SIZE_PX, pw, ph);
    if (iconSize > 0) {
      ctx.drawImage(
        img,
        px + (pw - iconSize) / 2,
        py + (ph - iconSize) / 2,
        iconSize,
        iconSize,
      );
    }
  } else if (!imageCache.has(component.icon)) {
    // 图片未缓存，预加载
    preloadImage(component.icon).then(() => {
      // 图片加载完成后重绘
      drawGrid();
    });
  }

  // 在图片下方绘制控件名称（如：输入1）
  drawComponentLabel(ctx, component);
};

// 绘制已放置的控件
// 先画控件，再画连接线，保证连接线显示在矩形区域之上
const drawPlacedComponents = (ctx) => {
  // 标签包围盒每帧重算，避免控件删除/移动后留下过期的命中区域
  labelRects.clear();

  // 通道铺在设备与站点下方，避免遮住站点区域。
  props.placedComponents.filter((component) => component.type === "AGVpath")
    .forEach((component) => drawAGVPath(ctx, component));

  props.placedComponents.forEach((component) => {
    // 连接线在所有控件绘制完成后统一绘制
    if (component.type === "connectionLine" || component.type === "AGVpath") {
      return;
    }
    drawSingleComponent(ctx, component);
  });

  // 连接线置于控件矩形和图标之上，避免被设备类矩形遮挡
  props.placedComponents
    .filter((component) => component.type === "connectionLine")
    .forEach((line) => drawConnectionLine(ctx, line));

  // 绘制临时连接线（连接线模式且已选中第一个控件）
  if (connectionLineMode.value && firstComponent.value && tempLineEnd.value) {
    drawTempConnectionLine(ctx);
  }

  // 绘制临时 AGV 路径（AGV 路径模式且已选中起点站点）
  if (agvPathMode.value && agvStartNode.value && agvPathPoints.value.length > 0) {
    drawTempAGVPath(ctx);
  }
};

// 站点中心坐标保持不变，矩形宽高随视图比例缩放。
const drawNodeComponent = (ctx, component) => {
  const bounds = getComponentBounds(component);
  const style = getStationType(component);
  const x = toPx(bounds.x);
  const y = toScreenY(bounds.y + bounds.height);
  const width = toPx(bounds.width);
  const height = toPx(bounds.height);
  ctx.fillStyle = style.fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, width, height);

  if (isComponentSelected(component.id)) {
    ctx.strokeStyle = "#2566fd";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
  }
  drawComponentLabel(ctx, component);
};

// 在控件图片下方绘制名称标签，并记录其包围盒供双击改名使用
const drawComponentLabel = (ctx, component) => {
  const label = getComponentLabel(component);

  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#333333";

  const bounds = getComponentBounds(component);
  const centerX = toPx(bounds.x + bounds.width / 2);
  const labelY = toScreenY(bounds.y) + LABEL_GAP;

  // 用当前字体量出文本宽度，得到与绘制结果一致的包围盒。
  // labelRects 存世界坐标（米），供米域命中判定与输入框定位共用
  const textWidth = ctx.measureText(label).width;
  labelRects.set(component.id, {
    x: toMeters(centerX - textWidth / 2),
    y: -toMeters(labelY + LABEL_FONT_SIZE),
    width: toMeters(textWidth),
    height: toMeters(LABEL_FONT_SIZE),
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

// 解出一条连接线的两个端点（各自收缩到控件图标边缘）。
// 绘制与命中判定共用，保证"看到的线"和"点得到的线"完全一致；
// 内部把世界坐标（米）换算成像素，后续几何计算与绘制都工作在像素域
const resolveLineEndpoints = (line) => {
  const fromComp = props.placedComponents.find((c) => c.id === line.fromId);
  const toComp = props.placedComponents.find((c) => c.id === line.toId);
  if (!fromComp || !toComp) return null;

  const fromCenter = getComponentCenter(fromComp);
  const toCenter = getComponentCenter(toComp);
  const fromCenterX = toPx(fromCenter.x);
  const fromCenterY = toScreenY(fromCenter.y);
  const toCenterX = toPx(toCenter.x);
  const toCenterY = toScreenY(toCenter.y);

  const dirX = toCenterX - fromCenterX;
  const dirY = toCenterY - fromCenterY;

  // 图标边界（像素）：图标居中于控件矩形，大小为 ICON_SIZE_PX 与控件像素尺寸的较小者
  const createIconBounds = (comp, centerX, centerY) => {
    const pw = toPx(comp.width);
    const ph = toPx(comp.height);
    const size = Math.min(ICON_SIZE_PX, pw, ph);
    return {
      x: centerX - size / 2,
      y: centerY - size / 2,
      width: size,
      height: size,
    };
  };

  const fromIcon = createIconBounds(fromComp, fromCenterX, fromCenterY);
  const toIcon = createIconBounds(toComp, toCenterX, toCenterY);

  return {
    start: clipToComponentEdge(fromIcon, fromCenterX, fromCenterY, dirX, dirY),
    end: clipToComponentEdge(toIcon, toCenterX, toCenterY, -dirX, -dirY),
  };
};

// 绘制连接线（已放置的）
const drawConnectionLine = (ctx, line) => {
  const endpoints = resolveLineEndpoints(line);
  if (!endpoints) return;

  const geo = computeLineGeometry(endpoints.start, endpoints.end);
  if (!geo) return;

  // 选中状态高亮
  const isSelected = isComponentSelected(line.id);
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
  const center = getComponentCenter(from);
  const fromCenterX = toPx(center.x);
  const fromCenterY = toScreenY(center.y);
  const tip = { x: toPx(tempLineEnd.value.x), y: toScreenY(tempLineEnd.value.y) };

  // 图标边界（像素）：图标居中于控件矩形
  const pw = toPx(from.width);
  const ph = toPx(from.height);
  const iconSize = Math.min(ICON_SIZE_PX, pw, ph);
  const fromIcon = {
    x: fromCenterX - iconSize / 2,
    y: fromCenterY - iconSize / 2,
    width: iconSize,
    height: iconSize,
  };

  // 起点收缩到图标边缘；终点是鼠标位置，不收缩
  const start = clipToComponentEdge(
    fromIcon,
    fromCenterX,
    fromCenterY,
    tip.x - fromCenterX,
    tip.y - fromCenterY,
  );

  // 高亮起点控件，提示当前正从它拉线（线可能很短，先画框保证一直可见）
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeRect(toPx(from.x) - 1, toScreenY(from.y + from.height) - 1, pw + 2, ph + 2);

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
const AGV_PATH_COLOR = "#059669";
const AGV_PATH_COLOR_SELECTED = "#047857";
const CORNER_RADIUS = 5;
const CORNER_GRAB_MARGIN = 3;

const drawAGVPath = (ctx, pathComponent, preview = false) => {
  const segments = buildPathGeometry(pathComponent);
  if (!segments.length) return;
  const selected = !preview && isComponentSelected(pathComponent.id);
  const width = toPx(getPathWidth(pathComponent));
  ctx.save();
  if (preview) ctx.globalAlpha = 0.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  tracePathGeometry(ctx, segments, ppm.value);
  ctx.strokeStyle = selected ? AGV_PATH_COLOR_SELECTED : AGV_PATH_COLOR;
  ctx.lineWidth = width + (selected ? 4 : 2);
  ctx.stroke();
  ctx.strokeStyle = selected ? "#a7f3d0" : "#d1fae5";
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.fillStyle = "#047857";
  for (const segment of segments) {
    const lengthPx = toPx(segment.length);
    const arrowLength = Math.min(16, width * 0.9, lengthPx * 0.45);
    if (arrowLength < 2) continue;
    const count = Math.min(150, Math.max(1, Math.floor(lengthPx / 100)));
    for (let i = 0; i < count; i++) {
      const point = pointOnPathSegment(segment, (i + 0.5) / count);
      const x = toPx(point.x), y = toScreenY(point.y);
      if (x + viewOffsetX.value < -20 || x + viewOffsetX.value > canvasWidth.value + 20 ||
          y + viewOffsetY.value < -20 || y + viewOffsetY.value > canvasHeight.value + 20) continue;
      const ux = point.ux, uy = -point.uy;
      const half = arrowLength / 2, side = Math.min(width * 0.3, arrowLength * 0.4);
      ctx.beginPath();
      ctx.moveTo(x + ux * half, y + uy * half);
      ctx.lineTo(x - ux * half - uy * side, y - uy * half + ux * side);
      ctx.lineTo(x - ux * half + uy * side, y - uy * half - ux * side);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (selected) {
    for (const point of pathComponent.nodes.slice(1, -1)) {
      ctx.beginPath();
      ctx.arc(toPx(point.x), toScreenY(point.y), CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = AGV_PATH_COLOR_SELECTED;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  ctx.restore();
  if (!preview) {
    let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
    for (const segment of segments) {
      if (remaining <= segment.length) {
        drawAGVPathLabel(ctx, pathComponent, pointOnPathSegment(segment, remaining / segment.length));
        break;
      }
      remaining -= segment.length;
    }
  }
};

const drawAGVPathLabel = (ctx, pathComponent, midNode) => {
  const label = getComponentLabel(pathComponent);

  ctx.font = LABEL_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#333333";

  // 标签显示在路径中点右上方
  const labelX = toPx(midNode.x) + 8;
  const labelY = toScreenY(midNode.y) - toPx(getPathWidth(pathComponent)) / 2 - 8;

  // 记录包围盒（世界坐标，米）供双击改名使用
  const textWidth = ctx.measureText(label).width;
  labelRects.set(pathComponent.id, {
    x: toMeters(labelX),
    y: -toMeters(labelY + LABEL_FONT_SIZE / 2),
    width: toMeters(textWidth),
    height: toMeters(LABEL_FONT_SIZE),
  });

  // 正在改名的标签由 HTML 输入框接管显示
  if (editingId.value === pathComponent.id) return;

  ctx.fillText(label, labelX, labelY);
};

// 绘制过程中预览相同宽度的通道区域和方向。
const drawTempAGVPath = (ctx) => {
  if (!agvStartNode.value || !agvPathPoints.value.length) return;
  const nodes = [...agvPathPoints.value];
  if (tempAGVPoint.value) nodes.push(tempAGVPoint.value);
  drawAGVPath(ctx, { nodes, pathWidth: DEFAULT_PATH_WIDTH }, true);
  ctx.save();
  ctx.strokeStyle = AGV_PATH_COLOR;
  ctx.lineWidth = 2;
  const bounds = getComponentBounds(agvStartNode.value);
  ctx.strokeRect(toPx(bounds.x) - 1, toScreenY(bounds.y + bounds.height) - 1,
    toPx(bounds.width) + 2, toPx(bounds.height) + 2);
  ctx.restore();
};

const drawCursor = (ctx) => {
  const cx = toPx(cursorX.value);
  const cy = toScreenY(cursorY.value);
  {
    const size = DEFAULT_COMPONENT_SIZES[props.activeControl?.type] || { width: 3, height: 3 };
    const width = toPx(size.width);
    const height = toPx(size.height);
    ctx.save();
    const station = props.activeControl?.type === "node" ? getStationType(props.activeControl) : null;
    ctx.fillStyle = station?.fill || "rgba(37, 99, 235, 0.06)";
    ctx.strokeStyle = station?.color || "#2563eb";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(cx - width / 2, cy - height / 2, width, height);
    ctx.strokeRect(cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
  }
  const half = SMALL_GRID_SIZE / 2;
  const left = cx - half;
  const top = cy - half;

  // 半透明黄色填充
  ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
  ctx.fillRect(left, top, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

  // 黄色边框
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, SMALL_GRID_SIZE, SMALL_GRID_SIZE);

  // 交点十字标记，强调锚点在线上而非格子中心
  ctx.beginPath();
  ctx.moveTo(cx - half, cy);
  ctx.lineTo(cx + half, cy);
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx, cy + half);
  ctx.stroke();
};

// 视口像素与世界坐标转换，所有命中检测、放置和拖动共用。
const getCanvasMousePosition = (e) => {
  const rect = canvas.value.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - viewOffsetX.value) / ppm.value,
    y: (viewOffsetY.value - (e.clientY - rect.top)) / ppm.value,
  };
};

// 普通移动步长为 0.01m；对齐控件时使用其精确坐标。
const snapToStep = (value) =>
  Number((Math.round(value / SNAP_STEP) * SNAP_STEP).toFixed(10));

// 对齐按屏幕距离判断，避免缩放后吸附范围过大或难以触发。
const alignToComponents = (raw, fallback, excludedIds, event, lockedAxis = null) => {
  alignmentGuides.value = [];
  if (event.altKey) return fallback;
  const margin = ALIGNMENT_THRESHOLD_PX / ppm.value;
  const viewportWidth = canvasWidth.value / ppm.value;
  const viewportHeight = canvasHeight.value / ppm.value;
  const targets = props.placedComponents
    .filter((item) => isMovableComponent(item) && !excludedIds.has(item.id))
    .map((item) => ({ id: item.id, ...getComponentBounds(item) }))
    .filter((item) =>
    Number.isFinite(item.x) && Number.isFinite(item.y) &&
    item.x + (item.width ?? 0) >= viewOrigin.value.x - margin &&
    item.x <= viewOrigin.value.x + canvasWidth.value / ppm.value + margin &&
    item.y + (item.height ?? 0) >= viewOrigin.value.y - canvasHeight.value / ppm.value - margin &&
    item.y <= viewOrigin.value.y + margin
  );
  targets.push(
    { id: "axis-x", axes: ["y"], anchorKinds: ["edge", "center"], x: viewOrigin.value.x, y: 0, width: viewportWidth, height: 0 },
    { id: "axis-y", axes: ["x"], anchorKinds: ["edge", "center"], x: 0, y: viewOrigin.value.y - viewportHeight, width: 0, height: viewportHeight },
  );
  if (viewOrigin.value.x <= margin && viewOrigin.value.x + viewportWidth >= -margin &&
    viewOrigin.value.y - viewportHeight <= margin && viewOrigin.value.y >= -margin) {
    targets.push({ id: "origin", anchorKinds: ["center"], x: 0, y: 0, width: 0, height: 0 });
  }
  const result = alignBounds(raw, fallback, targets, margin, lockedAxis);
  alignmentGuides.value = result.guides;
  return result;
};

// 预览和落点使用同一套计算，吸附后的中心位置就是实际放置位置。
const getPlacementAnchor = (position, event) => {
  const size = DEFAULT_COMPONENT_SIZES[props.activeControl?.type] || { width: 3, height: 3 };
  const raw = { x: position.x - size.width / 2, y: position.y - size.height / 2, ...size };
  const fallback = {
    ...size, x: snapToStep(position.x) - size.width / 2, y: snapToStep(position.y) - size.height / 2,
  };
  const aligned = alignToComponents(raw, fallback, new Set(), event);
  return { x: aligned.x + size.width / 2, y: aligned.y + size.height / 2 };
};

const drawAlignmentGuides = (ctx) => {
  if (!alignmentGuides.value.length) return;
  ctx.save();
  ctx.strokeStyle = "#db2777";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const margin = toMeters(8);
  ctx.beginPath();
  for (const guide of alignmentGuides.value) {
    if (guide.axis === "x") {
      ctx.moveTo(toPx(guide.value), toScreenY(guide.from - margin));
      ctx.lineTo(toPx(guide.value), toScreenY(guide.to + margin));
    } else {
      ctx.moveTo(toPx(guide.from - margin), toScreenY(guide.value));
      ctx.lineTo(toPx(guide.to + margin), toScreenY(guide.value));
    }
  }
  ctx.stroke();
  ctx.restore();
};

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

    const bounds = getComponentBounds(component);
    // 包括站点在内，按实际矩形区域命中。
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
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

  // 检测拐点（不包括起点和终点站点）。抓取余量是像素，换算成米
  const grabMeters = toMeters(CORNER_RADIUS + CORNER_GRAB_MARGIN);
  for (let i = 1; i < selectedPath.nodes.length - 1; i++) {
    const node = selectedPath.nodes[i];
    const dist = Math.hypot(x - node.x, y - node.y);
    if (dist <= grabMeters) {
      return { pathId: selectedPath.id, cornerIndex: i };
    }
  }

  return null;
};

// 命中测试：返回名称标签落在鼠标坐标下的控件（后放置的优先），无则返回 null。
// 包围盒来自绘制时记录的 labelRects（米），外扩 LABEL_HIT_PADDING 便于点中
const hitTestLabel = (x, y) => {
  const pad = toMeters(LABEL_HIT_PADDING);

  for (let i = props.placedComponents.length - 1; i >= 0; i -= 1) {
    const component = props.placedComponents[i];
    const rect = labelRects.get(component.id);
    if (!rect) continue;

    if (
      x >= rect.x - pad &&
      x <= rect.x + rect.width + pad &&
      y >= rect.y - pad &&
      y <= rect.y + rect.height + pad
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

  // 几何与线宽都在像素域，把传入的世界坐标（米）转成像素再判定
  const px = toPx(x);
  const py = toScreenY(y);

  // 线体：容差取半线宽 + 抓取余量。选中时线更粗，用较大的那个保证一致手感
  const halfWidth = LINE_WIDTH_SELECTED / 2;
  const tolerance = halfWidth + LINE_GRAB_MARGIN;

  // 用 start→end 整段做距离判定，顺带覆盖箭头的中轴区域
  if (
    distanceToSegment(px, py, geo.start.x, geo.start.y, geo.end.x, geo.end.y) <=
    tolerance
  ) {
    return true;
  }

  // 箭头两侧比线宽得多，单靠中轴距离判不到，补一次三角形内部判定
  return isPointInArrow(px, py, geo);
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

// 按真实直线和圆弧区域命中，同时保留少量屏幕抓取余量。
const hitTestAGVPath = (path, x, y) =>
  isPointInPathArea(path, x, y, toMeters(LINE_GRAB_MARGIN));

const labelEditorStyle = computed(() => {
  const rect = editingId.value ? labelRects.get(editingId.value) : null;
  if (!rect) return { display: "none" };

  // 文字很短时输入框会窄到没法点，给一个下限；同时留出光标和左右内边距的余量
  const width = Math.max(toPx(rect.width) + 16, 64);
  const centerX = toPx(rect.x + rect.width / 2);

  return {
    left: `${viewOffsetX.value + centerX - width / 2}px`,
    top: `${viewOffsetY.value + toScreenY(rect.y + rect.height)}px`,
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
    pathWidth: DEFAULT_PATH_WIDTH,
    nodes: [...agvPathPoints.value], // 深拷贝所有路径点（包括起点站点、中间拐点、终点站点）
    // 每两个点之间是一条线段
    segments: agvPathPoints.value.slice(1).map(() => ({ type: "line", radius: 0 })),
    // 每个拐点的圆角半径（不包括起点和终点站点）
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

// 中键按住拖动平移，左键始终用于选择和编辑。
const startPan = (e) => {
  e.preventDefault();
  panning.value = true;
  panStart = { x: e.clientX, y: e.clientY, origin: { ...viewOrigin.value } };
  showCursor.value = false;
  drawGrid();
};

const startSelectionBox = (e, position) => {
  e.preventDefault();
  const initialIds = [...selectedIdSet.value];
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  selectionBox.value = {
    start: position, end: position, moved: false,
    initialIds, baseIds: additive ? initialIds : [],
  };
  if (!additive) emit("select-component", null);
  showCursor.value = false;
  drawGrid();
};

const updateSelectionBox = (position) => {
  const box = selectionBox.value;
  if (!box) return;
  box.end = position;
  if (Math.max(Math.abs(position.x - box.start.x), Math.abs(position.y - box.start.y)) * ppm.value >= 3) {
    box.moved = true;
  }
  if (!box.moved) return;
  const minX = Math.min(box.start.x, position.x);
  const maxX = Math.max(box.start.x, position.x);
  const minY = Math.min(box.start.y, position.y);
  const maxY = Math.max(box.start.y, position.y);
  const containsPoint = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  // 连接线按可见线段判断；AGV 通道需完整落入选框才能选中。
  const enclosed = props.placedComponents.filter((item) => {
    if (item.type === "connectionLine") {
      const endpoints = resolveLineEndpoints(item);
      if (!endpoints || !computeLineGeometry(endpoints.start, endpoints.end)) return false;
      return [endpoints.start, endpoints.end].every((point) =>
        containsPoint(toMeters(point.x), -toMeters(point.y))
      );
    }
    if (item.type === "AGVpath") {
      const bounds = getPathBounds(item);
      return bounds && containsPoint(bounds.minX, bounds.minY) && containsPoint(bounds.maxX, bounds.maxY);
    }
    const bounds = getComponentBounds(item);
    return isMovableComponent(item) && containsPoint(bounds.x, bounds.y) &&
      containsPoint(bounds.x + bounds.width, bounds.y + bounds.height);
  }).map((item) => item.id);
  const ids = [...new Set([...box.baseIds, ...enclosed])];
  if (ids.length !== selectedIdSet.value.size || ids.some((id) => !isComponentSelected(id))) {
    emit("select-components", ids);
  }
  drawGrid();
};

const cancelSelectionBox = () => {
  if (!selectionBox.value) return;
  const ids = selectionBox.value.initialIds;
  selectionBox.value = null;
  emit("select-components", ids);
  drawGrid();
};

const drawSelectionBox = (ctx) => {
  const box = selectionBox.value;
  if (!box?.moved) return;
  const x = toPx(Math.min(box.start.x, box.end.x));
  const y = toScreenY(Math.max(box.start.y, box.end.y));
  const width = toPx(Math.abs(box.end.x - box.start.x));
  const height = toPx(Math.abs(box.end.y - box.start.y));
  ctx.save();
  ctx.fillStyle = "rgba(37, 99, 235, 0.10)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
};

const toggleComponentSelection = (id) => {
  const ids = [...selectedIdSet.value];
  emit("select-components", isComponentSelected(id) ? ids.filter((selected) => selected !== id) : [...ids, id]);
};

// 鼠标事件处理
const handleMouseDown = async (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  if (panning.value || selectionBox.value || dragging.value || draggingCorner.value) return;
  alignmentGuides.value = [];
  // 点击画布先结束文字编辑，避免聚焦引发 blur 后误放置新控件。
  if (editingId.value) {
    commitLabelEdit();
    return;
  }
  const rect = canvas.value.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientY < rect.top) return;
  canvas.value.focus({ preventScroll: true });
  canvas.value.setPointerCapture(e.pointerId);
  if (e.button === 1) {
    startPan(e);
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
    const pointX = snapToStep(pos.x);
    const pointY = snapToStep(pos.y);

    const finalX = pointX;
    const finalY = pointY;

    // 添加拐点到路径（世界坐标，米）
    agvPathPoints.value.push({ x: finalX, y: finalY });
    emit("add-log", `AGV 路径：添加拐点 (${fmtMeters(finalX)}, ${fmtMeters(finalY)}) m`);

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

    if (hit.type === "node") {
      emit("add-log", "连接线：不能连接站点，请使用 AGV 路径连接站点");
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

  // 选择模式：左键拖动控件，空白处开始框选。
  if (!shouldShowCustomCursor.value) {
    const pos = getCanvasMousePosition(e);

    // 优先检测是否点击了 AGV 路径的拐点
    const cornerHit = hitTestAGVCorner(pos.x, pos.y);
    if (cornerHit && !e.shiftKey) {
      // 开始拖拽拐点
      draggingCorner.value = true;
      dragPathId.value = cornerHit.pathId;
      dragCornerIndex.value = cornerHit.cornerIndex;

      const path = props.placedComponents.find((c) => c.id === cornerHit.pathId);
      const corner = path.nodes[cornerHit.cornerIndex];
      dragCornerOriginX.value = corner.x;
      dragCornerOriginY.value = corner.y;
      dragOffsetX.value = pos.x - corner.x;
      dragOffsetY.value = pos.y - corner.y;

      return;
    }

    const hit = cornerHit
      ? props.placedComponents.find((item) => item.id === cornerHit.pathId)
      : hitTestComponent(pos.x, pos.y);

    // 点在名称标签上：只选中不拖拽。双击改名的第一次 mousedown 会走到这里，
    // 若按"空白处"处理会先把控件取消选中，标签闪一下再进输入框
    if (!hit) {
      const labelHit = hitTestLabel(pos.x, pos.y);
      if (labelHit) {
        if (e.shiftKey) toggleComponentSelection(labelHit.id);
        else emit("select-component", labelHit.id);
        return;
      }
    }

    if (!hit) {
      startSelectionBox(e, pos);
      return;
    }

    // 按下已选控件时保留整组选中，供随后一起拖动；单击松开则选中该控件。
    const wasSelected = isComponentSelected(hit.id);
    const dragIds = wasSelected ? [...selectedIdSet.value]
      : e.shiftKey ? [...selectedIdSet.value, hit.id] : [hit.id];
    if (e.shiftKey && !isMovableComponent(hit)) {
      toggleComponentSelection(hit.id);
      return;
    }
    keepSelectionOnClick = Boolean(e.shiftKey);
    // Shift 单击已选对象时松开后取消选择；实际拖动时仍保留多选和方向锁定。
    shiftClickId = e.shiftKey && wasSelected ? hit.id : null;
    if (!wasSelected) {
      if (e.shiftKey) emit("select-components", dragIds);
      else emit("select-component", hit.id);
    }

    // 连接线和 AGV 路径不能拖拽，其他控件（包括站点）都可以拖拽
    if (hit && hit.type !== "connectionLine" && hit.type !== "AGVpath") {
      // 记录拖拽初始状态：命中控件、按下点相对控件左下角的偏移、原始位置
      dragging.value = true;
      dragId.value = hit.id;
      dragOffsetX.value = pos.x - hit.x;
      dragOffsetY.value = pos.y - hit.y;
      dragOriginX.value = hit.x;
      dragOriginY.value = hit.y;
      dragMoved.value = false;
      dragOrigins = props.placedComponents
        .filter((item) => dragIds.includes(item.id) && isMovableComponent(item))
        .map((item) => ({ id: item.id, type: item.type, x: item.x, y: item.y, bounds: getComponentBounds(item) }));
    } else {
      emit("select-component", hit.id);
    }
    return;
  }

  // 使用点击时的世界坐标，平移或恢复全局视图后无需先移动鼠标。
  const position = getCanvasMousePosition(e);
  const anchor = getPlacementAnchor(position, e);
  const anchorX = anchor.x;
  const anchorY = anchor.y;

  // 站点放置在网格线交点上（不偏移，直接使用锚点坐标）
  if (props.activeControl.type === "node") {
    const finalX = anchorX;
    const finalY = anchorY;

    // 四种站点分别编号。
    const station = getStationType(props.activeControl);
    const index = getNextStationIndex(props.placedComponents, station.value);

    // 生成稳定唯一 id
    const id = createComponentId();

    // 站点的 x/y 继续保存中心，宽高保存实际占地区域。
    emit("component-placed", {
      id,
      type: props.activeControl.type,
      name: station.label,
      icon: props.activeControl.icon,
      tabId: props.activeControl.tabId,
      index,
      x: finalX,
      y: finalY,
      width: DEFAULT_STATION_SIZE.width,
      height: DEFAULT_STATION_SIZE.height,
      stationType: station.value,
    });

    // 输出日志
    emit(
      "add-log",
      `新建对象，类型：${station.label}，编号：${station.label}${index}`,
    );

    // 通知父组件放置完成，重置为"选择"状态
    emit("placement-done");

    // prop 变更是异步的，立即手动隐藏游标并重绘，避免黄框残留
    showCursor.value = false;
    alignmentGuides.value = [];
    drawGrid();
    return;
  }

  // 其他控件：由中心反推左下角（默认真实尺寸，米）
  const defaultSize =
    DEFAULT_COMPONENT_SIZES[props.activeControl.type] || { width: 3, height: 3 };
  const componentX = anchorX - defaultSize.width / 2;
  const componentY = anchorY - defaultSize.height / 2;

  const finalX = componentX;
  const finalY = componentY;

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
    width: defaultSize.width,
    height: defaultSize.height,
    shadowColor: DEFAULT_COMPONENT_SHADOW_COLORS[props.activeControl.type],
  });

  // 输出日志：新建对象，类型：<type>，编号：<name><序号>
  emit(
    "add-log",
    `新建对象，类型：${props.activeControl.type}，编号：${props.activeControl.name}${index}`,
  );

  // 通知父组件放置完成，重置为"选择"状态
  emit("placement-done");

  // prop 变更是异步的，立即手动隐藏游标并重绘，避免黄框残留
  // placedComponents 更新后会由 watch 触发重绘
  showCursor.value = false;
  alignmentGuides.value = [];
  drawGrid();
};

const handleMouseMove = (e) => {
  alignmentGuides.value = [];
  if (panning.value && panStart) {
    viewOrigin.value = {
      x: panStart.origin.x - (e.clientX - panStart.x) / ppm.value,
      y: panStart.origin.y + (e.clientY - panStart.y) / ppm.value,
    };
    drawGrid();
    return;
  }
  const pos = getCanvasMousePosition(e);
  if (selectionBox.value) {
    updateSelectionBox(pos);
    return;
  }

  // 拖拽 AGV 路径拐点：拐点跟随鼠标，对齐到小网格线交点
  if (draggingCorner.value && dragPathId.value !== null && dragCornerIndex.value !== null) {
    const path = props.placedComponents.find((c) => c.id === dragPathId.value);
    if (!path || !path.nodes) return;

    // 对齐到小网格线交点
    let newX = Number((dragCornerOriginX.value +
      snapToStep(pos.x - dragOffsetX.value - dragCornerOriginX.value)).toFixed(10));
    let newY = Number((dragCornerOriginY.value +
      snapToStep(pos.y - dragOffsetY.value - dragCornerOriginY.value)).toFixed(10));

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

    drawGrid();
    return;
  }

  // AGV 路径模式且已选中起点站点：更新临时预览点
  if (agvPathMode.value && agvStartNode.value) {
    const station = hitTestComponent(pos.x, pos.y);
    const nodeX = station?.type === "node" ? station.x : snapToStep(pos.x);
    const nodeY = station?.type === "node" ? station.y : snapToStep(pos.y);
    tempAGVPoint.value = {
      x: nodeX,
      y: nodeY
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

    // 相对于拖动起点按 0.01m 移动，保留抓取偏移，避免已有控件开始拖动时跳动。
    const rawX = pos.x - dragOffsetX.value;
    const rawY = pos.y - dragOffsetY.value;
    let newX = Number((dragOriginX.value +
      snapToStep(rawX - dragOriginX.value)).toFixed(10));
    let newY = Number((dragOriginY.value +
      snapToStep(rawY - dragOriginY.value)).toFixed(10));

    // 按住 Shift：锁定到位移较大的主方向（水平或垂直）
    let lockedAxis = null;
    if (e.shiftKey) {
      const deltaX = Math.abs(newX - dragOriginX.value);
      const deltaY = Math.abs(newY - dragOriginY.value);
      if (deltaX >= deltaY) {
        newY = dragOriginY.value; // 锁定水平移动
        lockedAxis = "y";
      } else {
        newX = dragOriginX.value; // 锁定垂直移动
        lockedAxis = "x";
      }
    }

    // 对整组外接矩形吸附，所有成员始终使用同一位移。
    const minX = Math.min(...dragOrigins.map((item) => item.bounds.x));
    const minY = Math.min(...dragOrigins.map((item) => item.bounds.y));
    const size = {
      width: Math.max(...dragOrigins.map((item) => item.bounds.x + item.bounds.width)) - minX,
      height: Math.max(...dragOrigins.map((item) => item.bounds.y + item.bounds.height)) - minY,
    };
    const aligned = alignToComponents(
      { ...size, x: minX + rawX - dragOriginX.value, y: minY + rawY - dragOriginY.value },
      { ...size, x: minX + newX - dragOriginX.value, y: minY + newY - dragOriginY.value },
      new Set(dragOrigins.map((item) => item.id)), e, lockedAxis,
    );
    newX = Number((dragOriginX.value + aligned.x - minX).toFixed(10));
    newY = Number((dragOriginY.value + aligned.y - minY).toFixed(10));

    if (newX === draggedComponent.x && newY === draggedComponent.y) {
      drawGrid();
      return;
    }
    dragMoved.value = true;

    // 整组使用相同位移，保留控件间距；父组件批量同步关联路径。
    if (dragOrigins.length > 1) {
      const dx = newX - dragOriginX.value;
      const dy = newY - dragOriginY.value;
      emit("update-component-positions", dragOrigins.map((origin) => ({
        id: origin.id,
        x: Number((origin.x + dx).toFixed(10)),
        y: Number((origin.y + dy).toFixed(10)),
      })));
    } else {
      emit("update-component-position", { id: dragId.value, x: newX, y: newY });
    }

    drawGrid();
    return;
  }

  const shouldShow = shouldShowCustomCursor.value;
  const anchor = shouldShow ? getPlacementAnchor(pos, e) : { x: snapToStep(pos.x), y: snapToStep(pos.y) };
  cursorX.value = anchor.x;
  cursorY.value = anchor.y;
  showCursor.value = shouldShow;

  drawGrid();
};

const endDrag = () => {
  if (dragMoved.value) {
    dragOrigins.forEach((origin) => {
      const moved = props.placedComponents.find((item) => item.id === origin.id);
      if (!moved || (moved.x === origin.x && moved.y === origin.y)) return;
      const halfW = moved.type === "node" ? 0 : (moved.width ?? 0) / 2;
      const halfH = moved.type === "node" ? 0 : (moved.height ?? 0) / 2;
      emit("add-log", `移动对象，编号：${getComponentLabel(moved)}` +
        `，中心点物理坐标：(${fmtMeters(origin.x + halfW)} m, ${fmtMeters(origin.y + halfH)} m)` +
        ` → (${fmtMeters(moved.x + halfW)} m, ${fmtMeters(moved.y + halfH)} m)`);
    });
  } else if (shiftClickId) {
    toggleComponentSelection(shiftClickId);
  } else if (dragId.value && !keepSelectionOnClick) {
    emit("select-component", dragId.value);
  }
  dragging.value = false;
  dragId.value = null;
  dragMoved.value = false;
  dragOrigins = [];
  shiftClickId = null;
  keepSelectionOnClick = false;
};

const handleMouseUp = (e) => {
  if (alignmentGuides.value.length) {
    alignmentGuides.value = [];
    drawGrid();
  }
  if (selectionBox.value) {
    if (Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY)) {
      updateSelectionBox(getCanvasMousePosition(e));
    }
    selectionBox.value = null;
    drawGrid();
  }
  panning.value = false;
  panStart = null;
  // 结束拐点拖拽
  if (draggingCorner.value) {
    const path = props.placedComponents.find((c) => c.id === dragPathId.value);
    if (path && dragCornerIndex.value !== null) {
      const corner = path.nodes[dragCornerIndex.value];
      const originX = dragCornerOriginX.value;
      const originY = dragCornerOriginY.value;

      // 如果拐点位置发生了变化，输出日志（坐标均为米）
      if (corner.x !== originX || corner.y !== originY) {
        emit(
          "add-log",
          `移动拐点，路径：${getComponentLabel(path)}，拐点索引：${dragCornerIndex.value}` +
          `，物理坐标：(${fmtMeters(originX)} m, ${fmtMeters(originY)} m) → (${fmtMeters(corner.x)} m, ${fmtMeters(corner.y)} m)`,
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

const handlePointerCancel = () => {
  cancelSelectionBox();
  handleMouseUp();
};

const handleMouseLeave = () => {
  alignmentGuides.value = [];
  // 鼠标离开画布时隐藏自定义光标
  mouseInsideCanvas.value = false;
  showCursor.value = false;

  // Pointer Capture 让拖动在画布外继续，松开时由 pointerup 统一结束。
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

// 缩放只改变视图，鼠标下面的世界坐标保持不变。
const handleWheel = (e) => {
  if (panning.value || selectionBox.value || dragging.value || draggingCorner.value) return;
  const rect = canvas.value.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (mx < 0 || my < 0) return;
  if (editingId.value) commitLabelEdit();
  const anchor = getCanvasMousePosition(e);
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvasHeight.value : 1);
  const nextPpm = Math.min(MAX_PPM, Math.max(MIN_PPM,
    ppm.value * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.0015)));
  ppm.value = nextPpm;
  viewOrigin.value = { x: anchor.x - mx / nextPpm, y: anchor.y + my / nextPpm };
  // 更新放置和路径预览，避免下一次点击使用缩放前的光标坐标。
  handleMouseMove(e);
};

// 按实际视口尺寸将世界原点放在正中央，启动与空场景复位共用。
const centerOrigin = () => {
  ppm.value = DEFAULT_PPM;
  viewOrigin.value = {
    x: -canvasWidth.value / (2 * ppm.value),
    y: canvasHeight.value / (2 * ppm.value),
  };
};

// 按指定对象的真实范围适配视图，全局恢复和模型树定位共用。
const fitComponentsInView = (components, maxScale = 100, minExtent = 3) => {
  const points = [];
  let labelPadding = 48;
  const ctx = canvas.value?.getContext("2d");
  if (ctx) ctx.font = LABEL_FONT;
  components.forEach((component) => {
    if (component.type === "connectionLine") return;
    if (component.type === "AGVpath") {
      const bounds = getPathBounds(component);
      if (bounds) points.push({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
    } else {
      const bounds = getComponentBounds(component);
      points.push({ x: bounds.x, y: bounds.y });
      points.push({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    }
    if (ctx) labelPadding = Math.max(labelPadding, ctx.measureText(getComponentLabel(component)).width + 24);
  });
  const validPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!validPoints.length) return false;
  const minX = Math.min(...validPoints.map((p) => p.x));
  const maxX = Math.max(...validPoints.map((p) => p.x));
  const minY = Math.min(...validPoints.map((p) => p.y));
  const maxY = Math.max(...validPoints.map((p) => p.y));
  const padX = Math.min(labelPadding, canvasWidth.value / 4);
  const padY = Math.min(64, canvasHeight.value / 4);
  ppm.value = Math.min(maxScale,
    (canvasWidth.value - padX * 2) / Math.max(minExtent, maxX - minX),
    (canvasHeight.value - padY * 2) / Math.max(minExtent, maxY - minY));
  viewOrigin.value = {
    x: (minX + maxX) / 2 - canvasWidth.value / (2 * ppm.value),
    y: (minY + maxY) / 2 + canvasHeight.value / (2 * ppm.value),
  };
  return true;
};

// 全局视图按所有控件与路径的实际范围适配，空场景恢复初始视图。
const resetZoom = () => {
  alignmentGuides.value = [];
  if (editingId.value) commitLabelEdit();
  if (!fitComponentsInView(props.placedComponents)) centerOrigin();
  showCursor.value = false;
  drawGrid();
};

// 模型树双击对象后定位到它；连接线使用两端控件的范围，路径包含全部拐点。
const focusComponent = (id) => {
  alignmentGuides.value = [];
  const component = props.placedComponents.find((item) => item.id === id);
  if (!component) return;
  if (editingId.value) commitLabelEdit();
  const targets = component.type === "connectionLine"
    ? props.placedComponents.filter((item) => item.id === component.fromId || item.id === component.toId)
    : [component];
  if (!fitComponentsInView(targets, MAX_PPM, 1)) return;
  showCursor.value = false;
  drawGrid();
};

defineExpose({ resetZoom, focusComponent });

// 已放置控件或选中项变化时（含模型树的删除、选中），重绘画布
watch(
  () => [props.placedComponents, props.selectedId, props.selectedIds],
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
  if (e.target?.closest?.("input, textarea, [contenteditable='true']")) return;
  if (e.key !== "Escape") return;
  if (selectionBox.value) {
    cancelSelectionBox();
    return;
  }

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

const handleWindowBlur = () => {
  handlePointerCancel();
  handleMouseLeave();
};

// 容器大小变化（包括侧栏/控制台拖动）只调整视口，不修改模型坐标。
onMounted(() => {
  const resize = () => {
    viewportWidth.value = Math.max(1, canvasContainer.value.clientWidth);
    viewportHeight.value = Math.max(1, canvasContainer.value.clientHeight);
    drawGrid();
  };
  resize();
  // 仅在画布首次挂载时居中；后续尺寸变化保留当前视图位置和缩放。
  centerOrigin();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasContainer.value);
  drawGridNow();
  window.addEventListener("keydown", handleCanvasKeyDown);
  window.addEventListener("blur", handleWindowBlur);
});

onBeforeUnmount(() => {
  cancelScheduledDraw();
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleCanvasKeyDown);
  window.removeEventListener("blur", handleWindowBlur);
});
</script>

<style scoped>
.design-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #fefefe;
  overflow: hidden;
  position: relative;
}

/* 右下角缩放控件 */
.zoom-controls {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 10;
}

.zoom-btn {
  padding: 0 12px;
  height: 30px;
  border: none;
  background: #f3f4f6;
  color: #374151;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s;
}

.zoom-btn:hover { background: #e5e7eb; }
.canvas-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  /* 内边距由 CONTAINER_PADDING 常量通过内联样式驱动，避免 JS 坐标换算与 CSS 不一致 */
  position: relative;
}

canvas {
  display: block;
  position: absolute;
  inset: 0;
  outline: none;
  touch-action: none;
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

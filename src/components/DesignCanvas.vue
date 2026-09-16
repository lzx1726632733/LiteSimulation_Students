<template>
  <div class="design-canvas">
    <div
      class="canvas-container"
      ref="canvasContainer"
      :style="{ padding: CONTAINER_PADDING + 'px' }"
    >
      <!-- 尺寸不用模板绑定：后备缓冲要按设备像素比放大，宽高由 syncCanvasSize 统一设置。
           若这里再绑一遍 width/height，每次画布扩展都会先被 Vue 按 CSS 像素重置一次缓冲 -->
      <canvas
        ref="canvas"
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

    <!-- 右下角缩放控件：放大/缩小画布，并显示当前比例 -->
    <div class="zoom-controls">
      <button
        class="zoom-btn"
        title="缩小"
        :disabled="zoomIndex <= 0"
        @click="zoomOut"
      >&#8722;</button>
      <span class="zoom-scale">{{ zoomLabel }}</span>
      <button
        class="zoom-btn"
        title="放大"
        :disabled="zoomIndex >= ZOOM_LEVELS.length - 1"
        @click="zoomIn"
      >&#43;</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from "vue";
import { getComponentLabel } from "../utils/componentLabel.js";

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

// ── 世界坐标与缩放 ──────────────────────────────────────────────
// 数据层所有尺寸/位置都以"米"为单位（世界坐标），渲染时乘 ppm 投影像素。
// 缩放采用离散档位：每小格代表的米数（metersPerCell），档位越细放大倍数越高。
const ZOOM_LEVELS = [1, 0.5, 0.1, 0.05, 0.01]; // 每小格对应的米数（从粗到细）
const SMALL_GRID_SIZE = 10; // 小网格在屏幕上的像素大小（固定，缩放只改"每格多少米"）

// 当前缩放档位（下标）。zoomIn 增大下标 → 每格米数变小 → 画布放大
const zoomIndex = ref(0);
const metersPerCell = computed(() => ZOOM_LEVELS[zoomIndex.value] ?? 1);
// 每米对应的像素数：默认 1 格 = 1m 时是 10 px/m，放大到 0.01m/格时是 1000 px/m
const ppm = computed(() => SMALL_GRID_SIZE / metersPerCell.value);

// 画布网格数量（横向/纵向的"小格"数）。固定格数下，画布像素尺寸恒定，
// 世界覆盖范围 = 格数 × metersPerCell，随缩放档位变化（放大看细节、缩小看全貌）
const INITIAL_GRID_CELL_COUNT = 300;
const EXPAND_THRESHOLD_CELLS = 25; // 距世界边缘多少个小格时扩展画布

// 可调整尺寸的控件类型（这类控件有真实的宽高，单位为米）
const RESIZABLE_COMPONENT_TYPES = new Set([
  "workstation",
  "parallelWorkstation",
  "assemblyWorkstation",
  "disassemblyWorkstation",
  "buffer",
]);
const DEFAULT_COMPONENT_SHADOW_COLORS = {
  workstation: "#dbeafe",
  parallelWorkstation: "#dcfce7",
  assemblyWorkstation: "#fef3c7",
  disassemblyWorkstation: "#fce7f3",
  buffer: "#ede9fe",
};
// 各类型控件的默认真实尺寸（米）。暂定占位值，可按实际车间调整
const DEFAULT_COMPONENT_SIZES = {
  workstation: { width: 3, height: 3 },
  parallelWorkstation: { width: 3, height: 3 },
  assemblyWorkstation: { width: 3, height: 3 },
  disassemblyWorkstation: { width: 3, height: 3 },
  buffer: { width: 2, height: 4 },
};

// 网格与背景颜色
const GRID_COLOR = "#e0e0e0"; // 网格线颜色（浅灰，需与背景有足够对比度）
const BACKGROUND_COLOR = "#fefefe"; // 背景色

// 坐标标尺参数
// 画布四周预留的空白（像素），用于绘制坐标数字。网格与控件都会向内偏移这么多
const AXIS_GUTTER = 22;
// 每隔多少个小网格标注一次坐标（默认每 10 格标一次：0、10、20…）
const AXIS_LABEL_STEP = 10;
const AXIS_LABEL_COLOR = "#9aa0a6"; // 坐标数字颜色（浅灰）
const AXIS_LABEL_FONT = "10px sans-serif";

// 画布容器内边距（像素）。作为单一来源同时驱动 JS 坐标换算与 CSS 样式，避免两处不一致
const CONTAINER_PADDING = 0;

// 引用
const canvas = ref(null);
const canvasContainer = ref(null);

// 画布格数（可扩展）。固定格数 × 每格像素 = 画布像素尺寸；
// 世界覆盖范围 = 格数 × metersPerCell（米），随缩放档位变化
const gridCellCountX = ref(INITIAL_GRID_CELL_COUNT);
const gridCellCountY = ref(INITIAL_GRID_CELL_COUNT);

// 画布尺寸（指网格区域像素大小，不含四周标尺留白）
const canvasWidth = computed(() => gridCellCountX.value * SMALL_GRID_SIZE);
const canvasHeight = computed(() => gridCellCountY.value * SMALL_GRID_SIZE);

// 世界覆盖范围（米）
const worldWidthMeters = computed(() => gridCellCountX.value * metersPerCell.value);
const worldHeightMeters = computed(() => gridCellCountY.value * metersPerCell.value);

// canvas 元素实际尺寸 = 网格区域 + 四周各留一条标尺留白
const totalCanvasWidth = computed(() => canvasWidth.value + AXIS_GUTTER * 2);
const totalCanvasHeight = computed(() => canvasHeight.value + AXIS_GUTTER * 2);

// 光标状态
const showCursor = ref(false);
// 光标锚点：网格线交点的世界坐标（米，含滚动偏移）。放置控件时以此交点为中心
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

// 绘制上下文与后备缓冲尺寸缓存。
//
// 给 canvas.width/height 赋值会让浏览器丢弃并重新分配整块像素缓冲区（默认尺寸下约 30 MB）
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

// 绘制网格线本体（调用方需已把坐标系平移到网格区域左上角）。
// 只画一种网格（每格 SMALL_GRID_SIZE 像素），不再区分大小网格；
// 同色的线合到一个 path 里一次 stroke，画布扩展时的重建成本因此小得多
const drawGridLines = (ctx, width, height) => {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.beginPath();

  for (let x = 0; x <= width; x += SMALL_GRID_SIZE) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }

  for (let y = 0; y <= height; y += SMALL_GRID_SIZE) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }

  ctx.stroke();
};

// 静态层：背景 + 网格 + 原点坐标轴。
//
// 这些内容只随画布尺寸变化，与鼠标位置、控件状态无关。坐标数字改成"粘性标尺"
// 动态绘制（固定在视口边缘），因此不再进静态层；网格线合并到一个 path 里一次
// stroke，缓存到离屏 canvas，每帧只需一次 drawImage 把整层贴上来。
let staticLayer = null;
let staticLayerWidth = 0;
let staticLayerHeight = 0;
let staticLayerDpr = 0;

// 按需重建静态层。尺寸与设备像素比都没变时直接复用上次的结果
const syncStaticLayer = (totalWidth, totalHeight, dpr) => {
  if (
    staticLayer &&
    staticLayerWidth === totalWidth &&
    staticLayerHeight === totalHeight &&
    staticLayerDpr === dpr
  ) {
    return staticLayer;
  }

  if (!staticLayer) staticLayer = document.createElement("canvas");

  // 与主画布同样按设备像素比放大，贴图时才能做到设备像素 1:1，不产生重采样
  staticLayer.width = totalWidth * dpr;
  staticLayer.height = totalHeight * dpr;

  const layerCtx = staticLayer.getContext("2d");
  layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = totalWidth - AXIS_GUTTER * 2; // 网格区域宽度
  const height = totalHeight - AXIS_GUTTER * 2;

  layerCtx.fillStyle = BACKGROUND_COLOR;
  layerCtx.fillRect(0, 0, totalWidth, totalHeight);

  // 平移到网格区域左上角后绘制网格，与主画布的坐标约定保持一致。
  // 原点坐标轴改到动态层绘制（画在粘性标尺之上），避免被标尺条遮挡
  layerCtx.save();
  layerCtx.translate(AXIS_GUTTER, AXIS_GUTTER);
  drawGridLines(layerCtx, width, height);
  layerCtx.restore();

  staticLayerWidth = totalWidth;
  staticLayerHeight = totalHeight;
  staticLayerDpr = dpr;

  return staticLayer;
};

// 立即执行一次完整重绘。除调度器外不要直接调用，用 drawGrid 走合并
const drawGridNow = () => {
  // 控件切换等时机可能在挂载前触发重绘，此处兜底
  const ctx = syncCanvasSize();
  if (!ctx) return;

  const totalWidth = totalCanvasWidth.value; // 含标尺留白的画布总宽度
  const totalHeight = totalCanvasHeight.value;

  const layer = syncStaticLayer(totalWidth, totalHeight, backingDpr);

  // 贴静态层。临时把变换矩阵复位成单位矩阵，让离屏位图与后备缓冲按设备像素
  // 1:1 对齐（两者都已按 dpr 放大，再叠一层 scale 会导致缩放采样）。
  // 静态层不透明且铺满整块画布，这一步顺带完成了上一帧像素的清除
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  // 将坐标系平移到网格区域左上角，之后控件/光标都用"网格坐标"绘制，
  // 与 placedComponents 里存的 x/y 保持一致，无需在各处手动加留白偏移
  ctx.save();
  ctx.translate(AXIS_GUTTER, AXIS_GUTTER);

  // 绘制已放置的控件
  drawPlacedComponents(ctx);

  // 绘制黄色方框光标
  if (showCursor.value) {
    drawCursor(ctx);
  }

  // 记录光标绘制状态，光标局部重绘依赖它恢复旧位置的背景
  lastCursorVisible = showCursor.value;
  lastCursorX = showCursor.value ? cursorX.value : null;
  lastCursorY = showCursor.value ? cursorY.value : null;

  ctx.restore();

  // 粘性标尺画在最上层（canvas 坐标系），固定在视口边缘不随内容滚动
  drawStickyRulers(ctx);

  // 原点坐标轴画在标尺之上，避免箭头/标签被标尺条遮挡
  ctx.save();
  ctx.translate(AXIS_GUTTER, AXIS_GUTTER);
  drawOriginAxes(ctx);
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

// 粘性标尺：坐标数字固定在视口顶部与左侧，不随画布内容滚动。
// 无论缩放到哪个档位、滚动到哪个位置，都能看到当前可视区域的坐标（米）。
// 数字 = 格序号 × metersPerCell，每隔 AXIS_LABEL_STEP 个小网格标一个。
const drawStickyRulers = (ctx) => {
  const container = canvasContainer.value;
  if (!container) return;

  const viewportW = container.clientWidth;
  const viewportH = container.clientHeight;
  const scrollX = container.scrollLeft;
  const scrollY = container.scrollTop;
  const rulerSize = AXIS_GUTTER;

  const fmt = (m) => String(+m.toPrecision(6));

  ctx.save();

  // 顶部 + 左侧标尺条背景
  ctx.fillStyle = "#f7f8fa";
  ctx.fillRect(scrollX, scrollY, viewportW, rulerSize);
  ctx.fillRect(scrollX, scrollY, rulerSize, viewportH);

  // 标尺条与内容的分隔线
  ctx.strokeStyle = "#d9dce1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scrollX, scrollY + rulerSize);
  ctx.lineTo(scrollX + viewportW, scrollY + rulerSize);
  ctx.moveTo(scrollX + rulerSize, scrollY);
  ctx.lineTo(scrollX + rulerSize, scrollY + viewportH);
  ctx.stroke();

  ctx.fillStyle = AXIS_LABEL_COLOR;
  ctx.font = AXIS_LABEL_FONT;
  ctx.strokeStyle = "#c0c4cc";
  ctx.lineWidth = 1;

  // 顶部：可见的竖线刻度 + 数字
  const firstCellX = Math.max(0, Math.ceil((scrollX - AXIS_GUTTER) / SMALL_GRID_SIZE));
  const firstLabelCellX = Math.ceil(firstCellX / AXIS_LABEL_STEP) * AXIS_LABEL_STEP;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let cell = firstLabelCellX; ; cell += AXIS_LABEL_STEP) {
    const px = AXIS_GUTTER + cell * SMALL_GRID_SIZE;
    if (px > scrollX + viewportW) break;
    ctx.beginPath();
    ctx.moveTo(px, scrollY + rulerSize - 6);
    ctx.lineTo(px, scrollY + rulerSize);
    ctx.stroke();
    ctx.fillText(fmt(cell * metersPerCell.value), px, scrollY + rulerSize / 2 - 4);
  }

  // 左侧：可见的横线刻度 + 数字（旋转 90° 竖排）
  const firstCellY = Math.max(0, Math.ceil((scrollY - AXIS_GUTTER) / SMALL_GRID_SIZE));
  const firstLabelCellY = Math.ceil(firstCellY / AXIS_LABEL_STEP) * AXIS_LABEL_STEP;
  for (let cell = firstLabelCellY; ; cell += AXIS_LABEL_STEP) {
    const py = AXIS_GUTTER + cell * SMALL_GRID_SIZE;
    if (py > scrollY + viewportH) break;
    ctx.beginPath();
    ctx.moveTo(scrollX + rulerSize - 6, py);
    ctx.lineTo(scrollX + rulerSize, py);
    ctx.stroke();
    ctx.save();
    ctx.translate(scrollX + rulerSize / 2, py);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(fmt(cell * metersPerCell.value), 0, 0);
    ctx.restore();
  }

  ctx.restore();
};

// 在网格坐标系原点（左上角）绘制坐标轴：X 轴向右，Y 轴向下
const drawOriginAxes = (ctx) => {
  const LENGTH = 72;  // 坐标轴长度（像素）
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

// 米 ↔ 像素换算。数据层存米，绘制时用 toPx 投影像素；反算用 toMeters
const toPx = (meters) => meters * ppm.value;
const toMeters = (px) => px / ppm.value;
// 米转显示字符串（去尾零），供日志与坐标显示使用
const fmtMeters = (m) => String(+m.toPrecision(6));

// 控件图标在屏幕上的最大尺寸（像素）。图标视觉大小固定，不随缩放/控件尺寸无限放大
const ICON_SIZE_PX = 32;

// 绘制单个非连接线控件（普通控件 / 站点 / AGV 路径）。
// 全量重绘与光标局部重绘共用，保证两处绘制结果一致
const drawSingleComponent = (ctx, component) => {
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

  // 控件矩形（世界坐标 → 像素）
  const px = toPx(component.x);
  const py = toPx(component.y);
  const pw = toPx(component.width);
  const ph = toPx(component.height);

  if (RESIZABLE_COMPONENT_TYPES.has(component.type)) {
    const shadowColor = component.shadowColor || DEFAULT_COMPONENT_SHADOW_COLORS[component.type];
    ctx.fillStyle = shadowColor;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = component.id === props.selectedId ? "#2566fd" : "rgba(100, 116, 139, 0.45)";
    ctx.lineWidth = component.id === props.selectedId ? 2 : 1;
    ctx.strokeRect(px, py, pw, ph);
  }

  // 选中的控件先绘制高亮底框（外扩 1px 的视觉高亮，不随缩放变化）
  if (component.id === props.selectedId) {
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

  props.placedComponents.forEach((component) => {
    // 连接线在所有控件绘制完成后统一绘制
    if (component.type === "connectionLine") {
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

// 站点尺寸参数
const NODE_SIZE = SMALL_GRID_SIZE; // 站点大小为一个小网格
const NODE_RADIUS = 4; // 站点圆点半径

// 绘制站点控件（小圆点，放置在网格交点上）
const drawNodeComponent = (ctx, component) => {
  // 站点中心就是其世界坐标（米）投影像素后的位置（已对齐到网格交点）
  const centerX = toPx(component.x);
  const centerY = toPx(component.y);

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

  let centerX, labelY; // 像素坐标

  // 站点的标签显示在右侧
  if (component.type === "node") {
    centerX = toPx(component.x) + NODE_RADIUS + 8;
    labelY = toPx(component.y) - LABEL_FONT_SIZE / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
  } else {
    // 其他控件标签居中于控件正下方
    centerX = toPx(component.x) + toPx(component.width) / 2;
    labelY = toPx(component.y) + toPx(component.height) + LABEL_GAP;
  }

  // 用当前字体量出文本宽度，得到与绘制结果一致的包围盒。
  // labelRects 存世界坐标（米），供米域命中判定与输入框定位共用
  const textWidth = ctx.measureText(label).width;
  labelRects.set(component.id, {
    x: toMeters(component.type === "node" ? centerX : centerX - textWidth / 2),
    y: toMeters(labelY),
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

  const fromCenterX = toPx(fromComp.x + fromComp.width / 2);
  const fromCenterY = toPx(fromComp.y + fromComp.height / 2);
  const toCenterX = toPx(toComp.x + toComp.width / 2);
  const toCenterY = toPx(toComp.y + toComp.height / 2);

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
  const fromCenterX = toPx(from.x + from.width / 2);
  const fromCenterY = toPx(from.y + from.height / 2);
  const tip = { x: toPx(tempLineEnd.value.x), y: toPx(tempLineEnd.value.y) };

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
  ctx.strokeRect(toPx(from.x) - 1, toPx(from.y) - 1, pw + 2, ph + 2);

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

  // 世界坐标（米）→ 像素
  const pts = nodes.map((n) => ({ x: toPx(n.x), y: toPx(n.y) }));

  // lineJoin/lineCap 是会残留的 context 状态。后备缓冲不再每帧重建后，
  // 这里若不还原，圆角会漏给之后绘制的网格线和选中框
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round"; // 圆角连接
  ctx.lineCap = "round";

  // 如果没有设置圆角，直接绘制折线
  if (!cornerRadii || cornerRadii.every(r => r === 0)) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  } else {
    // 有圆角，使用 arcTo 绘制圆角路径
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const radius = toPx(cornerRadii[i - 1] || 0);

      if (radius > 0) {
        // 使用 arcTo 绘制圆角
        ctx.arcTo(curr.x, curr.y, next.x, next.y, radius);
      } else {
        // 无圆角，直接连线
        ctx.lineTo(curr.x, curr.y);
      }
    }

    // 连接到最后一个点
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }

  // 绘制拐点（不包括起点和终点站点）
  if (isSelected) {
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.restore();

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
  const labelX = toPx(midNode.x) + 8;
  const labelY = toPx(midNode.y) - 8;

  // 记录包围盒（世界坐标，米）供双击改名使用
  const textWidth = ctx.measureText(label).width;
  labelRects.set(pathComponent.id, {
    x: toMeters(labelX),
    y: toMeters(labelY - LABEL_FONT_SIZE / 2),
    width: toMeters(textWidth),
    height: toMeters(LABEL_FONT_SIZE),
  });

  // 正在改名的标签由 HTML 输入框接管显示
  if (editingId.value === pathComponent.id) return;

  ctx.fillText(label, labelX, labelY);
};

// 绘制临时 AGV 路径（正在绘制中，虚线跟随鼠标预览）
const drawTempAGVPath = (ctx) => {
  if (!agvStartNode.value || agvPathPoints.value.length === 0) return;

  // 世界坐标（米）→ 像素
  const points = agvPathPoints.value.map((p) => ({ x: toPx(p.x), y: toPx(p.y) }));

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
    const tip = { x: toPx(tempAGVPoint.value.x), y: toPx(tempAGVPoint.value.y) };
    ctx.strokeStyle = AGV_PATH_COLOR;
    ctx.lineWidth = AGV_PATH_WIDTH;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(tip.x, tip.y);
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
    const tip = { x: toPx(tempAGVPoint.value.x), y: toPx(tempAGVPoint.value.y) };
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
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
  const sx = toPx(agvStartNode.value.x);
  const sy = toPx(agvStartNode.value.y);
  ctx.strokeRect(
    sx - halfSize - 1,
    sy - halfSize - 1,
    NODE_SIZE + 2,
    NODE_SIZE + 2
  );
};

// 绘制光标：以网格线交点（cursorX/cursorY，米）为中心
// 用一个居中于交点的黄色方框表示放置锚点，方框中心即控件放置后的中心
const drawCursor = (ctx) => {
  const cx = toPx(cursorX.value);
  const cy = toPx(cursorY.value);
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

// 光标局部重绘相关状态。放置光标（黄色方框）跟随鼠标时，若每帧都全量重绘整块
// 大画布（静态层 drawImage + 全部控件），高 DPI 屏下单帧成本会超过一帧预算，黄框
// 就会明显滞后于鼠标。这里改为只恢复旧光标位置的一小块背景再画新光标，成本降到
// 与画布尺寸无关的常数级
let lastCursorVisible = false; // 上一帧光标是否可见
let lastCursorX = null; // 上一帧光标在网格坐标系中的 x（可见时有效）
let lastCursorY = null; // 上一帧光标在网格坐标系中的 y（可见时有效）
const CURSOR_REPAINT_PADDING = 2; // 恢复区域外扩量，覆盖 1px 描边与抗锯齿边缘

// 计算控件的包围盒（世界坐标，米），供光标局部重绘时判断哪些控件需要重画。
// 连接线与 AGV 路径没有矩形包围盒，按端点/路径点外扩线宽得到近似包围盒
const componentBounds = (component) => {
  if (component.type === "connectionLine") {
    const from = props.placedComponents.find((c) => c.id === component.fromId);
    const to = props.placedComponents.find((c) => c.id === component.toId);
    if (!from || !to) return null;
    const pad = toMeters(LINE_WIDTH_SELECTED + LINE_GRAB_MARGIN);
    return {
      x: Math.min(from.x, to.x) - pad,
      y: Math.min(from.y, to.y) - pad,
      w: Math.abs(to.x - from.x) + pad * 2,
      h: Math.abs(to.y - from.y) + pad * 2,
    };
  }

  if (component.type === "AGVpath") {
    const nodes = component.nodes;
    if (!nodes || nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    });
    const pad = toMeters(AGV_PATH_WIDTH_SELECTED + LINE_GRAB_MARGIN);
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  // 站点是抽象点，按圆点半径外扩一个抓取余量作为包围盒
  if (component.type === "node") {
    const r = toMeters(NODE_RADIUS + LINE_GRAB_MARGIN);
    return { x: component.x - r, y: component.y - r, w: r * 2, h: r * 2 };
  }

  return {
    x: component.x,
    y: component.y,
    w: component.width ?? 0,
    h: component.height ?? 0,
  };
};

// 两个轴对齐矩形是否相交
const rectsIntersect = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// 只重绘光标：恢复旧光标位置的一小块背景，再在新位置画光标。
// 相比全量重绘，省掉了整层 drawImage 与全部控件绘制，让黄框紧跟鼠标。
// newX/newY 为世界坐标（米）
const drawCursorOnly = (newX, newY) => {
  const ctx = syncCanvasSize();
  if (!ctx) return;

  const totalWidth = totalCanvasWidth.value;
  const totalHeight = totalCanvasHeight.value;
  const layer = syncStaticLayer(totalWidth, totalHeight, backingDpr);
  const dpr = backingDpr;

  // 计算需要恢复背景的矩形（世界坐标，米）：覆盖旧光标与新光标
  const halfM = toMeters(SMALL_GRID_SIZE / 2 + CURSOR_REPAINT_PADDING);
  let rx = newX - halfM;
  let ry = newY - halfM;
  let rw = halfM * 2;
  let rh = halfM * 2;

  if (lastCursorVisible && lastCursorX !== null && lastCursorY !== null) {
    const old = { x: lastCursorX - halfM, y: lastCursorY - halfM, w: rw, h: rh };
    const cur = { x: rx, y: ry, w: rw, h: rh };
    const minX = Math.min(old.x, cur.x);
    const minY = Math.min(old.y, cur.y);
    rx = minX;
    ry = minY;
    rw = Math.max(old.x + old.w, cur.x + cur.w) - minX;
    rh = Math.max(old.y + old.h, cur.y + cur.h) - minY;
  }

  // 1. 从静态层把恢复区域贴回主画布（单位矩阵下用设备像素坐标）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sx = Math.max(0, Math.floor((AXIS_GUTTER + toPx(rx)) * dpr));
  const sy = Math.max(0, Math.floor((AXIS_GUTTER + toPx(ry)) * dpr));
  const ex = Math.min(Math.ceil((AXIS_GUTTER + toPx(rx + rw)) * dpr), layer.width);
  const ey = Math.min(Math.ceil((AXIS_GUTTER + toPx(ry + rh)) * dpr), layer.height);
  if (ex > sx && ey > sy) {
    ctx.drawImage(layer, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  }
  ctx.restore();

  // 2. 重画与恢复区域相交的控件与连接线，再画新光标
  ctx.save();
  ctx.translate(AXIS_GUTTER, AXIS_GUTTER);

  const restoreRect = { x: rx, y: ry, w: rw, h: rh };
  props.placedComponents.forEach((component) => {
    const bounds = componentBounds(component);
    if (!bounds || !rectsIntersect(bounds, restoreRect)) return;

    if (component.type === "connectionLine") {
      drawConnectionLine(ctx, component);
    } else {
      drawSingleComponent(ctx, component);
    }
  });

  drawCursor(ctx);
  ctx.restore();

  // 恢复背景可能覆盖到粘性标尺，这里重新画一遍
  drawStickyRulers(ctx);

  // 恢复背景同样可能覆盖到原点轴，一并重画（画在标尺之上）
  ctx.save();
  ctx.translate(AXIS_GUTTER, AXIS_GUTTER);
  drawOriginAxes(ctx);
  ctx.restore();

  // 记录本次光标状态（世界坐标，米），供下一帧恢复背景
  lastCursorVisible = true;
  lastCursorX = newX;
  lastCursorY = newY;
};

// 扩展画布（按小格数增加画布尺寸）
const expandCanvas = (newCellCountX, newCellCountY) => {
  const oldX = gridCellCountX.value;
  const oldY = gridCellCountY.value;

  // 只在需要扩展时才扩展
  if (newCellCountX > oldX || newCellCountY > oldY) {
    gridCellCountX.value = Math.max(newCellCountX, oldX);
    gridCellCountY.value = Math.max(newCellCountY, oldY);

    nextTick(() => {
      drawGrid();
    });
  }
};

// 检查控件位置并扩展画布（当控件接近世界边缘时，参数单位为米）
const checkAndExpandCanvas = (
  componentX,
  componentY,
  componentWidth,
  componentHeight,
) => {
  const threshold = EXPAND_THRESHOLD_CELLS * metersPerCell.value; // 米

  // 计算控件的右边界和下边界（米）
  const rightEdge = componentX + componentWidth;
  const bottomEdge = componentY + componentHeight;

  // 检查是否需要向右扩展
  if (rightEdge > worldWidthMeters.value - threshold) {
    const newCells = Math.ceil((rightEdge + threshold) / metersPerCell.value);
    expandCanvas(newCells, gridCellCountY.value);
  }

  // 检查是否需要向下扩展
  if (bottomEdge > worldHeightMeters.value - threshold) {
    const newCells = Math.ceil((bottomEdge + threshold) / metersPerCell.value);
    expandCanvas(gridCellCountX.value, newCells);
  }
};

// 获取鼠标在世界坐标（米）中的位置（与 placedComponents 的 x/y 同一坐标系）
// 需依次扣除：容器内边距 padding、画布四周标尺留白 AXIS_GUTTER；并加回滚动偏移
const getCanvasMousePosition = (e) => {
  const containerRect = canvasContainer.value.getBoundingClientRect();

  const px =
    e.clientX -
    containerRect.left -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollLeft;
  const py =
    e.clientY -
    containerRect.top -
    CONTAINER_PADDING -
    AXIS_GUTTER +
    canvasContainer.value.scrollTop;
  return {
    x: toMeters(px),
    y: toMeters(py),
  };
};

// 将坐标向下对齐到小网格线（米，用于拖拽时控件左上角落在网格线上）
const snapToSmallGrid = (value) => {
  return Math.floor(value / metersPerCell.value) * metersPerCell.value;
};

// 将坐标对齐到最近的小网格线交点（米，用于放置光标：锚点在线上）
const snapToNearestGridLine = (value) => {
  return Math.round(value / metersPerCell.value) * metersPerCell.value;
};

// 将光标锚点限制在世界范围内（[0, 世界宽/高]，米），避免黄色方框跑到四周坐标标尺留白区
const clampCursorToGrid = (x, y) => ({
  x: Math.min(Math.max(x, 0), worldWidthMeters.value),
  y: Math.min(Math.max(y, 0), worldHeightMeters.value),
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

    // 站点使用圆形命中测试（半径是像素，先换算成米）
    if (component.type === "node") {
      const dist = Math.hypot(x - component.x, y - component.y);
      if (dist <= toMeters(NODE_RADIUS + LINE_GRAB_MARGIN)) {
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
  const py = toPx(y);

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

// AGV 路径命中判定：使用 isPointInStroke 精确判断（支持圆角）
const hitTestAGVPath = (path, x, y) => {
  const { nodes, cornerRadii } = path;
  if (!nodes || nodes.length < 2) return false;

  // 世界坐标（米）→ 像素
  const pts = nodes.map((n) => ({ x: toPx(n.x), y: toPx(n.y) }));
  const px = toPx(x);
  const py = toPx(y);

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
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
  } else {
    // 有圆角，使用 arcTo
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const radius = toPx(cornerRadii[i - 1] || 0);

      if (radius > 0) {
        ctx.arcTo(curr.x, curr.y, next.x, next.y, radius);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
    }

    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  // 使用 isPointInStroke 判断点是否在路径上
  return ctx.isPointInStroke(px, py);
};

// 输入框在容器中的绝对定位样式。
// labelRects 存的是世界坐标（米），需换算成像素并加回标尺留白与容器内边距；
// 容器滚动时输入框随内容一起滚（absolute 定位在滚动内容里），无需再补 scroll 偏移
const labelEditorStyle = computed(() => {
  const rect = editingId.value ? labelRects.get(editingId.value) : null;
  if (!rect) return { display: "none" };

  // 文字很短时输入框会窄到没法点，给一个下限；同时留出光标和左右内边距的余量
  const width = Math.max(toPx(rect.width) + 16, 64);
  const centerX = toPx(rect.x + rect.width / 2);

  return {
    left: `${CONTAINER_PADDING + AXIS_GUTTER + centerX - width / 2}px`,
    top: `${CONTAINER_PADDING + AXIS_GUTTER + toPx(rect.y)}px`,
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

    // 添加拐点到路径（世界坐标，米）
    agvPathPoints.value.push({ x: finalX, y: finalY });
    emit("add-log", `AGV 路径：添加拐点 (${fmtMeters(finalX)}, ${fmtMeters(finalY)}) m`);

    // 检查是否需要扩展画布
    checkAndExpandCanvas(finalX, finalY, metersPerCell.value, metersPerCell.value);

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

    // 通知父组件新增站点控件（站点是抽象点，无尺寸）
    emit("component-placed", {
      id,
      type: props.activeControl.type,
      name: props.activeControl.name,
      icon: props.activeControl.icon,
      tabId: props.activeControl.tabId,
      index,
      x: finalX,
      y: finalY,
      width: 0,
      height: 0,
    });

    // 输出日志
    emit(
      "add-log",
      `新建对象，类型：${props.activeControl.type}，编号：${props.activeControl.name}${index}`,
    );

    // 检查是否需要扩展画布
    checkAndExpandCanvas(finalX, finalY, metersPerCell.value, metersPerCell.value);

    // 通知父组件放置完成，重置为"选择"状态
    emit("placement-done");

    // prop 变更是异步的，立即手动隐藏游标并重绘，避免黄框残留
    showCursor.value = false;
    drawGrid();
    return;
  }

  // 其他控件：由中心反推左上角（默认真实尺寸，米）
  const defaultSize =
    DEFAULT_COMPONENT_SIZES[props.activeControl.type] || { width: 3, height: 3 };
  const componentX = anchorX - defaultSize.width / 2;
  const componentY = anchorY - defaultSize.height / 2;

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
    width: defaultSize.width,
    height: defaultSize.height,
    shadowColor: DEFAULT_COMPONENT_SHADOW_COLORS[props.activeControl.type],
  });

  // 输出日志：新建对象，类型：<type>，编号：<name><序号>
  emit(
    "add-log",
    `新建对象，类型：${props.activeControl.type}，编号：${props.activeControl.name}${index}`,
  );

  // 检查是否需要扩展画布
  checkAndExpandCanvas(finalX, finalY, defaultSize.width, defaultSize.height);

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

    // 检查是否需要扩展画布（拐点无尺寸，按一个小格计）
    checkAndExpandCanvas(newX, newY, metersPerCell.value, metersPerCell.value);

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

    // 控件被拖近边缘时扩展画布（宽高均为米）
    checkAndExpandCanvas(
      newX,
      newY,
      draggedComponent.width ?? metersPerCell.value,
      draggedComponent.height ?? metersPerCell.value,
    );
    return;
  }

  const anchor = clampCursorToGrid(
    snapToNearestGridLine(pos.x),
    snapToNearestGridLine(pos.y),
  );
  cursorX.value = anchor.x;
  cursorY.value = anchor.y;

  const shouldShow = shouldShowCustomCursor.value;
  showCursor.value = shouldShow;

  if (shouldShow) {
    // 光标跟随只做局部重绘，避免每帧全量重绘大画布导致黄框跟不上鼠标
    if (lastCursorVisible && lastCursorX === anchor.x && lastCursorY === anchor.y) {
      return; // 吸附到同一网格交点，位置未变，无需重绘
    }
    drawCursorOnly(anchor.x, anchor.y);
  } else if (lastCursorVisible) {
    // 光标需要隐藏（如刚切回"选择"工具）：全量重绘一次清除残留黄框
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
      // 中心点物理坐标（米，去尾零）。数据层已存米，直接计算
      const halfW = moved.width / 2;
      const halfH = moved.height / 2;
      const fromMx = fmtMeters(dragOriginX.value + halfW);
      const fromMy = fmtMeters(dragOriginY.value + halfH);
      const toMx   = fmtMeters(moved.x + halfW);
      const toMy   = fmtMeters(moved.y + halfH);

      emit(
        "add-log",
        `移动对象，编号：${getComponentLabel(moved)}` +
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

// 画布容器滚动时，根据视口坐标重算内容坐标，更新网格高亮。
// 粘性标尺固定在视口边缘，滚动后必须按新位置重绘，因此无论是否处于
// 放置模式都要触发重绘
const handleContainerScroll = () => {
  if (shouldShowCustomCursor.value && mouseInsideCanvas.value) {
    // 视口像素坐标 → 世界坐标（米）
    const px =
      mouseViewportX.value -
      CONTAINER_PADDING -
      AXIS_GUTTER +
      canvasContainer.value.scrollLeft;

    const py =
      mouseViewportY.value -
      CONTAINER_PADDING -
      AXIS_GUTTER +
      canvasContainer.value.scrollTop;

    const anchor = clampCursorToGrid(
      snapToNearestGridLine(toMeters(px)),
      snapToNearestGridLine(toMeters(py)),
    );
    cursorX.value = anchor.x;
    cursorY.value = anchor.y;
  }

  drawGrid();
};

// 右下角显示的当前比例文字，如 "1格 = 1m"、"1格 = 0.01m"
const zoomLabel = computed(() => {
  const m = metersPerCell.value;
  const text = m >= 1 ? String(m) : String(+m.toPrecision(6));
  return `1格 = ${text}m`;
});

// 应用缩放：保持视口中心的世界坐标不变，再重绘
const applyZoom = (nextIndex) => {
  const container = canvasContainer.value;
  if (!container) {
    zoomIndex.value = nextIndex;
    drawGrid();
    return;
  }

  const oldPpm = ppm.value;
  const viewportW = container.clientWidth;
  const viewportH = container.clientHeight;

  // 视口中心的世界坐标（米）
  const centerX =
    (container.scrollLeft + viewportW / 2 - CONTAINER_PADDING - AXIS_GUTTER) / oldPpm;
  const centerY =
    (container.scrollTop + viewportH / 2 - CONTAINER_PADDING - AXIS_GUTTER) / oldPpm;

  zoomIndex.value = nextIndex;

  // 新 ppm 下，把同一个世界中心点放回视口中心
  const newPpm = ppm.value;
  const maxScrollX = Math.max(0, canvasWidth.value - viewportW);
  const maxScrollY = Math.max(0, canvasHeight.value - viewportH);
  container.scrollLeft = Math.min(
    maxScrollX,
    Math.max(0, centerX * newPpm - viewportW / 2 + CONTAINER_PADDING + AXIS_GUTTER),
  );
  container.scrollTop = Math.min(
    maxScrollY,
    Math.max(0, centerY * newPpm - viewportH / 2 + CONTAINER_PADDING + AXIS_GUTTER),
  );

  drawGrid();
};

// 放大：每格米数变小（档位下标 +1）
const zoomIn = () => {
  if (zoomIndex.value >= ZOOM_LEVELS.length - 1) return;
  applyZoom(zoomIndex.value + 1);
};

// 缩小：每格米数变大（档位下标 -1）
const zoomOut = () => {
  if (zoomIndex.value <= 0) return;
  applyZoom(zoomIndex.value - 1);
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

    // 属性面板修改尺寸后，按最新矩形边界扩展画布，避免控件超出可视区域
    props.placedComponents.forEach((component) => {
      if (
        component.type === "connectionLine" ||
        component.type === "AGVpath" ||
        !Number.isFinite(component.width) ||
        !Number.isFinite(component.height)
      ) {
        return;
      }
      checkAndExpandCanvas(
        component.x,
        component.y,
        component.width,
        component.height,
      );
    });

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
  // 首帧直接画，避免挂载后到下一帧之间出现空白画布
  drawGridNow();

  // 滚动只读位置、不阻止默认行为，标记 passive 让浏览器免去等待回调的判断
  canvasContainer.value.addEventListener("scroll", handleContainerScroll, {
    passive: true,
  });
  window.addEventListener("keydown", handleCanvasKeyDown);
});

onBeforeUnmount(() => {
  cancelScheduledDraw();
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
  width: 26px;
  height: 26px;
  border: none;
  background: #f3f4f6;
  color: #374151;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s;
}

.zoom-btn:hover { background: #e5e7eb; }
.zoom-btn:disabled { opacity: 0.4; cursor: default; }

.zoom-scale {
  font-size: 12px;
  color: #374151;
  min-width: 72px;
  text-align: center;
  user-select: none;
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

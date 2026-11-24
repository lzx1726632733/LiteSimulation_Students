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
                @contextmenu="handleCanvasContextMenu"
                @dblclick="handleDoubleClick"
            ></canvas>
            <span ref="workpieceTooltipAnchor" class="workpiece-tooltip-anchor" aria-hidden="true"></span>
            <!--
                pointercancel:	指针操作被系统中断时清理状态。
                lostpointercapture:	画布失去指针捕获时清理状态，避免拖动状态残留。
                auxclick: 阻止辅助按键点击的默认行为；
            -->
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
            >显示全部
            </button>
        </div>
    </div>

</template>

<script setup>
import {ref, onMounted, onBeforeUnmount, nextTick, computed, watch} from "vue";
import {getComponentLabel} from "../utils/componentLabel.js";
import {alignBounds} from "../utils/alignment.js";
import {
    DEFAULT_STATION_SIZE,
    getStationType,
    getNextStationIndex,
    getComponentCenter,
    getComponentFootprint,
    getComponentQuarterTurns
} from "../utils/stations.js";
import {getComponentPorts, getComponentPortPosition} from "../utils/componentPorts.js";
import {getConnectionGeometry} from "../utils/connectionLine.js";
import {clampCanvasOffset, clampCanvasPoint, encloseCanvasBounds, fitsCanvasBounds, getCanvasItemBounds, getCanvasMoveBounds} from "../utils/canvasBoundary.js";
import {footprintsOverlap, getCollisionFootprint, resolveComponentDrag} from "../utils/componentCollision.js";
import {
    DEFAULT_PATH_WIDTH,
    getPathWidth,
    buildPathGeometry,
    pointOnPathSegment,
    distanceToPathSegment,
    tracePathGeometry,
    isPointInPathArea,
    getPathGeometryBounds,
    getPathBounds
} from "../utils/agvPath.js";
import {
    RECTANGULAR_OBSTACLE_TYPE,
    CIRCULAR_OBSTACLE_TYPE,
    OBSTACLE_COMPONENT_TYPES,
    RESIZABLE_COMPONENT_TYPES,
    DEFAULT_COMPONENT_SHADOW_COLORS,
    DEFAULT_COMPONENT_SIZES
} from "../utils/componentAppearance.js";
import {getLocalTriangleVertices, getTriangleVertices, TRIANGULAR_OBSTACLE_TYPE} from "../utils/triangleObstacle.js";
import {getWallGeometry, RECTANGULAR_WALL_TYPE} from "../utils/rectangularWall.js";
import {hasWallRouteCollision} from "../utils/wallRoutes.js";

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
    workpieces: {
        type: Array,
        default: () => [],
    },
    showCoordinateSystem: {
        type: Boolean,
        default: true,
    },
    canvasBoundary: {type: Object, default: null},
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
    "canvas-drag-start",
    "canvas-drag-end",
    "update-component-position",
    "update-component-positions",
    "resize-obstacle-edge",
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
const SNAP_STEP = 0.01; // 固定的移动或吸附步长是 0.01 米。它属于模型坐标，不会因为放大或缩小而改变。
const ALIGNMENT_THRESHOLD_PX = 6;   // 自动对齐的触发距离是 6 个屏幕像素。这是屏幕上的距离；缩放变化时，代码会根据 ppm 换算成相应的模型距离。
const alignmentGuides = ref([]);    // 用响应式数组保存当前的对齐辅助线信息。没有对齐线时通常为空数组；计算出对齐位置时，数组中会有对应的数据。
// ppm 是当前缩放比例，单位可以理解为“像素/米”。
const DEFAULT_PPM = 10; // 默认每米显示为 10 像素。
const MIN_PPM = 0.001;  // 缩放比例允许的最小值，限制最小缩放程度。
const MAX_PPM = 1000;   // 缩放比例允许的最大值，限制最大放大程度。
const SMALL_GRID_SIZE = 10; // 站点和放置光标的屏幕尺寸
const ppm = ref(DEFAULT_PPM);   // 保存当前使用的比例。它变化时，依赖它的计算属性也会重新计算。
// 视口左上角对应的物理坐标；X 向右、Y 向上，均允许负数。
const viewOrigin = ref({x: 0, y: 0});
const viewportWidth = ref(1);   // 保存视口的屏幕宽度和高度，单位是像素。初始值 1 是占位值，组件挂载并测量实际尺寸后会更新。
const viewportHeight = ref(1);

// 网格只负责显示，自动选择 1、2、5 系列间距，最细显示 0.01m。
const metersPerCell = computed(() => {
    const target = Math.max(SNAP_STEP, 12 / ppm.value); // 确保计算目标不会小于 0.01 米。
    const base = 10 ** Math.floor(Math.log10(target));  // floor：向下取整，计算一个比 target 小或等于它的 10 的整数次幂，用它来确定网格间距的数量级。
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
const canvasWidth = computed(() => viewportWidth.value);    // 画布的宽（或者叫长）
const canvasHeight = computed(() => viewportHeight.value);  // 画布的高
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
let dragFootprint = null;
let shiftClickId = null;
let keepSelectionOnClick = false;
const obstacleResize = ref(null);
const hoveredObstacleAxis = ref(null);

// 拖拽路径拐点的状态
const draggingCorner = ref(false); // 是否正在拖拽拐点
const dragPathId = ref(null); // 正在拖拽拐点所属的路径 id
const dragCornerIndex = ref(null);
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
const firstPort = ref(null);
const connectionWaypoints = ref([]);
const tempLineEnd = ref(null); // 临时连接线终点（鼠标位置）
const CONNECTION_PORT_GRAB = 8;
const CONNECTION_HANDLE_SIZE = 8;

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
    const resizeAxis = obstacleResize.value?.axis ?? hoveredObstacleAxis.value;
    if (resizeAxis === 'vertex') return 'move';
    if (resizeAxis === 'radius') return 'crosshair';
    if (resizeAxis) return resizeAxis === 'x' ? 'ew-resize' : 'ns-resize';
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
        hoveredObstacleAxis.value = null;
        const isLineMode = newControl?.type === "connectionLine";
        const wasLineMode = oldControl?.type === "connectionLine";
        const isAGVPathMode = newControl?.type === "AGVpath";
        const wasAGVPathMode = oldControl?.type === "AGVpath";

        connectionLineMode.value = isLineMode;
        agvPathMode.value = isAGVPathMode;

        // 重置连接线状态
        if (!isLineMode) clearConnectionDraft();

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
    if (!el) return null;   // 	元素尚未挂载时，返回 null，避免继续操作。

    // 首次调用时取得 2D 绘图对象，并缓存在 canvasCtx 中。
    if (!canvasCtx) canvasCtx = el.getContext("2d");

    const totalWidth = totalCanvasWidth.value;  // 读取画布希望显示的宽度，单位是 CSS 像素。
    const totalHeight = totalCanvasHeight.value;
    /*            可以把 Canvas 理解成一张图片：`canvas.width` 和 canvas.height 决定这张图片有多少像素；CSS 宽高决定它在屏幕上显示多大。
                假设画布显示为 800 × 600 CSS 像素，设备像素比 dpr = 2。这块显示区域实际占用 1600 × 1200 个屏幕像素。
                - 如果内部画布仍只有 800 × 600 像素，浏览器需要把它放大显示。原来一个像素要覆盖多个屏幕像素，细线边缘可能显得模糊。
                - 代码把内部画布设为 1600 × 1200 像素，同时保持 CSS 显示尺寸为 800 × 600。这样画布有足够的像素来描绘细节。
    * */
    const dpr = window.devicePixelRatio || 1;   // 	读取设备像素比；取不到时按 1 处理。
    // 只有显示尺寸或设备像素比变化时，才重新设置像素缓冲区。
    if (
        backingWidth !== totalWidth ||
        backingHeight !== totalHeight ||
        backingDpr !== dpr
    ) {
        // 后备缓冲按设备像素比放大，保证高 DPI 屏下线条不发虚
        el.width = totalWidth * dpr;    // 	设置画布内部的实际像素宽度。
        el.height = totalHeight * dpr;
        // CSS 尺寸仍用逻辑像素，浏览器负责缩放显示
        el.style.width = totalWidth + "px";
        el.style.height = totalHeight + "px";
        // 记录这次使用的尺寸和 dpr，供下次判断是否需要更新。
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
    const step = metersPerCell.value;   // 当前网格间距，单位：米/格
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const startX = Math.ceil(viewOrigin.value.x / step);    // 左边界：视口内第一条竖线的网格编号
    const endX = Math.floor((viewOrigin.value.x + canvasWidth.value / ppm.value) / step);   // 右边界：视口内最后一条竖线的网格编号，canvasWidth / ppm 把视口宽度从像素换算成米
    const startY = Math.ceil((viewOrigin.value.y - canvasHeight.value / ppm.value) / step); // 下边界：视口内第一条横线的网格编号，因为世界坐标 Y 向上，所以从顶部向下要做减法
    const endY = Math.floor(viewOrigin.value.y / step); // 上边界：视口内最后一条横线的网格编号
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
    ctx.stroke();   // 把前面加入路径的所有线条一次性画出来
};

const drawCanvasBoundary = (ctx) => {
    const boundary = props.canvasBoundary;
    if (!boundary) return;
    const {x, y, width, height} = boundary;
    const left = viewOffsetX.value + toPx(x);
    const right = viewOffsetX.value + toPx(x + width);
    const top = viewOffsetY.value + toScreenY(y + height);
    const bottom = viewOffsetY.value + toScreenY(y);
    const innerLeft = Math.max(0, left), innerRight = Math.min(canvasWidth.value, right);
    const innerTop = Math.max(0, top), innerBottom = Math.min(canvasHeight.value, bottom);
    const visible = innerRight > innerLeft && innerBottom > innerTop;

    ctx.save();
    ctx.fillStyle = "#11182748";
    ctx.beginPath();
    ctx.rect(0, 0, canvasWidth.value, canvasHeight.value);
    if (visible) ctx.rect(innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop);
    ctx.fill("evenodd");
    if (visible) {
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (left >= 0) { ctx.moveTo(left, innerTop); ctx.lineTo(left, innerBottom); }
        if (right <= canvasWidth.value) { ctx.moveTo(right, innerTop); ctx.lineTo(right, innerBottom); }
        if (top >= 0) { ctx.moveTo(innerLeft, top); ctx.lineTo(innerRight, top); }
        if (bottom <= canvasHeight.value) { ctx.moveTo(innerLeft, bottom); ctx.lineTo(innerRight, bottom); }
        ctx.stroke();
    }
    ctx.restore();
};

// 合并到动画帧重绘视口，避免缩放时创建整张模型大小的位图。
const drawGridNow = () => {
    const ctx = syncCanvasSize();
    if (!ctx) return;   // 	Canvas 尚不可用时停止绘制。
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, totalCanvasWidth.value, totalCanvasHeight.value);    // 用背景色覆盖整个画布，同时盖掉上一帧的内容。
    ctx.save(); // 	保存当前绘图状态，包括坐标变换、样式等，方便最后恢复。
    ctx.beginPath();
    ctx.rect(0, 0, canvasWidth.value, canvasHeight.value);  // 定义一个与可见画布区域相同的矩形。
    ctx.clip(); // 	将这个矩形设为裁剪区域，后续绘制超出区域的部分不会显示。
    drawGridLines(ctx); // 	画网格线。此时尚未执行下面的 translate，网格函数自己计算线条的屏幕位置。
    ctx.translate(viewOffsetX.value, viewOffsetY.value);    // 移动绘图坐标原点，让世界坐标 (0, 0) 对应到当前视图中的正确像素位置
    drawPlacedComponents(ctx);  // 绘制已经放置的控件、路径和连接线。
    drawWorkpieces(ctx);
    if (props.showCoordinateSystem) drawOriginMarker(ctx);  // 只控制坐标轴绘制，坐标变换与对齐参考仍保留。
    if (showCursor.value) drawCursor(ctx);  // 	需要显示自定义放置光标时才绘制它。
    drawAlignmentGuides(ctx);   // 绘制拖动控件时的对齐参考线。
    drawSelectionBox(ctx);  // 绘制鼠标框选区域。
    ctx.restore();  // 恢复 save() 时的状态，撤销本次设置的裁剪和坐标平移；已经画出的内容不会被撤销。
    drawCanvasBoundary(ctx);
    updateWorkpieceTooltip();
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

// 工件使用世界坐标，随画布一起平移和缩放；后生成的工件覆盖在前面。
const drawWorkpieces = (ctx) => {
    ctx.save();
    for (const part of props.workpieces ?? []) {
        if (part.stackHidden) continue;
        let x = toPx(part.x);
        let y = toScreenY(part.y + part.height);
        const width = toPx(part.width);
        const height = toPx(part.height);
        ctx.save();
        if (part.angle) {
            const center = part.position ?? {x: part.x + part.width / 2, y: part.y + part.height / 2};
            ctx.translate(toPx(center.x), toScreenY(center.y));
            ctx.rotate(-part.angle * Math.PI / 180);
            x = -width / 2;
            y = -height / 2;
        }
        ctx.fillStyle = part.fillColor;
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = part.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        if (width >= 14 && height >= 8) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.clip();
            ctx.font = `${Math.min(14, height * 0.65)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'white';
            const label = String(part.stackCount ?? part.sequence);
            ctx.strokeText(label, x + width / 2, y + height / 2, width - 4);
            ctx.fillStyle = '#111827';
            ctx.fillText(label, x + width / 2, y + height / 2, width - 4);
            ctx.restore();
        }
        ctx.restore();
    }
    ctx.restore();
};

const workpieceTooltipAnchor = ref(null);
let workpieceTooltip = null;
let workpieceTooltipText = '';
let workpieceHoverPointer = null;

// 按绘制顺序倒序检查，逆向旋转鼠标坐标以命中工件的实际矩形。
const hitTestWorkpiece = (x, y) => {
    const parts = props.workpieces ?? [];
    for (let index = parts.length - 1; index >= 0; index--) {
        const part = parts[index];
        if (part.stackHidden) continue;
        const center = part.position ?? {x: part.x + part.width / 2, y: part.y + part.height / 2};
        const radians = (part.angle ?? 0) * Math.PI / 180;
        const dx = x - center.x;
        const dy = y - center.y;
        const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
        const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
        const border = 0.5 / ppm.value;
        if (Math.abs(localX) <= part.width / 2 + border && Math.abs(localY) <= part.height / 2 + border) return part;
    }
    return null;
};

const hideWorkpieceTooltip = () => {
    workpieceTooltip?.hide();
    workpieceTooltipText = '';
};

const clearWorkpieceHover = () => {
    workpieceHoverPointer = null;
    hideWorkpieceTooltip();
};

const updateWorkpieceTooltip = () => {
    if (!workpieceHoverPointer || !canvas.value || panning.value || dragging.value || draggingCorner.value || obstacleResize.value ||
        selectionBox.value || workpieceHoverPointer.buttons || shouldShowCustomCursor.value ||
        connectionLineMode.value || agvPathMode.value) {
        hideWorkpieceTooltip();
        return;
    }
    const rect = canvas.value.getBoundingClientRect();
    const {clientX, clientY} = workpieceHoverPointer;
    if (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) {
        hideWorkpieceTooltip();
        return;
    }
    const point = getCanvasMousePosition(workpieceHoverPointer);
    const part = hitTestWorkpiece(point.x, point.y);
    if (part?.status !== 'moving') {
        hideWorkpieceTooltip();
        return;
    }
    const source = part && props.placedComponents.find(component => component.id === part.sourceId);
    const title = source ? getComponentLabel(source) : part?.sourceName;
    if (!title) {
        hideWorkpieceTooltip();
        return;
    }
    const anchor = workpieceTooltipAnchor.value;
    const Tooltip = window.bootstrap?.Tooltip;
    if (!anchor || !Tooltip) return;
    anchor.style.left = `${clientX}px`;
    anchor.style.top = `${clientY}px`;
    if (!workpieceTooltip) {
        workpieceTooltip = new Tooltip(anchor, {
            trigger: 'manual', placement: 'top', container: 'body',
            customClass: 'workpiece-source-tooltip',
            animation: false, delay: 0, html: false, title: () => workpieceTooltipText,
        });
    }
    if (workpieceTooltipText !== title) {
        workpieceTooltipText = title;
        workpieceTooltip.setContent({'.tooltip-inner': title});
        workpieceTooltip.show();
    } else {
        workpieceTooltip.update();
    }
};
// 米转显示字符串（去尾零），供日志与坐标显示使用
const fmtMeters = (m) => String(+m.toPrecision(6));

// 控件图标在屏幕上的最大尺寸（像素）。图标视觉大小固定，不随缩放/控件尺寸无限放大
const ICON_SIZE_PX = 32;
const OBSTACLE_HATCH_PITCH = 8 * Math.SQRT2; // 45° 斜线沿垂直于线条的方向间隔 8 CSS 像素。
const getObstacleCornerRadius = (width, height) => Math.min(3.5, width / 4, height / 4);

const drawObstacle = (ctx, {x, y, width, height}, {fillColor, selected = false, preview = false, points, circular,
    handles = selected} = {}) => {
    // 只为视口中可见的部分生成斜线。
    const left = Math.max(x, -viewOffsetX.value);
    const top = Math.max(y, -viewOffsetY.value);
    const visibleWidth = Math.min(x + width, canvasWidth.value - viewOffsetX.value) - left;
    const visibleHeight = Math.min(y + height, canvasHeight.value - viewOffsetY.value) - top;
    if (visibleWidth <= 0 || visibleHeight <= 0) return;

    ctx.save();
    if (preview) ctx.globalAlpha = 0.65;
    const centerX = x + width / 2, centerY = y + height / 2;
    const traceOutline = () => {
        ctx.beginPath();
        if (circular) {
            ctx.arc(centerX, centerY, width / 2, 0, Math.PI * 2);
        } else {
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.closePath();
        }
    };

    ctx.save();
    if (points || circular) {
        traceOutline();
        ctx.clip();
    }
    ctx.fillStyle = fillColor || DEFAULT_COMPONENT_SHADOW_COLORS[RECTANGULAR_OBSTACLE_TYPE];
    ctx.fillRect(left, top, visibleWidth, visibleHeight);

    ctx.beginPath();
    ctx.rect(left, top, visibleWidth, visibleHeight);
    ctx.clip();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const phase = ((x - left + y - top) % OBSTACLE_HATCH_PITCH + OBSTACLE_HATCH_PITCH) % OBSTACLE_HATCH_PITCH;
    for (let offset = phase; offset <= visibleWidth + visibleHeight; offset += OBSTACLE_HATCH_PITCH) {
        ctx.moveTo(left + offset, top);
        ctx.lineTo(left + offset - visibleHeight, top + visibleHeight);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = selected || preview ? "#2566fd" : "#334155";
    ctx.lineWidth = selected ? 2 : 1;
    if (preview) ctx.setLineDash([5, 3]);
    if (points || circular) {
        traceOutline();
        ctx.stroke();
    } else {
        ctx.strokeRect(x, y, width, height);
    }
    if (handles) {
        const radius = getObstacleCornerRadius(width, height);
        const handles = points ?? (circular ? [
            {x, y: centerY}, {x: x + width, y: centerY},
            {x: centerX, y}, {x: centerX, y: y + height},
        ] : [x, x + width].flatMap(cornerX =>
            [y, y + height].map(cornerY => ({x: cornerX, y: cornerY}))));
        ctx.fillStyle = "#2566fd";
        ctx.beginPath();
        for (const corner of handles) {
            ctx.moveTo(corner.x + radius, corner.y);
            ctx.arc(corner.x, corner.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
        if (points && points.every((point, index) => {
            const next = points[(index + 1) % points.length];
            return Math.hypot(point.x - next.x, point.y - next.y) >= 28;
        })) {
            const centerX = points.reduce((sum, point) => sum + point.x, 0) / 3;
            const centerY = points.reduce((sum, point) => sum + point.y, 0) / 3;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            points.forEach((point, index) => {
                const dx = point.x - centerX, dy = point.y - centerY;
                const distance = Math.hypot(dx, dy);
                ctx.fillText('ABC'[index], point.x + dx / distance * 11, point.y + dy / distance * 11);
            });
        }
    }
    ctx.restore();
};

const triangleScreenPoints = component => getTriangleVertices(component).map(point => ({
    x: toPx(point.x), y: toScreenY(point.y),
}));

const drawWall = (ctx, wall, options) => {
    const {parts, exitPoints} = getWallGeometry(wall);
    for (const {x, y, width, height} of parts) {
        drawObstacle(ctx, {x: toPx(x), y: toScreenY(y + height), width: toPx(width), height: toPx(height)},
            {...options, handles: false});
    }
    ctx.save();
    ctx.fillStyle = '#16a34a';
    for (const point of exitPoints) {
        ctx.beginPath();
        ctx.arc(toPx(point.x), toScreenY(point.y), 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
};

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
    if (component.type === RECTANGULAR_WALL_TYPE) {
        drawWall(ctx, component, {selected: isComponentSelected(component.id)});
        drawComponentLabel(ctx, component);
        return;
    }

    // 控件矩形（世界坐标 → 像素）
    const bounds = getComponentFootprint(component);
    const px = toPx(bounds.x);
    const py = toScreenY(bounds.y + bounds.height);
    const pw = toPx(bounds.width);
    const ph = toPx(bounds.height);

    if (OBSTACLE_COMPONENT_TYPES.has(component.type)) {
        drawObstacle(ctx, {x: px, y: py, width: pw, height: ph}, {
            fillColor: component.shadowColor,
            selected: isComponentSelected(component.id),
            points: component.type === TRIANGULAR_OBSTACLE_TYPE ? triangleScreenPoints(component) : undefined,
            circular: component.type === CIRCULAR_OBSTACLE_TYPE,
        });
        drawComponentLabel(ctx, component);
        return;
    }

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
            const turns = getComponentQuarterTurns(component);
            if (turns) {
                ctx.save();
                ctx.translate(px + pw / 2, py + ph / 2);
                ctx.rotate(turns * Math.PI / 2);
                ctx.drawImage(img, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
                ctx.restore();
            } else {
                ctx.drawImage(img, px + (pw - iconSize) / 2, py + (ph - iconSize) / 2, iconSize, iconSize);
            }
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

    if (connectionLineMode.value && firstPort.value) drawTempConnectionLine(ctx);
    if (agvPathMode.value && agvStartNode.value && agvPathPoints.value.length > 0) drawTempAGVPath(ctx);

    // 圆圈画在线体上方，只显示位置，不作为可拖动的对象。
    ctx.save();
    ctx.lineWidth = 2;
    ctx.fillStyle = "#ffffff";
    for (const component of props.placedComponents) {
        for (const {key, color} of getComponentPorts(component)) {
            const point = getComponentPortPosition(component, key);
            ctx.beginPath();
            ctx.arc(toPx(point.x), toScreenY(point.y), 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.stroke();
        }
    }
    ctx.restore();
};

// 站点中心坐标保持不变，矩形宽高随视图比例缩放。
const drawNodeComponent = (ctx, component) => {
    const bounds = getComponentFootprint(component);
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

    const bounds = getComponentFootprint(component);
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

// 由两点算出一条带箭头的线段的完整几何：
// start    起点
// end      终点，线体一直画到这里
// arrowTip 箭尖位置。箭头画在线段中点并沿轴向居中，因此箭尖落在
//          中点前方半个箭头长度处，三角形整体正好被中点平分
// slant    本次实际使用的箭头斜边长（空间不足时等比缩小）
// length   start 到 end 的可见长度
// 返回 null 表示两控件贴得太近，没有可见线段
const computeLineGeometry = (startPoint, endPoint) => {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.hypot(dx, dy);

    // 长度为 0：两点几乎重合，无可绘制内容
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

// 绘制实心三角箭头。箭尖位置由 geo.arrowTip 给出（线段中点前方半个箭头），
// 方向由 geo 的单位向量给出，直接旋转 ±halfAngle 得到两个后角，无需再算 atan2
const drawArrow = (ctx, geo, color) => {
    const {arrowTip: tip, ux, uy, slant} = geo;

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

const connectionScreenPoint = (point) => ({x: toPx(point.x), y: toScreenY(point.y)});

const connectionArrow = (segment) => {
    if (!segment.length) return null;
    if (segment.type === 'line') return computeLineGeometry(connectionScreenPoint(segment.start), connectionScreenPoint(segment.end));
    const {x, y, ux, uy} = pointOnPathSegment(segment, 0.5);
    const half = segment.length / 2;
    return computeLineGeometry(connectionScreenPoint({x: x - ux * half, y: y - uy * half}),
        connectionScreenPoint({x: x + ux * half, y: y + uy * half}));
};

const drawConnectionLine = (ctx, line) => {
    const route = getConnectionGeometry(line, props.placedComponents);
    if (!route) return;
    const selected = isComponentSelected(line.id);
    const color = selected ? LINE_COLOR_SELECTED : LINE_COLOR;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? LINE_WIDTH_SELECTED : LINE_WIDTH;
    ctx.lineJoin = 'round';
    if (route.length > 0) {
        tracePathGeometry(ctx, route.segments, ppm.value);
        ctx.stroke();
        for (const segment of route.segments) {
            const arrow = connectionArrow(segment);
            if (arrow) drawArrow(ctx, arrow, color);
        }
    }
    if (selected) {
        const half = CONNECTION_HANDLE_SIZE / 2;
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        for (const point of route.nodes.slice(1, -1)) {
            const {x, y} = connectionScreenPoint(point);
            ctx.fillRect(x - half, y - half, CONNECTION_HANDLE_SIZE, CONNECTION_HANDLE_SIZE);
            ctx.strokeRect(x - half, y - half, CONNECTION_HANDLE_SIZE, CONNECTION_HANDLE_SIZE);
        }
    }
    ctx.restore();
};

// 已落点用实线，下一段用虚线跟随鼠标。
const drawTempConnectionLine = (ctx) => {
    const {component, key} = firstPort.value;
    const start = connectionScreenPoint(getComponentPortPosition(component, key));
    const bounds = getComponentFootprint(component);
    ctx.save();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeRect(toPx(bounds.x) - 1, toScreenY(bounds.y + bounds.height) - 1,
        toPx(bounds.width) + 2, toPx(bounds.height) + 2);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    let tail = start;
    for (const point of connectionWaypoints.value) {
        tail = connectionScreenPoint(point);
        ctx.lineTo(tail.x, tail.y);
    }
    ctx.stroke();
    if (tempLineEnd.value) {
        const tip = connectionScreenPoint(tempLineEnd.value);
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
    }
    ctx.restore();
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
    drawAGVPath(ctx, {nodes, pathWidth: DEFAULT_PATH_WIDTH}, true);
    ctx.save();
    ctx.strokeStyle = AGV_PATH_COLOR;
    ctx.lineWidth = 2;
    const bounds = getComponentFootprint(agvStartNode.value);
    ctx.strokeRect(toPx(bounds.x) - 1, toScreenY(bounds.y + bounds.height) - 1,
        toPx(bounds.width) + 2, toPx(bounds.height) + 2);
    ctx.restore();
};

const drawCursor = (ctx) => {
    const cx = toPx(cursorX.value);
    const cy = toScreenY(cursorY.value);
    const type = props.activeControl?.type;
    const size = DEFAULT_COMPONENT_SIZES[type] ?? DEFAULT_STATION_SIZE;
    const width = toPx(size.width);
    const height = toPx(size.height);
    const bounds = {x: cx - width / 2, y: cy - height / 2, width, height};
    if (type === RECTANGULAR_WALL_TYPE) {
        drawWall(ctx, {x: cursorX.value - size.width / 2, y: cursorY.value - size.height / 2, ...size},
            {preview: true});
    } else if (OBSTACLE_COMPONENT_TYPES.has(type)) {
        const points = type === TRIANGULAR_OBSTACLE_TYPE
            ? triangleScreenPoints({x: cursorX.value - size.width / 2, y: cursorY.value - size.height / 2})
            : undefined;
        drawObstacle(ctx, bounds, {preview: true, points, circular: type === CIRCULAR_OBSTACLE_TYPE});
    } else {
        ctx.save();
        const station = type === "node" ? getStationType(props.activeControl) : null;
        ctx.fillStyle = station?.fill || "rgba(37, 99, 235, 0.06)";
        ctx.strokeStyle = station?.color || "#2563eb";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.fillRect(bounds.x, bounds.y, width, height);
        ctx.strokeRect(bounds.x, bounds.y, width, height);
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

const isInsideCanvas = (point) => fitsCanvasBounds({...point, width: 0, height: 0}, props.canvasBoundary);
const snapCanvasPoint = (point, padding = 0) => clampCanvasPoint({x: snapToStep(point.x), y: snapToStep(point.y)}, props.canvasBoundary, padding);

// 对齐按屏幕距离判断，避免缩放后吸附范围过大或难以触发。
const alignToComponents = (raw, fallback, excludedIds, event, lockedAxis = null) => {
    alignmentGuides.value = [];
    if (event.altKey) return fallback;
    const margin = ALIGNMENT_THRESHOLD_PX / ppm.value;
    const viewportWidth = canvasWidth.value / ppm.value;
    const viewportHeight = canvasHeight.value / ppm.value;
    const targets = props.placedComponents
        .filter((item) => isMovableComponent(item) && !excludedIds.has(item.id))
        .map((item) => ({id: item.id, ...getComponentFootprint(item)}))
        .filter((item) =>
            Number.isFinite(item.x) && Number.isFinite(item.y) &&
            item.x + (item.width ?? 0) >= viewOrigin.value.x - margin &&
            item.x <= viewOrigin.value.x + canvasWidth.value / ppm.value + margin &&
            item.y + (item.height ?? 0) >= viewOrigin.value.y - canvasHeight.value / ppm.value - margin &&
            item.y <= viewOrigin.value.y + margin
        );
    targets.push(
        {
            id: "axis-x",
            axes: ["y"],
            anchorKinds: ["edge", "center"],
            x: viewOrigin.value.x,
            y: 0,
            width: viewportWidth,
            height: 0
        },
        {
            id: "axis-y",
            axes: ["x"],
            anchorKinds: ["edge", "center"],
            x: 0,
            y: viewOrigin.value.y - viewportHeight,
            width: 0,
            height: viewportHeight
        },
    );
    if (viewOrigin.value.x <= margin && viewOrigin.value.x + viewportWidth >= -margin &&
        viewOrigin.value.y - viewportHeight <= margin && viewOrigin.value.y >= -margin) {
        targets.push({id: "origin", anchorKinds: ["center"], x: 0, y: 0, width: 0, height: 0});
    }
    const result = alignBounds(raw, fallback, targets, margin, lockedAxis);
    alignmentGuides.value = result.guides;
    return result;
};

// 预览和落点使用同一套计算，吸附后的中心位置就是实际放置位置。
const getPlacementAnchor = (position, event) => {
    if (!isInsideCanvas(position)) return null;
    const type = props.activeControl?.type;
    const size = DEFAULT_COMPONENT_SIZES[type] ?? DEFAULT_STATION_SIZE;
    const raw = {x: position.x - size.width / 2, y: position.y - size.height / 2, ...size};
    const fallback = {
        ...size, x: snapToStep(position.x) - size.width / 2, y: snapToStep(position.y) - size.height / 2,
    };
    const aligned = alignToComponents(raw, fallback, new Set(), event);
    const obstacles = props.placedComponents.map(getCollisionFootprint).filter(Boolean);
    const fit = ({x, y}) => {
        const bounds = {...size, x, y};
        const footprint = type === "node" ? bounds : getCollisionFootprint({...bounds, type});
        const offset = clampCanvasOffset(footprint, {x: 0, y: 0}, props.canvasBoundary);
        if (!offset) return null;
        const adjusted = {...footprint, x: footprint.x + offset.x, y: footprint.y + offset.y};
        return obstacles.some(obstacle => footprintsOverlap(adjusted, obstacle))
            ? null : {...bounds, x: x + offset.x, y: y + offset.y};
    };
    // 吸附位置被占用时，仍允许在未吸附的空闲格点放置。
    const placement = fit(aligned) ?? (aligned.x !== fallback.x || aligned.y !== fallback.y ? fit(fallback) : null);
    if (!placement) {
        alignmentGuides.value = [];
        return null;
    }
    alignmentGuides.value = alignmentGuides.value.filter(guide => placement[guide.axis] === aligned[guide.axis]);
    return {x: placement.x + size.width / 2, y: placement.y + size.height / 2};
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

        const bounds = getComponentFootprint(component);
        if (
            x >= bounds.x &&
            x <= bounds.x + bounds.width &&
            y >= bounds.y &&
            y <= bounds.y + bounds.height
        ) {
            if (component.type === RECTANGULAR_WALL_TYPE && !getWallGeometry(component).parts.some(part =>
                x >= part.x && x <= part.x + part.width && y >= part.y && y <= part.y + part.height)) continue;
            if (component.type === CIRCULAR_OBSTACLE_TYPE) {
                const radius = bounds.width / 2;
                if (Math.hypot(x - bounds.x - radius, y - bounds.y - radius) > radius) continue;
            }
            if (component.type === TRIANGULAR_OBSTACLE_TYPE) {
                const points = getTriangleVertices(component);
                const signs = points.map((start, index) => {
                    const end = points[(index + 1) % points.length];
                    return (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
                });
                if (signs.some(sign => sign > 0) && signs.some(sign => sign < 0)) continue;
            }
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
            return {pathId: selectedPath.id, cornerIndex: i};
        }
    }

    return null;
};

const hitTestConnectionCorner = (line, x, y, includeHandles) => {
    const route = getConnectionGeometry(line, props.placedComponents);
    if (!route) return null;
    const tolerance = toMeters(CONNECTION_HANDLE_SIZE / 2 + LINE_GRAB_MARGIN);
    // 靠近端口时保留组件的选择，避免把端口误当成重合的拐点。
    if ([route.start, route.end].some(point => Math.hypot(x - point.x, y - point.y) <= tolerance)) return null;
    if (includeHandles) {
        const index = route.nodes.slice(1, -1).findIndex(point => Math.abs(x - point.x) <= tolerance && Math.abs(y - point.y) <= tolerance);
        if (index >= 0) return {pathId: line.id, cornerIndex: index};
    }
    const arc = route.segments.find(segment => segment.type === 'arc' && distanceToPathSegment(segment, x, y) <= tolerance);
    return arc ? {pathId: line.id, cornerIndex: arc.cornerIndex} : null;
};

const getDraggablePathCorner = (path, index) => (path?.type === 'connectionLine' ? path.waypoints : path?.nodes)?.[index];

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

const hitTestConnectionLine = (line, x, y) => {
    const route = getConnectionGeometry(line, props.placedComponents);
    const tolerance = toMeters(LINE_WIDTH_SELECTED / 2 + LINE_GRAB_MARGIN);
    return !!route?.segments.some(segment => {
        if (!segment.length) return false;
        if (distanceToPathSegment(segment, x, y) <= tolerance) return true;
        const arrow = connectionArrow(segment);
        return arrow && isPointInArrow(toPx(x), toScreenY(y), arrow);
    });
};

// 判断点是否落在箭头三角形内（含 LINE_GRAB_MARGIN 的外扩）。
// 箭头挪到中间后它整体落在线体的判定带附近，这一步多数情况是冗余的；
// 但箭头比线宽得多，保留它才能保证以后调大箭头时命中区仍然跟着变
const isPointInArrow = (px, py, geo) => {
    const {arrowTip: tip, ux, uy, slant} = geo;

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
    if (!rect) return {display: "none"};

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

    emit("rename-component", {id, displayName: newLabel});
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
        segments: agvPathPoints.value.slice(1).map(() => ({type: "line", radius: 0})),
        // 每个拐点的圆角半径（不包括起点和终点站点）
    };
    if (!fitsCanvasBounds(getCanvasItemBounds(agvPath), props.canvasBoundary)) {
        agvPathPoints.value.pop();
        emit("add-log", "有限画布：AGV 通道需要留在边界内。");
        return;
    }
    if (hasWallRouteCollision(props.placedComponents, [agvPath])) {
        agvPathPoints.value.pop();
        emit("add-log", "AGV 路径：通道必须从有足够宽度的围墙出口通过。");
        return;
    }

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
    panStart = {x: e.clientX, y: e.clientY, origin: {...viewOrigin.value}};
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
            const route = getConnectionGeometry(item, props.placedComponents);
            if (!route?.length) return false;
            const bounds = getPathGeometryBounds(route.segments);
            return containsPoint(bounds.minX, bounds.minY) && containsPoint(bounds.maxX, bounds.maxY);
        }
        if (item.type === "AGVpath") {
            const bounds = getPathBounds(item);
            return bounds && containsPoint(bounds.minX, bounds.minY) && containsPoint(bounds.maxX, bounds.maxY);
        }
        const bounds = getComponentFootprint(item);
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

const hitTestObstacleBorder = (point) => {
    const margin = toMeters(5);
    for (let i = props.placedComponents.length - 1; i >= 0; i--) {
        const item = props.placedComponents[i];
        if (!isComponentSelected(item.id)) continue;
        if (item.type === CIRCULAR_OBSTACLE_TYPE) {
            const center = getComponentCenter(item);
            const radius = getComponentFootprint(item).width / 2;
            const grabRadius = Math.hypot(point.x - center.x, point.y - center.y);
            if (Math.abs(grabRadius - radius) <= Math.min(margin, radius / 2)) {
                return {id: item.id, axis: 'radius', center, radius, grabRadius};
            }
            continue;
        }
        if (item.type === TRIANGULAR_OBSTACLE_TYPE) {
            const points = getTriangleVertices(item);
            const distances = points.map(vertex => Math.hypot(vertex.x - point.x, vertex.y - point.y));
            const nearest = Math.min(...distances);
            if (nearest <= toMeters(7)) {
                const index = distances.indexOf(nearest);
                return {id: item.id, axis: 'vertex', index, vertex: points[index]};
            }
            const onEdge = points.some((start, index) => {
                const end = points[(index + 1) % points.length];
                const length = Math.hypot(end.x - start.x, end.y - start.y);
                return distanceToPathSegment({type: 'line', start, end, length}, point.x, point.y) <= toMeters(2);
            });
            if (onEdge) return {id: item.id};
            continue;
        }
        if (item.type !== RECTANGULAR_OBSTACLE_TYPE) continue;
        const {x, y, width, height} = getComponentFootprint(item);
        const right = x + width, top = y + height;
        const leftGap = Math.abs(point.x - x), rightGap = Math.abs(point.x - right);
        const bottomGap = Math.abs(point.y - y), topGap = Math.abs(point.y - top);
        const gapX = Math.min(leftGap, rightGap), gapY = Math.min(bottomGap, topGap);
        const cornerRadius = toMeters(getObstacleCornerRadius(toPx(width), toPx(height)) * 1.35);
        // 角点只是轮廓标记，优先消耗命中，避免被当作边或整个障碍物的拖动起点。
        if (Math.hypot(gapX, gapY) <= cornerRadius) return {id: item.id};
        const vertical = gapX <= margin && point.y >= y && point.y <= top;
        const horizontal = gapY <= margin && point.x >= x && point.x <= right;
        if (vertical && (!horizontal || gapX <= gapY)) {
            return leftGap <= rightGap ? {id: item.id, axis: 'x', direction: -1, edge: x}
                : {id: item.id, axis: 'x', direction: 1, edge: right};
        }
        if (horizontal) {
            return bottomGap <= topGap ? {id: item.id, axis: 'y', direction: -1, edge: y}
                : {id: item.id, axis: 'y', direction: 1, edge: top};
        }
    }
    return null;
};

const toggleComponentSelection = (id) => {
    const ids = [...selectedIdSet.value];
    emit("select-components", isComponentSelected(id) ? ids.filter((selected) => selected !== id) : [...ids, id]);
};

function clearConnectionDraft() {
    firstPort.value = null;
    connectionWaypoints.value = [];
    tempLineEnd.value = null;
}

function undoDraftPoint() {
    if (firstPort.value) {
        if (connectionWaypoints.value.length) {
            connectionWaypoints.value.pop();
            tempLineEnd.value = null;
        } else {
            clearConnectionDraft();
        }
    } else if (agvStartNode.value) {
        agvPathPoints.value.pop();
        tempAGVPoint.value = null;
        if (!agvPathPoints.value.length) agvStartNode.value = null;
    } else {
        return false;
    }
    drawGrid();
    return true;
}

const cancelConnectionDraft = () => {
    if (!firstPort.value) return;
    clearConnectionDraft();
    emit("add-log", "连接线：已取消当前绘制");
    drawGrid();
};

const handleCanvasContextMenu = (event) => {
    if (connectionLineMode.value) event.preventDefault();
};

const findConnectionPort = (position) => {
    const first = firstPort.value;
    const keys = first ? [first.key === 'loadPoint' ? 'unloadPoint' : 'loadPoint'] : ['unloadPoint', 'loadPoint'];
    let nearest = null;
    let closest = toMeters(CONNECTION_PORT_GRAB);
    for (const component of [...props.placedComponents].reverse()) {
        if (component.type === 'node' || component.id === first?.component.id) continue;
        for (const key of keys) {
            const point = getComponentPortPosition(component, key);
            if (!point) continue;
            const distance = Math.hypot(position.x - point.x, position.y - point.y);
            if (distance > closest || (nearest && distance === closest)) continue;
            closest = distance;
            nearest = {component, key, point};
        }
    }
    return nearest;
};

const placeConnectionPoint = (position) => {
    const port = findConnectionPort(position);
    const first = firstPort.value;
    if (!port) {
        if (first) {
            const point = snapCanvasPoint(position);
            const last = connectionWaypoints.value.at(-1) ?? getComponentPortPosition(first.component, first.key);
            if (Math.hypot(point.x - last.x, point.y - last.y) > 1e-9) connectionWaypoints.value.push(point);
            tempLineEnd.value = point;
            drawGrid();
        } else {
            const hit = hitTestComponent(position.x, position.y);
            emit("add-log", hit?.type === 'node' ? "连接线：不能连接站点，请使用 AGV 路径连接站点" : "连接线：请点击组件的上料点或下料点");
        }
        return;
    }
    if (!first) {
        firstPort.value = port;
        tempLineEnd.value = port.point;
        emit("add-log", "连接线：已选择起点 " + getComponentLabel(port.component));
        drawGrid();
        return;
    }
    // 两端均可作为落笔端，模型中的运输方向统一为下料点到上料点。
    const forward = first.key === 'unloadPoint';
    const from = forward ? first.component : port.component;
    const to = forward ? port.component : first.component;
    const waypoints = [...connectionWaypoints.value];
    if (!forward) waypoints.reverse();
    const index = getNextIndexForType("connectionLine");
    const line = {
        id: createComponentId(), type: "connectionLine", name: "连接线", index,
        icon: props.activeControl.icon, tabId: props.activeControl.tabId,
        fromId: from.id, toId: to.id, fromName: getComponentLabel(from), toName: getComponentLabel(to),
        waypoints,
    };
    if (!fitsCanvasBounds(getCanvasItemBounds(line), props.canvasBoundary)) {
        emit("add-log", "有限画布：连接线拐点需要留在边界内。");
        return;
    }
    if (hasWallRouteCollision(props.placedComponents, [line])) {
        emit("add-log", "连接线：请从围墙出口通过。");
        return;
    }
    emit("component-placed", line);
    emit("add-log", '新建对象，类型：connectionLine，编号：连接线' + index + '，连接：' + line.fromName + ' → ' + line.toName);
    clearConnectionDraft();
    emit("placement-done");
    drawGrid();
};

// 鼠标事件处理
const handleMouseDown = async (e) => {
    clearWorkpieceHover();
    if (e.button === 2 && connectionLineMode.value) {
        e.preventDefault();
        cancelConnectionDraft();
        return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    if (panning.value || selectionBox.value || dragging.value || draggingCorner.value || obstacleResize.value) return;
    // 对齐参考线
    alignmentGuides.value = [];
    // 点击画布先结束文字编辑，避免聚焦引发 blur 后误放置新控件。
    if (editingId.value) {
        commitLabelEdit();
        return;
    }
    // getBoundingClientRect() 是浏览器提供的 DOM 原生方法，它返回一个 DOMRect 对象，记录元素相对于浏览器视口的位置和尺寸，例如：
    const rect = canvas.value.getBoundingClientRect();
    // console.log("e.clientX=",e.clientX,"rect.left=",rect.left)
    // 没看懂
    if (e.clientX < rect.left || e.clientY < rect.top) return;
    // focus() 让画布获得键盘焦点，这样它可以接收键盘操作。`preventScroll: true` 表示聚焦时不让浏览器自动滚动页面。
    canvas.value.focus({preventScroll: true});
    // setPointerCapture() 让画布捕获当前指针。之后即使指针移出画布，相关的 pointermove 和 pointerup 事件仍会发给画布，便于持续完成拖动。
    canvas.value.setPointerCapture(e.pointerId);    // `e.pointerId` 用来指定当前是哪一个指针
    if (e.button === 1) {
        startPan(e);
        return;
    }
    // AGV 路径模式：点击站点开始绘制，左键添加拐点，点击站点结束
    if (agvPathMode.value) {
        const pos = getCanvasMousePosition(e);
        if (!isInsideCanvas(pos)) return;
        const hit = hitTestComponent(pos.x, pos.y);

        // 如果还没有起点站点，必须先点击站点
        if (!agvStartNode.value) {
            if (!hit || hit.type !== "node") {
                emit("add-log", "AGV 路径：请点击起点站点");
                return;
            }
            if (!fitsCanvasBounds(getCanvasItemBounds({type: 'AGVpath', nodes: [hit]}), props.canvasBoundary)) {
                emit("add-log", "有限画布：起点附近没有足够空间放置 AGV 通道。");
                return;
            }

            // 记录起点站点
            agvStartNode.value = hit;
            // 路径点数组的第一个点就是起点站点坐标
            agvPathPoints.value = [{x: hit.x, y: hit.y}];
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
            agvPathPoints.value.push({x: hit.x, y: hit.y});

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
        const point = snapCanvasPoint(pos, DEFAULT_PATH_WIDTH / 2);
        if (!point) return;

        // 添加拐点到路径（世界坐标，米）
        agvPathPoints.value.push(point);
        emit("add-log", `AGV 路径：添加拐点 (${fmtMeters(point.x)}, ${fmtMeters(point.y)}) m`);

        drawGrid();
        return;
    }

    if (connectionLineMode.value) {
        const pos = getCanvasMousePosition(e);
        if (isInsideCanvas(pos)) placeConnectionPoint(pos);
        return;
    }

    // 选择模式：左键拖动控件，空白处开始框选。
    if (!shouldShowCustomCursor.value) {
        const pos = getCanvasMousePosition(e);
        const border = !e.shiftKey && hitTestObstacleBorder(pos);
        if (border) {
            if (border.axis) {
                obstacleResize.value = {...border, grab: pos};
                emit('canvas-drag-start');
            }
            return;
        }

        const selected = props.placedComponents.find(item => item.id === props.selectedId);
        let cornerHit = hitTestConnectionCorner(selected, pos.x, pos.y, true) ?? hitTestAGVCorner(pos.x, pos.y);
        const hit = cornerHit ? props.placedComponents.find(item => item.id === cornerHit.pathId) : hitTestComponent(pos.x, pos.y);
        if (!cornerHit && hit?.type === 'connectionLine' && hit !== selected) {
            cornerHit = hitTestConnectionCorner(hit, pos.x, pos.y, false);
        }
        if (cornerHit && !e.shiftKey) {
            // 开始拖拽拐点
            draggingCorner.value = true;
            dragPathId.value = cornerHit.pathId;
            dragCornerIndex.value = cornerHit.cornerIndex;

            const corner = getDraggablePathCorner(hit, cornerHit.cornerIndex);
            dragCornerOriginX.value = corner.x;
            dragCornerOriginY.value = corner.y;
            dragOffsetX.value = pos.x - corner.x;
            dragOffsetY.value = pos.y - corner.y;
            if (!isComponentSelected(hit.id)) emit('select-component', hit.id);
            emit("canvas-drag-start");
            return;
        }

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
                .map((item) => ({
                    id: item.id,
                    type: item.type,
                    x: item.x,
                    y: item.y,
                    bounds: getCollisionFootprint(item) ?? getComponentFootprint(item)
                }));
            dragFootprint = getCanvasMoveBounds(new Set(dragOrigins.map(item => item.id)), props.placedComponents);
            emit("canvas-drag-start");
        } else {
            emit("select-component", hit.id);
        }
        return;
    }

    // 使用点击时的世界坐标，平移或恢复全局视图后无需先移动鼠标。
    const position = getCanvasMousePosition(e);
    const anchor = getPlacementAnchor(position, e);
    if (!anchor) {
        if (isInsideCanvas(position)) emit("add-log", "无法放置：这里没有足够的空闲空间。");
        return;
    }
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
    const type = props.activeControl.type;
    const defaultSize = DEFAULT_COMPONENT_SIZES[type] ?? DEFAULT_STATION_SIZE;
    const componentX = anchorX - defaultSize.width / 2;
    const componentY = anchorY - defaultSize.height / 2;

    const finalX = componentX;
    const finalY = componentY;

    // 预加载图片
    const triangleVertices = type === TRIANGULAR_OBSTACLE_TYPE ? getLocalTriangleVertices({}) : undefined;
    if (!OBSTACLE_COMPONENT_TYPES.has(type)) await preloadImage(props.activeControl.icon);
    const bounds = getCollisionFootprint({...defaultSize, type, x: finalX, y: finalY, triangleVertices});
    if (!fitsCanvasBounds(bounds, props.canvasBoundary) || props.placedComponents.some(item => {
        const obstacle = getCollisionFootprint(item);
        return obstacle && footprintsOverlap(bounds, obstacle);
    })) return;

    // 计算同类型控件的序号（填补被删除控件留下的空缺）
    const index = getNextIndexForType(props.activeControl.type);

    // 生成稳定唯一 id（序号 index 会被复用，不能当作 id）
    const id = createComponentId();

    // 通知父组件新增控件（父组件维护 placedComponents 单一数据源，模型树共享）
    const component = {
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
        ...(triangleVertices ? {triangleVertices} : {}),
    };
    if (type === RECTANGULAR_WALL_TYPE && hasWallRouteCollision(props.placedComponents, [component])) {
        emit("add-log", "无法放置：墙体会挡住已有的连接线或 AGV 路径。");
        return;
    }
    emit("component-placed", component);

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
    workpieceHoverPointer = {clientX: e.clientX, clientY: e.clientY, buttons: e.buttons ?? 0};
    updateWorkpieceTooltip();
    alignmentGuides.value = [];
    hoveredObstacleAxis.value = null;
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

    if (obstacleResize.value) {
        const {id, axis, direction, edge, grab, index, vertex, center, radius, grabRadius} = obstacleResize.value;
        if (axis === 'vertex') {
            const point = clampCanvasPoint({
                x: vertex.x + snapToStep(pos.x - grab.x),
                y: vertex.y + snapToStep(pos.y - grab.y),
            }, props.canvasBoundary);
            if (point) emit('update-component-position', {id, triangleVertex: {index, point}});
        } else if (axis === 'radius') {
            const delta = Math.hypot(pos.x - center.x, pos.y - center.y) - grabRadius;
            emit('resize-obstacle-edge', {id, axis, radius: radius + snapToStep(delta)});
        } else {
            emit('resize-obstacle-edge', {id, axis, direction, coordinate: edge + snapToStep(pos[axis] - grab[axis])});
        }
        drawGrid();
        return;
    }

    // 拖拽路径拐点，保留鼠标相对拐点的抓取偏移。
    if (draggingCorner.value && dragPathId.value !== null && dragCornerIndex.value !== null) {
        const path = props.placedComponents.find((c) => c.id === dragPathId.value);
        const index = dragCornerIndex.value;
        const corner = getDraggablePathCorner(path, index);
        if (!corner) return;

        // 对齐到小网格线交点
        const offsetX = snapToStep(pos.x - dragOffsetX.value - dragCornerOriginX.value);
        const offsetY = snapToStep(pos.y - dragOffsetY.value - dragCornerOriginY.value);
        let newX = offsetX ? Number((dragCornerOriginX.value + offsetX).toFixed(10)) : dragCornerOriginX.value;
        let newY = offsetY ? Number((dragCornerOriginY.value + offsetY).toFixed(10)) : dragCornerOriginY.value;

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

        const padding = path.type === 'AGVpath' ? getPathWidth(path) / 2 : 0;
        const point = clampCanvasPoint({x: newX, y: newY}, props.canvasBoundary, padding);
        if (!point || (corner.x === point.x && corner.y === point.y)) return;
        if (path.type === 'connectionLine') {
            emit('update-component-position', {id: path.id, connectionCorner: {index, point}});
        } else {
            const nodes = [...path.nodes];
            nodes[index] = point;
            emit('update-component-position', {id: path.id, nodes});
        }

        drawGrid();
        return;
    }

    // AGV 路径模式且已选中起点站点：更新临时预览点
    if (agvPathMode.value && agvStartNode.value) {
        const station = hitTestComponent(pos.x, pos.y);
        tempAGVPoint.value = station?.type === "node"
            ? clampCanvasPoint({x: station.x, y: station.y}, props.canvasBoundary, DEFAULT_PATH_WIDTH / 2)
            : snapCanvasPoint(pos, DEFAULT_PATH_WIDTH / 2);
        drawGrid();
        return;
    }

    if (connectionLineMode.value && firstPort.value) {
        tempLineEnd.value = findConnectionPort(pos)?.point ?? clampCanvasPoint(pos, props.canvasBoundary);
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
        const {x: minX, y: minY, width, height} = encloseCanvasBounds(dragOrigins.map(item => item.bounds));
        const movingIds = new Set(dragOrigins.map(item => item.id));
        const aligned = alignToComponents(
            {width, height, x: minX + rawX - dragOriginX.value, y: minY + rawY - dragOriginY.value},
            {width, height, x: minX + newX - dragOriginX.value, y: minY + newY - dragOriginY.value},
            movingIds, e, lockedAxis,
        );
        const offset = {x: aligned.x - minX, y: aligned.y - minY};
        const bounded = clampCanvasOffset(dragFootprint, offset, props.canvasBoundary);
        if (!bounded) return;
        const from = {x: draggedComponent.x - dragOriginX.value, y: draggedComponent.y - dragOriginY.value};
        const moving = dragOrigins.map(({bounds}) => ({...bounds, x: bounds.x + from.x, y: bounds.y + from.y}));
        const obstacles = props.placedComponents.filter(item => !movingIds.has(item.id)).map(getCollisionFootprint).filter(Boolean);
        const traveled = resolveComponentDrag(moving, obstacles, {x: bounded.x - from.x, y: bounded.y - from.y});
        const allowed = {x: from.x + traveled.x, y: from.y + traveled.y};
        alignmentGuides.value = alignmentGuides.value.filter(guide => Math.abs(offset[guide.axis] - allowed[guide.axis]) < 1e-8);
        newX = Number((dragOriginX.value + allowed.x).toFixed(10));
        newY = Number((dragOriginY.value + allowed.y).toFixed(10));

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
            emit("update-component-position", {id: dragId.value, x: newX, y: newY});
        }

        drawGrid();
        return;
    }

    const shouldShow = shouldShowCustomCursor.value;
    if (!shouldShow && !e.shiftKey) hoveredObstacleAxis.value = hitTestObstacleBorder(pos)?.axis ?? null;
    const anchor = shouldShow ? getPlacementAnchor(pos, e) : {x: snapToStep(pos.x), y: snapToStep(pos.y)};
    if (anchor) {
        cursorX.value = anchor.x;
        cursorY.value = anchor.y;
    }
    showCursor.value = shouldShow && !!anchor;

    drawGrid();
};

const endDrag = () => {
    if (dragMoved.value) {
        dragOrigins.forEach((origin) => {
            const moved = props.placedComponents.find((item) => item.id === origin.id);
            if (!moved || (moved.x === origin.x && moved.y === origin.y)) return;
            const center = getComponentCenter(moved);
            emit("add-log", `移动对象，编号：${getComponentLabel(moved)}` +
                `，中心点物理坐标：(${fmtMeters(center.x + (origin.x - moved.x))} m, ${fmtMeters(center.y + (origin.y - moved.y))} m)` +
                ` → (${fmtMeters(center.x)} m, ${fmtMeters(center.y)} m)`);
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
    dragFootprint = null;
    shiftClickId = null;
    keepSelectionOnClick = false;
};

const finishCanvasDrag = () => {
    if (!draggingCorner.value && !dragging.value && !obstacleResize.value) return;
    if (alignmentGuides.value.length) {
        alignmentGuides.value = [];
        drawGrid();
    }
    // 结束拐点拖拽
    if (obstacleResize.value) {
        obstacleResize.value = null;
        hoveredObstacleAxis.value = null;
    } else if (draggingCorner.value) {
        const path = props.placedComponents.find((c) => c.id === dragPathId.value);
        const corner = getDraggablePathCorner(path, dragCornerIndex.value);
        if (corner) {
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
    } else {
        endDrag();
    }
    emit("canvas-drag-end");
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
    finishCanvasDrag();
};

const handlePointerCancel = () => {
    clearWorkpieceHover();
    cancelSelectionBox();
    handleMouseUp();
};

const handleMouseLeave = () => {
    clearWorkpieceHover();
    alignmentGuides.value = [];
    hoveredObstacleAxis.value = null;
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

const handleMouseEnter = (event) => {
    // 鼠标进入画布
    mouseInsideCanvas.value = true;
    if (event) {
        workpieceHoverPointer = {clientX: event.clientX, clientY: event.clientY, buttons: event.buttons ?? 0};
        updateWorkpieceTooltip();
    }
};

// 缩放只改变视图，鼠标下面的世界坐标保持不变。
const handleWheel = (e) => {
    if (panning.value || selectionBox.value || dragging.value || draggingCorner.value || obstacleResize.value) return;
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
    viewOrigin.value = {x: anchor.x - mx / nextPpm, y: anchor.y + my / nextPpm};
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
const fitComponentsInView = (components, {maxScale = 100, minExtent = 3, boundary = null} = {}) => {
    const points = boundary ? [boundary, {x: boundary.x + boundary.width, y: boundary.y + boundary.height}] : [];
    let labelPadding = 48;
    const ctx = canvas.value?.getContext("2d");
    if (ctx) ctx.font = LABEL_FONT;
    components.forEach((component) => {
        if (component.type === "connectionLine") {
            const route = getConnectionGeometry(component, props.placedComponents);
            if (route) points.push(...route.nodes);
            return;
        }
        if (component.type === "AGVpath") {
            const bounds = getPathBounds(component);
            if (bounds) points.push({x: bounds.minX, y: bounds.minY}, {x: bounds.maxX, y: bounds.maxY});
        } else if (component.type === 'workpiece' && component.angle) {
            const center = component.position ?? {x: component.x + component.width / 2, y: component.y + component.height / 2};
            const radians = component.angle * Math.PI / 180;
            const halfWidth = (Math.abs(component.width * Math.cos(radians)) + Math.abs(component.height * Math.sin(radians))) / 2;
            const halfHeight = (Math.abs(component.width * Math.sin(radians)) + Math.abs(component.height * Math.cos(radians))) / 2;
            points.push({x: center.x - halfWidth, y: center.y - halfHeight}, {x: center.x + halfWidth, y: center.y + halfHeight});
        } else {
            const bounds = getComponentFootprint(component);
            points.push({x: bounds.x, y: bounds.y});
            points.push({x: bounds.x + bounds.width, y: bounds.y + bounds.height});
        }
        if (ctx && component.type !== 'workpiece') {
            labelPadding = Math.max(labelPadding, ctx.measureText(getComponentLabel(component)).width + 24);
        }
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
    const visibleParts = (props.workpieces ?? []).filter(part => !part.stackHidden);
    if (!fitComponentsInView([...props.placedComponents, ...visibleParts], {boundary: props.canvasBoundary})) centerOrigin();
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
        ? [component, ...props.placedComponents.filter((item) => item.id === component.fromId || item.id === component.toId)]
        : [component];
    if (!fitComponentsInView(targets, {maxScale: MAX_PPM, minExtent: 1})) return;
    showCursor.value = false;
    drawGrid();
};

defineExpose({resetZoom, focusComponent, undoDraftPoint, finishCanvasDrag});

watch(() => props.workpieces, () => drawGrid());
watch(() => props.showCoordinateSystem, () => drawGrid());
watch(() => props.canvasBoundary, () => {
    showCursor.value = false;
    drawGrid();
});

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

        if (firstPort.value && !props.placedComponents.includes(firstPort.value.component)) clearConnectionDraft();

        if (canvas.value) {
            drawGrid();
        }
    },
    {deep: true},
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
        if (firstPort.value) cancelConnectionDraft();
        else emit("placement-done");
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
    workpieceTooltip?.dispose();
    workpieceTooltip = null;
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

.zoom-btn:hover {
    background: #e5e7eb;
}

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

.workpiece-tooltip-anchor {
    position: fixed;
    width: 1px;
    height: 1px;
    pointer-events: none;
}

:global(.workpiece-source-tooltip) { pointer-events: none; }

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

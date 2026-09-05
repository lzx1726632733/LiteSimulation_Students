# AGV路径拐点拖动功能实现说明

## 功能概述
实现了AGV路径拐点的拖动功能，拖动拐点后会自动更新相关联的AGV路线。圆角半径使用米作为单位，并自动检测圆角是否过大。

## 主要修改

### 1. DesignCanvas.vue - 添加拖拽状态管理

#### 新增状态变量（第151-155行）
```javascript
const draggingCorner = ref(false); // 是否正在拖拽拐点
const dragPathId = ref(null); // 正在拖拽拐点所属的路径 id
const dragCornerIndex = ref(null); // 正在拖拽的拐点在 nodes 数组中的索引
const dragCornerOriginX = ref(0); // 拐点原始位置 x
const dragCornerOriginY = ref(0); // 拐点原始位置 y
```

#### 新增常量（第796-799行）
```javascript
const CORNER_RADIUS = 5; // 拐点圆点半径
const CORNER_GRAB_MARGIN = 3; // 拐点抓取余量
```

### 2. 命中测试函数

#### hitTestAGVCorner（第1134-1152行）
- 检测鼠标是否点击了AGV路径的拐点
- 只检测当前选中的AGV路径
- 不包括起点和终点站点（只检测中间拐点）
- 返回 `{ pathId, cornerIndex }` 或 `null`

### 3. 鼠标事件处理

#### handleMouseDown（第1579-1596行）
- 优先检测是否点击了拐点
- 如果点击了拐点，进入拖拽拐点模式
- 记录拐点的原始位置供日志使用

#### handleMouseMove（第1735-1777行）
- 拖拽拐点时，拐点跟随鼠标移动
- 对齐到小网格线交点
- 支持 Shift 键锁定水平或垂直方向
- 不允许拖到负坐标
- 实时更新 nodes 数组并通知父组件
- 接近边缘时自动扩展画布

#### handleMouseUp（第1887-1921行）
- 结束拖拽时输出详细日志
- 日志包含：
  - 路径名称
  - 拐点索引
  - 移动前后的像素坐标
  - 移动前后的物理坐标（米）
- 重置拖拽状态

#### handleMouseLeave（第1938-1943行）
- 鼠标离开画布时结束拐点拖拽
- 重置所有拖拽状态变量

### 4. WorkspaceLayout.vue - 更新位置处理

#### handleUpdateComponentPosition 修改（第98-117行）
```javascript
const handleUpdateComponentPosition = ({ id, x, y, nodes }) => {
  const target = placedComponents.value.find((item) => item.id === id)
  if (!target) return

  // 如果提供了 nodes 参数，说明是在拖动 AGV 路径的拐点
  if (nodes) {
    target.nodes = nodes
    return
  }

  // 普通控件位置更新
  target.x = x
  target.y = y

  // 如果拖动的是站点，需要同步更新所有连接到该站点的 AGV 路径
  if (target.type === 'node') {
    updateAGVPathsForNode(id, x, y)
  }
}
```

### 5. PropertyPanel.vue - 圆角单位改为米并添加错误检测

#### 圆角单位转换函数
```javascript
// 将像素半径转换为米
const metersToRadius = (radiusInPixels) => {
  return Number((radiusInPixels / SMALL_GRID_SIZE * settings.metersPerGrid).toFixed(2));
};

// 将米转换为像素半径
const radiusToPixels = (radiusInMeters) => {
  return radiusInMeters / settings.metersPerGrid * SMALL_GRID_SIZE;
};
```

#### 圆角过大检测
```javascript
// 检查圆角是否过大
const isCornerRadiusTooLarge = (cornerIndex, radiusInPixels) => {
  // 计算前后两段线段的长度
  const dist1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const dist2 = Math.hypot(next.x - curr.x, next.y - curr.y);

  // 圆角半径不能超过任一线段长度的一半
  const maxRadius = Math.min(dist1, dist2) / 2;

  return radiusInPixels > maxRadius;
};
```

#### 圆角输入处理
- 输入框显示米为单位的值
- 自动检测圆角是否过大
- 如果过大，显示红色边框和错误提示
- 自动限制到最大允许值

## 使用方法

### 拖动拐点

1. **选中AGV路径**：点击画布上的AGV路径，路径会显示选中状态（深绿色）
2. **显示拐点**：选中后，路径的中间拐点会显示为白色圆点（带绿色边框）
3. **拖动拐点**：
   - 点击并拖动任意拐点
   - 拐点会跟随鼠标移动并自动对齐到网格线交点
   - 按住 Shift 键可以锁定到主方向（水平或垂直）
4. **释放鼠标**：松开鼠标完成拖动，路径会实时更新，控制台会输出移动日志

### 设置圆角

1. **选中AGV路径**：点击画布上的AGV路径
2. **打开属性面板**：右侧属性面板会显示拐点圆角设置
3. **输入圆角半径**：
   - 单位为米（与画布比例尺对应）
   - 输入框支持小数点，精度到0.01米
   - 如果圆角过大，输入框会显示红色边框
   - 下方会显示红色错误提示："圆角过大，超出可用线段长度"
4. **自动限制**：如果输入的圆角超过线段长度的一半，系统会自动将其限制为最大允许值

## 圆角验证规则

圆角半径必须满足以下条件：
- **不能超过前一段线段长度的一半**
- **不能超过后一段线段长度的一半**

例如：
- 如果拐点前的线段长度为2米，后的线段长度为3米
- 则圆角半径最大为 min(2/2, 3/2) = 1米
- 如果输入1.5米，系统会自动限制为1米并显示错误提示

## 技术特点

- **精确命中检测**：使用圆形区域检测，半径为拐点半径 + 抓取余量
- **网格对齐**：拖动时自动对齐到小网格线交点，保持整洁
- **方向锁定**：支持 Shift 键锁定主方向移动
- **边界保护**：不允许拖到负坐标区域
- **自动扩展**：接近边缘时自动扩展画布
- **实时更新**：拖动过程中路径实时渲染
- **详细日志**：记录拖动前后的像素和物理坐标
- **单位转换**：圆角半径使用米作为单位，自动与画布比例尺对应
- **智能验证**：实时检测圆角是否过大，自动限制到最大允许值
- **视觉反馈**：圆角过大时显示红色边框和错误提示

## 注意事项

1. 只有选中的AGV路径才会显示拐点
2. 起点和终点站点不能通过拐点拖动功能移动（需要直接拖动站点）
3. 拖动拐点会自动更新路径的所有线段
4. 圆角设置会在拐点移动后保持不变
5. 圆角半径的单位是米，会根据画布比例尺自动转换为像素
6. 如果拖动拐点导致线段变短，已设置的圆角可能会变得过大并显示错误提示
7. 修改比例尺会影响圆角半径的显示值，但像素值保持不变

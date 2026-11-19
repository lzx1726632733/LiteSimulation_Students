

# 1 组件结构

![image-20261119113435688](F:\JavaProject\LiteSimulation_Students-main\typora-img\image-20261119113435688.png)

# 2 组件通信

## 2.1 画布组件与父组件（工作区）通信

### 2.1.1 工作区中调用子组件的代码如下：

```vue
<DesignCanvas
    ref="designCanvas"
    :activeControl="activeControl"  tips="父组件调用子组件时顺便传参"
    :placedComponents="placedComponents"
    :selectedId="selectedId"
    :selectedIds="selectedIds"
    @placement-done="emit('placement-done')"
    @add-log="handleAddLog"
    @component-placed="handleComponentPlaced"
    @select-component="handleSelectComponent"
    @select-components="handleSelectComponents"
    @update-component-position="handleUpdateComponentPosition"
    @update-component-positions="handleUpdateComponentPositions"
    @update-component-properties="handleUpdateComponentProperties"
    @rename-component="handleRenameComponent"
/>
```

### 2.1.2 传给 DesignCanvas 的数据：

| 写法                                   | 作用                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `ref="designCanvas"`                   | 给画布组件留一个引用，父组件可通过 `designCanvas.value` 调用它暴露的方法。 |
| `:activeControl="activeControl"`       | 把父组件当前的操作模式传给画布，例如选择、放置或绘制。       |
| `:placedComponents="placedComponents"` | 把已放置的组件列表传给画布，用于绘制和命中选择。列表由 WorkspaceLayout 统一维护。 |
| `:selectedId="selectedId"`             | 把当前模型树或画布中选中那一个的组件的 ID 传给画布。         |
| `:selectedIds="selectedIds"`           | 把当前模型树或画布中选中多个的组件的 ID 传给画布。           |

### 2.1.3 监听 DesignCanvas 发出的事件：

| 模板绑定                                                     | WorkspaceLayout 收到后                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `@placement-done="emit('placement-done')"`                   | 再把事件转发给自己的父组件（这里是 `App.vue`）。            |
| `@add-log="handleAddLog"`                                    | 把消息加入日志列表。                                        |
| `@component-placed="handleComponentPlaced"`                  | 画布放置控件后，把新组件加入 `placedComponents`，并选中它。 |
| `@select-component="handleSelectComponent"`                  | 更新单选状态：`selectedId` 和 `selectedIds`。               |
| `@select-components="handleSelectComponents"`                | 更新多选状态。                                              |
| `@update-component-position = "handleUpdateComponentPosition"` | 更新指定组件的位置；如果是站点，还会同步关联路径。          |
| `@update-component-positions="handleUpdateComponentPositions"` | 批量更新多个组件的位置。                                    |
| `@update-component-properties="handleUpdateComponentProperties"` | 更新尺寸、颜色、站点类型或路径属性等。                      |
| `@rename-component="handleRenameComponent"`                  | 更新组件的显示名称。                                        |

## 2.2 属性组件与父组件（工作区）通信

### 2.2.1 工作区中调用子组件的代码如下：

```vue
<PropertyPanel
    :selectedItem="selectedComponent"
    :placedComponents="placedComponents"
    @update-component-properties="handleUpdateComponentProperties"
    @update-component-position="handleUpdateComponentPosition"
/>
```

### 2.2.2 传给 PropertyPanel的数据与事件：

| 代码                                                         | 具体作用                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `:selectedItem="selectedComponent"`                          | 把当前选中的**组件对象**交给属性面板，用来显示名称、类型、尺寸、坐标等。 |
| `:placedComponents="placedComponents"`                       | 把所有已放置组件的列表交给属性面板。面板主要用它查找连接线或 AGV 路径两端组件的名称。 |
| `@update-component-properties="handleUpdateComponentProperties"` | 监听“修改属性”事件。面板发出组件 ID 和新属性，父组件调用对应函数更新数据。 |
| `@update-component-position="handleUpdateComponentPosition"` | 监听“修改位置”事件。用户在面板中修改中心点坐标后，父组件调用对应函数更新位置。 |


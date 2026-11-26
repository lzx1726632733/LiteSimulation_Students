<template>
    <div class="property-panel">
        <div v-if="!processOnly" class="panel-header">
            <span class="panel-title">属性面板</span>
        </div>
        <div class="panel-content">
            <!-- 未选中任何元素 -->
            <div v-if="!selectedItem" class="empty-state">
                <div class="empty-icon">📋</div>
                <p class="empty-text">请在画布中选择一个元素</p>
            </div>

            <!-- 侧边属性面板 -->
            <div v-else-if="!processOnly" class="prop-list">
                <!-- 基本信息 -->
                <div class="prop-section">
                    <div class="section-title">基本信息</div>
                    <div class="prop-row">
                        <span class="prop-key">名称</span>
                        <span class="prop-value">{{ getComponentLabel(selectedItem) }}</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">类型</span>
                        <span class="prop-value">{{ selectedItem.type === 'node' ? '站点' : selectedItem.type }}</span>
                    </div>
                </div>
                <!-- 站点 -->
                <div v-if="selectedItem.type === 'node'" class="prop-section">
                    <div class="section-title">站点设置</div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="station-type">站点类型</label>
                        <select id="station-type" class="property-input station-type-select" :value="stationStyle.value"
                                @change="handleStationTypeChange">
                            <option v-for="type in STATION_TYPES" :key="type.value" :value="type.value">{{
                                    type.label
                                }}
                            </option>
                        </select>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">区域颜色</span>
                        <span class="station-color"
                              :style="{ backgroundColor: stationStyle.fill, borderColor: stationStyle.color }"></span>
                        <span class="prop-value">随站点类型设置</span>
                    </div>
                </div>
                <!-- 是可调整大小的组件：“尺寸与外观” -->
                <div v-if="isResizableComponent" class="prop-section">
                    <div class="section-title">尺寸与外观</div>
                    <div class="prop-row dimension-row">
                        <span class="prop-key">水平尺寸</span>
                        <input class="property-input" type="number" min="0.01" step="0.01" :value="widthInMeters"
                               @input="handleDimensionChange('width', $event)"
                               @blur="handleDimensionBlur('width', $event)"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row dimension-row">
                        <span class="prop-key">垂直尺寸</span>
                        <input class="property-input" type="number" min="0.01" step="0.01" :value="heightInMeters"
                               @input="handleDimensionChange('height', $event)"
                               @blur="handleDimensionBlur('height', $event)"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row">
                        <span class="prop-key">方向调整</span>
                        <div class="rotation-buttons">
                            <button type="button" title="顺时针旋转 90°" aria-label="顺时针旋转 90°"
                                    @click="rotateSelectedComponent(1)">
                                <img :src="clockwiseIcon" alt="" draggable="false"/>
                            </button>
                            <button type="button" title="逆时针旋转 90°" aria-label="逆时针旋转 90°"
                                    @click="rotateSelectedComponent(-1)">
                                <img :src="anticlockwiseIcon" alt="" draggable="false"/>
                            </button>
                        </div>
                    </div>
                    <div v-if="selectedItem.type !== 'node'" class="prop-row dimension-row">
                        <span class="prop-key">阴影颜色</span>
                        <input class="color-input" type="color" :value="shadowColor" @input="handleShadowColorChange"/>
                        <span class="color-value">{{ shadowColor }}</span>
                    </div>
                </div>
                <!-- 两条连接线 -->
                <div v-if="selectedItem.type === 'connectionLine' || selectedItem.type === 'AGVpath'" class="prop-section">
                    <template v-if="selectedItem.type === 'connectionLine'">
                        <div class="section-title">连接关系</div>
                        <div class="prop-row">
                            <span class="prop-key">起点</span>
                            <span class="prop-value">{{ fromLabel }}</span>
                        </div>
                        <div class="prop-row">
                            <span class="prop-key">终点</span>
                            <span class="prop-value">{{ toLabel }}</span>
                        </div>
                    </template>
                    <template v-else>
                        <div class="section-title">路径区域</div>
                        <div class="prop-row dimension-row">
                            <label class="prop-key" for="agv-path-width">通道宽度</label>
                            <input id="agv-path-width" class="property-input" type="number" min="0.01" step="0.01"
                                   :value="pathWidthInMeters" @change="handlePathWidthChange"
                                   @blur="handlePathWidthChange"/>
                            <span class="property-unit">m</span>
                        </div>
                        <div class="prop-row">
                            <span class="prop-key">行驶方向</span>
                            <span class="prop-value">起点 → 终点</span>
                            <button class="property-action-button" type="button"
                                    @click="emit('update-component-properties', { id: selectedItem.id, reverseDirection: true })">
                                反向
                            </button>
                        </div>
                    </template>
                    <div v-if="selectedItem.type === 'connectionLine'" class="section-title" style="margin-top: 10px">连接线属性</div>
                    <div v-else class="section-title connection-table-title">路径参数</div>
                    <div class="prop-row dimension-row">
                        <span id="connection-affected-endpoint-label" class="prop-key">更改时影响</span>
                        <div class="connection-endpoint-options" role="radiogroup" aria-labelledby="connection-affected-endpoint-label"
                             title="编辑直线长度或角度时，移动该线段所选的一端。若该端连着站点或组件，则移动整个站点或组件。">
                            <label v-for="option in connectionEndpointOptions" :key="option.value" class="square-radio-label">
                                <input type="radio" class="square-radio" :name="`connection-endpoint-${selectedItem.id}`"
                                       :value="option.value" :checked="connectionAffectedEndpoint === option.value"
                                       @change="emit('update-component-properties', {id: selectedItem.id, affectedEndpoint: option.value})"/>
                                {{ option.label }}
                            </label>
                        </div>
                    </div>
                    <div v-if="selectedItem.type === 'connectionLine'" class="prop-row dimension-row">
                        <label class="prop-key" for="connection-workpiece-speed">工件速度</label>
                        <input id="connection-workpiece-speed" class="property-input" type="number" min="0" step="0.01"
                               :value="connectionWorkpieceSpeed"
                               @change="handleConnectionPropertyChange('workpieceSpeed', $event)"
                               @blur="handleConnectionPropertyChange('workpieceSpeed', $event)"
                               @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m/s</span>
                    </div>
                    <div v-if="selectedItem.type === 'connectionLine'" class="section-title connection-table-title">线条参数</div>
                    <table class="connection-table">
                        <thead>
                            <tr>
                                <th scope="col">序号</th>
                                <th scope="col">类型</th>
                                <th scope="col" title="长度、半径和画布坐标的单位均为米">物理参数</th>
                                <th scope="col" title="正 X 方向为 0°，正 Y 方向为 90°">角度</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, i) in connectionGeometry?.rows" :key="i"
                                :class="{'connection-corner-row': row.type !== 'Line'}"
                                :tabindex="row.type !== 'Line' ? 0 : undefined"
                                :title="row.type !== 'Line' ? '双击编辑圆弧半径' : undefined"
                                @dblclick="row.type !== 'Line' && openConnectionRadius(row)"
                                @keydown.enter.self.prevent="row.type !== 'Line' && openConnectionRadius(row)">
                                <td>{{ i + 1 }}</td>
                                <td>{{ row.type }}</td>
                                <template v-if="row.type === 'Line'">
                                    <td v-for="field in ['length', 'angle']" :key="field"
                                        :title="field === 'length' ? '双击编辑长度（米）' : '双击编辑角度（°）'"
                                        :tabindex="isEditingConnectionCell(row, field) ? undefined : 0"
                                        @dblclick="startConnectionCellEdit(row, field)"
                                        @keydown.enter.self.prevent="startConnectionCellEdit(row, field)">
                                        <input v-if="isEditingConnectionCell(row, field)" class="property-input connection-cell-input"
                                               type="number" step="any" :min="field === 'angle' ? -360 : 0"
                                               :max="field === 'angle' ? 360 : undefined" :value="connectionCellEdit.value"
                                               :aria-label="field === 'length' ? '直线长度（米）' : '直线角度（°）'"
                                               @vue:mounted="focusConnectionCell"
                                               @input="connectionCellEdit.value = $event.target.value"
                                               @blur="saveConnectionCellEdit"
                                               @keydown.enter.stop.prevent="$event.target.blur()"
                                               @keydown.esc.stop.prevent="connectionCellEdit = null"/>
                                        <span v-else>{{ formatConnectionNumber(row[field]) }}{{ field === 'angle' ? '°' : '' }}</span>
                                    </td>
                                </template>
                                <template v-else>
                                    <td>{{ row.type === 'Arc' ? formatConnectionNumber(row.radius) : formatWaypoint(row.point) }}</td>
                                    <td></td>
                                </template>
                            </tr>
                        </tbody>
                        <tfoot v-if="connectionGeometry">
                            <tr><th scope="row" colspan="2">总长</th><td colspan="2">{{ formatConnectionNumber(connectionGeometry.length) }} m</td></tr>
                        </tfoot>
                    </table>
                    <p v-if="connectionCellError" class="connection-edit-error" role="status">{{ connectionCellError }}</p>
                </div>
                <!-- 普通控件和站点：可编辑的中心点物理坐标 -->
                <div v-else class="prop-section">
                    <div class="section-title">中心点物理坐标</div>
                    <div v-for="axis in ['x', 'y']" :key="`${selectedItem.id}-${axis}`" class="prop-row dimension-row">
                        <label class="prop-key" :for="`center-coordinate-${axis}`">{{ axis.toUpperCase() }} 坐标</label>
                        <input
                            :id="`center-coordinate-${axis}`"
                            class="property-input"
                            type="number"
                            step="0.01"
                            :value="centerCoordinates[axis]"
                            @change="handleCenterCoordinateChange(axis, $event)"
                            @blur="handleCenterCoordinateChange(axis, $event)"
                            @keydown.enter.prevent="$event.target.blur()"
                        />
                        <span class="property-unit">m</span>
                    </div>
                    <div v-if="componentPorts.length" class="component-ports">
                        <div class="section-title">上下料点</div>
                        <div v-for="port in componentPorts" :key="`${selectedItem.id}-${port.key}`" class="prop-row port-row">
                            <span class="prop-key">{{ port.label }}</span>
                            <label v-for="axis in ['x', 'y']" :key="axis" class="port-coordinate">
                                <span>{{ axis.toUpperCase() }}</span>
                                <input class="property-input" type="number" step="any"
                                       :value="port.offset[axis]" :min="-portLimits[axis]" :max="portLimits[axis]"
                                       :aria-label="`${port.label} ${axis.toUpperCase()} 坐标（米）`"
                                       :title="`相对组件中心，范围 ${-portLimits[axis]} 至 ${portLimits[axis]} 米`"
                                       @blur="handlePortCoordinateChange(port.key, axis, $event)"
                                       @keydown.enter.prevent="$event.target.blur()"/>
                            </label>
                        </div>
                        <p v-if="portError" class="port-error" role="status">{{ portError }}</p>
                    </div>

                </div>
                <div v-if="wallSettings" :key="selectedItem.id" class="prop-section">
                    <div class="section-title">矩形墙属性</div>
                    <div v-for="field in wallNumericFields" :key="field.key" class="prop-row dimension-row">
                        <label class="prop-key" :for="`wall-${field.key}`">{{ field.label }}</label>
                        <input :id="`wall-${field.key}`" class="property-input" type="number" step="any"
                               :value="wallSettings[field.key]" @blur="handleWallNumber(field.key, $event)"
                               @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m</span>
                    </div>
                    <div class="prop-row wall-thickness-row">
                        <label class="prop-key" for="wall-thickness-mode">厚度方向</label>
                        <select id="wall-thickness-mode" class="property-input" :value="wallSettings.wallThicknessMode"
                                @change="handleWallThicknessMode">
                            <option v-for="mode in WALL_THICKNESS_MODES" :key="mode.value" :value="mode.value">
                                {{ mode.label }}
                            </option>
                        </select>
                    </div>
                    <table class="shape-properties-table" aria-label="矩形墙出口">
                        <thead>
                            <tr><th scope="col">序号</th><th scope="col">出口位置</th><th scope="col">出口宽度</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="(exit, index) in wallSettings.wallExits" :key="index">
                                <th scope="row">{{ index + 1 }}</th>
                                <td>{{ WALL_SIDES.find(side => side.value === exit.side)?.label }}</td>
                                <td>{{ exit.width }} m</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="assembly-actions">
                        <button type="button" @click="emit('open-dialog', {itemId: selectedItem.id, dialogType: 'wall-exits'})">
                            编辑表格
                        </button>
                    </div>
                </div>
                <div v-if="circleRadius !== null" class="prop-section">
                    <div class="section-title">圆形属性</div>
                    <div class="prop-row dimension-row">
                        <label class="prop-key" for="circle-radius">半径</label>
                        <input id="circle-radius" :key="selectedItem.id" class="property-input" type="number"
                               :min="MIN_CIRCLE_RADIUS" step="any" :value="circleRadius"
                               @blur="handleCircleRadiusBlur" @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m</span>
                    </div>
                </div>
                <div v-if="triangleParameters" class="prop-section">
                    <div class="section-title">三角形属性</div>
                    <table class="shape-properties-table" aria-label="三角形属性">
                        <thead>
                            <tr>
                                <th scope="col">参数</th>
                                <th scope="col">值</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="field in TRIANGLE_FIELDS" :key="field.key">
                                <th scope="row">{{ field.shortLabel ?? field.label }}</th>
                                <td>{{ formatTriangleValue(triangleParameters[field.key]) }} {{ field.unit }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="assembly-actions">
                        <button type="button"
                                @click="emit('open-dialog', {itemId: selectedItem.id, dialogType: 'triangle-definition'})">
                            定义三角形
                        </button>
                    </div>
                </div>
                <!-- AGV配置 -->
                <div v-if="selectedItem.type === 'AGVconfiguration'" class="input-settings" :key="selectedItem.id">
                    <div class="section-title">AGV配置</div>
                    <div class="prop-row input-property-row input-close-row">
                        <label class="prop-key" for="agv-range">AGV续航</label>
                        <input id="agv-range" class="property-input" type="text" inputmode="decimal"
                               :value="agvRangeText" :disabled="!selectedItem.agvRangeEnabled"
                               title="输入非负距离（米），∞ 表示无限续航。"
                               @blur="handleAgvRangeChange" @keydown.enter.prevent="$event.target.blur()"/>
                        <span class="property-unit">m</span>
                        <label class="input-close-toggle">
                            <input type="checkbox" :checked="selectedItem.agvRangeEnabled"
                                   @change="emit('update-component-properties', {id: selectedItem.id, agvRangeEnabled: $event.target.checked})"/>
                            启用
                        </label>
                    </div>
                    <table class="shape-properties-table" aria-label="AGV配置清单">
                        <thead>
                            <tr><th scope="col">序号</th><th scope="col">AGV起始站点</th><th scope="col">AGV数量</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in selectedItem.agvRows" :key="row.stationId">
                                <th scope="row">{{ index + 1 }}</th>
                                <td>{{ resolveLabel(row.stationId) }}</td>
                                <td>{{ row.count }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="assembly-actions">
                        <button type="button" @click="emit('open-dialog', {itemId: selectedItem.id, dialogType: 'agv-configuration'})">
                            编辑表格
                        </button>
                    </div>
                </div>
            </div>
            <div v-else class="prop-list">
                <div class="prop-section">
                    <!--  输入控件  -->
                    <div v-if="selectedItem.type === 'systemInput'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title" >工件属性</div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="input-type">输入类型</label>
                            <div class="input-type-control">
                                <select id="input-type" class="property-input" :value="inputProperties.inputType"
                                        @change="handleInputPropertyChange('inputType', $event)">
                                    <option v-for="type in INPUT_ENTITY_TYPES" :key="type" :value="type">{{ type }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="prop-row input-property-row input-rule-row">
                            <label class="prop-key" for="input-rules">输入规则</label>
                            <select id="input-rules" name="inputRules" class="property-input">
                                <option value="default">默认方式</option>
                                <option value="order-form">订单表</option>
                                <option value="data-input">数据输入</option>
                                <option value="custom-method">自定义方法</option>
                            </select>
                            <button class="btn" type="button" aria-label="编辑输入规则"
                                    @click="emit('open-dialog', {itemId: selectedItem.id, dialogType: 'input-rule'})">
                                <img src="/src/assets/icons/edit.svg" alt="编辑" class="btn-img">
                            </button>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="generation-interval">工件产生间隔</label>
                            <input id="generation-interval" class="property-input" type="text" placeholder="分:秒"
                                   title="格式：dd:hh:mm:ss.ms"
                                   :value="formatGenerationInterval(inputProperties.generationInterval)"
                                   @change="handleGenerationIntervalChange" @blur="handleGenerationIntervalChange"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="first-generation-time">首次产生时间</label>
                            <input id="first-generation-time" class="property-input" type="number" min="0" step="0.01"
                                   :value="inputProperties.firstGenerationTime"
                                   @change="handleInputPropertyChange('firstGenerationTime', $event)"
                                   @blur="handleInputPropertyChange('firstGenerationTime', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">秒</span>
                        </div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="max-output-count">最大输出个数</label>
                            <input id="max-output-count" class="property-input" type="number" min="0" step="1"
                                   :value="inputProperties.maxOutputCount"
                                   @change="handleInputPropertyChange('maxOutputCount', $event)"
                                   @blur="handleInputPropertyChange('maxOutputCount', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div class="prop-row input-property-row input-close-row">
                            <label class="prop-key" for="input-close-time">入口关闭时间</label>
                            <input id="input-close-time" class="property-input" type="number" min="0" step="0.01"
                                   :value="inputProperties.inputCloseTime" :disabled="!inputProperties.inputCloseEnabled"
                                   @change="handleInputPropertyChange('inputCloseTime', $event)"
                                   @blur="handleInputPropertyChange('inputCloseTime', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">秒</span>
                            <label class="input-close-toggle">
                                <input type="checkbox" :checked="inputProperties.inputCloseEnabled"
                                       @change="handleInputPropertyChange('inputCloseEnabled', $event)"/>
                                启用
                            </label>
                        </div>
                        <div class="prop-row input-property-row workpiece-display-row">
                            <span id="workpiece-display-label" class="prop-key">工件展示方式</span>
                            <div class="workpiece-display-options" role="radiogroup" aria-labelledby="workpiece-display-label">
                                <label v-for="option in workpieceDisplayOptions" :key="option.value" class="square-radio-label">
                                    <input type="radio" class="square-radio" :name="`workpiece-display-${selectedItem.id}`"
                                           :value="option.value" :checked="inputProperties.workpieceDisplayMode === option.value"
                                           @change="emit('update-component-properties', {id: selectedItem.id, workpieceDisplayMode: option.value})"/>
                                    {{ option.label }}
                                </label>
                            </div>
                        </div>
                    </div>
                    <!-- 设备 -->
                    <div v-if="selectedItem.type === 'workstation'" class="input-settings" :key="selectedItem.id" >
                        <div class="section-title" >设备属性</div>
                        <div v-for="property in workstationTimeProperties" :key="property.field" class="prop-row input-property-row">
                            <label class="prop-key" :for="`workstation-${property.field}`">{{ property.label }}</label>
                            <input :id="`workstation-${property.field}`" class="property-input" type="text"
                                   placeholder="dd:hh:mm:ss.ms" title="定值，格式：dd:hh:mm:ss.ms（可省略前面的时间段）"
                                   :value="formatGenerationInterval(workstationProperties[property.field])"
                                   @change="handleWorkstationTimeChange(property.field, $event)"
                                   @blur="handleWorkstationTimeChange(property.field, $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                        </div>
                    </div>
                    <!-- 加工站 -->
                    <div v-if="selectedItem.type === 'parallelWorkstation'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title">加工站属性</div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="parallel-equipment-count">设备数量</label>
                            <input id="parallel-equipment-count" class="property-input" type="number" min="1" step="1"
                                   :value="parallelWorkstationProperties.equipmentCount"
                                   @change="handleEquipmentCountChange" @blur="handleEquipmentCountChange"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div v-for="property in workstationTimeProperties" :key="property.field" class="prop-row input-property-row">
                            <label class="prop-key" :for="`parallel-${property.field}`">{{ property.label }}</label>
                            <input :id="`parallel-${property.field}`" class="property-input" type="text"
                                   placeholder="dd:hh:mm:ss.ms" title="定值，格式：dd:hh:mm:ss.ms（可省略前面的时间段）"
                                   :value="formatGenerationInterval(parallelWorkstationProperties[property.field])"
                                   @change="handleWorkstationTimeChange(property.field, $event)"
                                   @blur="handleWorkstationTimeChange(property.field, $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                        </div>
                    </div>
                    <!-- 装配站 -->
                    <div v-if="selectedItem.type === 'assemblyWorkstation'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title">装配站属性</div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="assembly-unit-count">单元数量</label>
                            <input id="assembly-unit-count" class="property-input" type="number" min="1" step="1"
                                   :value="assemblyUnitCount" title="同时可用于装配的单元数量"
                                   @change="handleAssemblyUnitCountChange" @blur="handleAssemblyUnitCountChange"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div class="prop-row assembly-mode-row">
                            <span id="assembly-mode-label" class="prop-key">装配模式</span>
                            <div class="workpiece-display-options" role="radiogroup" aria-labelledby="assembly-mode-label">
                                <label v-for="mode in ASSEMBLY_MODES" :key="mode.value" class="square-radio-label">
                                    <input type="radio" class="square-radio" name="assembly-mode"
                                           :checked="assemblyMode === mode.value"
                                           @click="selectAssemblyMode(mode.value)"/>
                                    {{ mode.label }}
                                </label>
                            </div>
                        </div>
                        <div class="assembly-table-container">
                            <table class="assembly-table" aria-label="装配件/容器清单" @keydown.esc.stop="selectAssemblyRow(null)">
                                <thead><tr><th scope="col">序号</th><th scope="col">装配件/容器类型</th><th scope="col">打包类型</th></tr></thead>
                                <tbody>
                                    <tr v-for="(recipe, index) in assemblyRecipes" :key="index"
                                        :class="{selected: selectedAssemblyRow === index}"
                                        :aria-selected="selectedAssemblyRow === index" tabindex="0"
                                        @click="selectAssemblyRow(index)"
                                        @keydown.enter.prevent="selectAssemblyRow(index)" @keydown.space.prevent="selectAssemblyRow(index)">
                                        <th scope="row">{{ index + 1 }}</th>
                                        <td :title="recipe.productType">{{ recipe.productType }}</td>
                                        <td :title="getAssemblyPackingType(recipe, assemblyMode)">{{ getAssemblyPackingType(recipe, assemblyMode) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="assembly-actions">
                            <button type="button" @click="openAssemblyRecipe(null)">增加行</button>
                            <button type="button" :disabled="selectedAssemblyRow === null" @click="deleteAssemblyRecipe">删除行</button>
                            <button type="button" :disabled="selectedAssemblyRow === null" @click="openAssemblyRecipe(selectedAssemblyRow)">编辑行</button>
                        </div>
                    </div>
                    <!-- 拆卸站 -->
                    <div v-if="selectedItem.type === 'disassemblyWorkstation'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title">拆卸站属性</div>
                        <div class="prop-row input-property-row">
                            <label class="prop-key" for="disassembly-unit-count">单元数量</label>
                            <input id="disassembly-unit-count" class="property-input" type="number" min="1" step="1"
                                   :value="disassemblyUnitCount" title="同时可用于拆卸的单元数量"
                                   @change="handleDisassemblyUnitCountChange" @blur="handleDisassemblyUnitCountChange"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div class="prop-row assembly-mode-row">
                            <span id="disassembly-mode-label" class="prop-key">拆卸模式</span>
                            <div class="workpiece-display-options" role="radiogroup" aria-labelledby="disassembly-mode-label">
                                <label v-for="mode in DISASSEMBLY_MODES" :key="mode.value" class="square-radio-label">
                                    <input type="radio" class="square-radio" name="disassembly-mode"
                                           :checked="disassemblyMode === mode.value"
                                           @change="emit('update-component-properties', {id: selectedItem.id, disassemblyMode: mode.value})"/>
                                    {{ mode.label }}
                                </label>
                            </div>
                        </div>
                        <p v-if="disassemblyMode === 'container'" class="disassembly-hint">容器到站即卸载，无需配置 BOM。</p>
                        <div class="assembly-table-container">
                            <table class="assembly-table" aria-label="拆卸站装配件/容器清单" @keydown.esc.stop="selectDisassemblyRow(null)">
                                <thead><tr><th scope="col">序号</th><th scope="col">装配件/容器类型</th><th scope="col">名称</th></tr></thead>
                                <tbody>
                                    <tr v-for="(recipe, index) in disassemblyRecipes" :key="index"
                                        :class="{selected: selectedDisassemblyRow === index}"
                                        :aria-selected="selectedDisassemblyRow === index" tabindex="0"
                                        @click="selectDisassemblyRow(index)"
                                        @keydown.enter.prevent="selectDisassemblyRow(index)" @keydown.space.prevent="selectDisassemblyRow(index)">
                                        <th scope="row">{{ index + 1 }}</th>
                                        <td :title="recipe.productType">{{ recipe.productType }}</td>
                                        <td :title="recipe.name">{{ recipe.name }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="assembly-actions">
                            <button type="button" @click="openDisassemblyRecipe(null)">增加行</button>
                            <button type="button" :disabled="selectedDisassemblyRow === null" @click="deleteDisassemblyRecipe">删除行</button>
                            <button type="button" :disabled="selectedDisassemblyRow === null" @click="openDisassemblyRecipe(selectedDisassemblyRow)">编辑行</button>
                        </div>
                    </div>
                    <!-- 缓冲区 -->
                    <div v-if="selectedItem.type === 'buffer'" class="input-settings" :key="selectedItem.id">
                        <div class="section-title">缓冲区属性</div>
                        <div class="prop-row input-property-row buffer-property-row">
                            <label class="prop-key" for="buffer-capacity">缓冲区最大容量</label>
                            <input id="buffer-capacity" class="property-input" type="number" min="-1" step="1"
                                   :value="bufferCapacity" title="-1 表示无限容量；其余请输入正整数。在途工件也占用容量。"
                                   @change="handleBufferPropertyChange('bufferCapacity', $event)"
                                   @blur="handleBufferPropertyChange('bufferCapacity', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                            <span class="property-unit">个</span>
                        </div>
                        <div class="prop-row input-property-row buffer-property-row">
                            <label class="prop-key" for="buffer-minimum-stay">最短停留时间</label>
                            <input id="buffer-minimum-stay" class="property-input" type="text"
                                   :value="formatGenerationInterval(minimumStayTime)"
                                   title="定值，格式：dd:hh:mm:ss.ms，到站后开始计时"
                                   @change="handleBufferPropertyChange('minimumStayTime', $event)"
                                   @blur="handleBufferPropertyChange('minimumStayTime', $event)"
                                   @keydown.enter.prevent="$event.target.blur()"/>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import {computed, ref, watch} from "vue";
import {getComponentLabel} from "../utils/componentLabel.js";
import {STATION_TYPES, getStationType, getComponentFootprint, getComponentCenter, getComponentQuarterTurns} from "../utils/stations.js";
import clockwiseIcon from "../assets/icons/clockwise.svg";
import anticlockwiseIcon from "../assets/icons/anticlockwise.svg";
import {getPathWidth} from "../utils/agvPath.js";
import {parseAgvRange} from "../utils/agvConfiguration.js";
import {CIRCULAR_OBSTACLE_TYPE, getCircleRadius, getDefaultShadowColor, MIN_CIRCLE_RADIUS, RESIZABLE_COMPONENT_TYPES} from "../utils/componentAppearance.js";
import {formatTriangleValue, getLocalTriangleVertices, getTriangleParameters, TRIANGLE_FIELDS, TRIANGULAR_OBSTACLE_TYPE} from "../utils/triangleObstacle.js";
import {getWallSettings, RECTANGULAR_WALL_TYPE, WALL_SIDES, WALL_THICKNESS_MODES} from "../utils/rectangularWall.js";
import {INPUT_ENTITY_TYPES, INPUT_PROPERTY_DEFAULTS, getInputType, isValidInputProperty, parseGenerationInterval, formatGenerationInterval} from "../utils/inputRules.js";
import {WORKSTATION_PROPERTY_DEFAULTS, PARALLEL_WORKSTATION_PROPERTY_DEFAULTS, isValidWorkstationProperty, isValidParallelWorkstationProperty} from "../utils/workstationProperties.js";
import {DEFAULT_WORKPIECE_SPEED, getEditableRouteGeometry} from "../utils/connectionLine.js";
import {ASSEMBLY_MODES, getAssemblyPackingType, getAssemblyUnitCount, isValidAssemblyUnitCount} from "../utils/assemblyRecipes.js";
import {DISASSEMBLY_MODES, getDisassemblyUnitCount, isValidDisassemblyUnitCount} from "../utils/disassemblyRecipes.js";
import {getBufferProperty, isValidBufferProperty} from "../utils/bufferProperties.js";
import {getComponentPorts, getComponentPortOffset, isValidComponentPortOffset} from "../utils/componentPorts.js";
// 声明接受父组件传来的两个对象
const props = defineProps({
    // 当前选中的控件对象（由父组件根据 selectedId 查出后传入）
    selectedItem: {
        type: Object,
        default: null,
    },
    // 已放置控件列表，用于解析连接线两端对象的名称
    placedComponents: {
        type: Array,
        default: () => [],
    },
    canvasBoundary: {type: Object, default: null},
    processOnly: {type: Boolean, default: false},
});
const emit = defineEmits(["update-component-properties", "update-component-position", "open-dialog"]);
const wallSettings = computed(() => props.selectedItem?.type === RECTANGULAR_WALL_TYPE
    ? getWallSettings(props.selectedItem) : null);
const wallNumericFields = [
    {key: 'width', label: '长度'}, {key: 'height', label: '宽度'}, {key: 'wallThickness', label: '墙体厚度'},
];

function handleWallNumber(field, event) {
    const input = event.target;
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0 && value !== wallSettings.value[field]) {
        emit("update-component-properties", {id: props.selectedItem.id, [field]: value});
    }
    input.value = String(wallSettings.value[field]);
}

function handleWallThicknessMode(event) {
    emit("update-component-properties", {id: props.selectedItem.id, wallThicknessMode: event.target.value});
    event.target.value = wallSettings.value.wallThicknessMode;
}

const circleRadius = computed(() => props.selectedItem?.type === CIRCULAR_OBSTACLE_TYPE
    ? Number(getCircleRadius(props.selectedItem).toPrecision(8)) : null);

function handleCircleRadiusBlur(event) {
    const input = event.target;
    const radius = Number(input.value);
    if (circleRadius.value === null) return;
    if (Number.isFinite(radius) && radius >= MIN_CIRCLE_RADIUS && radius !== circleRadius.value) {
        emit("update-component-properties", {id: props.selectedItem.id, circleRadius: radius});
    }
    input.value = String(circleRadius.value);
}

const triangleParameters = computed(() => props.selectedItem?.type === TRIANGULAR_OBSTACLE_TYPE
    ? getTriangleParameters(getLocalTriangleVertices(props.selectedItem)) : null);
const bufferCapacity = computed(() => getBufferProperty(props.selectedItem, 'bufferCapacity'));
const minimumStayTime = computed(() => getBufferProperty(props.selectedItem, 'minimumStayTime'));
const componentPorts = computed(() => getComponentPorts(props.selectedItem).map(port => ({
    ...port, offset: getComponentPortOffset(props.selectedItem, port.key),
})));
const portError = ref('');

function handlePortCoordinateChange(key, axis, event) {
    const port = componentPorts.value.find(entry => entry.key === key);
    if (!port) return;
    const raw = event.target.value.trim();
    const point = {...port.offset, [axis]: raw === '' ? NaN : Number(raw)};
    if (!isValidComponentPortOffset(props.selectedItem, point)) {
        event.target.value = String(port.offset[axis]);
        portError.value = `${port.label} ${axis.toUpperCase()} 坐标应在 ${-portLimits.value[axis]} 至 ${portLimits.value[axis]} 米之间。`;
        return;
    }
    portError.value = '';
    event.target.value = String(point[axis]);
    if (point[axis] !== port.offset[axis]) {
        emit('update-component-properties', {id: props.selectedItem.id, portOffset: {key, point}});
    }
}

function handleBufferPropertyChange(field, event) {
    const item = props.selectedItem;
    if (item?.type !== 'buffer') return;
    const duration = field === 'minimumStayTime';
    const raw = event.target.value;
    const value = duration ? parseGenerationInterval(raw, {allowZero: true}) : Number(raw);
    const current = getBufferProperty(item, field);
    const valid = isValidBufferProperty(field, value);
    const displayValue = valid ? value : current;
    event.target.value = duration ? formatGenerationInterval(displayValue) : String(displayValue);
    if (valid && value !== current) emit('update-component-properties', {id: item.id, [field]: value});
}
const assemblyMode = computed(() => props.selectedItem?.assemblyMode ?? 'parts');
const assemblyUnitCount = computed(() => getAssemblyUnitCount(props.selectedItem));
const assemblyRecipes = computed(() => props.selectedItem?.assemblyRecipes ?? []);
const selectedAssemblyRow = ref(null);
const assemblyModeForEdit = ref(null);
const disassemblyMode = computed(() => props.selectedItem?.disassemblyMode ?? 'parts');
const disassemblyUnitCount = computed(() => getDisassemblyUnitCount(props.selectedItem));
const disassemblyRecipes = computed(() => props.selectedItem?.disassemblyRecipes ?? []);
const selectedDisassemblyRow = ref(null);
watch(() => props.selectedItem?.id, () => {
    selectAssemblyRow(null);
    selectDisassemblyRow(null);
    portError.value = '';
});

function handleDisassemblyUnitCountChange(event) {
    const item = props.selectedItem;
    if (item?.type !== 'disassemblyWorkstation') return;
    const count = Number(event.target.value);
    const current = disassemblyUnitCount.value;
    event.target.value = String(isValidDisassemblyUnitCount(count) ? count : current);
    if (isValidDisassemblyUnitCount(count) && count !== current) {
        emit('update-component-properties', {id: item.id, disassemblyUnitCount: count});
    }
}

function selectDisassemblyRow(index) {
    selectedDisassemblyRow.value = selectedDisassemblyRow.value === index ? null : index;
}

function openDisassemblyRecipe(rowIndex) {
    if (rowIndex !== null && !disassemblyRecipes.value[rowIndex]) return;
    emit('open-dialog', {itemId: props.selectedItem.id, dialogType: 'disassembly-recipe', rowIndex});
}

function deleteDisassemblyRecipe() {
    if (!disassemblyRecipes.value[selectedDisassemblyRow.value]) return;
    emit('update-component-properties', {
        id: props.selectedItem.id,
        disassemblyRecipes: disassemblyRecipes.value.filter((_, index) => index !== selectedDisassemblyRow.value),
    });
    selectDisassemblyRow(null);
}

function handleAssemblyUnitCountChange(event) {
    const item = props.selectedItem;
    if (item?.type !== 'assemblyWorkstation') return;
    const count = Number(event.target.value);
    const current = assemblyUnitCount.value;
    if (!isValidAssemblyUnitCount(count)) {
        event.target.value = String(current);
        return;
    }
    event.target.value = String(count);
    if (count !== current) emit('update-component-properties', {id: item.id, assemblyUnitCount: count});
}

function selectAssemblyRow(index) {
    selectedAssemblyRow.value = selectedAssemblyRow.value === index ? null : index;
    assemblyModeForEdit.value = null;
}

function selectAssemblyMode(mode) {
    emit('update-component-properties', {id: props.selectedItem.id, assemblyMode: mode});
    const recipe = assemblyRecipes.value[selectedAssemblyRow.value];
    assemblyModeForEdit.value = recipe ? {recipe, mode} : null;
}

function openAssemblyRecipe(rowIndex) {
    const recipe = assemblyRecipes.value[rowIndex];
    if (rowIndex !== null && !recipe) return;
    const pending = assemblyModeForEdit.value;
    emit('open-dialog', {
        itemId: props.selectedItem.id, dialogType: 'assembly-recipe', rowIndex,
        editMode: pending && pending.recipe === recipe ? pending.mode : undefined,
    });
}

function deleteAssemblyRecipe() {
    if (!assemblyRecipes.value[selectedAssemblyRow.value]) return;
    emit('update-component-properties', {
        id: props.selectedItem.id,
        assemblyRecipes: assemblyRecipes.value.filter((_, index) => index !== selectedAssemblyRow.value),
    });
    selectAssemblyRow(null);
}
const connectionGeometry = computed(() => getEditableRouteGeometry(props.selectedItem, props.placedComponents));
const connectionWorkpieceSpeed = computed(() => props.selectedItem?.workpieceSpeed ?? DEFAULT_WORKPIECE_SPEED);
const connectionEndpointOptions = [{value: 'to', label: '终点'}, {value: 'from', label: '起点'}];
const connectionAffectedEndpoint = computed(() => props.selectedItem?.affectedEndpoint === 'from' ? 'from' : 'to');
const formatConnectionNumber = value => Number(value.toFixed(4));
const formatWaypoint = point => '(' + formatConnectionNumber(point.x) + ', ' + formatConnectionNumber(point.y) + ')';
const readConnectionNumber = value => String(value).trim() === '' ? NaN : Number(value);

const handleConnectionPropertyChange = (field, event) => {
    if (props.selectedItem?.type !== 'connectionLine') return;
    const value = readConnectionNumber(event.target.value);
    if (!Number.isFinite(value) || value < 0) {
        event.target.value = String(connectionWorkpieceSpeed.value);
        return;
    }
    if (value !== connectionWorkpieceSpeed.value) emit('update-component-properties', {id: props.selectedItem.id, [field]: value});
};

const connectionCellEdit = ref(null);
const connectionCellError = ref('');
const isEditingConnectionCell = (row, field) => connectionCellEdit.value?.index === row.index && connectionCellEdit.value?.field === field;

function startConnectionCellEdit(row, field) {
    if (isEditingConnectionCell(row, field)) return;
    connectionCellError.value = '';
    connectionCellEdit.value = {id: props.selectedItem.id, index: row.index, field,
        value: String(formatConnectionNumber(row[field])), initial: row[field]};
}

const focusConnectionCell = ({el}) => {
    el.focus();
    el.select();
};

function saveConnectionCellEdit() {
    const draft = connectionCellEdit.value;
    if (!draft) return;
    connectionCellEdit.value = null;
    if (draft.id !== props.selectedItem?.id) return;
    const value = readConnectionNumber(draft.value);
    if (!Number.isFinite(value) || (draft.field === 'angle' ? Math.abs(value) > 360 : value < 0)) {
        connectionCellError.value = draft.field === 'angle' ? '请输入 -360° 至 360° 的角度。' : '请输入大于或等于 0 的长度。';
        return;
    }
    if (value === formatConnectionNumber(draft.initial)) return;
    const {index, field} = draft;
    emit('update-component-properties', {id: props.selectedItem.id, connectionSegment: {index, [field]: value}});
}

function openConnectionRadius(row) {
    emit('open-dialog', {itemId: props.selectedItem.id, dialogType: 'connection-radius', rowIndex: row.index});
}

watch(() => props.selectedItem?.id, () => {
    connectionCellEdit.value = null;
    connectionCellError.value = '';
});

const workpieceDisplayOptions = [
    {value: 'recommended', label: '按推荐大小'},
    {value: 'actual', label: '按实际大小'},
];
const inputProperties = computed(() => Object.fromEntries(
    Object.entries(INPUT_PROPERTY_DEFAULTS).map(([field, defaultValue]) =>
        [field, field === 'inputType' ? getInputType(props.selectedItem) : props.selectedItem?.[field] ?? defaultValue]),
));
const workstationTimeProperties = [
    {field: 'processingTime', label: '加工时长'},
    {field: 'setupTime', label: '准备时长'},
];
const workstationProperties = computed(() => Object.fromEntries(
    Object.entries(WORKSTATION_PROPERTY_DEFAULTS).map(([field, defaultValue]) =>
        [field, props.selectedItem?.[field] ?? defaultValue]),
));
const parallelWorkstationProperties = computed(() => Object.fromEntries(
    Object.entries(PARALLEL_WORKSTATION_PROPERTY_DEFAULTS).map(([field, defaultValue]) =>
        [field, props.selectedItem?.[field] ?? defaultValue]),
));
const handleEquipmentCountChange = (event) => {
    const item = props.selectedItem;
    if (item?.type !== 'parallelWorkstation') return;
    const raw = event.target.value.trim();
    const count = raw === '' ? NaN : Number(raw);
    if (!isValidParallelWorkstationProperty('equipmentCount', count)) {
        event.target.value = String(parallelWorkstationProperties.value.equipmentCount);
        return;
    }
    event.target.value = String(count);
    if (count !== parallelWorkstationProperties.value.equipmentCount) {
        emit('update-component-properties', {id: item.id, equipmentCount: count});
    }
};
const handleWorkstationTimeChange = (field, event) => {
    const item = props.selectedItem;
    if (item?.type !== 'workstation' && item?.type !== 'parallelWorkstation') return;
    const seconds = parseGenerationInterval(event.target.value, {allowZero: true});
    if (!isValidWorkstationProperty(field, seconds)) {
        event.target.value = formatGenerationInterval(workstationProperties.value[field]);
        return;
    }
    event.target.value = formatGenerationInterval(seconds);
    if (seconds !== workstationProperties.value[field]) {
        emit('update-component-properties', {id: item.id, [field]: seconds});
    }
};
const handleGenerationIntervalChange = (event) => {
    const item = props.selectedItem;
    if (item?.type !== 'systemInput') return;
    const seconds = parseGenerationInterval(event.target.value);
    if (!isValidInputProperty('generationInterval', seconds)) {
        event.target.value = formatGenerationInterval(inputProperties.value.generationInterval);
        return;
    }
    event.target.value = formatGenerationInterval(seconds);
    if (seconds !== inputProperties.value.generationInterval) {
        emit('update-component-properties', {id: item.id, generationInterval: seconds});
    }
};
const handleInputPropertyChange = (field, event) => {
    const item = props.selectedItem;
    if (item?.type !== 'systemInput') return;
    const raw = event.target.value.trim();
    let value = raw === '' ? NaN : Number(raw);
    if (field === 'inputCloseEnabled') value = event.target.checked;
    if (field === 'inputType') value = raw;
    if (!isValidInputProperty(field, value)) {
        event.target.value = String(inputProperties.value[field]);
        return;
    }
    if (value !== inputProperties.value[field]) {
        emit('update-component-properties', {id: item.id, [field]: value});
    }
};
const shadowColor = computed(() => props.selectedItem?.shadowColor || getDefaultShadowColor(props.selectedItem?.type));
const pathWidthInMeters = computed(() => props.selectedItem ? Number(getPathWidth(props.selectedItem).toFixed(2)) : 1);
const agvRangeText = computed(() => String(props.selectedItem?.agvRangeEnabled ? props.selectedItem.agvRange ?? '∞' : '∞'));

function handleAgvRangeChange(event) {
    const item = props.selectedItem;
    if (item?.type !== 'AGVconfiguration' || !item.agvRangeEnabled) return;
    const range = parseAgvRange(event.target.value);
    if (range !== undefined && range !== (item.agvRange ?? null)) {
        emit('update-component-properties', {id: item.id, agvRange: range});
    }
    event.target.value = agvRangeText.value;
}

const handlePathWidthChange = (event) => {
    const item = props.selectedItem;
    if (item?.type !== "AGVpath") return;
    const raw = event.target.value.trim();
    const value = Number(raw);
    const width = raw && Number.isFinite(value) ? Math.max(0.01, Number(value.toFixed(2))) : getPathWidth(item);
    event.target.value = String(width);
    if (width !== getPathWidth(item)) emit("update-component-properties", {id: item.id, pathWidth: width});
    if (props.canvasBoundary) event.target.value = String(getPathWidth(item));
};
const stationStyle = computed(() => getStationType(props.selectedItem));
const handleStationTypeChange = (event) => {
    emit("update-component-properties", {id: props.selectedItem.id, stationType: event.target.value});
};

// 按 id 找出对象的显示名称（名称+序号），找不到则提示已删除
const resolveLabel = (id) => {
    const target = props.placedComponents.find((item) => item.id === id);
    return target ? getComponentLabel(target) : "（对象已删除）";
};

const fromLabel = computed(() =>
    props.selectedItem ? resolveLabel(props.selectedItem.fromId) : "",
);

const toLabel = computed(() =>
    props.selectedItem ? resolveLabel(props.selectedItem.toId) : "",
);

// 站点存中心，其他控件存左下角；统一按 0.01m 精度显示中心，允许负坐标。
const centerCoordinates = computed(() => {
    const item = props.selectedItem;
    if (!item || item.type === "connectionLine" || item.type === "AGVpath") return {x: 0, y: 0};
    const center = getComponentCenter(item);
    return {x: Number(center.x.toFixed(2)), y: Number(center.y.toFixed(2))};
});

// 完成输入后提交；清空或尚未输完负号时不移动控件，失焦恢复原坐标。
const handleCenterCoordinateChange = (axis, event) => {
    const item = props.selectedItem;
    if (!item || item.type === "connectionLine" || item.type === "AGVpath") return;
    const rawValue = event.target.value.trim();
    const inputValue = Number(rawValue);
    if (rawValue === "" || !Number.isFinite(inputValue)) {
        event.target.value = String(centerCoordinates.value[axis]);
        return;
    }
    const value = Number(inputValue.toFixed(2));
    event.target.value = String(value);
    if (value === centerCoordinates.value[axis]) return;
    const position = {id: item.id, x: item.x, y: item.y};
    const offset = getComponentCenter(item)[axis] - item[axis];
    position[axis] = Number((value - offset).toFixed(10));
    // 共用拖动的更新事件，使站点关联的 AGV 路径也同步更新。
    emit("update-component-position", position);
    event.target.value = String(centerCoordinates.value[axis]);
};

const isResizableComponent = computed(() =>
    Boolean(props.selectedItem && RESIZABLE_COMPONENT_TYPES.has(props.selectedItem.type)),
);
function rotateSelectedComponent(rotationDelta) {
    if (isResizableComponent.value) {
        emit("update-component-properties", {id: props.selectedItem.id, rotationDelta});
    }
}

const footprint = computed(() => props.selectedItem ? getComponentFootprint(props.selectedItem) : null);
const portLimits = computed(() => ({x: (footprint.value?.width ?? 0) / 2, y: (footprint.value?.height ?? 0) / 2}));
watch([() => footprint.value?.width, () => footprint.value?.height], () => { portError.value = ''; });
// 尺寸已直接以米存储，这里只做 2 位小数显示（与输入框 step 0.01 一致）
const widthInMeters = computed(() => Number(footprint.value?.width.toFixed(2) ?? 0));
const heightInMeters = computed(() => Number(footprint.value?.height.toFixed(2) ?? 0));

function modelDimension(dimension) {
    if (getComponentQuarterTurns(props.selectedItem) % 2 === 0) return dimension;
    return dimension === 'width' ? 'height' : 'width';
}

const handleDimensionChange = (dimension, event) => {
    if (props.canvasBoundary) return;
    const inputValue = Number(event.target.value);
    // 允许用户输入过程中的任意值（米），不做限制
    if (!isNaN(inputValue) && inputValue > 0) {
        emit("update-component-properties", {id: props.selectedItem.id, [modelDimension(dimension)]: inputValue});
    }
};

const handleDimensionBlur = (dimension, event) => {
    const inputValue = Number(event.target.value);
    // 失焦时应用最小值限制（0.01 米）
    const meters = Math.max(0.01, inputValue || 0.01);
    const current = dimension === 'width' ? widthInMeters : heightInMeters;
    if (Number.isFinite(meters) && (props.canvasBoundary ? meters !== current.value : meters !== inputValue)) {
        emit("update-component-properties", {id: props.selectedItem.id, [modelDimension(dimension)]: meters});
    }
    event.target.value = String(current.value);
};

const handleShadowColorChange = (event) => {
    emit("update-component-properties", {id: props.selectedItem.id, shadowColor: event.target.value});
};

</script>

<style scoped>
.input-settings { display: flex; flex-direction: column; gap: 10px; }
.prop-row.input-property-row { display: grid; }
.input-property-row { grid-template-columns: 84px minmax(0, 1fr) 14px; gap: 6px; }
.input-rule-row { grid-template-columns: 84px minmax(0, 1fr) 28px; }
.buffer-property-row { grid-template-columns: 96px minmax(0, 1fr) 14px; }
.input-close-row { grid-template-columns: 84px minmax(0, 1fr) 14px auto; }
.input-property-row .property-input { box-sizing: border-box; width: 100%; min-width: 0; height: 28px; background: white; }
.input-property-row .property-input:focus { outline: 2px solid #93c5fd; outline-offset: 1px; }
.input-property-row .property-input:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }
.input-type-control { position: relative; min-width: 0; }
.input-type-control .property-input {
    appearance: none;
    padding: 3px 28px 3px 8px;
    border-radius: 5px;
    cursor: pointer;
}
.input-type-control .property-input:hover { border-color: #94a3b8; }
.input-type-control::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 11px;
    width: 6px;
    height: 6px;
    border: solid #475569;
    border-width: 0 1.5px 1.5px 0;
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
}
.input-rule-row .btn { justify-content: center; min-width: 0; margin: 0; padding: 4px; }
.input-rule-row .btn-img { margin: 0; }
.input-close-toggle { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; color: #6b7280; cursor: pointer; }
.input-close-toggle input { margin: 0; accent-color: #0780ff; }
.workpiece-display-row { grid-template-columns: 84px minmax(0, 1fr); align-items: start; }
.workpiece-display-options { display: flex; flex-direction: column; gap: 8px; }
.assembly-mode-row { align-items: flex-start; }
.disassembly-hint { margin: 0; font-size: 12px; color: #6b7280; }
.assembly-table-container { max-height: 180px; overflow: auto; border: 1px solid #d1d5db; border-radius: 4px; }
.assembly-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.assembly-table th, .assembly-table td { padding: 6px 3px; text-align: center; font-weight: normal; }
.assembly-table thead { position: sticky; top: 0; background: #f3f4f6; }
.assembly-table th:first-child { width: 36px; }
.assembly-table th:last-child { width: 76px; }
.assembly-table td { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.assembly-table tbody tr { cursor: pointer; border-top: 1px solid #e5e7eb; }
.assembly-table tr.selected { background: #dbeafe; color: #1e40af; }
.assembly-table tr:focus-visible { outline: 1px solid #2563eb; outline-offset: -1px; }
.assembly-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.assembly-actions button { flex: 1 0 auto; }
.assembly-actions button,
.property-action-button { padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; background: white; font: inherit; font-size: 12px; cursor: pointer; }
.assembly-actions button:hover,
.property-action-button:hover { background-color: #e8eaf0; }
.assembly-actions button:disabled { opacity: .5; cursor: default; }
.shape-properties-table { width: 100%; border-collapse: collapse; border: 1px solid #dbe2eb; font-size: 13px; }
.shape-properties-table th, .shape-properties-table td {
    padding: 5px 8px;
    border-bottom: 1px solid #e5e7eb;
    text-align: center;
}
.shape-properties-table thead { background: #f3f6fa; color: #1f2937; }
.shape-properties-table tbody th { font-weight: normal; color: #4b5563; white-space: nowrap; }
.shape-properties-table td { font-variant-numeric: tabular-nums; }
.wall-thickness-row { margin-bottom: 4px; }
.wall-thickness-row select { flex: 1; min-width: 0; }
.connection-table-title { margin-top: 8px; }
.connection-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; color: #1f2937; }
.connection-table th, .connection-table td { padding: 6px 4px; text-align: center; border: 1px solid #dbe2eb; overflow-wrap: anywhere; }
.connection-table th, .connection-table tfoot td { background: #f3f6fa; font-weight: 600; }
.connection-table th:nth-child(1) { width: 34px; }
.connection-table th:nth-child(2) { width: 42px; }
.connection-table th:nth-child(4) { width: 56px; }
.connection-table td[tabindex], .connection-corner-row { cursor: pointer; }
.connection-table td[tabindex]:hover, .connection-corner-row:hover { background: #eaf2ff; }
.connection-table .connection-cell-input { box-sizing: border-box; width: 100%; padding: 3px; }
.connection-edit-error { margin: 0; color: #b91c1c; font-size: 12px; }

.connection-endpoint-options { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.square-radio-label { display: inline-flex; align-items: center; gap: 6px; color: #374151; cursor: pointer; }
.square-radio {
    appearance: none;
    display: grid;
    place-content: center;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 1px solid #9ca3af;
    border-radius: 2px;
    background: white;
    cursor: pointer;
}
.square-radio:checked { border-color: #0780ff; background: #0780ff; }
.square-radio:checked::after { content: '✓'; color: white; font-size: 11px; line-height: 12px; }
.square-radio:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.btn {
    display: flex;
    border-radius: 8px;
    border: none;
    background-color: #fefefe;
    align-items: center;
    padding: 4px 6px;
    margin-right: 6px;
    user-select: none;
    cursor: pointer;
}
.btn:hover {
    background-color: #e8eaf0;
}
.btn-img {
    width: 18px;
    height: 18px;
    margin-right: 4px;
    user-select: none;
    -webkit-user-drag: none;
}

.station-type-select {
    flex: 1;
    min-width: 110px;
}

.station-color {
    width: 28px;
    height: 18px;
    border: 2px solid;
    border-radius: 2px;
}

.property-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.panel-header {
    background-color: #f9f9fe;
    padding: 8px 16px;
    border-bottom: 1px solid #e0e4e8;
}

.panel-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #000000;
    user-select: none;
    -webkit-user-drag: none;
}

.panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
}

/* 滚动条整体宽度（垂直滚动条）， 控制垂直滚动条粗细，设为6px细滚动条；水平滚动条用height属性 */
.panel-content::-webkit-scrollbar {
    width: 6px;
}

/* 滚动条滑动的底板背景色，浅灰底色 */
.panel-content::-webkit-scrollbar-track {
    background: #f3f4f6;
}

/* 拖动块默认浅灰色，圆角实现圆润效果（宽度 6px，圆角 3px 刚好半圆）。 */
.panel-content::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 3px;
}

/* 鼠标放上去滑块加深灰色，提升交互反馈 */
.panel-content::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #9ca3af;
}

.empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
    user-select: none;
    -webkit-user-drag: none;
}

.empty-text {
    font-size: 14px;
    margin: 0;
    user-select: none;
    -webkit-user-drag: none;
}

/* 属性列表 */
.prop-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.prop-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.dimension-row {
    align-items: center;
}
.component-ports { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.prop-row.port-row { display: grid; grid-template-columns: 60px minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
.port-coordinate { display: flex; align-items: center; gap: 4px; color: #6b7280; min-width: 0; }
.port-coordinate .property-input { box-sizing: border-box; width: 100%; min-width: 0; }
.port-error { margin: 0; color: #b91c1c; font-size: 12px; }

.rotation-buttons { display: flex; gap: 6px; }
.rotation-buttons button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 28px;
    padding: 0;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
}
.rotation-buttons button:hover { background: #eff6ff; }
.rotation-buttons img { width: 16px; height: 16px; }

.property-input {
    width: 72px;
    padding: 4px 6px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    font-size: 13px;
    color: #1f2937;
}

.property-unit,
.color-value {
    color: #6b7280;
    font-size: 12px;
}

.color-input {
    width: 34px;
    height: 26px;
    padding: 1px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    background: #ffffff;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #1f2937;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
    user-select: none;
}

.prop-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}

.prop-key {
    flex: 0 0 auto;
    min-width: 60px;
    color: #6b7280;
    user-select: none;
    white-space: nowrap;
}

.prop-value {
    flex: 1;
    color: #374151;
    word-break: break-all;
}

</style>

// 存放标签、菜单、子菜单等数据
export const tabList = [
  { id: "commonControl", name: "常用组件", icon: "/src/assets/icons/commonControl.svg" },
  { id: "logistics", name: "物流设施", icon: "/src/assets/icons/logistics.svg" },
  { id: "resource", name: "生产资源", icon: "/src/assets/icons/resource.svg" },
  { id: "algorithm", name: "优化算法", icon: "/src/assets/icons/algorithm.svg" },
  { id: "script", name: "脚本方法", icon: "/src/assets/icons/script.svg" },
];                              
     
export const menuControls = {
  commonControl: [
    { id: 1, name: "选择", icon: "/src/assets/icons/select.svg", type:"select" },
    { id: 2, name: "输入", icon: "/src/assets/icons/systemInput.svg", type:"systemInput" },
    { id: 3, name: "输出", icon: "/src/assets/icons/systemOutput.svg", type:"systemOutput" },
    { id: 4, name: "设备", icon: "/src/assets/icons/workstation.svg", type:"workstation" },
    { id: 5, name: "加工站", icon: "/src/assets/icons/parallelWorkstation.svg", type:"parallelWorkstation" },
    { id: 6, name: "装配站", icon: "/src/assets/icons/assemblyWorkstation.svg", type:"assemblyWorkstation" },
    { id: 7, name: "拆卸站", icon: "/src/assets/icons/disassemblyWorkstation.svg", type:"disassemblyWorkstation" },
    { id: 8, name: "缓冲区", icon: "/src/assets/icons/buffer.svg", type:"buffer" },
    { id: 9, name: "连接线", icon: "/src/assets/icons/connectionLine.svg", type:"connectionLine" }
],
  logistics: [
    { id: 1, name: "AGV路径", icon: "/src/assets/icons/AGVpath.svg", type:"AGVpath" },
    { id: 2, name: "站点", icon: "/src/assets/icons/node.svg", type:"node" },
    { id: 3, name: "立体仓库", icon: "/src/assets/icons/warehouse.svg", type:"warehouse" },


  ],
  resource: [],
  algorithm: [
    { id: 1, name: "容量配置", icon: "/src/assets/icons/capacityConfiguration.svg", type:"capacityConfiguration" },
    { id: 2, name: "投料控制", icon: "/src/assets/icons/feedingControl.svg", type:"feedingControl" },
  ],
  script: [
    { id: 1, name: "创建脚本", icon: "/src/assets/icons/createScript.svg", type:"createScript" }
  ]
};

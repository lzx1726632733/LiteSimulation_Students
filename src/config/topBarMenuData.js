// 顶栏菜单数据。每个对象对应一个顶栏按钮及其下拉菜单项。
// dividerBefore: true  —— 在该项上方渲染分割线
// disabled: true       —— 置灰且不可点击（功能尚未实现时使用）

export const topBarMenus = [
  {
    id: 'start',
    label: '开始',
    items: [
      { id: 'new-model',   label: '新建模型' },
      { id: 'open-model',  label: '打开模型' },
      { id: 'save',        label: '保存' },
      { id: 'save-as',     label: '另存为' },
      { id: 'close-model', label: '关闭当前模型',   dividerBefore: true },
    ],
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { id: 'view-api',  label: '查看 API' },
      { id: 'demo',      label: '查看例程 Demo' },
      { id: 'about',     label: '关于 Litesimulation', dividerBefore: true },
    ],
  },
]

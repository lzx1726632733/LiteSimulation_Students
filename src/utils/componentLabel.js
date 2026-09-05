// 控件在画布标签、模型树、属性面板和日志里显示的名称，全项目共用这一处口径。
//
// 默认名称由"类型名 + 序号"拼出（如 输入1）；用户在画布上双击标签改名后，
// 结果存在 displayName 上并优先使用。改名只影响显示，不动 name/index，
// 因此序号复用（getNextIndexForType）等逻辑不受影响。
export const getComponentLabel = (component) => {
  if (!component) return "";

  const custom = component.displayName;
  if (typeof custom === "string" && custom.trim() !== "") {
    return custom.trim();
  }

  return `${component.name}${component.index}`;
};

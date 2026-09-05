const { contextBridge, ipcRenderer } = require('electron')

// 示例：暴露窗口控制 API，按需增减
contextBridge.exposeInMainWorld('electronAPI', {
  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close'),
  winIsMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  // 订阅最大化状态变化，返回取消订阅函数供组件卸载时调用
  onMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized)
    ipcRenderer.on('win-maximized-change', listener)
    return () => ipcRenderer.off('win-maximized-change', listener)
  }
})

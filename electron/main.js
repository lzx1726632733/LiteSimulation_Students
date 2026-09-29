const { app, BrowserWindow, Menu, ipcMain } = require('electron/main')
const path = require('node:path')
const net = require('node:net')

const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000'

const waitForServer = (url, timeoutMs = 15000) => {
  const { hostname, port } = new URL(url)
  const targetPort = Number(port || 80)

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()

    const tryConnect = () => {
      const socket = net.createConnection({ host: hostname, port: targetPort })

      socket.once('connect', () => {
        socket.end()
        resolve()
      })

      socket.once('error', () => {
        socket.destroy()

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`))
          return
        }

        setTimeout(tryConnect, 250)
      })
    }

    tryConnect()
  })
}

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false, // 去掉原生标题栏（使用前端自定义的 TopBar）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // 最大化/还原状态变化时通知渲染进程，让 TopBar 切换按钮图标
  const sendMaximizedState = () => {
    if (win.isDestroyed()) return
    win.webContents.send('win-maximized-change', win.isMaximized())
  }
  win.on('maximize', sendMaximizedState)
  win.on('unmaximize', sendMaximizedState)
  // 页面加载前先最大化，让画布初始化时直接使用最大化后的窗口尺寸。
  win.maximize()
  win.once('ready-to-show', () => {
    win.show()
  })

  if (app.isPackaged) {
    await win.loadFile(path.join(__dirname, '../dist/index.html'))
    return
  }

  await waitForServer(devServerUrl)
  await win.loadURL(devServerUrl)
}

// 窗口控制 IPC：最小化、最大化/还原、关闭
// 用 event.sender 定位发起请求的窗口，避免引用到已销毁的窗口实例
ipcMain.on('win-min', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.on('win-max', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
})
ipcMain.on('win-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
// 渲染进程挂载时查询当前状态，避免刷新后图标与真实窗口状态不一致
ipcMain.handle('win-is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
})

app.whenReady().then(() => {
  // 去掉原生菜单栏（File/Edit/View 等），使用前端自定义菜单
  Menu.setApplicationMenu(null)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

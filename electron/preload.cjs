const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('ppmsDesktop', {
  isDesktop: true,
})

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  hardReload: () => ipcRenderer.send('window:hardReload'),
  forceQuit: () => ipcRenderer.send('app:forceQuit'),
  onConfirmQuit: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('app:confirmQuit', handler);
    return () => { ipcRenderer.off('app:confirmQuit', handler); };
  },
  popout: (data: { type: string; url?: string; filePath?: string }) => ipcRenderer.invoke('window:popout', data),
  popoutPanel: (data: { panelType: 'terminal' | 'editor'; payload: any }) => ipcRenderer.invoke('window:popoutPanel', data),
  closePopoutPanel: (panelId: string) => ipcRenderer.send('panel:close', panelId),
  onPanelReturned: (cb: (data: { panelId: string; panelType?: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('panel:returned', handler);
    return () => { ipcRenderer.off('panel:returned', handler); };
  },
  onPanelClosed: (cb: (data: { panelId: string; panelType: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('panel:closed', handler);
    return () => { ipcRenderer.off('panel:closed', handler); };
  },
  popoutRefresh: () => ipcRenderer.send('popout:refresh'),
  onPopoutLoad: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('popout:load', handler);
    return () => { ipcRenderer.off('popout:load', handler); };
  },
  onPopoutRefresh: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('popout:refresh', handler);
    return () => { ipcRenderer.off('popout:refresh', handler); };
  },
  onPopoutClosed: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('popout:closed', handler);
    return () => { ipcRenderer.off('popout:closed', handler); };
  },
  onPopoutSendPrompt: (cb: (prompt: string) => void) => {
    const handler = (_e: any, prompt: string) => cb(prompt);
    ipcRenderer.on('popout:sendPrompt', handler);
    return () => { ipcRenderer.off('popout:sendPrompt', handler); };
  },

  // Env
  getHomeDir: () => ipcRenderer.invoke('env:homeDir'),
  getAppVersion: () => ipcRenderer.invoke('env:appVersion'),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardReadImage: (projectPath: string) => ipcRenderer.invoke('clipboard:readImage', projectPath),
  clipboardWrite: (text: string) => ipcRenderer.send('clipboard:write', text),

  // Touch input do webview pres CDP
  mobileEnableTouch: (webContentsId: number) => ipcRenderer.invoke('mobile:enableTouch', webContentsId),
  mobileDisableTouch: (webContentsId: number) => ipcRenderer.invoke('mobile:disableTouch', webContentsId),
  mobileSetColorScheme: (webContentsId: number, scheme: 'dark' | 'light') => ipcRenderer.invoke('mobile:setColorScheme', webContentsId, scheme),
  mobileTouch: (webContentsId: number, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x: number, y: number) =>
    ipcRenderer.send('mobile:touch', webContentsId, type, x, y),

  // Store (settings)
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
  storeGetAll: () => ipcRenderer.invoke('store:getAll'),

  // Projects
  scanProjects: (scanPath: string) => ipcRenderer.invoke('projects:scan', scanPath),
  getPinnedProjects: () => ipcRenderer.invoke('projects:getPinned'),
  togglePinProject: (projectPath: string) => ipcRenderer.invoke('projects:togglePin', projectPath),
  getProjectPrefs: (projectPath: string) => ipcRenderer.invoke('projects:getPrefs', projectPath),
  setProjectPref: (projectPath: string, key: string, value: any) => ipcRenderer.invoke('projects:setPref', projectPath, key, value),

  // Git
  gitStatus: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
  gitPull: (projectPath: string) => ipcRenderer.invoke('git:pull', projectPath),
  gitLog: (projectPath: string, count?: number) => ipcRenderer.invoke('git:log', projectPath, count),
  gitDiff: (projectPath: string) => ipcRenderer.invoke('git:diff', projectPath),
  gitDiffStaged: (projectPath: string) => ipcRenderer.invoke('git:diffStaged', projectPath),
  gitCommit: (projectPath: string, message: string, push?: boolean) => ipcRenderer.invoke('git:commit', projectPath, message, push),
  gitPush: (projectPath: string) => ipcRenderer.invoke('git:push', projectPath),
  gitRevparse: (projectPath: string) => ipcRenderer.invoke('git:revparse', projectPath),
  gitResetHard: (projectPath: string, hash: string) => ipcRenderer.invoke('git:resetHard', projectPath, hash),
  gitDiffRange: (projectPath: string, fromHash: string) => ipcRenderer.invoke('git:diffRange', projectPath, fromHash),
  gitRecentFiles: (projectPath: string) => ipcRenderer.invoke('git:recentFiles', projectPath),

  // Capture (screenshot region for lasso → CC)
  captureRegion: (rect: { x: number; y: number; width: number; height: number }, savePath: string) =>
    ipcRenderer.invoke('capture:region', rect, savePath),
  captureCleanup: (tmpDir: string) => ipcRenderer.invoke('capture:cleanup', tmpDir),

  // Project management (destrukivní)
  deleteProject: (projectPath: string) => ipcRenderer.invoke('fs:deleteProject', projectPath),
  renameProject: (oldPath: string, newName: string) => ipcRenderer.invoke('fs:renameProject', oldPath, newName),
  duplicateProject: (sourcePath: string, newName: string) => ipcRenderer.invoke('fs:duplicateProject', sourcePath, newName),
  shellOpenPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),

  // File system
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  dirStats: (dirPath: string) => ipcRenderer.invoke('fs:dirStats', dirPath),
  fileStats: (filePath: string) => ipcRenderer.invoke('fs:fileStats', filePath),
  listFilesRecursive: (rootPath: string) => ipcRenderer.invoke('fs:listFilesRecursive', rootPath),
  projectAssetsHash: (rootDir: string) => ipcRenderer.invoke('fs:projectAssetsHash', rootDir),
  projectSearch: (rootPath: string, query: string, opts: any) => ipcRenderer.invoke('fs:projectSearch', rootPath, query, opts),
  projectReplace: (rootPath: string, query: string, replacement: string, opts: any) => ipcRenderer.invoke('fs:projectReplace', rootPath, query, replacement, opts),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createDir: (dirPath: string) => ipcRenderer.invoke('fs:createDir', dirPath),
  getLanguage: (filePath: string) => ipcRenderer.invoke('fs:getLanguage', filePath),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: (multi?: boolean) => ipcRenderer.invoke('dialog:openFile', multi),

  // PTY
  createPty: (cwd: string) => ipcRenderer.invoke('pty:create', cwd),
  writePty: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  resizePty: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  killPty: (id: string) => ipcRenderer.send('pty:kill', id),
  onPtyData: (callback: (id: string, data: string) => void): (() => void) => {
    const handler = (_event: any, id: string, data: string) => callback(id, data);
    ipcRenderer.on('pty:data', handler);
    return () => { ipcRenderer.off('pty:data', handler); };
  },
  onPtyExit: (callback: (id: string) => void): (() => void) => {
    const handler = (_event: any, id: string) => callback(id);
    ipcRenderer.on('pty:exit', handler);
    return () => { ipcRenderer.off('pty:exit', handler); };
  },

  // GRAL
  gralAudit: (projectPath: string) => ipcRenderer.invoke('gral:audit', projectPath),
  gralParseTokens: (projectPath: string) => ipcRenderer.invoke('gral:parseTokens', projectPath),
  gralFileSizes: (projectPath: string) => ipcRenderer.invoke('gral:fileSizes', projectPath),
  gralDetectType: (projectPath: string) => ipcRenderer.invoke('gral:detectType', projectPath),

  // Project helpers
  generateClaudeMd: (projectPath: string) => ipcRenderer.invoke('project:generateClaudeMd', projectPath),

  // Scaffolding
  scaffoldProject: (name: string, targetDir: string, template?: string) =>
    ipcRenderer.invoke('scaffold:create', name, targetDir, template),

  // Deploy (FTP)
  deployFtp: (projectPath: string) => ipcRenderer.invoke('deploy:ftp', projectPath),
  deployGetConfig: (projectPath: string) => ipcRenderer.invoke('deploy:getConfig', projectPath),
  deploySetConfig: (projectPath: string, config: any) => ipcRenderer.invoke('deploy:setConfig', projectPath, config),

  // Usage tracker
  usageScan: () => ipcRenderer.invoke('usage:scan'),
  usageAccount: () => ipcRenderer.invoke('usage:account'),
  usageRateLimits: () => ipcRenderer.invoke('usage:rateLimits'),
};

contextBridge.exposeInMainWorld('levis', api);

const path = require('node:path')

function resolveRuntimePaths({ isPackaged, appPath, resourcesPath, legacyUserDataPath, localAppData }) {
  const dataRoot = isPackaged
    ? localAppData ? path.join(localAppData, 'PPMS') : legacyUserDataPath
    : appPath
  const databaseDir = path.join(dataRoot, 'data')
  const backupDir = isPackaged ? path.join(dataRoot, 'backups') : path.join(appPath, 'backups')
  const logDir = isPackaged ? path.join(dataRoot, 'logs') : path.join(appPath, 'logs')
  const legacyDatabasePaths = isPackaged
    ? [
        path.join(legacyUserDataPath, 'data', 'ppms.sqlite'),
        path.join(resourcesPath, 'data', 'ppms.sqlite'),
        path.join(appPath, 'data', 'ppms.sqlite'),
      ].filter((candidate) => path.resolve(candidate) !== path.resolve(databaseDir, 'ppms.sqlite'))
    : []

  return {
    appRoot: appPath,
    dataRoot,
    databaseDir,
    databasePath: path.join(databaseDir, 'ppms.sqlite'),
    backupDir,
    logDir,
    legacyDatabasePaths: [...new Set(legacyDatabasePaths)],
  }
}

module.exports = { resolveRuntimePaths }
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveRuntimePaths } = require('./runtime-paths.cjs')

describe('Electron runtime paths', () => {
  it('keeps production data independent of the installation directory', () => {
    const shared = { isPackaged: true, resourcesPath: 'C:\\Program Files\\PPMS\\resources', legacyUserDataPath: 'C:\\Users\\User\\AppData\\Roaming\\PPMS', localAppData: 'C:\\Users\\User\\AppData\\Local' }
    const programFiles = resolveRuntimePaths({ ...shared, appPath: 'C:\\Program Files\\PPMS\\resources\\app' })
    const otherDrive = resolveRuntimePaths({ ...shared, appPath: 'D:\\Software\\PPMS\\resources\\app' })

    assert.equal(programFiles.databasePath, 'C:\\Users\\User\\AppData\\Local\\PPMS\\data\\ppms.sqlite')
    assert.equal(otherDrive.databasePath, programFiles.databasePath)
    assert.equal(programFiles.backupDir, 'C:\\Users\\User\\AppData\\Local\\PPMS\\backups')
    assert.equal(programFiles.logDir, 'C:\\Users\\User\\AppData\\Local\\PPMS\\logs')
  })

  it('keeps development data in the project data and backup folders', () => {
    const paths = resolveRuntimePaths({
      isPackaged: false,
      appPath: 'D:\\PPMStest\\PPMS',
      resourcesPath: '',
      legacyUserDataPath: '',
      localAppData: '',
    })

    assert.equal(paths.databasePath, path.join('D:\\PPMStest\\PPMS', 'data', 'ppms.sqlite'))
    assert.equal(paths.backupDir, path.join('D:\\PPMStest\\PPMS', 'backups'))
    assert.equal(paths.logDir, path.join('D:\\PPMStest\\PPMS', 'logs'))
  })

  it('falls back to Electron userData without adding a duplicate PPMS directory', () => {
    const paths = resolveRuntimePaths({
      isPackaged: true,
      appPath: 'C:\\Program Files\\PPMS\\resources\\app',
      resourcesPath: 'C:\\Program Files\\PPMS\\resources',
      legacyUserDataPath: 'C:\\Users\\User\\AppData\\Roaming\\PPMS',
      localAppData: '',
    })

    assert.equal(paths.databasePath, 'C:\\Users\\User\\AppData\\Roaming\\PPMS\\data\\ppms.sqlite')
  })

  it('lists prior Electron and packaged seed databases as migration sources', () => {
    const paths = resolveRuntimePaths({
      isPackaged: true,
      appPath: 'C:\\Program Files\\PPMS\\resources\\app',
      resourcesPath: 'C:\\Program Files\\PPMS\\resources',
      legacyUserDataPath: 'C:\\Users\\User\\AppData\\Roaming\\PPMS',
      localAppData: 'C:\\Users\\User\\AppData\\Local',
    })

    assert.deepEqual(paths.legacyDatabasePaths, [
      'C:\\Users\\User\\AppData\\Roaming\\PPMS\\data\\ppms.sqlite',
      'C:\\Program Files\\PPMS\\resources\\data\\ppms.sqlite',
      'C:\\Program Files\\PPMS\\resources\\app\\data\\ppms.sqlite',
    ])
  })
})
import { describe, expect, it } from 'vitest'
import { createBackup, readStored, restoreBackup, writeStored } from './storage'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('PPMS storage', () => {
  it('reads legacy raw JSON and writes versioned envelopes', () => {
    const storage = memoryStorage({ 'ppms-sales': JSON.stringify([{ id: 1 }]) })

    expect(readStored(storage, 'ppms-sales', [])).toEqual([{ id: 1 }])
    writeStored(storage, 'ppms-sales', [{ id: 2 }])
    expect(JSON.parse(storage.getItem('ppms-sales') || '{}')).toEqual({ version: 1, data: [{ id: 2 }] })
  })

  it('creates and restores backups for allowed register keys', () => {
    const storage = memoryStorage({ 'ppms-sales': JSON.stringify([{ id: 1 }]), 'ppms-expenses': JSON.stringify([{ id: 2 }]) })
    const backup = createBackup(storage, ['ppms-sales', 'ppms-expenses'])
    const restored = memoryStorage()

    restoreBackup(restored, backup, ['ppms-sales', 'ppms-expenses'])

    expect(readStored(restored, 'ppms-sales', [])).toEqual([{ id: 1 }])
    expect(readStored(restored, 'ppms-expenses', [])).toEqual([{ id: 2 }])
  })

  it('rejects malformed backups', () => {
    expect(() => restoreBackup(memoryStorage(), '{"data": []}', ['ppms-sales'])).toThrow('Invalid PPMS backup file.')
  })
})

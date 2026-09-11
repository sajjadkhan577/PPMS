export const PPMS_STORAGE_VERSION = 1

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

type StorageEnvelope<T> = {
  version: number
  data: T
}

export function readStored<T>(storage: StorageLike, key: string, initial: T, normalize: (value: unknown) => T = (value) => value as T): T {
  const saved = storage.getItem(key)
  if (!saved) return initial

  try {
    const parsed: unknown = JSON.parse(saved)
    if (isEnvelope<T>(parsed)) return normalize(parsed.data)
    return normalize(parsed)
  } catch {
    return initial
  }
}

export function writeStored<T>(storage: StorageLike, key: string, value: T) {
  const envelope: StorageEnvelope<T> = { version: PPMS_STORAGE_VERSION, data: value }
  storage.setItem(key, JSON.stringify(envelope))
}

export function createBackup(storage: StorageLike, keys: string[]) {
  const data: Record<string, unknown> = {}

  for (const key of keys) {
    const saved = storage.getItem(key)
    if (!saved) continue
    try {
      const parsed: unknown = JSON.parse(saved)
      data[key] = isEnvelope(parsed) ? parsed.data : parsed
    } catch {
      throw new Error(`Cannot back up invalid storage entry: ${key}`)
    }
  }

  return JSON.stringify({ version: PPMS_STORAGE_VERSION, createdAt: new Date().toISOString(), data }, null, 2)
}

export function restoreBackup(storage: StorageLike, backup: string, keys: string[]) {
  const parsed: unknown = JSON.parse(backup)
  if (!isBackup(parsed)) throw new Error('Invalid PPMS backup file.')

  const allowed = new Set(keys)
  for (const [key, value] of Object.entries(parsed.data)) {
    if (allowed.has(key)) writeStored(storage, key, value)
  }
}

function isEnvelope<T>(value: unknown): value is StorageEnvelope<T> {
  return typeof value === 'object' && value !== null && 'version' in value && 'data' in value
}

function isBackup(value: unknown): value is { version: number; createdAt: string; data: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return 'version' in record && 'createdAt' in record && typeof record.data === 'object' && record.data !== null
}

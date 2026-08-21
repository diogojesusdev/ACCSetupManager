import type { AppBootstrap } from '../types/models'

const bootstrapCacheKey = 'acc-setup-manager.bootstrap-cache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAppBootstrap(value: unknown): value is AppBootstrap {
  if (!isRecord(value)) {
    return false
  }

  const { settings, library, undoState } = value
  return (
    isRecord(settings) &&
    isRecord(library) &&
    Array.isArray(library.cars) &&
    Array.isArray(library.tracks) &&
    isRecord(undoState)
  )
}

export function loadCachedBootstrap(): AppBootstrap | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const raw = window.localStorage.getItem(bootstrapCacheKey)
  if (!raw) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return isAppBootstrap(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function saveCachedBootstrap(value: AppBootstrap): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(bootstrapCacheKey, JSON.stringify(value))
}

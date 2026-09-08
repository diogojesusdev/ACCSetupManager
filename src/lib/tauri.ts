import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AppBootstrap,
  LocalSetup,
  MutationResult,
  RemoteSourceResult,
  SetupDocument,
} from '../types/models'

export async function loadAppBootstrap(): Promise<AppBootstrap> {
  return invoke<AppBootstrap>('load_app_bootstrap')
}

export async function notifyFrontendReady(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return
  }

  await invoke('frontend_ready')
}

export async function setManualSetupRoot(path: string | null): Promise<AppBootstrap> {
  return invoke<AppBootstrap>('set_manual_setup_root', { path })
}

export async function readSetupDocument(path: string): Promise<SetupDocument> {
  return invoke<SetupDocument>('read_setup_document', { path })
}

export async function loadLocalSetups(trackPath: string): Promise<LocalSetup[]> {
  return invoke<LocalSetup[]>('load_local_setups', { trackPath })
}

export async function saveLocalSetup(path: string, content: string): Promise<MutationResult> {
  return invoke<MutationResult>('save_local_setup', { path, content })
}

export async function createLocalSetup(
  trackPath: string,
  fileName: string,
): Promise<MutationResult> {
  return invoke<MutationResult>('create_local_setup', { trackPath, fileName })
}

export async function renameLocalSetup(
  path: string,
  newFileName: string,
): Promise<MutationResult> {
  return invoke<MutationResult>('rename_local_setup', { path, newFileName })
}

export async function deleteLocalSetup(path: string): Promise<MutationResult> {
  return invoke<MutationResult>('delete_local_setup', { path })
}

export async function importLocalSetup(
  trackPath: string,
  sourcePath: string,
  targetFileName: string,
  overwrite = false,
): Promise<MutationResult> {
  return invoke<MutationResult>('import_local_setup', {
    trackPath,
    sourcePath,
    targetFileName,
    overwrite,
  })
}

export async function copyLocalSetupToTracks(
  sourcePath: string,
  targetTrackPaths: string[],
): Promise<MutationResult> {
  return invoke<MutationResult>('copy_local_setup_to_tracks', {
    sourcePath,
    targetTrackPaths,
  })
}

export async function undoLastOperation(): Promise<MutationResult> {
  return invoke<MutationResult>('undo_last_operation')
}

export async function redoLastOperation(): Promise<MutationResult> {
  return invoke<MutationResult>('redo_last_operation')
}

export async function loadRemoteSourceResultsFromBackend(args: {
  sourceId: string
  carFolderName: string
  carDisplayName: string
  trackFolderName: string
  trackDisplayName: string
  forceRefresh?: boolean
}): Promise<RemoteSourceResult> {
  return invoke<RemoteSourceResult>('load_remote_source_results', args)
}

export async function readRemoteSetupDocument(
  sourceId: string,
  remoteSetupId: string,
): Promise<SetupDocument> {
  return invoke<SetupDocument>('read_remote_setup_document', { sourceId, remoteSetupId })
}

export async function downloadRemoteSetup(args: {
  sourceId: string
  remoteSetupId: string
  trackPath: string
  targetFileName: string
  overwrite?: boolean
}): Promise<MutationResult> {
  return invoke<MutationResult>('download_remote_setup', args)
}

export async function downloadRemoteSetupToTracks(args: {
  sourceId: string
  remoteSetupId: string
  targetTrackPaths: string[]
  targetFileName: string
}): Promise<MutationResult> {
  return invoke<MutationResult>('download_remote_setup_to_tracks', args)
}

export async function readCarGlobalSetup(carFolder: string): Promise<SetupDocument> {
  return invoke<SetupDocument>('global_setup_read_master', { carFolder })
}

export async function adoptGlobalSetup(
  carFolder: string,
  sourcePath: string,
): Promise<MutationResult> {
  return invoke<MutationResult>('global_setup_adopt', { carFolder, sourcePath })
}

export async function saveGlobalSetupMaster(
  carFolder: string,
  content: string,
): Promise<MutationResult> {
  return invoke<MutationResult>('global_setup_save_master', { carFolder, content })
}

export async function subscribeToGlobalSetupChanges(
  onChange: () => void,
): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => {}
  }

  const { listen } = await import('@tauri-apps/api/event')
  return listen('global-setup-state-changed', () => {
    onChange()
  })
}

export async function chooseDirectory(): Promise<string | null> {
  const result = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select the ACC setups root',
  })

  return typeof result === 'string' ? result : null
}

export async function chooseImportFile(): Promise<string | null> {
  const result = await openDialog({
    directory: false,
    multiple: false,
    title: 'Import setup JSON',
    filters: [{ name: 'Setup JSON', extensions: ['json'] }],
  })

  return typeof result === 'string' ? result : null
}

export async function openExternal(url: string): Promise<void> {
  await openUrl(url)
}

function currentWindowOrNull() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null
  }

  return getCurrentWindow()
}

export async function minimizeCurrentWindow(): Promise<void> {
  const appWindow = currentWindowOrNull()
  if (!appWindow) {
    return
  }

  await appWindow.minimize()
}

export async function startDraggingCurrentWindow(): Promise<void> {
  const appWindow = currentWindowOrNull()
  if (!appWindow) {
    return
  }

  await appWindow.startDragging()
}

export async function toggleCurrentWindowMaximize(): Promise<void> {
  const appWindow = currentWindowOrNull()
  if (!appWindow) {
    return
  }

  await appWindow.toggleMaximize()
}

export async function closeCurrentWindow(): Promise<void> {
  const appWindow = currentWindowOrNull()
  if (!appWindow) {
    return
  }

  await appWindow.close()
}

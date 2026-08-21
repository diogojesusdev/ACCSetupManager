import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AppBootstrap,
  MutationResult,
  RemoteSourceResult,
  SetupDocument,
} from '../types/models'

export async function loadAppBootstrap(): Promise<AppBootstrap> {
  return invoke<AppBootstrap>('load_app_bootstrap')
}

export async function setManualSetupRoot(path: string | null): Promise<AppBootstrap> {
  return invoke<AppBootstrap>('set_manual_setup_root', { path })
}

export async function readSetupDocument(path: string): Promise<SetupDocument> {
  return invoke<SetupDocument>('read_setup_document', { path })
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

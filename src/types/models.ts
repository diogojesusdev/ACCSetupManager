export type RootStatus = 'ready' | 'missing' | 'invalid'

export interface AppSettings {
  detectedRoot: string | null
  manualRoot: string | null
  effectiveRoot: string | null
  rootStatus: RootStatus
}

export interface Car {
  id: string
  folderName: string
  displayName: string
  absolutePath: string
  trackCount: number
  globalSetupPath: string
}

export interface Track {
  id: string
  carId: string
  folderName: string
  displayName: string
  absolutePath: string
  setupCount: number
}

export interface LocalSetup {
  id: string
  trackId: string
  fileName: string
  displayName: string
  absolutePath: string
  lastModifiedAt: string
  fileExtension: string | null
}

export interface LocalLibrary {
  cars: Car[]
  tracks: Track[]
}

export interface UndoState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export interface AppBootstrap {
  settings: AppSettings
  library: LocalLibrary
  undoState: UndoState
}

export interface MutationResult {
  bootstrap: AppBootstrap
  selectedSetupPath: string | null
}

export interface SetupDocument {
  kind: 'local' | 'remote' | 'global'
  id: string
  title: string
  content: string
  readOnly: boolean
  dirty: boolean
  sourceLabel: string
  remoteDownload?: RemoteDownloadDescriptor
  /** Set when `kind` is `'global'`: the car folder this master belongs to. */
  carFolder?: string
}

export interface RemoteDownloadDescriptor {
  sourceId: string
  remoteSetupId: string
  suggestedFileName: string
  sourcePageUrl?: string
}

export interface RemoteSource {
  id: string
  name: string
  baseUrl: string
  supportsPreview: boolean
  summary: string
}

export interface RemoteSetup {
  id: string
  sourceId: string
  name: string
  displayName: string
  fileName: string
  sourcePageUrl: string
  downloadUrl?: string
  updatedAt?: string
  author?: string
  previewAvailable: boolean
  sourceMetadata?: Record<string, unknown>
}

export interface RemoteSourceResult {
  items: RemoteSetup[]
  stale: boolean
  message: string
}

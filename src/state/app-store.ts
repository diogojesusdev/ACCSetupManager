import { create } from 'zustand'
import type { SetupDocument } from '../types/models'
import type { LocalSortMode } from '../lib/setup-list'

export interface OpenDocumentState extends SetupDocument {
  savedContent: string
}

interface AppStoreState {
  selectedCarId: string | null
  selectedTrackId: string | null
  selectedLocalSetupId: string | null
  localFilter: string
  localSortMode: LocalSortMode
  activeRemoteSourceId: string
  selectedRemoteSetupIds: Record<string, string | null>
  remoteFilters: Record<string, string>
  openDocument: OpenDocumentState | null
  setSelectedCarId: (carId: string | null) => void
  setSelectedTrackId: (trackId: string | null) => void
  setSelectedLocalSetupId: (setupId: string | null) => void
  setLocalFilter: (value: string) => void
  setLocalSortMode: (value: LocalSortMode) => void
  setActiveRemoteSourceId: (value: string) => void
  setSelectedRemoteSetupId: (sourceId: string, setupId: string | null) => void
  setRemoteFilter: (sourceId: string, value: string) => void
  openDocumentPane: (document: SetupDocument) => void
  updateOpenDocumentContent: (content: string) => void
  markOpenDocumentSaved: (savedContent: string, newId?: string, newTitle?: string) => void
  closeOpenDocument: () => void
}

export const useAppStore = create<AppStoreState>((set) => ({
  selectedCarId: null,
  selectedTrackId: null,
  selectedLocalSetupId: null,
  localFilter: '',
  localSortMode: 'alphabetical',
  activeRemoteSourceId: 'simply-lovely-setups',
  selectedRemoteSetupIds: {},
  remoteFilters: {},
  openDocument: null,
  setSelectedCarId: (selectedCarId) => set({ selectedCarId }),
  setSelectedTrackId: (selectedTrackId) => set({ selectedTrackId }),
  setSelectedLocalSetupId: (selectedLocalSetupId) => set({ selectedLocalSetupId }),
  setLocalFilter: (localFilter) => set({ localFilter }),
  setLocalSortMode: (localSortMode) => set({ localSortMode }),
  setActiveRemoteSourceId: (activeRemoteSourceId) => set({ activeRemoteSourceId }),
  setSelectedRemoteSetupId: (sourceId, setupId) =>
    set((state) => ({
      selectedRemoteSetupIds: { ...state.selectedRemoteSetupIds, [sourceId]: setupId },
    })),
  setRemoteFilter: (sourceId, value) =>
    set((state) => ({
      remoteFilters: { ...state.remoteFilters, [sourceId]: value },
    })),
  openDocumentPane: (document) =>
    set({
      openDocument: {
        ...document,
        savedContent: document.content,
      },
    }),
  updateOpenDocumentContent: (content) =>
    set((state) => {
      if (!state.openDocument) {
        return state
      }

      return {
        openDocument: {
          ...state.openDocument,
          content,
          dirty: content !== state.openDocument.savedContent,
        },
      }
    }),
  markOpenDocumentSaved: (savedContent, newId, newTitle) =>
    set((state) => {
      if (!state.openDocument) {
        return state
      }

      return {
        openDocument: {
          ...state.openDocument,
          id: newId ?? state.openDocument.id,
          title: newTitle ?? state.openDocument.title,
          content: savedContent,
          savedContent,
          dirty: false,
        },
      }
    }),
  closeOpenDocument: () => set({ openDocument: null }),
}))

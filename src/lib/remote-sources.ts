import type { Car, RemoteSource, RemoteSourceResult, Track } from '../types/models'
import { loadRemoteSourceResultsFromBackend } from './tauri'

export const BUILT_IN_REMOTE_SOURCES: RemoteSource[] = [
  {
    id: 'simply-lovely-setups',
    name: 'Simply Lovely Setups',
    baseUrl: 'https://www.simplylovelysetups.com',
    supportsPreview: true,
    summary:
      'Spike winner: verified public JSON API, broad coverage, and adapter-friendly preview/download flow.',
  },
]

export async function loadRemoteSourceResults(
  source: RemoteSource,
  car: Car | undefined,
  track: Track | undefined,
  forceRefresh = false,
): Promise<RemoteSourceResult> {
  if (!car || !track) {
    return {
      items: [],
      stale: false,
      message: 'Select a car and a track to load remote setups.',
    }
  }

  return loadRemoteSourceResultsFromBackend({
    sourceId: source.id,
    carFolderName: car.folderName,
    carDisplayName: car.displayName,
    trackFolderName: track.folderName,
    trackDisplayName: track.displayName,
    forceRefresh,
  })
}

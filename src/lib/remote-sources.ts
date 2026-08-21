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
  {
    id: 'acccarsetups',
    name: 'ACCCarSetups',
    baseUrl: 'https://acccarsetups.com',
    supportsPreview: false,
    summary:
      'Broad public catalog, but verified rows link out to third-party pages instead of source-hosted setup files.',
  },
  {
    id: 'parc-ferme',
    name: 'Parc Ferme',
    baseUrl: 'https://www.parcferme.cc',
    supportsPreview: true,
    summary:
      'Rich public detail pages, but the verified ACC catalog is tiny and downloads require sign-in.',
  },
]

const REMOTE_SOURCE_SPIKE_MESSAGES: Record<string, string> = {
  'simply-lovely-setups':
    'Simply Lovely Setups is the recommended first v1 source: public list/detail JSON, broad ACC coverage, and practical preview/download generation.',
  acccarsetups:
    'The verification report deferred this source for v1 because its listings behave like an outbound directory rather than a source-native setup library.',
  'parc-ferme':
    'The verification report deferred this source for v1 because current ACC coverage is thin and the download flow requires a signed-in Discord session.',
}

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

  if (source.id === 'simply-lovely-setups') {
    return loadRemoteSourceResultsFromBackend({
      sourceId: source.id,
      carFolderName: car.folderName,
      carDisplayName: car.displayName,
      trackFolderName: track.folderName,
      trackDisplayName: track.displayName,
      forceRefresh,
    })
  }

  return {
    items: [],
    stale: false,
    message: `${REMOTE_SOURCE_SPIKE_MESSAGES[source.id] ?? `${source.name} is scaffolded as a built-in tab, but its live adapter still needs to be wired.`} See .agents/remote-source-verification-report.md for the evidence and adapter notes.`,
  }
}

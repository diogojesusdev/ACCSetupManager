import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  type ActionIconProps,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  NativeSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCloudOff,
  IconCopy,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconFolder,
  IconFolderOpen,
  IconGlobe,
  IconMapPin,
  IconMinus,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSquare,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import type { MouseEventHandler, ReactNode } from 'react'
import { clsx } from 'clsx'
import {
  BUILT_IN_REMOTE_SOURCES,
  loadRemoteSourceResults,
} from './lib/remote-sources'
import {
  closeCurrentWindow,
  chooseDirectory,
  chooseImportFile,
  adoptGlobalSetup,
  copyLocalSetupToTracks,
  createLocalSetup,
  deleteLocalSetup,
  downloadRemoteSetupToTracks,
  importLocalSetup,
  loadLocalSetups,
  loadAppBootstrap,
  minimizeCurrentWindow,
  openExternal,
  readCarGlobalSetup,
  readRemoteSetupDocument,
  readSetupDocument,
  redoLastOperation,
  renameLocalSetup,
  saveGlobalSetupMaster,
  saveLocalSetup,
  setManualSetupRoot,
  startDraggingCurrentWindow,
  subscribeToGlobalSetupChanges,
  toggleCurrentWindowMaximize,
  undoLastOperation,
} from './lib/tauri'
import {
  filterLocalSetups,
  filterRemoteSetups,
  isReservedGlobalSetupFileName,
  sortLocalSetups,
  sortRemoteSetups,
  type LocalSortMode,
} from './lib/setup-list'
import { loadCachedBootstrap, saveCachedBootstrap } from './lib/bootstrap-cache'
import { useAppStore } from './state/app-store'
import type { AppBootstrap, LocalSetup, MutationResult, RemoteSetup } from './types/models'

const bootstrapQueryKey = ['bootstrap']
const localSetupsQueryKey = ['local-setups'] as const
const HybridSetupEditor = lazy(async () => {
  const module = await import('./lib/setup-editor')
  return { default: module.HybridSetupEditor }
})
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

type RenameModalState =
  | { mode: 'create'; trackPath: string; fileName: string }
  | { mode: 'rename'; setup: LocalSetup; fileName: string }
  | null

type RemoteInstallModalState = {
  sourceId: string
  remoteSetupId: string
  fileName: string
  targetTrackIds: string[]
}

type CopySetupModalState = {
  setup: LocalSetup
  targetTrackIds: string[]
}

type SetupWorkspaceTab = 'local' | 'remote'

function showError(title: string, error: unknown): void {
  notifications.show({
    title,
    message: error instanceof Error ? error.message : String(error),
    color: 'red',
  })
}

function showSuccess(message: string): void {
  notifications.show({
    message,
    color: 'steel',
  })
}

function formatDate(value: string): string {
  return dateTimeFormatter.format(new Date(value))
}

function formatLabel(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1)
}

function getSetupTitleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^/.]+$/, '')
  const parts = stem.split(/[_-]+/).filter(Boolean)

  if (!parts.length) {
    return stem || fileName
  }

  return parts.map((part) => formatLabel(part)).join(' ')
}

function getRemoteSetupHighlights(setup: RemoteSetup): string[] {
  const sourceMetadata = setup.sourceMetadata ?? {}
  const details = [sourceMetadata.setupType, sourceMetadata.weather]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(formatLabel)

  if (setup.author) {
    details.push(`By ${setup.author}`)
  }

  return details
}

function App() {
  const queryClient = useQueryClient()
  const [renameModal, setRenameModal] = useState<RenameModalState>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<LocalSetup | null>(null)
  const [settingsOpened, setSettingsOpened] = useState(false)
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [pendingImportName, setPendingImportName] = useState('')
  const [copySetupModal, setCopySetupModal] = useState<CopySetupModalState | null>(null)
  const [setupWorkspaceTab, setSetupWorkspaceTab] = useState<SetupWorkspaceTab>('local')
  const [remoteInstallModal, setRemoteInstallModal] =
    useState<RemoteInstallModalState | null>(null)

  const {
    selectedCarId,
    selectedTrackId,
    selectedLocalSetupId,
    localFilter,
    localSortMode,
    activeRemoteSourceId,
    selectedRemoteSetupIds,
    remoteFilters,
    openDocument,
    setSelectedCarId,
    setSelectedTrackId,
    setSelectedLocalSetupId,
    setLocalFilter,
    setLocalSortMode,
    setActiveRemoteSourceId,
    setSelectedRemoteSetupId,
    setRemoteFilter,
    openDocumentPane,
    updateOpenDocumentContent,
    markOpenDocumentSaved,
    closeOpenDocument,
  } = useAppStore()

  const bootstrapQuery = useQuery({
    queryKey: bootstrapQueryKey,
    queryFn: loadAppBootstrap,
    placeholderData: loadCachedBootstrap,
  })

  const bootstrap = bootstrapQuery.data

  useEffect(() => {
    if (bootstrap && !bootstrapQuery.isPlaceholderData) {
      saveCachedBootstrap(bootstrap)
    }
  }, [bootstrap, bootstrapQuery.isPlaceholderData])

  const selectedCar = bootstrap?.library.cars.find((car) => car.id === selectedCarId)
  const visibleTracks = useMemo(
    () =>
      bootstrap?.library.tracks.filter((track) => track.carId === selectedCarId) ?? [],
    [bootstrap?.library.tracks, selectedCarId],
  )
  const selectedTrack = visibleTracks.find((track) => track.id === selectedTrackId)
  const localSetupsQuery = useQuery({
    queryKey: [...localSetupsQueryKey, selectedTrackId],
    queryFn: () => loadLocalSetups(selectedTrackId ?? ''),
    enabled: Boolean(selectedTrackId),
  })
  const visibleLocalSetups = useMemo(
    () =>
      sortLocalSetups(filterLocalSetups(localSetupsQuery.data ?? [], localFilter), localSortMode),
    [localFilter, localSetupsQuery.data, localSortMode],
  )
  const activeRemoteSource =
    BUILT_IN_REMOTE_SOURCES.find((source) => source.id === activeRemoteSourceId) ??
    BUILT_IN_REMOTE_SOURCES[0]
  const selectedRemoteSetupId = selectedRemoteSetupIds[activeRemoteSource.id] ?? null
  const remoteQueryKey = [
    'remote-source',
    activeRemoteSource.id,
    selectedCar?.folderName,
    selectedTrack?.folderName,
  ] as const

  const remoteQuery = useQuery({
    queryKey: remoteQueryKey,
    queryFn: () => loadRemoteSourceResults(activeRemoteSource, selectedCar, selectedTrack),
    enabled: Boolean(selectedCar && selectedTrack && setupWorkspaceTab === 'remote'),
  })

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    const cars = bootstrap.library.cars
    if (!cars.length) {
      setSelectedCarId(null)
      setSelectedTrackId(null)
      setSelectedLocalSetupId(null)
      return
    }

    if (!selectedCarId || !cars.some((car) => car.id === selectedCarId)) {
      setSelectedCarId(cars[0]?.id ?? null)
      return
    }

    const tracks = bootstrap.library.tracks.filter((track) => track.carId === selectedCarId)
    if (!tracks.length) {
      setSelectedTrackId(null)
      setSelectedLocalSetupId(null)
      return
    }

    if (!selectedTrackId || !tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(tracks[0]?.id ?? null)
      return
    }

  }, [
    bootstrap,
    selectedCarId,
    selectedTrackId,
    setSelectedCarId,
    setSelectedLocalSetupId,
    setSelectedTrackId,
  ])

  useEffect(() => {
    if (!selectedLocalSetupId || !localSetupsQuery.data) {
      return
    }

    if (!localSetupsQuery.data.some((setup) => setup.id === selectedLocalSetupId)) {
      setSelectedLocalSetupId(null)
    }
  }, [localSetupsQuery.data, selectedLocalSetupId, setSelectedLocalSetupId])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void subscribeToGlobalSetupChanges(() => {
      if (disposed) {
        return
      }

      void queryClient.invalidateQueries({ queryKey: bootstrapQueryKey })
      void queryClient.invalidateQueries({ queryKey: localSetupsQueryKey })

      const current = useAppStore.getState().openDocument
      if (current?.kind !== 'global' || !current.carFolder || current.dirty) {
        return
      }

      const carFolder = current.carFolder
      void readCarGlobalSetup(carFolder)
        .then((document) => {
          const latest = useAppStore.getState().openDocument
          if (latest?.kind !== 'global' || latest.carFolder !== carFolder || latest.dirty) {
            return
          }
          useAppStore.getState().openDocumentPane(document)
        })
        .catch((error) => showError("Couldn't refresh the global setup", error))
    }).then((fn) => {
      if (disposed) {
        fn()
        return
      }
      unlisten = fn
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  const applyMutationResult = (result: MutationResult, successMessage?: string): void => {
    queryClient.setQueryData<AppBootstrap>(bootstrapQueryKey, result.bootstrap)
    void queryClient.invalidateQueries({ queryKey: localSetupsQueryKey })
    if (result.selectedSetupPath) {
      setSelectedLocalSetupId(result.selectedSetupPath)
    }
    if (successMessage) {
      showSuccess(successMessage)
    }
  }

  const openRemotePreview = async (setup: RemoteSetup) => {
    setSelectedRemoteSetupId(setup.sourceId, setup.id)
    await remotePreviewMutation.mutateAsync({
      sourceId: setup.sourceId,
      remoteSetupId: setup.id,
    })
  }

  const openRemoteInstallModal = ({
    sourceId,
    remoteSetupId,
    fileName,
  }: Omit<RemoteInstallModalState, 'targetTrackIds'>) => {
    if (!selectedTrack) {
      showError('Download unavailable', 'Select a track folder first.')
      return
    }
    setRemoteInstallModal({
      sourceId,
      remoteSetupId,
      fileName,
      targetTrackIds: [selectedTrack.id],
    })
  }

  const requestRemoteDownload = (setup: RemoteSetup) => {
    setSelectedRemoteSetupId(setup.sourceId, setup.id)
    openRemoteInstallModal({
      sourceId: setup.sourceId,
      remoteSetupId: setup.id,
      fileName: setup.fileName,
    })
  }

  const requestPreviewDownload = () => {
    const descriptor = openDocument?.remoteDownload
    if (!descriptor) {
      return
    }

    openRemoteInstallModal({
      sourceId: descriptor.sourceId,
      remoteSetupId: descriptor.remoteSetupId,
      fileName: descriptor.suggestedFileName,
    })
  }

  const openSetupInEditor = async (setupPath: string) => {
    try {
      const document = await readSetupDocument(setupPath)
      openDocumentPane(document)
    } catch (error) {
      showError("Couldn't open this setup", error)
    }
  }

  const openGlobalSetupInEditor = async (carFolder: string) => {
    try {
      const document = await readCarGlobalSetup(carFolder)
      openDocumentPane(document)
    } catch (error) {
      showError("Couldn't open the global setup", error)
    }
  }

  const createMutation = useMutation({
    mutationFn: ({ trackPath, fileName }: { trackPath: string; fileName: string }) =>
      createLocalSetup(trackPath, fileName),
    onSuccess: async (result) => {
      applyMutationResult(result, 'Your new setup is ready.')
      setRenameModal(null)
      if (result.selectedSetupPath) {
        await openSetupInEditor(result.selectedSetupPath)
      }
    },
    onError: (error) => showError("Couldn't create this setup", error),
  })

  const renameMutation = useMutation({
    mutationFn: ({ path, newFileName }: { path: string; newFileName: string }) =>
      renameLocalSetup(path, newFileName),
    onSuccess: (result, variables) => {
      applyMutationResult(result, 'Setup name updated.')
      setRenameModal(null)

      if (openDocument && openDocument.id === variables.path) {
        markOpenDocumentSaved(
          openDocument.content,
          result.selectedSetupPath ?? variables.path,
          getSetupTitleFromFileName(variables.newFileName),
        )
      }
    },
    onError: (error) => showError("Couldn't rename this setup", error),
  })

  const saveMutation = useMutation({
    mutationFn: ({
      path,
      content,
      carFolder,
    }: {
      path: string
      content: string
      carFolder?: string
    }) => (carFolder ? saveGlobalSetupMaster(carFolder, content) : saveLocalSetup(path, content)),
    onSuccess: (result) => {
      applyMutationResult(result, 'Changes saved.')
      if (openDocument) {
        markOpenDocumentSaved(openDocument.content)
      }
    },
    onError: (error) => showError("Couldn't save your changes", error),
  })

  const adoptGlobalSetupMutation = useMutation({
    mutationFn: ({ carFolder, sourcePath }: { carFolder: string; sourcePath: string }) =>
      adoptGlobalSetup(carFolder, sourcePath),
    onSuccess: (result) => {
      applyMutationResult(result, "Set as this car's global setup.")
    },
    onError: (error) => showError("Couldn't set this as the global setup", error),
  })

  const deleteMutation = useMutation({
    mutationFn: (path: string) => deleteLocalSetup(path),
    onSuccess: (result, path) => {
      applyMutationResult(result, 'Setup removed.')
      if (openDocument?.id === path) {
        closeOpenDocument()
      }
      setDeleteCandidate(null)
    },
    onError: (error) => showError("Couldn't remove this setup", error),
  })

  const importMutation = useMutation({
    mutationFn: ({
      trackPath,
      sourcePath,
      targetFileName,
      overwrite,
    }: {
      trackPath: string
      sourcePath: string
      targetFileName: string
      overwrite: boolean
    }) => importLocalSetup(trackPath, sourcePath, targetFileName, overwrite),
    onSuccess: (result) => {
      applyMutationResult(result, 'Setup added to your library.')
      setPendingImportName('')
      setImportOverwrite(false)
    },
    onError: (error) => showError("Couldn't add this setup", error),
  })

  const copyMutation = useMutation({
    mutationFn: ({
      sourcePath,
      targetTrackPaths,
    }: {
      sourcePath: string
      targetTrackPaths: string[]
    }) => copyLocalSetupToTracks(sourcePath, targetTrackPaths),
    onSuccess: (result, variables) => {
      const count = variables.targetTrackPaths.length
      applyMutationResult(result, `Setup copied to ${count} track${count === 1 ? '' : 's'}.`)
      setCopySetupModal(null)
    },
    onError: (error) => showError("Couldn't copy this setup", error),
  })

  const undoMutation = useMutation({
    mutationFn: () => undoLastOperation(),
    onSuccess: (result) => applyMutationResult(result),
    onError: (error) => showError("Couldn't undo that change", error),
  })

  const redoMutation = useMutation({
    mutationFn: () => redoLastOperation(),
    onSuccess: (result) => applyMutationResult(result),
    onError: (error) => showError("Couldn't redo that change", error),
  })

  const refreshRemoteMutation = useMutation({
    mutationFn: () =>
      loadRemoteSourceResults(activeRemoteSource, selectedCar, selectedTrack, true),
    onSuccess: (result) => {
      queryClient.setQueryData(remoteQueryKey, result)
      showSuccess('Community setups updated.')
    },
    onError: (error) => showError("Couldn't refresh community setups", error),
  })

  const remotePreviewMutation = useMutation({
    mutationFn: ({ sourceId, remoteSetupId }: { sourceId: string; remoteSetupId: string }) =>
      readRemoteSetupDocument(sourceId, remoteSetupId),
    onSuccess: (document) => openDocumentPane(document),
    onError: (error) => showError("Couldn't open this preview", error),
  })

  const remoteDownloadMutation = useMutation({
    mutationFn: ({
      sourceId,
      remoteSetupId,
      targetTrackPaths,
      targetFileName,
    }: {
      sourceId: string
      remoteSetupId: string
      targetTrackPaths: string[]
      targetFileName: string
    }) =>
      downloadRemoteSetupToTracks({
        sourceId,
        remoteSetupId,
        targetTrackPaths,
        targetFileName,
      }),
    onSuccess: (result, variables) => {
      const count = variables.targetTrackPaths.length
      applyMutationResult(result, `Setup added to ${count} track${count === 1 ? '' : 's'}.`)
      setRemoteInstallModal(null)
    },
    onError: (error) => showError("Couldn't add this setup", error),
  })

  const rootMutation = useMutation({
    mutationFn: (path: string | null) => setManualSetupRoot(path),
    onSuccess: (result) => {
      queryClient.setQueryData<AppBootstrap>(bootstrapQueryKey, result)
      void queryClient.removeQueries({ queryKey: localSetupsQueryKey })
      void queryClient.removeQueries({ queryKey: ['remote-source'] })
      showSuccess('Setup folder updated.')
      setSettingsOpened(false)
      closeOpenDocument()
    },
    onError: (error) => showError("Couldn't update your setup folder", error),
  })

  const handlePickRoot = async () => {
    try {
      const path = await chooseDirectory()
      if (!path) {
        return
      }

      await rootMutation.mutateAsync(path)
    } catch (error) {
      showError("Couldn't choose this folder", error)
    }
  }

  const handleImportClick = async () => {
    if (!selectedTrack) {
      showError('Choose a track first', 'Then you can add a setup to it.')
      return
    }

    try {
      const sourcePath = await chooseImportFile()
      if (!sourcePath) {
        return
      }

      const inferredName = sourcePath.split('\\').pop() ?? 'imported-setup.json'
      await importMutation.mutateAsync({
        trackPath: selectedTrack.id,
        sourcePath,
        targetFileName: pendingImportName || inferredName,
        overwrite: importOverwrite,
      })
    } catch (error) {
      showError("Couldn't add this setup", error)
    }
  }

  const handleDropImport = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!selectedTrack) {
      return
    }

    const file = event.dataTransfer.files.item(0) as (File & { path?: string }) | null
    const sourcePath = file?.path

    if (!sourcePath) {
      showError("Couldn't add this setup", 'Try choosing the file instead of dragging it here.')
      return
    }

    try {
      await importMutation.mutateAsync({
        trackPath: selectedTrack.id,
        sourcePath,
        targetFileName: file.name,
        overwrite: false,
      })
    } catch (error) {
      showError("Couldn't add this setup", error)
    }
  }

  const openCreateSetupModal = () => {
    if (!selectedTrack) {
      return
    }

    setRenameModal({ mode: 'create', trackPath: selectedTrack.id, fileName: '' })
  }

  const openRenameSetupModal = (setup: LocalSetup) => {
    setRenameModal({
      mode: 'rename',
      setup,
      fileName: setup.fileName,
    })
  }

  const openCopySetupModal = (setup: LocalSetup) => {
    setCopySetupModal({
      setup,
      targetTrackIds: [],
    })
  }

  if (!bootstrap) {
    return (
      bootstrapQuery.isError ? (
        <Group justify="center" align="center" mih="100vh" p="xl">
          <Alert color="red" title="ACC Setup Manager could not start">
            {bootstrapQuery.error instanceof Error
              ? bootstrapQuery.error.message
              : 'An unknown startup error occurred.'}
          </Alert>
        </Group>
      ) : (
        <Group justify="center" align="center" mih="100vh">
          <Loader size="lg" />
        </Group>
      )
    )
  }

  const bootstrapRefreshError =
    bootstrapQuery.isError && bootstrapQuery.error instanceof Error
      ? bootstrapQuery.error.message
      : null

  const selectCar = (carId: string) => {
    const carTracks = bootstrap.library.tracks.filter((track) => track.carId === carId)
    const nextTrackId =
      selectedCarId === carId && carTracks.some((track) => track.id === selectedTrackId)
        ? selectedTrackId
        : (carTracks[0]?.id ?? null)

    setSelectedCarId(carId)
    setSelectedTrackId(nextTrackId)
    setSelectedLocalSetupId(null)
  }

  const selectTrack = (trackId: string) => {
    setSelectedTrackId(trackId)
    setSelectedLocalSetupId(null)
  }

  const renderCarList = () => {
    if (!bootstrap.library.cars.length) {
      return (
        <Group justify="center" align="center" h="100%">
          <Stack gap={6} align="center">
            <Text size="sm" fw={600}>
              No cars found
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={300}>
              Choose your ACC setups folder to see your cars here.
            </Text>
          </Stack>
        </Group>
      )
    }

    return (
      <ScrollArea h="100%" type="auto" offsetScrollbars>
        <Stack gap="xs">
          {bootstrap.library.cars.map((car) => {
            const selected = car.id === selectedCarId
            return (
              <button
                key={car.id}
                type="button"
                className={clsx('setup-row', 'library-choice', selected && 'setup-row--selected')}
                onClick={() => selectCar(car.id)}
                title={car.folderName}
              >
                <span className="library-choice__main">
                  <ThemeIcon size={28} radius="sm" variant="light" color={selected ? 'steel' : 'dark'}>
                    {selected ? <IconFolderOpen size={16} /> : <IconFolder size={16} />}
                  </ThemeIcon>
                  <span className="library-choice__label">
                    <Text fw={600} truncate>
                      {car.displayName}
                    </Text>
                  </span>
                </span>
                <Badge variant="light" color={selected ? 'steel' : 'dark'} className="library-choice__meta">
                  {car.trackCount}
                </Badge>
              </button>
            )
          })}
        </Stack>
      </ScrollArea>
    )
  }

  const renderTrackList = () => {
    if (!selectedCar) {
      return (
        <Group justify="center" align="center" h="100%">
          <Stack gap={6} align="center">
            <Text size="sm" fw={600}>
              Select a car first
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={280}>
              Its tracks will appear here.
            </Text>
          </Stack>
        </Group>
      )
    }

    if (!visibleTracks.length) {
      return (
        <Group justify="center" align="center" h="100%">
          <Stack gap={6} align="center">
            <Text size="sm" fw={600}>
              No tracks found
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={280}>
              No tracks have been found for {selectedCar.displayName} yet.
            </Text>
          </Stack>
        </Group>
      )
    }

    return (
      <ScrollArea h="100%" type="auto" offsetScrollbars>
        <Stack gap="xs">
          {visibleTracks.map((track) => {
            const selected = track.id === selectedTrackId
            return (
              <button
                key={track.id}
                type="button"
                className={clsx('setup-row', 'library-choice', selected && 'setup-row--selected')}
                onClick={() => selectTrack(track.id)}
                title={track.folderName}
              >
                <span className="library-choice__main">
                  <ThemeIcon size={28} radius="sm" variant="light" color={selected ? 'steel' : 'dark'}>
                    <IconMapPin size={16} />
                  </ThemeIcon>
                  <span className="library-choice__label">
                    <Text fw={selected ? 600 : 500} truncate>
                      {track.displayName}
                    </Text>
                  </span>
                </span>
                <Badge variant="light" color={selected ? 'steel' : 'dark'} className="library-choice__meta">
                  {track.setupCount}
                </Badge>
              </button>
            )
          })}
        </Stack>
      </ScrollArea>
    )
  }

  const renderRemoteSetupList = ({
    items,
    selectedSetupId,
    onSelect,
    onOpenPreview,
    onDownload,
    onOpenSourcePage,
  }: {
    items: RemoteSetup[]
    selectedSetupId: string | null
    onSelect: (setup: RemoteSetup) => void
    onOpenPreview: (setup: RemoteSetup) => void
    onDownload: (setup: RemoteSetup) => void
    onOpenSourcePage: (setup: RemoteSetup) => void
  }) => (
      <ScrollArea h="100%" type="auto" offsetScrollbars>
        <Stack gap="xs">
          {items.map((item) => {
            const selected = item.id === selectedSetupId
            return (
              <Paper
                key={item.id}
                radius="sm"
                p="xs"
                onClick={() => onSelect(item)}
                onDoubleClick={() => onOpenPreview(item)}
                tabIndex={0}
                className={clsx('setup-row', selected && 'setup-row--selected')}
                style={{ cursor: 'pointer' }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onOpenPreview(item)
                  }

                  if (event.key === ' ') {
                    event.preventDefault()
                    onSelect(item)
                  }
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600}>{item.displayName}</Text>
                    <Group gap={6} wrap="wrap">
                      {getRemoteSetupHighlights(item).map((highlight) => (
                        <Badge key={`${item.id}-${highlight}`} variant="light" color="dark">
                          {highlight}
                        </Badge>
                      ))}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {item.updatedAt
                        ? `Updated ${formatDate(item.updatedAt)}`
                        : 'You can preview or add this setup to your library.'}
                    </Text>
                  </Stack>
                  <Group gap="xs" wrap="wrap" justify="flex-end" className="setup-row__actions">
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      rightSection={<IconExternalLink size={14} />}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenSourcePage(item)
                      }}
                    >
                      View source
                    </Button>
                    <Button
                      variant="light"
                      size="compact-xs"
                      leftSection={<IconEdit size={14} />}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenPreview(item)
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      size="compact-xs"
                      leftSection={<IconDownload size={14} />}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDownload(item)
                      }}
                    >
                      Download
                    </Button>
                  </Group>
                </Group>
              </Paper>
            )
          })}
        </Stack>
      </ScrollArea>
    )

  const renderGlobalSetupRow = () => {
    if (!selectedCar) {
      return null
    }

    return (
      <Paper
        key="global-setup"
        radius="sm"
        p="xs"
        onClick={() => void openGlobalSetupInEditor(selectedCar.folderName)}
        tabIndex={0}
        className="setup-row setup-row--global"
        style={{ cursor: 'pointer' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            void openGlobalSetupInEditor(selectedCar.folderName)
          }
        }}
      >
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
          <Group gap={8} wrap="nowrap">
            <IconGlobe size={16} />
            <Stack gap={2}>
              <Text fw={700}>Global setup</Text>
              <Text size="xs" c="dimmed">
                Applies to every track for {selectedCar.displayName}
              </Text>
            </Stack>
          </Group>
          <Badge variant="light" color="steel">
            Pinned
          </Badge>
        </Group>
      </Paper>
    )
  }

  const renderLocalSetupList = (items: LocalSetup[]) => {
    const globalSetupRow = selectedTrack ? renderGlobalSetupRow() : null

    if (!items.length) {
      return (
        <ScrollArea h="100%" type="auto" offsetScrollbars>
          <Stack gap="xs">
            {globalSetupRow}
            <Group justify="center" align="center" mih={160}>
              <Stack gap={6} align="center">
                <Text size="sm" fw={600}>
                  {selectedTrack ? 'No saved setups yet' : 'Choose a track to begin'}
                </Text>
                <Text size="sm" c="dimmed" ta="center" maw={280}>
                  {selectedTrack
                    ? 'Create a setup, add one from your computer, or browse community setups.'
                    : 'Choose a car and track to see the setups you have saved.'}
                </Text>
              </Stack>
            </Group>
          </Stack>
        </ScrollArea>
      )
    }

    return (
      <ScrollArea h="100%" type="auto" offsetScrollbars>
        <Stack gap="xs">
          {globalSetupRow}
          {items.map((setup) => {
            const selected = setup.id === selectedLocalSetupId
            return (
              <Paper
                key={setup.id}
                radius="sm"
                p="xs"
                onClick={() => setSelectedLocalSetupId(setup.id)}
                onDoubleClick={() => void openSetupInEditor(setup.id)}
                tabIndex={0}
                className={clsx('setup-row', selected && 'setup-row--selected')}
                style={{ cursor: 'pointer' }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void openSetupInEditor(setup.id)
                  }

                  if (event.key === ' ') {
                    event.preventDefault()
                    setSelectedLocalSetupId(setup.id)
                  }
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                  <Stack gap={4}>
                    <Text fw={600}>{setup.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      Saved {formatDate(setup.lastModifiedAt)}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap" className="setup-row__actions">
                    <IconActionButton
                      label="Open setup"
                      color="steel"
                      onClick={(event) => {
                        event.stopPropagation()
                        void openSetupInEditor(setup.id)
                      }}
                    >
                      <IconPencil size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Set as this car's global setup"
                      color="steel"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!selectedCar) {
                          return
                        }
                        void adoptGlobalSetupMutation.mutateAsync({
                          carFolder: selectedCar.folderName,
                          sourcePath: setup.id,
                        })
                      }}
                    >
                      <IconGlobe size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Copy setup to other tracks"
                      color="steel"
                      disabled={visibleTracks.length <= 1}
                      onClick={(event) => {
                        event.stopPropagation()
                        openCopySetupModal(setup)
                      }}
                    >
                      <IconCopy size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Rename setup"
                      color="gray"
                      onClick={(event) => {
                        event.stopPropagation()
                        openRenameSetupModal(setup)
                      }}
                    >
                      <IconEdit size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Delete setup"
                      color="red"
                      onClick={(event) => {
                        event.stopPropagation()
                        setDeleteCandidate(setup)
                      }}
                    >
                      <IconTrash size={16} />
                    </IconActionButton>
                  </Group>
                </Group>
              </Paper>
            )
          })}
        </Stack>
      </ScrollArea>
    )
  }

  const renderLocalSetupsPane = () => (
    <Stack gap="xs" h="100%" style={{ flex: 1, minHeight: 0 }}>
      <Group justify="space-between" align="flex-start">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {selectedTrack ? `${visibleLocalSetups.length} shown` : 'Select a track'}
        </Text>
        <Group gap={4} wrap="nowrap">
          <IconActionButton
            label="Create a new setup"
            color="steel"
            disabled={!selectedTrack}
            onClick={openCreateSetupModal}
          >
            <IconPlus size={16} />
          </IconActionButton>
          <IconActionButton
            label="Add a setup from your computer"
            color="steel"
            disabled={!selectedTrack}
            onClick={() => void handleImportClick()}
          >
            <IconDownload size={16} />
          </IconActionButton>
        </Group>
      </Group>

      <Group grow>
        <TextInput
          placeholder="Search saved setups"
          size="xs"
          value={localFilter}
          onChange={(event) => setLocalFilter(event.currentTarget.value)}
        />
        <NativeSelect
          size="xs"
          value={localSortMode}
          onChange={(event) => setLocalSortMode(event.currentTarget.value as LocalSortMode)}
          data={[
            { value: 'alphabetical', label: 'Alphabetical' },
            { value: 'recent', label: 'Recently modified' },
          ]}
        />
      </Group>

      <Box
        className="list-shell"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void handleDropImport(event)}
      >
        {!selectedTrack ? (
          renderLocalSetupList([])
        ) : localSetupsQuery.isLoading && !localSetupsQuery.data ? (
          <Group justify="center" align="center" h="100%">
            <Loader size="sm" />
          </Group>
        ) : localSetupsQuery.isError ? (
          <Group justify="center" align="center" h="100%">
            <Alert color="red" title="Couldn't load your setups">
              {localSetupsQuery.error instanceof Error
                ? localSetupsQuery.error.message
                : 'Try choosing the track again.'}
            </Alert>
          </Group>
        ) : (
          renderLocalSetupList(visibleLocalSetups)
        )}
      </Box>

    </Stack>
  )

  const renderRemoteLibraryPane = () => (
    <Stack gap="xs" h="100%" style={{ flex: 1, minHeight: 0 }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {selectedTrack ? 'Browse community setups' : 'Choose a track'}
        </Text>
      </Group>

      <Card withBorder radius="sm" className="context-strip">
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Group gap="xs" wrap="wrap">
              <Badge variant="light" color="steel">
                {activeRemoteSource.name}
              </Badge>
              {remoteQuery.data?.stale ? (
                <Badge color="yellow" variant="light">
                  Cached
                </Badge>
              ) : null}
            </Group>
            <Group gap="xs" wrap="wrap">
              {BUILT_IN_REMOTE_SOURCES.length > 1 ? (
                <NativeSelect
                  size="xs"
                  value={activeRemoteSource.id}
                  onChange={(event) => setActiveRemoteSourceId(event.currentTarget.value)}
                  data={BUILT_IN_REMOTE_SOURCES.map((source) => ({
                    value: source.id,
                    label: source.name,
                  }))}
                />
              ) : null}
              <Button
                variant="subtle"
                size="xs"
                rightSection={<IconExternalLink size={14} />}
                onClick={() => void openExternal(activeRemoteSource.baseUrl)}
                title="Open the source website in your browser"
              >
                Visit website
              </Button>
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                size="xs"
                disabled={!selectedTrack}
                loading={refreshRemoteMutation.isPending}
                onClick={() => void refreshRemoteMutation.mutateAsync()}
                title="Refresh the active remote source"
              >
                Refresh
              </Button>
            </Group>
          </Group>
          <Text size="sm">
            {selectedTrack
              ? `Setups for ${selectedCar?.displayName ?? 'your car'} at ${selectedTrack.displayName}. Add one to save it with this track.`
              : 'Choose a car and track to find matching community setups.'}
          </Text>
          <Text size="xs" c="dimmed">
            {activeRemoteSource.summary}
          </Text>
        </Stack>
      </Card>

      <TextInput
        placeholder="Search community setups"
        size="xs"
        disabled={!selectedTrack}
        value={remoteFilters[activeRemoteSource.id] ?? ''}
        onChange={(event) => setRemoteFilter(activeRemoteSource.id, event.currentTarget.value)}
      />

      <Box className="list-shell">
        {!selectedTrack ? (
          <Stack gap="xs" justify="center" h="100%">
            <Group gap="xs">
              <ThemeIcon color="gray" variant="light">
                <IconCloudOff size={16} />
              </ThemeIcon>
              <Text fw={500}>Choose a track to browse community setups.</Text>
            </Group>
            <Text size="sm" c="dimmed">
              You will only see setups that match the car and track you choose.
            </Text>
          </Stack>
        ) : remoteQuery.isFetching && !remoteQuery.data ? (
          <Group justify="center" align="center" h="100%">
            <Loader size="sm" />
          </Group>
        ) : remoteQuery.isError ? (
          <Group justify="center" align="center" h="100%">
            <Alert color="red" title="Couldn't load community setups">
              {remoteQuery.error instanceof Error
                ? remoteQuery.error.message
                : 'Check your connection and try again.'}
            </Alert>
          </Group>
        ) : visibleRemoteItems.length ? (
          renderRemoteSetupList({
            items: visibleRemoteItems,
            selectedSetupId: selectedRemoteSetup?.id ?? null,
            onSelect: (setup) => setSelectedRemoteSetupId(activeRemoteSource.id, setup.id),
            onOpenPreview: (setup) => void openRemotePreview(setup),
            onDownload: (setup) => void requestRemoteDownload(setup),
            onOpenSourcePage: (setup) => void openExternal(setup.sourcePageUrl),
          })
        ) : (
          <Stack gap="xs" justify="center" h="100%">
            <Group gap="xs">
              <ThemeIcon color="gray" variant="light">
                <IconCloudOff size={16} />
              </ThemeIcon>
              <Text fw={500}>
                {remoteQuery.data?.message ?? 'No community setups are available for this car and track yet.'}
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              Try a different source or check again later.
            </Text>
          </Stack>
        )}
      </Box>
    </Stack>
  )

  const remoteFilter = remoteFilters[activeRemoteSource.id] ?? ''
  const visibleRemoteItems = sortRemoteSetups(
    filterRemoteSetups(remoteQuery.data?.items ?? [], remoteFilter),
  )
  const copySourceTrack = copySetupModal
    ? bootstrap.library.tracks.find((track) => track.id === copySetupModal.setup.trackId) ??
      selectedTrack ??
      null
    : null
  const copySourceCar = copySourceTrack
    ? bootstrap.library.cars.find((car) => car.id === copySourceTrack.carId)
    : null
  const copyDestinationTracks = copySourceTrack
    ? bootstrap.library.tracks.filter(
        (track) => track.carId === copySourceTrack.carId && track.id !== copySourceTrack.id,
      )
    : []
  const remoteInstallDestinationTracks = visibleTracks
  const selectedRemoteSetup =
    visibleRemoteItems.find((setup) => setup.id === selectedRemoteSetupId) ??
    remoteQuery.data?.items.find((setup) => setup.id === selectedRemoteSetupId)

  return (
    <>
      <AppShell
        header={{ height: 52 }}
        padding={0}
        styles={{
          header: {
            background: 'rgba(12, 14, 16, 0.96)',
            borderBottom: '1px solid rgba(188, 54, 36, 0.28)',
          },
          main: {
            background: 'transparent',
            color: 'white',
          },
        }}
      >
        <AppShell.Header px="sm">
          <Group justify="space-between" align="center" h="100%" wrap="nowrap" className="window-titlebar">
            <Group
              gap="sm"
              wrap="nowrap"
              className="titlebar-drag"
              data-tauri-drag-region
              onMouseDown={(event) => {
                if (event.button === 0) {
                  void startDraggingCurrentWindow()
                }
              }}
              onDoubleClick={() => void toggleCurrentWindowMaximize()}
            >
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Group gap="xs" wrap="nowrap">
                  <Text fw={700} size="sm">
                    ACC Setup Manager
                  </Text>
                  <Badge
                    variant="dot"
                    color={bootstrap.settings.rootStatus === 'ready' ? 'steel' : 'yellow'}
                    className="titlebar-badge"
                  >
                    {bootstrap.settings.rootStatus === 'ready' ? 'Ready' : 'Select folder'}
                  </Badge>
                  {bootstrapQuery.isFetching ? (
                    <Badge variant="light" color="steel">
                      Refreshing
                    </Badge>
                  ) : null}
                </Group>
                <Text size="xs" c="dimmed" className="titlebar-context">
                  {selectedTrack
                    ? `${selectedCar?.displayName ?? 'Selected car'} • ${selectedTrack.displayName}`
                    : 'Choose a car and track to get started'}
                </Text>
              </Stack>
            </Group>

            <Group gap={6} wrap="nowrap" className="titlebar-actions">
              <IconActionButton
                label={bootstrap.undoState.undoLabel ?? 'Nothing to undo'}
                variant="subtle"
                size="md"
                disabled={!bootstrap.undoState.canUndo || undoMutation.isPending}
                onClick={() => void undoMutation.mutateAsync()}
              >
                <IconArrowBackUp size={16} />
              </IconActionButton>
              <IconActionButton
                label={bootstrap.undoState.redoLabel ?? 'Nothing to redo'}
                variant="subtle"
                size="md"
                disabled={!bootstrap.undoState.canRedo || redoMutation.isPending}
                onClick={() => void redoMutation.mutateAsync()}
              >
                <IconArrowForwardUp size={16} />
              </IconActionButton>
              <IconActionButton
                label="Open settings"
                variant="subtle"
                size="md"
                onClick={() => setSettingsOpened(true)}
              >
                <IconSettings size={16} />
              </IconActionButton>
              <Box className="titlebar-divider" />
              <IconActionButton
                label="Minimize window"
                variant="subtle"
                size="md"
                onClick={() => void minimizeCurrentWindow()}
              >
                <IconMinus size={16} />
              </IconActionButton>
              <IconActionButton
                label="Toggle maximize window"
                variant="subtle"
                size="md"
                onClick={() => void toggleCurrentWindowMaximize()}
              >
                <IconSquare size={14} />
              </IconActionButton>
              <IconActionButton
                label="Hide to tray"
                variant="subtle"
                size="md"
                color="red"
                onClick={() => void closeCurrentWindow()}
              >
                <IconX size={16} />
              </IconActionButton>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Stack gap="xs" p="xs" h="calc(100vh - 52px)">
            {bootstrapRefreshError ? (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="yellow"
                title="Couldn't refresh your library"
              >
                {bootstrapRefreshError}
              </Alert>
            ) : null}
            {bootstrap.settings.rootStatus !== 'ready' ? (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color={bootstrap.settings.rootStatus === 'invalid' ? 'red' : 'yellow'}
                title={
                  bootstrap.settings.rootStatus === 'invalid'
                    ? 'This folder does not contain ACC setups'
                    : 'ACC setups folder not found'
                }
              >
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Text size="sm">
                    Select the folder where ACC saves your setups. It is usually
                    {' '}
                    <Code>C:\Users\&lt;user&gt;\Documents\Assetto Corsa Competizione\Setups</Code>
                    .
                  </Text>
                  <Button
                    leftSection={<IconFolderOpen size={16} />}
                    onClick={() => void handlePickRoot()}
                    title="Choose the ACC setups folder manually"
                  >
                    Select folder
                  </Button>
                </Group>
              </Alert>
            ) : null}

            <Box className="workspace-grid">
              <Card withBorder radius="md" className="surface-card" p="xs">
                <Stack gap="xs" h="100%">
                  <Text fw={700} tt="uppercase" size="sm" className="panel-title">
                    Setup library
                  </Text>

                  <Box className="setup-library-layout">
                    <Stack gap="xs" className="library-column">
                      <Group justify="space-between" align="flex-start">
                        <Text fw={700} tt="uppercase" size="xs" className="panel-title">
                          Cars
                        </Text>
                        <Badge variant="light" color="dark">
                          {bootstrap.library.cars.length}
                        </Badge>
                      </Group>

                      <Box className="list-shell">{renderCarList()}</Box>
                    </Stack>

                    <Stack gap="xs" className="library-column">
                      <Group justify="space-between" align="flex-start">
                        <Text fw={700} tt="uppercase" size="xs" className="panel-title">
                          Tracks
                        </Text>
                        <Badge variant="light" color="dark">
                          {selectedCar ? visibleTracks.length : 0}
                        </Badge>
                      </Group>

                      <Box className="list-shell">{renderTrackList()}</Box>
                    </Stack>

                    <Stack gap="xs" className="setups-column">
                      <Tabs
                        value={setupWorkspaceTab}
                        onChange={(value) =>
                          value && setSetupWorkspaceTab(value as SetupWorkspaceTab)
                        }
                        variant="outline"
                        radius="md"
                        styles={{
                          root: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
                          panel: { flex: 1, display: 'flex', minHeight: 0 },
                        }}
                      >
                        <Tabs.List>
                          <Tabs.Tab value="local">My setups</Tabs.Tab>
                          <Tabs.Tab value="remote">Community setups</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="local" pt="xs">
                          <Box className="setup-workspace__pane">{renderLocalSetupsPane()}</Box>
                        </Tabs.Panel>

                        <Tabs.Panel value="remote" pt="xs">
                          <Box className="setup-workspace__pane">{renderRemoteLibraryPane()}</Box>
                        </Tabs.Panel>
                      </Tabs>
                    </Stack>
                  </Box>
                </Stack>
              </Card>
            </Box>
          </Stack>
        </AppShell.Main>
      </AppShell>

      <Modal
        opened={Boolean(openDocument)}
        onClose={closeOpenDocument}
        title={
          openDocument ? (
            <Group gap="xs" wrap="wrap">
              <Text fw={700}>{openDocument.title}</Text>
              <Badge variant="light" color={openDocument.readOnly ? 'dark' : 'steel'}>
                {openDocument.readOnly ? 'Preview only' : 'Ready to edit'}
              </Badge>
              <Badge variant="light" color={openDocument.dirty ? 'red' : 'steel'}>
                {openDocument.dirty ? 'Unsaved changes' : 'Saved'}
              </Badge>
            </Group>
          ) : null
        }
        size="82%"
        centered
      >
        {openDocument ? (
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Text size="sm" c="dimmed">
                {openDocument.sourceLabel}
              </Text>
              <Group gap="xs" wrap="wrap">
                {openDocument.remoteDownload ? (
                  <Button
                    variant="light"
                    leftSection={<IconDownload size={16} />}
                    loading={remoteDownloadMutation.isPending}
                    onClick={() => void requestPreviewDownload()}
                    title="Add this setup to the selected track"
                  >
                    Download
                  </Button>
                ) : null}
                {openDocument.remoteDownload?.sourcePageUrl ? (
                  <IconActionButton
                    label="Visit website"
                    variant="light"
                    size="lg"
                    onClick={() =>
                      void openExternal(openDocument.remoteDownload?.sourcePageUrl ?? '')
                    }
                  >
                    <IconExternalLink size={16} />
                  </IconActionButton>
                ) : null}
                {!openDocument.readOnly ? (
                  <Button
                    leftSection={<IconRefresh size={16} />}
                    disabled={!openDocument.dirty || saveMutation.isPending}
                    onClick={() =>
                      void saveMutation.mutateAsync({
                        path: openDocument.id,
                        content: openDocument.content,
                        carFolder: openDocument.carFolder,
                      })
                    }
                    title="Save your changes"
                  >
                    Save
                  </Button>
                ) : null}
              </Group>
            </Group>
            <Suspense
              fallback={
                <Card withBorder radius="md" className="editor-shell" p="md">
                  <Stack gap="xs" justify="center" h="100%">
                    <Text fw={600}>Opening setup</Text>
                    <Loader size="sm" />
                  </Stack>
                </Card>
              }
            >
              <HybridSetupEditor
                documentId={openDocument.id}
                title={openDocument.title}
                content={openDocument.content}
                readOnly={openDocument.readOnly}
                onChange={updateOpenDocumentContent}
              />
            </Suspense>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={Boolean(renameModal)}
        onClose={() => setRenameModal(null)}
        title={renameModal?.mode === 'rename' ? 'Rename setup' : 'Create setup'}
      >
        <Stack>
          <TextInput
            label="Setup name"
            placeholder="my-setup.json"
            value={renameModal?.fileName ?? ''}
            onChange={(event) =>
              setRenameModal((current) =>
                current
                  ? {
                      ...current,
                      fileName: event.currentTarget.value,
                    }
                  : current,
              )
            }
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenameModal(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameModal?.fileName.trim()}
              loading={createMutation.isPending || renameMutation.isPending}
              onClick={() => {
                if (!renameModal) {
                  return
                }

                if (renameModal.mode === 'create') {
                  if (isReservedGlobalSetupFileName(renameModal.fileName.trim())) {
                    showError(
                      "Couldn't create this setup",
                      'That name is reserved for the ACC Manager global setup.',
                    )
                    return
                  }
                  void createMutation.mutateAsync({
                    trackPath: renameModal.trackPath,
                    fileName: renameModal.fileName.trim(),
                  })
                  return
                }

                if (isReservedGlobalSetupFileName(renameModal.fileName.trim())) {
                  showError(
                    "Couldn't rename this setup",
                    'That name is reserved for the ACC Manager global setup.',
                  )
                  return
                }

                void renameMutation.mutateAsync({
                  path: renameModal.setup.id,
                  newFileName: renameModal.fileName.trim(),
                })
              }}
            >
              {renameModal?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(copySetupModal)}
        onClose={() => setCopySetupModal(null)}
        title="Copy setup to tracks"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Add <strong>{copySetupModal?.setup.displayName}</strong> to other tracks for{' '}
            <strong>{copySourceCar?.displayName ?? 'this car'}</strong>. If a setup already has this
            name, the copy will be given a new name.
          </Text>
          <Stack gap="xs">
            <Group justify="space-between" align="center" wrap="wrap" gap="xs">
              <Text size="sm" fw={600}>
                Destination tracks
              </Text>
              {copyDestinationTracks.length ? (
                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      setCopySetupModal((current) =>
                        current
                          ? {
                              ...current,
                              targetTrackIds: copyDestinationTracks.map((track) => track.id),
                            }
                          : current,
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      setCopySetupModal((current) =>
                        current
                          ? {
                              ...current,
                              targetTrackIds: [],
                            }
                          : current,
                      )
                    }
                  >
                    Unselect all
                  </Button>
                </Group>
              ) : null}
            </Group>
            {copyDestinationTracks.length ? (
              <Checkbox.Group
                value={copySetupModal?.targetTrackIds ?? []}
                onChange={(value) =>
                  setCopySetupModal((current) =>
                    current
                      ? {
                          ...current,
                          targetTrackIds: value,
                        }
                      : current,
                  )
                }
              >
                <ScrollArea.Autosize mah={260} type="auto" offsetScrollbars>
                  <Stack gap={8}>
                    {copyDestinationTracks.map((track) => (
                      <Checkbox
                        key={track.id}
                        value={track.id}
                        label={`${track.displayName} (${track.setupCount} setup${track.setupCount === 1 ? '' : 's'})`}
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Checkbox.Group>
            ) : (
              <Text size="sm" c="dimmed">
                No other tracks are available for this car.
              </Text>
            )}
          </Stack>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCopySetupModal(null)}>
              Cancel
            </Button>
            <Button
              loading={copyMutation.isPending}
              disabled={!copySetupModal?.targetTrackIds.length}
              onClick={() =>
                copySetupModal &&
                void copyMutation.mutateAsync({
                  sourcePath: copySetupModal.setup.id,
                  targetTrackPaths: copySetupModal.targetTrackIds,
                })
              }
            >
              Copy
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(deleteCandidate)}
        onClose={() => setDeleteCandidate(null)}
        title="Delete setup"
      >
        <Stack>
          <Text>
            Delete
            {' '}
            <strong>{deleteCandidate?.displayName}</strong>
            {' '}
            from the selected track?
          </Text>
          <Text size="sm" c="dimmed">
            You can bring it back with Undo while this app is open.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteCandidate(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => deleteCandidate && void deleteMutation.mutateAsync(deleteCandidate.id)}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={settingsOpened} onClose={() => setSettingsOpened(false)} title="Settings">
        <Stack>
          <Text size="sm" c="dimmed">
            Choose where ACC saves your setups if the app cannot find the folder automatically.
          </Text>
          <TextInput
            label="Folder found automatically"
            value={bootstrap.settings.detectedRoot ?? 'Not found'}
            readOnly
          />
          <TextInput
            label="Folder you selected"
            value={bootstrap.settings.manualRoot ?? ''}
            placeholder="Not set"
            readOnly
          />
          <Group justify="space-between">
            <Button variant="default" onClick={() => void handlePickRoot()}>
              Choose folder
            </Button>
            <Button
              variant="light"
              color="red"
              disabled={!bootstrap.settings.manualRoot}
              loading={rootMutation.isPending}
              onClick={() => void rootMutation.mutateAsync(null)}
            >
              Use automatic folder
            </Button>
          </Group>
          <Divider />
          <TextInput
            label="Name for the next imported setup"
            description="Leave blank to keep the setup's original name."
            placeholder="Keep the original name"
            value={pendingImportName}
            onChange={(event) => setPendingImportName(event.currentTarget.value)}
          />
          <SegmentedControl
            value={importOverwrite ? 'overwrite' : 'rename'}
            onChange={(value) => setImportOverwrite(value === 'overwrite')}
            data={[
              { value: 'rename', label: 'Keep both setups' },
              { value: 'overwrite', label: 'Replace existing setup' },
            ]}
          />
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(remoteInstallModal)}
        onClose={() => setRemoteInstallModal(null)}
        title="Add setup to tracks"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Add <strong>{getSetupTitleFromFileName(remoteInstallModal?.fileName ?? '')}</strong> to
            one or more tracks for <strong>{selectedCar?.displayName ?? 'this car'}</strong>. If you
            downloaded this setup to a track before, it will be replaced. Otherwise, a setup with a
            matching name is kept and the new one gets a different name.
          </Text>
          <Stack gap="xs">
            <Group justify="space-between" align="center" wrap="wrap" gap="xs">
              <Text size="sm" fw={600}>
                Destination tracks
              </Text>
              {remoteInstallDestinationTracks.length ? (
                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      setRemoteInstallModal((current) =>
                        current
                          ? {
                              ...current,
                              targetTrackIds: remoteInstallDestinationTracks.map((track) => track.id),
                            }
                          : current,
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      setRemoteInstallModal((current) =>
                        current
                          ? {
                              ...current,
                              targetTrackIds: [],
                            }
                          : current,
                      )
                    }
                  >
                    Unselect all
                  </Button>
                </Group>
              ) : null}
            </Group>
            {remoteInstallDestinationTracks.length ? (
              <Checkbox.Group
                value={remoteInstallModal?.targetTrackIds ?? []}
                onChange={(value) =>
                  setRemoteInstallModal((current) =>
                    current
                      ? {
                          ...current,
                          targetTrackIds: value,
                        }
                      : current,
                  )
                }
              >
                <ScrollArea.Autosize mah={260} type="auto" offsetScrollbars>
                  <Stack gap={8}>
                    {remoteInstallDestinationTracks.map((track) => (
                      <Checkbox
                        key={track.id}
                        value={track.id}
                        label={`${track.displayName} (${track.setupCount} setup${track.setupCount === 1 ? '' : 's'})`}
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Checkbox.Group>
            ) : (
              <Text size="sm" c="dimmed">
                No tracks are available for this car.
              </Text>
            )}
          </Stack>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoteInstallModal(null)}>
              Cancel
            </Button>
            <Button
              loading={remoteDownloadMutation.isPending}
              disabled={!remoteInstallModal?.targetTrackIds.length}
              onClick={() =>
                remoteInstallModal &&
                void remoteDownloadMutation.mutateAsync({
                  sourceId: remoteInstallModal.sourceId,
                  remoteSetupId: remoteInstallModal.remoteSetupId,
                  targetTrackPaths: remoteInstallModal.targetTrackIds,
                  targetFileName: remoteInstallModal.fileName,
                })
              }
            >
              Install
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

function IconActionButton({
  label,
  children,
  variant = 'subtle',
  ...props
}: {
  label: string
  children: ReactNode
  color?: string
  disabled?: boolean
  loading?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  size?: ActionIconProps['size']
  variant?: ActionIconProps['variant']
}) {
  return (
    <Tooltip label={label} withArrow openDelay={150}>
      <Box component="span" style={{ display: 'inline-flex' }}>
        <ActionIcon aria-label={label} variant={variant} {...props}>
          {children}
        </ActionIcon>
      </Box>
    </Tooltip>
  )
}

export default App

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  type ActionIconProps,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
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
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconFolderOpen,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'
import type { MouseEventHandler, ReactNode } from 'react'
import { clsx } from 'clsx'
import {
  BUILT_IN_REMOTE_SOURCES,
  loadRemoteSourceResults,
} from './lib/remote-sources'
import {
  chooseDirectory,
  chooseImportFile,
  createLocalSetup,
  deleteLocalSetup,
  downloadRemoteSetup,
  importLocalSetup,
  loadAppBootstrap,
  openExternal,
  readRemoteSetupDocument,
  readSetupDocument,
  redoLastOperation,
  renameLocalSetup,
  saveLocalSetup,
  setManualSetupRoot,
  undoLastOperation,
} from './lib/tauri'
import {
  filterLocalSetups,
  filterRemoteSetups,
  sortLocalSetups,
  sortRemoteSetups,
  type LocalSortMode,
} from './lib/setup-list'
import { useAppStore } from './state/app-store'
import type { AppBootstrap, LocalSetup, MutationResult, RemoteSetup } from './types/models'

const bootstrapQueryKey = ['bootstrap']
const MonacoEditor = lazy(() => import('@monaco-editor/react'))

type RenameModalState =
  | { mode: 'create'; trackPath: string; fileName: string }
  | { mode: 'rename'; setup: LocalSetup; fileName: string }
  | null

type RemoteDownloadModalState = {
  sourceId: string
  remoteSetupId: string
  fileName: string
  overwrite: boolean
}

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
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getRemoteSetupDescription(setup: RemoteSetup): string {
  const sourceMetadata = setup.sourceMetadata ?? {}
  const details = [sourceMetadata.setupType, sourceMetadata.weather]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value[0]?.toUpperCase() + value.slice(1))

  if (details.length) {
    return details.join(' • ')
  }

  if (setup.author) {
    return setup.author
  }

  return 'Preview and download are available for this setup.'
}

function App() {
  const queryClient = useQueryClient()
  const [renameModal, setRenameModal] = useState<RenameModalState>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<LocalSetup | null>(null)
  const [settingsOpened, setSettingsOpened] = useState(false)
  const [importOverwrite, setImportOverwrite] = useState(false)
  const [pendingImportName, setPendingImportName] = useState('')
  const [remoteDownloadModal, setRemoteDownloadModal] =
    useState<RemoteDownloadModalState | null>(null)

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
  })

  const bootstrap = bootstrapQuery.data

  const selectedCar = bootstrap?.library.cars.find((car) => car.id === selectedCarId)
  const visibleTracks = useMemo(
    () =>
      bootstrap?.library.tracks.filter((track) => track.carId === selectedCarId) ?? [],
    [bootstrap?.library.tracks, selectedCarId],
  )
  const selectedTrack = visibleTracks.find((track) => track.id === selectedTrackId)
  const visibleLocalSetups = useMemo(
    () =>
      sortLocalSetups(
        filterLocalSetups(
          bootstrap?.library.localSetups.filter((setup) => setup.trackId === selectedTrackId) ??
            [],
          localFilter,
        ),
        localSortMode,
      ),
    [bootstrap?.library.localSetups, localFilter, localSortMode, selectedTrackId],
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
    enabled: Boolean(activeRemoteSource),
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

    const setups = bootstrap.library.localSetups.filter((setup) => setup.trackId === selectedTrackId)
    if (selectedLocalSetupId && !setups.some((setup) => setup.id === selectedLocalSetupId)) {
      setSelectedLocalSetupId(null)
    }
  }, [
    bootstrap,
    selectedCarId,
    selectedLocalSetupId,
    selectedTrackId,
    setSelectedCarId,
    setSelectedLocalSetupId,
    setSelectedTrackId,
  ])

  const applyMutationResult = (result: MutationResult, successMessage?: string): void => {
    queryClient.setQueryData<AppBootstrap>(bootstrapQueryKey, result.bootstrap)
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

  const startRemoteDownload = async ({
    sourceId,
    remoteSetupId,
    fileName,
    overwrite,
  }: RemoteDownloadModalState) => {
    if (!selectedTrack) {
      showError('Download unavailable', 'Select a track folder first.')
      return
    }

    try {
      await remoteDownloadMutation.mutateAsync({
        sourceId,
        remoteSetupId,
        trackPath: selectedTrack.id,
        targetFileName: fileName,
        overwrite,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('already exists')) {
        setRemoteDownloadModal({
          sourceId,
          remoteSetupId,
          fileName,
          overwrite,
        })
        return
      }

      showError('Unable to download remote setup', error)
    }
  }

  const requestRemoteDownload = async (setup: RemoteSetup) => {
    setSelectedRemoteSetupId(setup.sourceId, setup.id)
    await startRemoteDownload({
      sourceId: setup.sourceId,
      remoteSetupId: setup.id,
      fileName: setup.fileName,
      overwrite: false,
    })
  }

  const requestPreviewDownload = async () => {
    const descriptor = openDocument?.remoteDownload
    if (!descriptor) {
      return
    }

    await startRemoteDownload({
      sourceId: descriptor.sourceId,
      remoteSetupId: descriptor.remoteSetupId,
      fileName: descriptor.suggestedFileName,
      overwrite: false,
    })
  }

  const openSetupInEditor = async (setupPath: string) => {
    try {
      const document = await readSetupDocument(setupPath)
      openDocumentPane(document)
    } catch (error) {
      showError('Unable to open setup', error)
    }
  }

  const createMutation = useMutation({
    mutationFn: ({ trackPath, fileName }: { trackPath: string; fileName: string }) =>
      createLocalSetup(trackPath, fileName),
    onSuccess: async (result) => {
      applyMutationResult(result, 'Setup created.')
      setRenameModal(null)
      if (result.selectedSetupPath) {
        await openSetupInEditor(result.selectedSetupPath)
      }
    },
    onError: (error) => showError('Unable to create setup', error),
  })

  const renameMutation = useMutation({
    mutationFn: ({ path, newFileName }: { path: string; newFileName: string }) =>
      renameLocalSetup(path, newFileName),
    onSuccess: (result, variables) => {
      const renamedSetup = result.bootstrap.library.localSetups.find(
        (setup) => setup.id === result.selectedSetupPath,
      )

      applyMutationResult(result, 'Setup renamed.')
      setRenameModal(null)

      if (openDocument && renamedSetup && openDocument.id === variables.path) {
        markOpenDocumentSaved(openDocument.content, renamedSetup.id, renamedSetup.displayName)
      }
    },
    onError: (error) => showError('Unable to rename setup', error),
  })

  const saveMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      saveLocalSetup(path, content),
    onSuccess: (result) => {
      applyMutationResult(result, 'Setup saved.')
      if (openDocument) {
        markOpenDocumentSaved(openDocument.content)
      }
    },
    onError: (error) => showError('Unable to save setup', error),
  })

  const deleteMutation = useMutation({
    mutationFn: (path: string) => deleteLocalSetup(path),
    onSuccess: (result, path) => {
      applyMutationResult(result, 'Setup deleted.')
      if (openDocument?.id === path) {
        closeOpenDocument()
      }
      setDeleteCandidate(null)
    },
    onError: (error) => showError('Unable to delete setup', error),
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
      applyMutationResult(result, 'Setup imported.')
      setPendingImportName('')
      setImportOverwrite(false)
    },
    onError: (error) => showError('Unable to import setup', error),
  })

  const undoMutation = useMutation({
    mutationFn: () => undoLastOperation(),
    onSuccess: (result) => applyMutationResult(result),
    onError: (error) => showError('Unable to undo', error),
  })

  const redoMutation = useMutation({
    mutationFn: () => redoLastOperation(),
    onSuccess: (result) => applyMutationResult(result),
    onError: (error) => showError('Unable to redo', error),
  })

  const refreshRemoteMutation = useMutation({
    mutationFn: () =>
      loadRemoteSourceResults(activeRemoteSource, selectedCar, selectedTrack, true),
    onSuccess: (result) => {
      queryClient.setQueryData(remoteQueryKey, result)
      showSuccess('Remote setups refreshed.')
    },
    onError: (error) => showError('Unable to refresh remote setups', error),
  })

  const remotePreviewMutation = useMutation({
    mutationFn: ({ sourceId, remoteSetupId }: { sourceId: string; remoteSetupId: string }) =>
      readRemoteSetupDocument(sourceId, remoteSetupId),
    onSuccess: (document) => openDocumentPane(document),
    onError: (error) => showError('Unable to load remote preview', error),
  })

  const remoteDownloadMutation = useMutation({
    mutationFn: ({
      sourceId,
      remoteSetupId,
      trackPath,
      targetFileName,
      overwrite,
    }: {
      sourceId: string
      remoteSetupId: string
      trackPath: string
      targetFileName: string
      overwrite: boolean
    }) =>
      downloadRemoteSetup({
        sourceId,
        remoteSetupId,
        trackPath,
        targetFileName,
        overwrite,
      }),
    onSuccess: (result) => {
      applyMutationResult(result, 'Remote setup downloaded.')
      setRemoteDownloadModal(null)
    },
  })

  const rootMutation = useMutation({
    mutationFn: (path: string | null) => setManualSetupRoot(path),
    onSuccess: (result) => {
      queryClient.setQueryData<AppBootstrap>(bootstrapQueryKey, result)
      showSuccess('Setup root updated.')
      setSettingsOpened(false)
      closeOpenDocument()
    },
    onError: (error) => showError('Unable to update setup root', error),
  })

  const handlePickRoot = async () => {
    try {
      const path = await chooseDirectory()
      if (!path) {
        return
      }

      await rootMutation.mutateAsync(path)
    } catch (error) {
      showError('Unable to choose a folder', error)
    }
  }

  const handleImportClick = async () => {
    if (!selectedTrack) {
      showError('Import unavailable', 'Select a track folder first.')
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
      showError('Unable to import setup', error)
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
      showError('Import unavailable', 'The dropped file path was not available to the app.')
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
      showError('Unable to import setup', error)
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

  if (bootstrapQuery.isLoading) {
    return (
      <Group justify="center" align="center" mih="100vh">
        <Loader size="lg" />
      </Group>
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
                radius="md"
                p="sm"
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
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                  <Stack gap={4}>
                    <Group gap="xs">
                      <Text fw={600}>{item.displayName}</Text>
                      {selected ? (
                        <Badge size="xs" color="steel" variant="light">
                          Selected
                        </Badge>
                      ) : null}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {getRemoteSetupDescription(item)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {item.updatedAt ? `Updated ${formatDate(item.updatedAt)}` : 'Preview and download available'}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap" className="setup-row__actions">
                    <IconActionButton
                      label="Open source page"
                      color="gray"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenSourcePage(item)
                      }}
                    >
                      <IconExternalLink size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Preview setup"
                      color="steel"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenPreview(item)
                      }}
                    >
                      <IconEdit size={16} />
                    </IconActionButton>
                    <IconActionButton
                      label="Download into selected track"
                      color="steel"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDownload(item)
                      }}
                    >
                      <IconDownload size={16} />
                    </IconActionButton>
                  </Group>
                </Group>
              </Paper>
            )
          })}
        </Stack>
      </ScrollArea>
    )

  const renderLocalSetupList = (items: LocalSetup[]) => {
    if (!items.length) {
      return (
        <Group justify="center" align="center" h="100%">
          <Stack gap={6} align="center">
            <Text size="sm" fw={600}>
              {selectedTrack ? 'No local setups yet' : 'Select a track to begin'}
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={280}>
              {selectedTrack
                ? 'Create a fresh JSON setup, import one from disk, or browse the remote library for ready-made baselines.'
                : 'Pick a car and track first, then this compact library will show every local setup for that combination.'}
            </Text>
          </Stack>
        </Group>
      )
    }

    return (
      <ScrollArea h="100%" type="auto" offsetScrollbars>
        <Stack gap="xs">
          {items.map((setup) => {
            const selected = setup.id === selectedLocalSetupId
            return (
              <Paper
                key={setup.id}
                radius="md"
                p="sm"
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
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                  <Stack gap={4}>
                    <Text fw={600}>{setup.displayName}</Text>
                    <Text size="sm" c="dimmed">
                      Saved {formatDate(setup.lastModifiedAt)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {setup.fileName}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap" className="setup-row__actions">
                    <IconActionButton
                      label="Open JSON panel"
                      color="steel"
                      onClick={(event) => {
                        event.stopPropagation()
                        void openSetupInEditor(setup.id)
                      }}
                    >
                      <IconEdit size={16} />
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

  if (bootstrapQuery.isError || !bootstrap) {
    return (
      <Group justify="center" align="center" mih="100vh" p="xl">
        <Alert color="red" title="ACC Setup Manager could not start">
          {bootstrapQuery.error instanceof Error
            ? bootstrapQuery.error.message
            : 'An unknown startup error occurred.'}
        </Alert>
      </Group>
    )
  }

  const remoteFilter = remoteFilters[activeRemoteSource.id] ?? ''
  const visibleRemoteItems = sortRemoteSetups(
    filterRemoteSetups(remoteQuery.data?.items ?? [], remoteFilter),
  )
  const selectedRemoteSetup =
    visibleRemoteItems.find((setup) => setup.id === selectedRemoteSetupId) ??
    remoteQuery.data?.items.find((setup) => setup.id === selectedRemoteSetupId)

  return (
    <>
      <AppShell
        header={{ height: 72 }}
        padding={0}
        styles={{
          header: {
            background: 'rgba(7, 10, 18, 0.82)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(167, 175, 182, 0.14)',
          },
          main: {
            background:
              'radial-gradient(circle at top, rgba(123, 20, 33, 0.16), transparent 32%), linear-gradient(180deg, rgba(18, 20, 24, 0.98) 0%, rgba(4, 5, 7, 1) 100%)',
            color: 'white',
          },
        }}
      >
        <AppShell.Header p="md">
          <Group justify="space-between" align="center" h="100%" wrap="nowrap">
            <Stack gap={4} style={{ minWidth: 0 }}>
              <Group gap="xs" wrap="nowrap">
                <Text fw={700} size="lg">
                  ACC Setup Manager
                </Text>
                <Badge variant="light" color="steel">
                  Compact desktop
                </Badge>
              </Group>
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Badge
                  variant="dot"
                  color={bootstrap.settings.rootStatus === 'ready' ? 'steel' : 'yellow'}
                >
                  {bootstrap.settings.rootStatus === 'ready' ? 'Library ready' : 'Root needs attention'}
                </Badge>
                <Code className="root-pill">
                  {bootstrap.settings.effectiveRoot ?? 'No active setups folder selected'}
                </Code>
              </Group>
            </Stack>

            <Group gap="xs" wrap="nowrap">
              <IconActionButton
                label={bootstrap.undoState.undoLabel ?? 'Nothing to undo'}
                variant="light"
                size="lg"
                disabled={!bootstrap.undoState.canUndo || undoMutation.isPending}
                onClick={() => void undoMutation.mutateAsync()}
              >
                <IconArrowBackUp size={18} />
              </IconActionButton>
              <IconActionButton
                label={bootstrap.undoState.redoLabel ?? 'Nothing to redo'}
                variant="light"
                size="lg"
                disabled={!bootstrap.undoState.canRedo || redoMutation.isPending}
                onClick={() => void redoMutation.mutateAsync()}
              >
                <IconArrowForwardUp size={18} />
              </IconActionButton>
              <IconActionButton
                label="Open settings"
                variant="light"
                size="lg"
                onClick={() => setSettingsOpened(true)}
              >
                <IconSettings size={18} />
              </IconActionButton>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Stack gap="md" p="md" h="calc(100vh - 72px)">
            {bootstrap.settings.rootStatus !== 'ready' ? (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color={bootstrap.settings.rootStatus === 'invalid' ? 'red' : 'yellow'}
                title={
                  bootstrap.settings.rootStatus === 'invalid'
                    ? 'The selected setups folder is invalid'
                    : 'ACC setups folder not found'
                }
              >
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Text size="sm">
                    ACC Setup Manager looks for
                    {' '}
                    <Code>C:\Users\&lt;user&gt;\Documents\Assetto Corsa Competizione\Setups</Code>
                    . Choose the folder manually to start browsing setups.
                  </Text>
                  <Button
                    leftSection={<IconFolderOpen size={16} />}
                    onClick={() => void handlePickRoot()}
                    title="Choose the ACC setups folder manually"
                  >
                    Choose folder
                  </Button>
                </Group>
              </Alert>
            ) : null}

            <Box className="workspace-grid">
              <Card withBorder radius="xl" className="surface-card">
                <Stack gap="lg" h="100%">
                  <Stack gap={4}>
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>Setup library</Text>
                        <Text size="sm" c="dimmed">
                          Pick a car, narrow to a track, then manage local setups. JSON opens only when needed.
                        </Text>
                      </div>
                      <Badge variant="light" color="steel">
                        {bootstrap.library.localSetups.length} total setups
                      </Badge>
                    </Group>
                    <Box className="context-strip">
                      <Group gap="xs" wrap="wrap">
                        <Badge variant="light" color="dark">
                          {bootstrap.library.cars.length} cars
                        </Badge>
                        <Badge variant="light" color="dark">
                          {visibleTracks.length} tracks
                        </Badge>
                        <Badge variant="light" color="steel">
                          {visibleLocalSetups.length} visible
                        </Badge>
                      </Group>
                    </Box>
                  </Stack>

                  <Box className="selection-grid">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                        Car
                      </Text>
                      <NativeSelect
                        value={selectedCarId ?? ''}
                        onChange={(event) => {
                          setSelectedCarId(event.currentTarget.value || null)
                          setSelectedTrackId(null)
                          setSelectedLocalSetupId(null)
                        }}
                        data={bootstrap.library.cars.map((car) => ({
                          value: car.id,
                          label: `${car.displayName} (${car.trackCount})`,
                        }))}
                      />
                    </Stack>
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                        Track
                      </Text>
                      <NativeSelect
                        value={selectedTrackId ?? ''}
                        disabled={!selectedCar}
                        onChange={(event) => {
                          setSelectedTrackId(event.currentTarget.value || null)
                          setSelectedLocalSetupId(null)
                        }}
                        data={
                          visibleTracks.length
                            ? visibleTracks.map((track) => ({
                                value: track.id,
                                label: `${track.displayName} (${track.setupCount})`,
                              }))
                            : [{ value: '', label: selectedCar ? 'No tracks found' : 'Select a car first' }]
                        }
                      />
                    </Stack>
                  </Box>

                  <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>Local setups</Text>
                        <Text size="sm" c="dimmed">
                          {selectedTrack
                            ? `${selectedTrack.displayName} for ${selectedCar?.displayName ?? 'selected car'}`
                            : 'Select a track to unlock create and import actions.'}
                        </Text>
                      </div>
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
                          label="Import a JSON setup"
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
                        placeholder="Search local setups"
                        value={localFilter}
                        onChange={(event) => setLocalFilter(event.currentTarget.value)}
                      />
                      <NativeSelect
                        value={localSortMode}
                        onChange={(event) =>
                          setLocalSortMode(event.currentTarget.value as LocalSortMode)
                        }
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
                      {renderLocalSetupList(visibleLocalSetups)}
                    </Box>

                    <Text size="xs" c="dimmed">
                      Drop a JSON file here to import it into the selected track folder.
                    </Text>
                  </Stack>
                </Stack>
              </Card>

              <Card withBorder radius="xl" className="surface-card">
                <Stack gap="md" h="100%">
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <div>
                      <Text fw={700}>Remote setup library</Text>
                      <Text size="sm" c="dimmed">
                        {selectedTrack
                          ? `Browse proven setups for ${selectedCar?.displayName ?? 'the selected car'} at ${selectedTrack.displayName}.`
                          : 'Choose a car and track on the left, then browse remote setups here.'}
                      </Text>
                    </div>
                    <Group gap="xs" wrap="wrap">
                      {openDocument ? (
                        <Badge variant="light" color="steel">
                          JSON panel open
                        </Badge>
                      ) : (
                        <Badge variant="light" color="dark">
                          JSON on demand
                        </Badge>
                      )}
                      {openDocument ? (
                        <Button
                          variant="light"
                          onClick={closeOpenDocument}
                          title="Close the current JSON panel"
                        >
                          Close JSON panel
                        </Button>
                      ) : null}
                    </Group>
                  </Group>

                  <Tabs
                    value={activeRemoteSource.id}
                    onChange={(value) => value && setActiveRemoteSourceId(value)}
                    variant="outline"
                    radius="md"
                    styles={{
                      root: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
                      panel: { flex: 1, display: 'flex', minHeight: 0 },
                    }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="wrap" mb="sm">
                      <div>
                        <Text fw={700}>Compare and import</Text>
                        <Text size="sm" c="dimmed">
                          Preview or download remote setups without giving JSON editing permanent space in the main view.
                        </Text>
                      </div>
                      <Button
                        variant="light"
                        leftSection={<IconRefresh size={16} />}
                        disabled={!selectedTrack}
                        loading={refreshRemoteMutation.isPending}
                        onClick={() => void refreshRemoteMutation.mutateAsync()}
                        title="Refresh the active remote source"
                      >
                        Refresh
                      </Button>
                    </Group>

                    <Tabs.List>
                      {BUILT_IN_REMOTE_SOURCES.map((source) => (
                        <Tabs.Tab key={source.id} value={source.id}>
                          {source.name}
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>

                    {BUILT_IN_REMOTE_SOURCES.map((source) => (
                      <Tabs.Panel key={source.id} value={source.id} pt="md">
                        <Stack gap="sm" h="100%" style={{ flex: 1, minHeight: 0 }}>
                          <Card withBorder radius="xl" className="context-strip">
                            <Group justify="space-between" align="flex-start" wrap="wrap">
                              <Stack gap={4}>
                                <Group gap="xs" wrap="wrap">
                                  <Text fw={600}>{source.name}</Text>
                                  <Badge color="steel" variant="light">
                                    Live
                                  </Badge>
                                  {source.id === activeRemoteSource.id && remoteQuery.data?.stale ? (
                                    <Badge color="yellow" variant="light">
                                      Cached
                                    </Badge>
                                  ) : null}
                                </Group>
                                <Text size="sm" c="dimmed">
                                  {source.summary}
                                </Text>
                              </Stack>
                              <Button
                                variant="subtle"
                                rightSection={<IconExternalLink size={14} />}
                                onClick={() => void openExternal(source.baseUrl)}
                                title="Open the source website in your browser"
                              >
                                Open source page
                              </Button>
                            </Group>
                          </Card>

                          <TextInput
                            placeholder="Search remote setups"
                            value={remoteFilters[source.id] ?? ''}
                            onChange={(event) =>
                              setRemoteFilter(source.id, event.currentTarget.value)
                            }
                          />

                          <Box className="list-shell">
                            {source.id !== activeRemoteSource.id ? (
                              <Group justify="center" align="center" h="100%">
                                <Text size="sm" c="dimmed">
                                  Switch to this source to load its current state.
                                </Text>
                              </Group>
                            ) : remoteQuery.isFetching ? (
                              <Group justify="center" align="center" h="100%">
                                <Loader size="sm" />
                              </Group>
                            ) : remoteQuery.isError ? (
                              <Group justify="center" align="center" h="100%">
                                <Alert color="red" title="Remote source request failed">
                                  {remoteQuery.error instanceof Error
                                    ? remoteQuery.error.message
                                    : 'The remote source request failed.'}
                                </Alert>
                              </Group>
                            ) : visibleRemoteItems.length ? (
                              renderRemoteSetupList({
                                items: visibleRemoteItems,
                                selectedSetupId: selectedRemoteSetup?.id ?? null,
                                onSelect: (setup) => setSelectedRemoteSetupId(source.id, setup.id),
                                onOpenPreview: (setup) => void openRemotePreview(setup),
                                onDownload: (setup) => void requestRemoteDownload(setup),
                                onOpenSourcePage: (setup) => void openExternal(setup.sourcePageUrl),
                              })
                            ) : (
                              <Stack gap="sm" justify="center" h="100%">
                                <Group gap="xs">
                                  <ThemeIcon color="gray" variant="light">
                                    <IconCloudOff size={16} />
                                  </ThemeIcon>
                                  <Text fw={500}>
                                    {source.id === activeRemoteSource.id
                                      ? remoteQuery.data?.message
                                      : 'Switch to this source to load its current state.'}
                                  </Text>
                                </Group>
                                <Text size="sm" c="dimmed">
                                  If no entries appear, the selected car and track may not be covered by this adapter yet.
                                </Text>
                              </Stack>
                            )}
                          </Box>
                        </Stack>
                      </Tabs.Panel>
                    ))}
                  </Tabs>
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
                {openDocument.readOnly ? 'Read-only preview' : 'Editable JSON'}
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
                    title="Download this preview into the selected local track folder"
                  >
                    Download
                  </Button>
                ) : null}
                {openDocument.remoteDownload?.sourcePageUrl ? (
                  <IconActionButton
                    label="Open source page"
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
                      })
                    }
                    title="Save the current setup file"
                  >
                    Save
                  </Button>
                ) : null}
              </Group>
            </Group>
            <Card withBorder radius="xl" className="editor-shell editor-modal-shell" p="xs">
              <Suspense
                fallback={
                  <Group justify="center" align="center" h="100%">
                    <Loader size="sm" />
                  </Group>
                }
              >
                <MonacoEditor
                  height="100%"
                  language="json"
                  theme="vs-dark"
                  value={openDocument.content}
                  options={{
                    minimap: { enabled: false },
                    automaticLayout: true,
                    readOnly: openDocument.readOnly,
                    scrollBeyondLastLine: false,
                    formatOnPaste: true,
                    formatOnType: true,
                  }}
                  onChange={(value) => {
                    if (!openDocument.readOnly) {
                      updateOpenDocumentContent(value ?? '')
                    }
                  }}
                />
              </Suspense>
            </Card>
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
            label="File name"
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
                  void createMutation.mutateAsync({
                    trackPath: renameModal.trackPath,
                    fileName: renameModal.fileName.trim(),
                  })
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
            The file is moved out of the ACC folder immediately and can be restored with Undo in the
            current session.
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
            The app auto-detects the default ACC setups folder and stores an optional manual override.
          </Text>
          <TextInput
            label="Detected root"
            value={bootstrap.settings.detectedRoot ?? 'Not found'}
            readOnly
          />
          <TextInput
            label="Manual override"
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
              Clear override
            </Button>
          </Group>
          <Divider />
          <TextInput
            label="Default import file name override"
            description="Optional file name used when importing through the toolbar."
            placeholder="Leave blank to use the original file name"
            value={pendingImportName}
            onChange={(event) => setPendingImportName(event.currentTarget.value)}
          />
          <SegmentedControl
            value={importOverwrite ? 'overwrite' : 'rename'}
            onChange={(value) => setImportOverwrite(value === 'overwrite')}
            data={[
              { value: 'rename', label: 'Rename on conflict' },
              { value: 'overwrite', label: 'Overwrite on conflict' },
            ]}
          />
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(remoteDownloadModal)}
        onClose={() => setRemoteDownloadModal(null)}
        title="Resolve download conflict"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            A local setup with that file name already exists. Rename it or overwrite the existing
            file.
          </Text>
          <TextInput
            label="File name"
            value={remoteDownloadModal?.fileName ?? ''}
            onChange={(event) =>
              setRemoteDownloadModal((current) =>
                current
                  ? {
                      ...current,
                      fileName: event.currentTarget.value,
                    }
                  : current,
              )
            }
          />
          <SegmentedControl
            value={remoteDownloadModal?.overwrite ? 'overwrite' : 'rename'}
            onChange={(value) =>
              setRemoteDownloadModal((current) =>
                current
                  ? {
                      ...current,
                      overwrite: value === 'overwrite',
                    }
                  : current,
              )
            }
            data={[
              { value: 'rename', label: 'Rename' },
              { value: 'overwrite', label: 'Overwrite' },
            ]}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoteDownloadModal(null)}>
              Cancel
            </Button>
            <Button
              loading={remoteDownloadMutation.isPending}
              disabled={!remoteDownloadModal?.fileName.trim()}
              onClick={() =>
                remoteDownloadModal &&
                void startRemoteDownload({
                  ...remoteDownloadModal,
                  fileName: remoteDownloadModal.fileName.trim(),
                })
              }
            >
              Download
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

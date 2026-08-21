import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
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
import type { ReactNode } from 'react'
import { Group as ResizableGroup, Panel, Separator } from 'react-resizable-panels'
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
  type RemoteSortMode,
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
    color: 'green',
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

  if (setup.rankingLabel) {
    details.unshift(setup.rankingLabel)
  }

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
    remoteSortModes,
    openDocument,
    setSelectedCarId,
    setSelectedTrackId,
    setSelectedLocalSetupId,
    setLocalFilter,
    setLocalSortMode,
    setActiveRemoteSourceId,
    setSelectedRemoteSetupId,
    setRemoteFilter,
    setRemoteSortMode,
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
  const selectedLocalSetup = visibleLocalSetups.find(
    (setup) => setup.id === selectedLocalSetupId,
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

  if (bootstrapQuery.isLoading) {
    return (
      <Group justify="center" align="center" mih="100vh">
        <Loader size="lg" />
      </Group>
    )
  }

  function RemoteSetupList({
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
  }) {
    return (
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
                style={{
                  cursor: 'pointer',
                  background: selected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(30, 41, 59, 0.55)',
                  border: selected
                    ? '1px solid rgba(167, 139, 250, 0.7)'
                    : '1px solid rgba(71, 85, 105, 0.45)',
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={4}>
                    <Text fw={500}>{item.displayName}</Text>
                    <Text size="sm" c="dimmed">
                      {getRemoteSetupDescription(item)}
                    </Text>
                  </Stack>
                  <Group gap={6} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenSourcePage(item)
                      }}
                    >
                      <IconExternalLink size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="blue"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenPreview(item)
                      }}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="green"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDownload(item)
                      }}
                    >
                      <IconDownload size={16} />
                    </ActionIcon>
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
  const remoteSortMode = remoteSortModes[activeRemoteSource.id] ?? 'alphabetical'
  const visibleRemoteItems = sortRemoteSetups(
    filterRemoteSetups(remoteQuery.data?.items ?? [], remoteFilter),
    remoteSortMode,
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
          main: {
            background:
              'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 12, 20, 1) 100%)',
            color: 'white',
          },
        }}
      >
        <AppShell.Header p="md">
          <Group justify="space-between" align="center" h="100%">
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={700} size="lg">
                  ACC Setup Manager
                </Text>
                <Badge variant="light" color="violet">
                  Windows v1
                </Badge>
              </Group>
              <Group gap="xs">
                <Text c="dimmed" size="sm">
                  Root:
                </Text>
                <Code>
                  {bootstrap.settings.effectiveRoot ?? 'No active setups folder selected'}
                </Code>
              </Group>
            </Stack>

            <Group gap="xs">
              <Tooltip label={bootstrap.undoState.undoLabel ?? 'Nothing to undo'}>
                <ActionIcon
                  variant="light"
                  size="lg"
                  disabled={!bootstrap.undoState.canUndo || undoMutation.isPending}
                  onClick={() => void undoMutation.mutateAsync()}
                >
                  <IconArrowBackUp size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={bootstrap.undoState.redoLabel ?? 'Nothing to redo'}>
                <ActionIcon
                  variant="light"
                  size="lg"
                  disabled={!bootstrap.undoState.canRedo || redoMutation.isPending}
                  onClick={() => void redoMutation.mutateAsync()}
                >
                  <IconArrowForwardUp size={18} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon variant="light" size="lg" onClick={() => setSettingsOpened(true)}>
                <IconSettings size={18} />
              </ActionIcon>
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
                  <Button leftSection={<IconFolderOpen size={16} />} onClick={() => void handlePickRoot()}>
                    Choose folder
                  </Button>
                </Group>
              </Alert>
            ) : null}

            <ResizableGroup orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
              <Panel defaultSize={16} minSize={12}>
                <ExplorerColumn
                  title="Cars"
                  subtitle={`${bootstrap.library.cars.length} folders`}
                >
                  <SelectableList
                    items={bootstrap.library.cars.map((car) => ({
                      id: car.id,
                      title: car.displayName,
                      description: `${car.trackCount} tracks`,
                      selected: car.id === selectedCarId,
                      onClick: () => {
                        setSelectedCarId(car.id)
                        setSelectedTrackId(null)
                        setSelectedLocalSetupId(null)
                      },
                    }))}
                  />
                </ExplorerColumn>
              </Panel>

              <Separator style={resizeHandleStyle} />

              <Panel defaultSize={18} minSize={14}>
                <ExplorerColumn
                  title="Tracks"
                  subtitle={selectedCar ? `${visibleTracks.length} folders` : 'Select a car'}
                >
                  <SelectableList
                    emptyMessage={
                      selectedCar
                        ? 'No track folders were found for this car.'
                        : 'Select a car to view tracks.'
                    }
                    items={visibleTracks.map((track) => ({
                      id: track.id,
                      title: track.displayName,
                      description: `${track.setupCount} setups`,
                      selected: track.id === selectedTrackId,
                      onClick: () => {
                        setSelectedTrackId(track.id)
                        setSelectedLocalSetupId(null)
                      },
                    }))}
                  />
                </ExplorerColumn>
              </Panel>

              <Separator style={resizeHandleStyle} />

              <Panel defaultSize={26} minSize={18}>
                <ExplorerColumn
                  title="Local setups"
                  subtitle={selectedTrack ? `${visibleLocalSetups.length} items` : 'Select a track'}
                  toolbar={
                    <Group gap="xs" wrap="nowrap">
                      <ActionIcon
                        variant="light"
                        disabled={!selectedTrack}
                        onClick={() =>
                          setRenameModal(
                            selectedTrack
                              ? { mode: 'create', trackPath: selectedTrack.id, fileName: '' }
                              : null,
                          )
                        }
                      >
                        <IconPlus size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        disabled={!selectedLocalSetup}
                        onClick={() =>
                          setRenameModal(
                            selectedLocalSetup
                              ? {
                                  mode: 'rename',
                                  setup: selectedLocalSetup,
                                  fileName: selectedLocalSetup.fileName,
                                }
                              : null,
                          )
                        }
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="red"
                        disabled={!selectedLocalSetup}
                        onClick={() => setDeleteCandidate(selectedLocalSetup ?? null)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                      <ActionIcon variant="light" disabled={!selectedTrack} onClick={() => void handleImportClick()}>
                        <IconDownload size={16} />
                      </ActionIcon>
                    </Group>
                  }
                >
                  <Stack gap="sm" h="100%">
                    <Group grow>
                      <TextInput
                        placeholder="Filter setups"
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
                    <Paper
                      h="100%"
                      p="xs"
                      bg="dark.6"
                      radius="md"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => void handleDropImport(event)}
                    >
                      <SelectableList
                        emptyMessage={
                          selectedTrack
                            ? 'No setup files were found for this track. Create or import one to begin.'
                            : 'Select a track to browse local setups.'
                        }
                        items={visibleLocalSetups.map((setup) => ({
                          id: setup.id,
                          title: setup.displayName,
                          description: `Saved ${formatDate(setup.lastModifiedAt)}`,
                          selected: setup.id === selectedLocalSetupId,
                          onClick: () => setSelectedLocalSetupId(setup.id),
                          onDoubleClick: () => void openSetupInEditor(setup.id),
                        }))}
                      />
                    </Paper>
                    <Text size="xs" c="dimmed">
                      Drop a JSON file here to import it into the selected track folder.
                    </Text>
                  </Stack>
                </ExplorerColumn>
              </Panel>

              <Separator style={resizeHandleStyle} />

              <Panel defaultSize={40} minSize={24}>
                {openDocument ? (
                  <Stack gap="sm" h="100%">
                    <Group justify="space-between">
                      <Stack gap={2}>
                        <Text fw={600}>{openDocument.title}</Text>
                        <Text size="sm" c="dimmed">
                          {openDocument.readOnly ? 'Read-only preview' : 'Editable local JSON'}
                        </Text>
                      </Stack>
                      <Group gap="xs">
                        {openDocument.remoteDownload ? (
                          <Button
                            variant="light"
                            leftSection={<IconDownload size={16} />}
                            loading={remoteDownloadMutation.isPending}
                            onClick={() => void requestPreviewDownload()}
                          >
                            Download
                          </Button>
                        ) : null}
                        {openDocument.remoteDownload?.sourcePageUrl ? (
                          <ActionIcon
                            variant="light"
                            size="lg"
                            onClick={() =>
                              void openExternal(openDocument.remoteDownload?.sourcePageUrl ?? '')
                            }
                          >
                            <IconExternalLink size={16} />
                          </ActionIcon>
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
                          >
                            Save
                          </Button>
                        ) : null}
                        <Button variant="light" onClick={closeOpenDocument}>
                          Close
                        </Button>
                      </Group>
                    </Group>
                    <Card withBorder radius="lg" bg="dark.7" h="100%" p="xs">
                      <Suspense
                        fallback={
                          <Group justify="center" align="center" h="100%">
                            <Loader size="sm" />
                          </Group>
                        }
                      >
                        <MonacoEditor
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
                ) : (
                  <Stack gap="md" h="100%">
                    <Group justify="space-between">
                      <Stack gap={2}>
                        <Text fw={600}>Remote source area</Text>
                        <Text size="sm" c="dimmed">
                          Simply Lovely Setups is live. The other tabs reflect the completed
                          verification report.
                        </Text>
                      </Stack>
                      <Button
                        variant="light"
                        leftSection={<IconRefresh size={16} />}
                        disabled={!selectedTrack}
                        loading={refreshRemoteMutation.isPending}
                        onClick={() => void refreshRemoteMutation.mutateAsync()}
                      >
                        Refresh
                      </Button>
                    </Group>

                    <Tabs
                      value={activeRemoteSource.id}
                      onChange={(value) => value && setActiveRemoteSourceId(value)}
                      variant="outline"
                      radius="md"
                      styles={{ panel: { flex: 1, display: 'flex', minHeight: 0 } }}
                    >
                      <Tabs.List>
                        {BUILT_IN_REMOTE_SOURCES.map((source) => (
                          <Tabs.Tab key={source.id} value={source.id}>
                            {source.name}
                          </Tabs.Tab>
                        ))}
                      </Tabs.List>

                      {BUILT_IN_REMOTE_SOURCES.map((source) => (
                        <Tabs.Panel key={source.id} value={source.id} pt="md">
                          <Stack gap="sm" h="100%">
                            <Card withBorder radius="lg" bg="dark.7">
                              <Group justify="space-between" align="flex-start">
                                <Stack gap={4}>
                                  <Group gap="xs">
                                    <Text fw={600}>{source.name}</Text>
                                    {source.id === 'simply-lovely-setups' ? (
                                      <Badge color="green" variant="light">
                                        Live
                                      </Badge>
                                    ) : (
                                      <Badge color="gray" variant="light">
                                        Deferred
                                      </Badge>
                                    )}
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
                                >
                                  Open source page
                                </Button>
                              </Group>
                            </Card>

                            <Group grow>
                              <TextInput
                                placeholder="Filter remote setups"
                                value={remoteFilters[source.id] ?? ''}
                                onChange={(event) =>
                                  setRemoteFilter(source.id, event.currentTarget.value)
                                }
                              />
                              <SegmentedControl
                                value={remoteSortModes[source.id] ?? 'alphabetical'}
                                onChange={(value) =>
                                  setRemoteSortMode(source.id, value as RemoteSortMode)
                                }
                                data={[
                                  { value: 'alphabetical', label: 'Alphabetical' },
                                  { value: 'ranking', label: 'Ranking' },
                                ]}
                              />
                            </Group>

                            <Card withBorder radius="lg" bg="dark.6" h="100%">
                              {source.id !== activeRemoteSource.id ? (
                                <Group justify="center" align="center" h="100%">
                                  <Text size="sm" c="dimmed">
                                    Switch to this tab to load its current state.
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
                                <RemoteSetupList
                                  items={visibleRemoteItems}
                                  selectedSetupId={selectedRemoteSetup?.id ?? null}
                                  onSelect={(setup) => setSelectedRemoteSetupId(source.id, setup.id)}
                                  onOpenPreview={(setup) => void openRemotePreview(setup)}
                                  onDownload={(setup) => void requestRemoteDownload(setup)}
                                  onOpenSourcePage={(setup) => void openExternal(setup.sourcePageUrl)}
                                />
                              ) : (
                                <Stack gap="sm" justify="center" h="100%">
                                  <Group gap="xs">
                                    <ThemeIcon color="gray" variant="light">
                                      <IconCloudOff size={16} />
                                    </ThemeIcon>
                                    <Text fw={500}>
                                      {source.id === activeRemoteSource.id
                                        ? remoteQuery.data?.message
                                        : 'Switch to this tab to load its current state.'}
                                    </Text>
                                  </Group>
                                  <Text size="sm" c="dimmed">
                                    {source.id === 'simply-lovely-setups'
                                      ? 'The adapter is live. If no entries appear, the selected car and track may not be covered by the verified API.'
                                      : 'The tab is preserved in the built-in source allowlist, but the verification report recommends deferring this source for v1.'}
                                  </Text>
                                </Stack>
                              )}
                            </Card>
                          </Stack>
                        </Tabs.Panel>
                      ))}
                    </Tabs>
                  </Stack>
                )}
              </Panel>
            </ResizableGroup>
          </Stack>
        </AppShell.Main>
      </AppShell>

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

interface SelectableListItem {
  id: string
  title: string
  description: string
  selected: boolean
  onClick?: () => void
  onDoubleClick?: () => void
}

function ExplorerColumn({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string
  subtitle: string
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <Card
      withBorder
      radius="lg"
      bg="rgba(13, 17, 28, 0.85)"
      h="100%"
      styles={{ root: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      <Group justify="space-between" align="flex-start" mb="md">
        <Stack gap={2}>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
        </Stack>
        {toolbar}
      </Group>
      <Box style={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Card>
  )
}

function SelectableList({
  items,
  emptyMessage = 'Nothing to show.',
}: {
  items: SelectableListItem[]
  emptyMessage?: string
}) {
  if (!items.length) {
    return (
      <Group justify="center" align="center" h="100%">
        <Text size="sm" c="dimmed" ta="center">
          {emptyMessage}
        </Text>
      </Group>
    )
  }

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack gap="xs">
        {items.map((item) => (
          <Paper
            key={item.id}
            radius="md"
            p="sm"
            onClick={item.onClick}
            onDoubleClick={item.onDoubleClick}
            className={clsx('selectable-list-item', item.selected && 'selectable-list-item--selected')}
            style={{
              cursor: item.onClick ? 'pointer' : 'default',
              background: item.selected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(30, 41, 59, 0.55)',
              border: item.selected
                ? '1px solid rgba(167, 139, 250, 0.7)'
                : '1px solid rgba(71, 85, 105, 0.45)',
            }}
          >
            <Text fw={500}>{item.title}</Text>
            <Text size="sm" c="dimmed">
              {item.description}
            </Text>
          </Paper>
        ))}
      </Stack>
    </ScrollArea>
  )
}

const resizeHandleStyle = {
  width: 6,
  background: 'transparent',
}

export default App

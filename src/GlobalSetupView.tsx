import { lazy, Suspense, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertCircle,
  IconCheck,
  IconGlobe,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import {
  adoptGlobalSetup,
  chooseImportFile,
  disableGlobalSetup,
  enableGlobalSetup,
  loadGlobalSetupState,
  pushGlobalSetup,
  readSetupDocument,
  saveGlobalSetupMaster,
} from './lib/tauri'
import type { AppBootstrap, GlobalSetupState } from './types/models'

const HybridSetupEditor = lazy(async () => {
  const module = await import('./lib/setup-editor')
  return { default: module.HybridSetupEditor }
})

const globalSetupQueryKey = ['global-setup-state'] as const

function showError(title: string, error: unknown): void {
  notifications.show({
    title,
    message: error instanceof Error ? error.message : String(error),
    color: 'red',
  })
}

function showSuccess(message: string): void {
  notifications.show({ message, color: 'steel' })
}

function statusBadge(status: GlobalSetupState['status']) {
  switch (status) {
    case 'synced':
      return (
        <Badge variant="light" color="steel">
          Synced
        </Badge>
      )
    case 'master_modified':
      return (
        <Badge variant="light" color="yellow">
          Master modified — fleet stale
        </Badge>
      )
    case 'no_master':
      return (
        <Badge variant="light" color="red">
          Master file missing
        </Badge>
      )
    default:
      return (
        <Badge variant="light" color="dark">
          Disabled
        </Badge>
      )
  }
}

export function GlobalSetupView({ bootstrap }: { bootstrap: AppBootstrap }) {
  const queryClient = useQueryClient()
  const [masterContent, setMasterContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false)

  const rootReady = bootstrap.settings.rootStatus === 'ready'

  const stateQuery = useQuery({
    queryKey: globalSetupQueryKey,
    queryFn: loadGlobalSetupState,
    enabled: rootReady,
  })

  const applyBootstrap = (result: { bootstrap: AppBootstrap }): void => {
    queryClient.setQueryData<AppBootstrap>(['bootstrap'], result.bootstrap)
    void queryClient.invalidateQueries({ queryKey: globalSetupQueryKey })
    void queryClient.invalidateQueries({ queryKey: ['local-setups'] })
  }

  useEffect(() => {
    const unlistenPromise = listen('global-setup-state-changed', () => {
      void queryClient.invalidateQueries({ queryKey: globalSetupQueryKey })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      void queryClient.invalidateQueries({ queryKey: ['local-setups'] })
    })
    return () => {
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [queryClient])

  const globalState = stateQuery.data
  const masterPath = globalState?.masterPath ?? null

  useEffect(() => {
    if (!masterPath || globalState?.status === 'no_master') {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const document = await readSetupDocument(masterPath)
        if (!cancelled) {
          setMasterContent(document.content)
          setSavedContent(document.content)
        }
      } catch (error) {
        if (!cancelled) {
          showError("Couldn't open the global setup master", error)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [masterPath, globalState?.status])

  const enableMutation = useMutation({
    mutationFn: enableGlobalSetup,
    onSuccess: (result) => {
      applyBootstrap(result)
      showSuccess('Global setup enabled and pushed to every car and track.')
    },
    onError: (error) => showError("Couldn't enable the global setup", error),
  })

  const disableMutation = useMutation({
    mutationFn: disableGlobalSetup,
    onSuccess: (result) => {
      applyBootstrap(result)
      setDisableConfirmOpen(false)
      showSuccess('Global setup disabled and all owned copies removed.')
    },
    onError: (error) => showError("Couldn't disable the global setup", error),
  })

  const pushMutation = useMutation({
    mutationFn: pushGlobalSetup,
    onSuccess: (result) => {
      applyBootstrap(result)
      showSuccess('Master setup pushed to every car and track.')
    },
    onError: (error) => showError("Couldn't push the global setup", error),
  })

  const saveMutation = useMutation({
    mutationFn: (content: string) => saveGlobalSetupMaster(content),
    onSuccess: (result) => {
      applyBootstrap(result)
      setSavedContent(masterContent)
      showSuccess('Master setup saved. Push it to update every car and track.')
    },
    onError: (error) => showError("Couldn't save the master setup", error),
  })

  const adoptMutation = useMutation({
    mutationFn: async () => {
      const sourcePath = await chooseImportFile()
      if (!sourcePath) {
        throw new Error('No setup file was selected.')
      }
      return adoptGlobalSetup(sourcePath)
    },
    onSuccess: (result) => {
      applyBootstrap(result)
      showSuccess('Setup adopted as the master. Push it to update every car and track.')
    },
    onError: (error) => showError("Couldn't adopt that setup", error),
  })

  if (!rootReady) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        color="yellow"
        title="Setup folder required"
      >
        Choose your ACC setups folder before using the global setup.
      </Alert>
    )
  }

  if (!globalState) {
    return (
      <Group justify="center" align="center" h={200}>
        {stateQuery.isError ? (
          <Alert color="red" title="Couldn't load the global setup state">
            {stateQuery.error instanceof Error
              ? stateQuery.error.message
              : 'An unknown error occurred.'}
          </Alert>
        ) : (
          <Loader size="sm" />
        )}
      </Group>
    )
  }

  if (!globalState.featureEnabled) {
    return (
      <Card withBorder radius="md" className="surface-card" p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconGlobe size={20} />
            <Text fw={700}>Global Setup</Text>
          </Group>
          <Text size="sm" c="dimmed">
            Define one master setup that is synced to every car and track combination in your
            ACC setups folder. The same values apply everywhere — tune one copy in game and it
            is promoted to the master and pushed to the whole fleet automatically.
          </Text>
          <Group gap="xs">
            <Button
              leftSection={<IconCheck size={16} />}
              loading={enableMutation.isPending}
              onClick={() => void enableMutation.mutateAsync()}
            >
              Enable global setup
            </Button>
            <Button
              variant="light"
              loading={adoptMutation.isPending}
              onClick={() => void adoptMutation.mutateAsync()}
              title="Enable using an existing setup file as the master"
            >
              Enable with an existing setup
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Enabling writes the default baseline to about{' '}
                {bootstrap.library.cars.length} cars × all known tracks. You can undo it while
            the app stays open.
          </Text>
        </Stack>
      </Card>
    )
  }

  if (globalState.status === 'no_master') {
    return (
      <Card withBorder radius="md" className="surface-card" p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <Text fw={700}>Global Setup</Text>
            {statusBadge(globalState.status)}
          </Group>
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            title="The master setup file is missing"
          >
            The master file was deleted from the setups folder. Recover it by adopting an
            existing setup file, or disable the feature to remove the remaining owned copies.
          </Alert>
          <Group gap="xs">
            <Button
              variant="light"
              loading={adoptMutation.isPending}
              onClick={() => void adoptMutation.mutateAsync()}
            >
              Adopt setup as master
            </Button>
            <Button
              variant="light"
              color="red"
              loading={disableMutation.isPending}
              onClick={() => setDisableConfirmOpen(true)}
            >
              Disable
            </Button>
          </Group>
        </Stack>
      </Card>
    )
  }

  const dirty = masterContent !== null && masterContent !== savedContent

  return (
    <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
      <Card withBorder radius="md" className="surface-card" p="xs">
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="xs">
              <IconGlobe size={18} />
              <Text fw={700}>Global Setup</Text>
              {statusBadge(globalState.status)}
            </Group>
            <Group gap="xs" wrap="wrap">
              <Button
                variant="light"
                loading={adoptMutation.isPending}
                onClick={() => void adoptMutation.mutateAsync()}
                title="Replace the master with an existing setup file"
              >
                Adopt setup as master
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={() => setDisableConfirmOpen(true)}
                title="Remove the master and every owned copy"
              >
                Disable
              </Button>
            </Group>
          </Group>
          <Group gap="xs" wrap="wrap">
            <Button
              leftSection={<IconUpload size={16} />}
              disabled={globalState.status !== 'master_modified'}
              loading={pushMutation.isPending}
              onClick={() => void pushMutation.mutateAsync()}
              title="Write the master to every car and track"
            >
              Push to all
            </Button>
            <Button
              disabled={!dirty || saveMutation.isPending}
              loading={saveMutation.isPending}
              onClick={() => masterContent && void saveMutation.mutateAsync(masterContent)}
              title="Save your edits to the master file"
            >
              Save master
            </Button>
            {dirty ? (
              <Badge variant="light" color="yellow">
                Unsaved changes
              </Badge>
            ) : null}
            <Text size="xs" c="dimmed">
              {globalState.ownedFileCount} owned copies across{' '}
              {globalState.cars.length} cars
            </Text>
          </Group>
        </Stack>
      </Card>

      <Card withBorder radius="md" className="editor-shell" p="md" style={{ flex: 1, minHeight: 0 }}>
        {masterContent === null ? (
          <Group justify="center" align="center" h="100%">
            <Loader size="sm" />
          </Group>
        ) : (
          <Suspense
            fallback={
              <Group justify="center" align="center" h="100%">
                <Loader size="sm" />
              </Group>
            }
          >
            <HybridSetupEditor
              documentId={masterPath ?? 'global-setup-master'}
              title="ACC Manager Global Setup"
              content={masterContent}
              readOnly={false}
              onChange={setMasterContent}
            />
          </Suspense>
        )}
      </Card>

      <Card withBorder radius="md" className="surface-card" p="xs" style={{ maxHeight: 220 }}>
        <Stack gap="xs">
          <Text fw={700} tt="uppercase" size="xs" className="panel-title">
            Sync status per car
          </Text>
          <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Car</Table.Th>
                  <Table.Th>In sync</Table.Th>
                  <Table.Th>Missing</Table.Th>
                  <Table.Th>Diverged</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {globalState.cars.map((car) => (
                  <Table.Tr key={car.carFolder}>
                    <Table.Td>{car.displayName}</Table.Td>
                    <Table.Td>{car.inSync}</Table.Td>
                    <Table.Td>{car.missing}</Table.Td>
                    <Table.Td>{car.diverged}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Stack>
      </Card>

      <Modal
        opened={disableConfirmOpen}
        onClose={() => setDisableConfirmOpen(false)}
        title="Disable global setup"
      >
        <Stack>
          <Text>
            Remove the master setup and all{' '}
            <strong>{globalState.ownedFileCount}</strong> owned copies from your setups folder?
          </Text>
          <Text size="sm" c="dimmed">
            You can undo this while the app stays open.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDisableConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={disableMutation.isPending}
              onClick={() => void disableMutation.mutateAsync()}
            >
              Disable and remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

export default GlobalSetupView

import { AppShell, Box, Card, Group, Skeleton, Stack, Text } from '@mantine/core'

export function StartupShell() {
  return (
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
        <Group justify="space-between" align="center" h="100%" wrap="nowrap">
          <Stack gap={0}>
            <Text fw={700} size="sm">
              ACC Setup Manager
            </Text>
            <Text size="xs" c="dimmed">
              Loading your setup library
            </Text>
          </Stack>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="xs" p="xs" h="calc(100vh - 52px)">
          <Box className="workspace-grid">
            <Card withBorder radius="md" className="surface-card" p="xs">
              <Stack gap="xs" h="100%">
                <Text fw={700} tt="uppercase" size="sm" className="panel-title">
                  Setup library
                </Text>

                <Box className="setup-library-layout">
                  <Stack gap="xs" className="library-column">
                    <Skeleton height={22} radius="sm" />
                    <Box className="list-shell">
                      <Stack gap="xs">
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                      </Stack>
                    </Box>
                  </Stack>

                  <Stack gap="xs" className="library-column">
                    <Skeleton height={22} radius="sm" />
                    <Box className="list-shell">
                      <Stack gap="xs">
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                      </Stack>
                    </Box>
                  </Stack>

                  <Stack gap="xs" className="setups-column">
                    <Skeleton height={34} radius="sm" />
                    <Box className="list-shell" style={{ height: '100%' }}>
                      <Stack gap="xs">
                        <Skeleton height={56} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                        <Skeleton height={44} radius="sm" />
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            </Card>
          </Box>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}

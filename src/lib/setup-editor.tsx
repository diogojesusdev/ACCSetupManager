import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core'
import { IconWand } from '@tabler/icons-react'
import { type ReactElement, useMemo, useState } from 'react'
import {
  type JsonObject,
  type JsonPath,
  type JsonPrimitive,
  type JsonValue,
  isJsonObject,
  mergeAccSetupScaffold,
  parseStructuredDocument,
  serializeJsonObject,
  setJsonValueAtPath,
} from './setup-editor-helpers'

type StructuredEditorMode = 'structured' | 'raw'

interface HybridSetupEditorProps {
  documentId: string
  title: string
  content: string
  readOnly: boolean
  onChange: (content: string) => void
}

type EditorTabId =
  | 'tyres'
  | 'strategy'
  | 'balance'
  | 'dampers'
  | 'aero'
  | 'meta'
  | 'other'

interface EditorTabSection {
  key: string
  path: JsonPath
  value: JsonValue
}

interface EditorTabDefinition {
  id: EditorTabId
  label: string
  sections: EditorTabSection[]
}

interface MaybeEditorTabSection {
  key: string
  path: JsonPath
  value: JsonValue | undefined
}

const wheelCornerLabels = ['Front left', 'Front right', 'Rear left', 'Rear right']
const frontRearLabels = ['Front', 'Rear']

const sectionOrder: Record<string, string[]> = {
  '': ['basicSetup', 'advancedSetup', 'setup_type', 'weather', 'trackBopType', 'file_name'],
  basicSetup: ['tyres', 'alignment', 'electronics', 'strategy'],
  advancedSetup: ['mechanicalBalance', 'dampers', 'aeroBalance', 'drivetrain'],
  'basicSetup.strategy': [
    'fuel',
    'nPitStops',
    'tyreSet',
    'frontBrakePadCompound',
    'rearBrakePadCompound',
    'pitStrategy',
    'fuelPerLap',
  ],
}

const fieldLabels: Record<string, string> = {
  basicSetup: 'Basic setup',
  advancedSetup: 'Advanced setup',
  tyres: 'Tyres',
  tyreCompound: 'Tyre compound',
  tyrePressure: 'Tyre pressure',
  alignment: 'Alignment',
  camber: 'Camber',
  toe: 'Toe',
  staticCamber: 'Static camber',
  toeOutLinear: 'Toe out linear',
  casterLF: 'Caster left front',
  casterRF: 'Caster right front',
  steerRatio: 'Steer ratio',
  electronics: 'Electronics',
  tC1: 'TC 1',
  tC2: 'TC 2',
  abs: 'ABS',
  eCUMap: 'ECU map',
  fuelMix: 'Fuel mix',
  telemetryLaps: 'Telemetry laps',
  strategy: 'Strategy',
  fuel: 'Fuel',
  nPitStops: 'Pit stops',
  tyreSet: 'Tyre set',
  frontBrakePadCompound: 'Front brake pad compound',
  rearBrakePadCompound: 'Rear brake pad compound',
  pitStrategy: 'Pit strategy',
  fuelToAdd: 'Fuel to add',
  fuelPerLap: 'Fuel per lap',
  mechanicalBalance: 'Mechanical balance',
  aRBFront: 'ARB front',
  aRBRear: 'ARB rear',
  wheelRate: 'Wheel rate',
  bumpStopRateUp: 'Bump stop rate up',
  bumpStopRateDn: 'Bump stop rate down',
  bumpStopWindow: 'Bump stop window',
  brakeTorque: 'Brake torque',
  brakeBias: 'Brake bias',
  dampers: 'Dampers',
  bumpSlow: 'Bump slow',
  bumpFast: 'Bump fast',
  reboundSlow: 'Rebound slow',
  reboundFast: 'Rebound fast',
  aeroBalance: 'Aero balance',
  rideHeight: 'Ride height',
  rodLength: 'Rod length',
  splitter: 'Splitter',
  rearWing: 'Rear wing',
  brakeDuct: 'Brake duct',
  drivetrain: 'Drivetrain',
  preload: 'Preload',
  setup_type: 'Setup type',
  weather: 'Weather',
  trackBopType: 'Track BoP type',
  file_name: 'File name',
}

function hasAccSections(value: JsonObject): boolean {
  return isJsonObject(value.basicSetup) || isJsonObject(value.advancedSetup)
}

function getJsonValueAtPath(root: JsonObject, path: JsonPath): JsonValue | undefined {
  let current: JsonValue = root

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[segment]
      continue
    }

    if (!isJsonObject(current)) {
      return undefined
    }
    current = current[segment]
  }

  return current
}

function buildOtherSections(value: JsonObject): EditorTabSection[] {
  const sections: EditorTabSection[] = []
  const extraRootKeys = Object.keys(value).filter(
    (key) => !['basicSetup', 'advancedSetup', 'setup_type', 'weather', 'trackBopType', 'file_name'].includes(key),
  )

  if (extraRootKeys.length) {
    sections.push({
      key: 'rootExtra',
      path: ['Additional fields'],
      value: Object.fromEntries(extraRootKeys.map((key) => [key, value[key]])),
    })
  }

  const basicSetup = isJsonObject(value.basicSetup) ? value.basicSetup : null
  const extraBasicKeys = basicSetup
    ? Object.keys(basicSetup).filter((key) => !['tyres', 'alignment', 'electronics', 'strategy'].includes(key))
    : []
  if (basicSetup && extraBasicKeys.length) {
    sections.push({
      key: 'basicExtra',
      path: ['basicSetup', 'Additional fields'],
      value: Object.fromEntries(extraBasicKeys.map((key) => [key, basicSetup[key]])),
    })
  }

  const advancedSetup = isJsonObject(value.advancedSetup) ? value.advancedSetup : null
  const extraAdvancedKeys = advancedSetup
    ? Object.keys(advancedSetup).filter(
        (key) => !['mechanicalBalance', 'dampers', 'aeroBalance', 'drivetrain'].includes(key),
      )
    : []
  if (advancedSetup && extraAdvancedKeys.length) {
    sections.push({
      key: 'advancedExtra',
      path: ['advancedSetup', 'Additional fields'],
      value: Object.fromEntries(extraAdvancedKeys.map((key) => [key, advancedSetup[key]])),
    })
  }

  return sections
}

function buildEditorTabs(value: JsonObject): EditorTabDefinition[] {
  const withSections = (id: EditorTabId, label: string, sections: MaybeEditorTabSection[]): EditorTabDefinition => ({
    id,
    label,
    sections: sections.filter((section): section is EditorTabSection => section.value !== undefined),
  })

  const baseTabs: EditorTabDefinition[] = [
    withSections('tyres', 'Tyres + Alignment', [
        { key: 'tyres', path: ['basicSetup', 'tyres'], value: getJsonValueAtPath(value, ['basicSetup', 'tyres']) },
        {
          key: 'alignment',
          path: ['basicSetup', 'alignment'],
          value: getJsonValueAtPath(value, ['basicSetup', 'alignment']),
        },
      ]),
    withSections('strategy', 'Electronics + Strategy', [
        {
          key: 'electronics',
          path: ['basicSetup', 'electronics'],
          value: getJsonValueAtPath(value, ['basicSetup', 'electronics']),
        },
        {
          key: 'strategy',
          path: ['basicSetup', 'strategy'],
          value: getJsonValueAtPath(value, ['basicSetup', 'strategy']),
        },
      ]),
    withSections('balance', 'Mechanical Balance', [
        {
          key: 'mechanicalBalance',
          path: ['advancedSetup', 'mechanicalBalance'],
          value: getJsonValueAtPath(value, ['advancedSetup', 'mechanicalBalance']),
        },
      ]),
    withSections('dampers', 'Dampers', [
        {
          key: 'dampers',
          path: ['advancedSetup', 'dampers'],
          value: getJsonValueAtPath(value, ['advancedSetup', 'dampers']),
        },
      ]),
    withSections('aero', 'Aero + Drivetrain', [
        {
          key: 'aeroBalance',
          path: ['advancedSetup', 'aeroBalance'],
          value: getJsonValueAtPath(value, ['advancedSetup', 'aeroBalance']),
        },
        {
          key: 'drivetrain',
          path: ['advancedSetup', 'drivetrain'],
          value: getJsonValueAtPath(value, ['advancedSetup', 'drivetrain']),
        },
      ]),
    withSections('meta', 'Setup Info', [
        { key: 'file_name', path: ['file_name'], value: getJsonValueAtPath(value, ['file_name']) },
        { key: 'setup_type', path: ['setup_type'], value: getJsonValueAtPath(value, ['setup_type']) },
        { key: 'weather', path: ['weather'], value: getJsonValueAtPath(value, ['weather']) },
        {
          key: 'trackBopType',
          path: ['trackBopType'],
          value: getJsonValueAtPath(value, ['trackBopType']),
        },
      ]),
  ].filter((tab) => tab.sections.length > 0)

  const otherSections = buildOtherSections(value)
  if (otherSections.length) {
    baseTabs.push({
      id: 'other',
      label: 'Other',
      sections: otherSections,
    })
  }

  return baseTabs
}

function formatFieldLabel(key: string): string {
  if (fieldLabels[key]) {
    return fieldLabels[key]
  }

  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function getOrderedEntries(path: JsonPath, value: JsonObject): [string, JsonValue][] {
  const entries = Object.entries(value)
  const order = sectionOrder[path.join('.')] ?? []

  return entries.sort(([leftKey], [rightKey]) => {
    const leftIndex = order.indexOf(leftKey)
    const rightIndex = order.indexOf(rightKey)
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) {
        return 1
      }
      if (rightIndex === -1) {
        return -1
      }
      return leftIndex - rightIndex
    }

    return leftKey.localeCompare(rightKey)
  })
}

function getArrayItemLabels(path: JsonPath, values: JsonValue[]): string[] {
  const lastSegment = path[path.length - 1]
  if (values.length === 4) {
    return wheelCornerLabels
  }

  if (values.length === 2 && lastSegment === 'brakeDuct') {
    return frontRearLabels
  }

  return values.map((_, index) => `Item ${index + 1}`)
}

function getNumericStep(value: number): number {
  return Number.isInteger(value) ? 1 : 0.001
}

function renderPrimitiveEditor(args: {
  label: string
  value: JsonPrimitive
  readOnly: boolean
  onValueChange: (nextValue: JsonValue) => void
}) {
  const { label, onValueChange, readOnly, value } = args

  if (typeof value === 'number') {
    return (
      <NumberInput
        label={label}
        size="xs"
        value={value}
        readOnly={readOnly}
        hideControls
        step={getNumericStep(value)}
        decimalScale={Number.isInteger(value) ? 0 : 4}
        onChange={(nextValue) => {
          if (typeof nextValue === 'number' && Number.isFinite(nextValue)) {
            onValueChange(nextValue)
          }
        }}
      />
    )
  }

  if (typeof value === 'boolean') {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <SegmentedControl
          size="xs"
          fullWidth
          value={value ? 'true' : 'false'}
          disabled={readOnly}
          onChange={(nextValue) => onValueChange(nextValue === 'true')}
          data={[
            { label: 'True', value: 'true' },
            { label: 'False', value: 'false' },
          ]}
        />
      </Stack>
    )
  }

  return (
    <TextInput
      label={label}
      size="xs"
      value={value === null ? 'null' : String(value)}
      readOnly={readOnly}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  )
}

export function HybridSetupEditor({
  documentId,
  title,
  content,
  readOnly,
  onChange,
}: HybridSetupEditorProps) {
  const parsed = useMemo(() => parseStructuredDocument(content), [content])
  const preferredMode: StructuredEditorMode = parsed.kind === 'object' ? 'structured' : 'raw'
  const [modeState, setModeState] = useState<{
    documentId: string
    mode: StructuredEditorMode
  }>({ documentId, mode: preferredMode })
  const mode =
    modeState.documentId === documentId
      ? modeState.mode === 'structured' && parsed.kind !== 'object'
        ? 'raw'
        : modeState.mode
      : preferredMode
  const [tabState, setTabState] = useState<{ documentId: string; tab: EditorTabId }>({
    documentId,
    tab: 'tyres',
  })

  const applyObjectUpdate = (nextValue: JsonObject) => {
    onChange(serializeJsonObject(nextValue))
  }

  const insertAccScaffold = () => {
    if (parsed.kind !== 'object') {
      return
    }

    applyObjectUpdate(mergeAccSetupScaffold(parsed.value))
  }

  const renderJsonValue = (path: JsonPath, value: JsonValue): ReactElement => {
    const pathKey = path.join('.')
    const lastSegment = path[path.length - 1]
    const label =
      typeof lastSegment === 'number'
        ? path[path.length - 2] === 'pitStrategy'
          ? `Stop ${lastSegment + 1}`
          : `Item ${lastSegment + 1}`
        : typeof lastSegment === 'string'
          ? formatFieldLabel(lastSegment)
          : title

    if (Array.isArray(value)) {
      if (!value.length) {
        return (
          <Card withBorder radius="md" className="structured-section-card" p="xs">
            <Stack gap={4}>
              <Text fw={600}>{label}</Text>
              <Text size="sm" c="dimmed">
                Nothing has been added here yet.
              </Text>
            </Stack>
          </Card>
        )
      }

      const primitiveArray = value.every(
        (item) =>
          item === null ||
          typeof item === 'boolean' ||
          typeof item === 'number' ||
          typeof item === 'string',
      )

      if (primitiveArray) {
        const labels = getArrayItemLabels(path, value)
        return (
          <Card withBorder radius="md" className="structured-section-card" p="xs">
            <Stack gap="sm">
              <Text fw={600}>{label}</Text>
              <div className="structured-array-grid">
                {value.map((item, index) => (
                  <div key={`${pathKey}.${index}`}>
                    {renderPrimitiveEditor({
                      label: labels[index] ?? `Item ${index + 1}`,
                      value: item as JsonPrimitive,
                      readOnly,
                      onValueChange: (nextValue) => {
                        if (parsed.kind !== 'object') {
                          return
                        }

                        applyObjectUpdate(
                          setJsonValueAtPath(parsed.value, [...path, index], nextValue),
                        )
                      },
                    })}
                  </div>
                ))}
              </div>
            </Stack>
          </Card>
        )
      }

      return (
        <Card withBorder radius="md" className="structured-section-card" p="xs">
          <Stack gap="sm">
            <Text fw={600}>{label}</Text>
            {value.map((item, index) => (
              <div key={`${pathKey}.${index}`}>
                {renderJsonValue([...path, index], item)}
              </div>
            ))}
          </Stack>
        </Card>
      )
    }

    if (isJsonObject(value)) {
      const entries = getOrderedEntries(path, value)
      if (!entries.length) {
        return (
          <Card withBorder radius="md" className="structured-section-card" p="xs">
            <Stack gap={4}>
              <Text fw={600}>{label}</Text>
              <Text size="sm" c="dimmed">
                This section is empty.
              </Text>
            </Stack>
          </Card>
        )
      }

      const body = (
        <Stack gap="sm">
          {entries.map(([entryKey, entryValue]) => (
            <div key={`${pathKey}.${entryKey}`}>
              {renderJsonValue([...path, entryKey], entryValue)}
            </div>
          ))}
        </Stack>
      )

      if (!path.length) {
        return <>{body}</>
      }

      return (
        <Card withBorder radius="md" className="structured-section-card" p="xs">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text fw={600}>{label}</Text>
              <Text size="xs" c="dimmed">
                {pathKey}
              </Text>
            </Group>
            {body}
          </Stack>
        </Card>
      )
    }

    return (
      <div className="structured-field">
        {renderPrimitiveEditor({
          label,
          value,
          readOnly,
          onValueChange: (nextValue) => {
            if (parsed.kind !== 'object') {
              return
            }

            applyObjectUpdate(setJsonValueAtPath(parsed.value, path, nextValue))
          },
        })}
      </div>
    )
  }

  const renderStructuredContent = () => {
    if (parsed.kind === 'invalid') {
      return (
        <Alert color="red" title="Can't show the setup fields">
          Fix the setup text in Raw mode, then switch back here. Problem: {parsed.error}
        </Alert>
      )
    }

    if (parsed.kind === 'non-object') {
      return (
        <Alert color="orange" title="Can't show the setup fields">
          This file is not in the format needed to show individual setup fields. You can still view
          it in Raw mode.
        </Alert>
      )
    }

    const objectKeys = Object.keys(parsed.value)
    const tabs = buildEditorTabs(parsed.value)
    const activeTab =
      tabState.documentId === documentId && tabs.some((tab) => tab.id === tabState.tab)
        ? tabState.tab
        : tabs[0]?.id ?? 'meta'

    if (!objectKeys.length) {
      return (
        <Card withBorder radius="md" className="structured-empty-state" p="sm">
          <Stack gap="sm">
            <Text fw={600}>This setup is empty.</Text>
            <Text size="sm" c="dimmed">
              Add the standard ACC fields to start editing this setup.
            </Text>
            {!readOnly ? (
              <Group>
                <Button
                  leftSection={<IconWand size={16} />}
                  onClick={insertAccScaffold}
                  title="Adds standard ACC setup fields without changing any values already here."
                >
                  Add standard ACC fields
                </Button>
                <Text size="sm" c="dimmed">
                  You can always use Raw mode to edit the full setup file.
                </Text>
              </Group>
            ) : null}
          </Stack>
        </Card>
      )
    }

    return (
      <div className="structured-editor-body">
        {!readOnly && !hasAccSections(parsed.value) ? (
          <Alert color="orange" title="Some ACC fields are missing" className="structured-inline-alert">
            You can still edit this setup here. Add the standard ACC fields to see the usual sections.
          </Alert>
        ) : null}
        {tabs.length ? (
          <Tabs
            value={activeTab}
            onChange={(nextValue) => {
              if (nextValue) {
                setTabState({
                  documentId,
                  tab: nextValue as EditorTabId,
                })
              }
            }}
            className="structured-editor-tabs"
          >
            <Tabs.List>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.id} value={tab.id}>
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {tabs.map((tab) => (
              <Tabs.Panel key={tab.id} value={tab.id} pt="xs">
                <Stack gap="xs">
                  {tab.sections.map((section) => (
                    <div key={section.key}>{renderJsonValue(section.path, section.value)}</div>
                  ))}
                </Stack>
              </Tabs.Panel>
            ))}
          </Tabs>
        ) : (
          renderJsonValue([], parsed.value)
        )}
      </div>
    )
  }

  return (
    <Stack gap="sm" className="hybrid-editor-shell">
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(nextValue) =>
              setModeState({
                documentId,
                mode: nextValue as StructuredEditorMode,
              })
            }
            data={[
              { value: 'structured', label: 'Structured', disabled: parsed.kind !== 'object' },
              { value: 'raw', label: 'Raw JSON' },
            ]}
          />
          {mode === 'structured' && parsed.kind === 'object' ? (
            <Text size="xs" c="dimmed">
              Use the grouped fields for everyday changes. Raw mode is available when you need it.
            </Text>
          ) : null}
        </Group>
        {!readOnly && parsed.kind === 'object' ? (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconWand size={16} />}
            onClick={insertAccScaffold}
            title="Adds standard ACC setup fields without changing any values already here."
          >
            Add standard ACC fields
          </Button>
        ) : null}
      </Group>

      <Card withBorder radius="xl" className="editor-shell editor-modal-shell" p={0}>
        {mode === 'structured' ? (
          renderStructuredContent()
        ) : (
          <div className="raw-editor-shell">
            <textarea
              aria-label={`${title} raw JSON`}
              className="json-editor"
              value={content}
              readOnly={readOnly}
              spellCheck={false}
              onChange={(event) => {
                if (!readOnly) {
                  onChange(event.currentTarget.value)
                }
              }}
            />
          </div>
        )}
      </Card>
    </Stack>
  )
}

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonPathSegment = number | string
export type JsonPath = readonly JsonPathSegment[]

export type StructuredDocumentState =
  | { kind: 'invalid'; error: string }
  | { kind: 'non-object'; value: JsonValue }
  | { kind: 'object'; value: JsonObject }

const accSetupScaffold: JsonObject = {
  basicSetup: {
    tyres: {
      tyreCompound: 0,
      tyrePressure: [0, 0, 0, 0],
    },
    alignment: {
      camber: [0, 0, 0, 0],
      toe: [0, 0, 0, 0],
      staticCamber: [0, 0, 0, 0],
      toeOutLinear: [0, 0, 0, 0],
      casterLF: 0,
      casterRF: 0,
      steerRatio: 0,
    },
    electronics: {
      tC1: 0,
      tC2: 0,
      abs: 0,
      eCUMap: 0,
      fuelMix: 0,
      telemetryLaps: 0,
    },
    strategy: {
      fuel: 0,
      nPitStops: 0,
      tyreSet: 0,
      frontBrakePadCompound: 0,
      rearBrakePadCompound: 0,
      pitStrategy: [
        {
          fuelToAdd: 0,
          tyres: {
            tyreCompound: 0,
            tyrePressure: [0, 0, 0, 0],
          },
          tyreSet: 0,
          frontBrakePadCompound: 0,
          rearBrakePadCompound: 0,
        },
      ],
      fuelPerLap: 0,
    },
  },
  advancedSetup: {
    mechanicalBalance: {
      aRBFront: 0,
      aRBRear: 0,
      wheelRate: [0, 0, 0, 0],
      bumpStopRateUp: [0, 0, 0, 0],
      bumpStopRateDn: [0, 0, 0, 0],
      bumpStopWindow: [0, 0, 0, 0],
      brakeTorque: 0,
      brakeBias: 0,
    },
    dampers: {
      bumpSlow: [0, 0, 0, 0],
      bumpFast: [0, 0, 0, 0],
      reboundSlow: [0, 0, 0, 0],
      reboundFast: [0, 0, 0, 0],
    },
    aeroBalance: {
      rideHeight: [0, 0, 0, 0],
      rodLength: [0, 0, 0, 0],
      splitter: 0,
      rearWing: 0,
      brakeDuct: [0, 0],
    },
    drivetrain: {
      preload: 0,
    },
  },
}

export function parseStructuredDocument(content: string): StructuredDocumentState {
  try {
    const value = JSON.parse(content) as JsonValue
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return { kind: 'non-object', value }
    }

    return { kind: 'object', value }
  } catch (error) {
    return {
      kind: 'invalid',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function serializeJsonObject(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function setJsonValueAtPath(
  root: JsonObject,
  path: JsonPath,
  nextValue: JsonValue,
): JsonObject {
  return updateJsonValue(root, path, nextValue) as JsonObject
}

export function mergeAccSetupScaffold(target: JsonObject): JsonObject {
  return mergeMissingValues(target, accSetupScaffold)
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object'
}

function updateJsonValue(current: JsonValue, path: JsonPath, nextValue: JsonValue): JsonValue {
  if (!path.length) {
    return nextValue
  }

  const [segment, ...rest] = path
  if (Array.isArray(current) && typeof segment === 'number') {
    const nextArray = [...current]
    nextArray[segment] = updateJsonValue(nextArray[segment] as JsonValue, rest, nextValue)
    return nextArray
  }

  if (current && typeof current === 'object' && typeof segment === 'string') {
    const nextObject = { ...(current as JsonObject) }
    nextObject[segment] = updateJsonValue(nextObject[segment] as JsonValue, rest, nextValue)
    return nextObject
  }

  return current
}

function mergeMissingValues(target: JsonObject, defaults: JsonObject): JsonObject {
  const merged: JsonObject = { ...target }

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const currentValue = merged[key]
    if (currentValue === undefined) {
      merged[key] = cloneJsonValue(defaultValue)
      continue
    }

    if (isJsonObject(currentValue) && isJsonObject(defaultValue)) {
      merged[key] = mergeMissingValues(currentValue, defaultValue)
    }
  }

  return merged
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    )
  }

  return value
}

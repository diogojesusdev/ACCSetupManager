import { MantineProvider } from '@mantine/core'
import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  mergeAccSetupScaffold,
  parseStructuredDocument,
  serializeJsonObject,
  setJsonValueAtPath,
} from './setup-editor-helpers'
import { HybridSetupEditor } from './setup-editor'

function renderWithMantine(element: ReturnType<typeof createElement>) {
  return render(createElement(MantineProvider, null, element))
}

describe('setup editor helpers', () => {
  it('parses ACC setup objects for structured editing', () => {
    const result = parseStructuredDocument(
      serializeJsonObject({
        basicSetup: { strategy: { fuel: 20 } },
        advancedSetup: { drivetrain: { preload: 10 } },
      }),
    )

    expect(result.kind).toBe('object')
    if (result.kind !== 'object') {
      throw new Error('Expected an object result')
    }

    expect(result.value.basicSetup).toBeTruthy()
    expect(result.value.advancedSetup).toBeTruthy()
  })

  it('reports invalid JSON cleanly', () => {
    const result = parseStructuredDocument('{')
    expect(result.kind).toBe('invalid')
  })

  it('fills missing ACC sections without overwriting existing values', () => {
    const merged = mergeAccSetupScaffold({
      basicSetup: {
        strategy: {
          fuel: 55,
        },
      },
      customNote: 'keep me',
    })

    expect((merged.basicSetup as Record<string, unknown>).strategy).toBeTruthy()
    expect(
      ((merged.basicSetup as Record<string, unknown>).strategy as Record<string, unknown>).fuel,
    ).toBe(55)
    expect(merged.advancedSetup).toBeTruthy()
    expect(merged.customNote).toBe('keep me')
  })

  it('updates nested array values immutably', () => {
    const original = {
      basicSetup: {
        tyres: {
          tyrePressure: [54, 61, 48, 54],
        },
      },
    }

    const updated = setJsonValueAtPath(
      original,
      ['basicSetup', 'tyres', 'tyrePressure', 2],
      50,
    )

    expect(
      (((updated.basicSetup as Record<string, unknown>).tyres as Record<string, unknown>)
        .tyrePressure as number[])[2],
    ).toBe(50)
    expect(
      (((original.basicSetup as Record<string, unknown>).tyres as Record<string, unknown>)
        .tyrePressure as number[])[2],
    ).toBe(48)
  })

  it('shows an editable raw JSON textarea when raw mode is selected', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    renderWithMantine(
      createElement(HybridSetupEditor, {
        documentId: 'doc-1',
        title: 'Test setup',
        content: '{"value":1}',
        readOnly: false,
        onChange: handleChange,
      }),
    )

    await user.click(screen.getByRole('radio', { name: 'Raw JSON' }))

    const textarea = screen.getByLabelText('Test setup raw JSON')
    expect(textarea).toBeVisible()

    fireEvent.change(textarea, { target: { value: '{"value":2}' } })

    expect(handleChange).toHaveBeenLastCalledWith('{"value":2}')
  })

  it('explains that the ACC scaffold action only fills missing standard sections', () => {
    renderWithMantine(
      createElement(HybridSetupEditor, {
        documentId: 'doc-2',
        title: 'Test setup',
        content: serializeJsonObject({
          basicSetup: {
            strategy: {
              fuel: 42,
            },
          },
          customNote: 'keep me',
        }),
        readOnly: false,
        onChange: vi.fn(),
      }),
    )

    const button = screen.getAllByRole('button', { name: 'Add standard ACC fields' })[0]
    expect(button).toHaveAttribute(
      'title',
      'Adds standard ACC setup fields without changing any values already here.',
    )
  })
})

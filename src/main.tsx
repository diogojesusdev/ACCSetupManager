import { Suspense, StrictMode, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTheme, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './index.css'
import { StartupShell } from './StartupShell.tsx'
import { notifyFrontendReady } from './lib/tauri.ts'

const App = lazy(() => import('./App.tsx'))

function BootSplashHider() {
  useEffect(() => {
    const bootSplash = document.getElementById('boot-splash')
    void notifyFrontendReady()

    if (!bootSplash) {
      return undefined
    }

    bootSplash.classList.add('hidden')
    const timeoutId = window.setTimeout(() => {
      bootSplash.remove()
    }, 160)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  return null
}

const queryClient = new QueryClient()
const theme = createTheme({
  colors: {
    steel: [
      '#eef2f4',
      '#d8dfe4',
      '#c2cbd2',
      '#aab6bf',
      '#93a1ab',
      '#798892',
      '#62707a',
      '#4c5861',
      '#363f46',
      '#20262b',
    ],
  },
  primaryColor: 'steel',
  defaultRadius: 'md',
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  headings: {
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: '700',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <BootSplashHider />
        <Notifications position="top-right" />
        <Suspense fallback={<StartupShell />}>
          <App />
        </Suspense>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
)

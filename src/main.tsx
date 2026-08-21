import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTheme, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import App from './App.tsx'
import './index.css'

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
        <Notifications position="top-right" />
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
)

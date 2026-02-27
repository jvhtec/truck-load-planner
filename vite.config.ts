import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(() => {
  const configuredBase = process.env.VITE_BASE_PATH || '/'
  const normalizedBase = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`

  return {
    base: normalizedBase,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@core': path.resolve(__dirname, './src/core'),
      },
    },
  }
})

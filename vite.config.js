import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { readFileSync, existsSync } from 'fs'

function getAppVersion(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.VITE_APP_VERSION) return env.VITE_APP_VERSION

  const envBuildPath = path.resolve(__dirname, '.env.build')
  if (existsSync(envBuildPath)) {
    const match = readFileSync(envBuildPath, 'utf8').match(/VITE_APP_VERSION=(.+)/)
    if (match) return match[1].trim()
  }

  const versionJsonPath = path.resolve(__dirname, 'public/version.json')
  if (existsSync(versionJsonPath)) {
    try {
      return JSON.parse(readFileSync(versionJsonPath, 'utf8')).version
    } catch { /* fall through */ }
  }

  return '1.0.0'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion(mode)),
  },
  optimizeDeps: {
    force: true
  }
}));

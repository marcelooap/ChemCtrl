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
      '@industrializacao': path.resolve(__dirname, './src/modules/industrializacao'),
      '@transbordo': path.resolve(__dirname, './src/modules/transbordo'),
      '@painel': path.resolve(__dirname, './src/modules/painel'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion(mode)),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('jspdf')) return 'pdf'
          if (id.includes('exceljs')) return 'excel'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('date-fns') || id.includes('moment')) return 'dates'
          if (id.includes('@radix-ui') || id.includes('lucide-react')) return 'ui'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  optimizeDeps: {
    // force:true removido — rebundle a cada start era custo permanente
  },
}));

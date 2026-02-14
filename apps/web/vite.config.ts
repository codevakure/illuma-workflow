import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Node.js module shims for server-side code bundled in browser
      { find: /^crypto$/, replacement: path.resolve(__dirname, './src/shims/node-crypto.ts') },
      { find: /^zlib$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^dns$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^util$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^http$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^https$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^net$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^os$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^stream$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^events$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^buffer$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^tls$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^querystring$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^child_process$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^fs$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      { find: /^fs\/promises$/, replacement: path.resolve(__dirname, './src/shims/node-stubs.ts') },
      // Next.js shims - must come before @/ catch-all
      { find: 'next/navigation', replacement: path.resolve(__dirname, './src/shims/next-navigation.ts') },
      { find: 'next/image', replacement: path.resolve(__dirname, './src/shims/next-image.tsx') },
      { find: 'next/link', replacement: path.resolve(__dirname, './src/shims/next-link.tsx') },
      // Local packages (formerly workspace packages)
      { find: '@sim/logger', replacement: path.resolve(__dirname, './src/lib/logger.ts') },
      { find: '@sim-v2/shared', replacement: path.resolve(__dirname, './src/shared/index.ts') },
      // Map Next.js dynamic route paths BEFORE @/ catch-all
      // These use regex to match the literal [workspaceId] and [workflowId] segments
      { find: /^@\/app\/workspace\/\[workspaceId\]\/w\/\[workflowId\]\/(.*)/, replacement: path.resolve(__dirname, './src/app/workflow/$1') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/w\/\[workflowId\]$/, replacement: path.resolve(__dirname, './src/app/workflow') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/providers\/(.*)/, replacement: path.resolve(__dirname, './src/app/workspace/providers/$1') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/utils\/(.*)/, replacement: path.resolve(__dirname, './src/app/workspace/utils/$1') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/w\/components\/(.*)/, replacement: path.resolve(__dirname, './src/app/workspace/w/components/$1') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/w\/hooks$/, replacement: path.resolve(__dirname, './src/app/workspace/w/hooks') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/w\/hooks\/(.*)/, replacement: path.resolve(__dirname, './src/app/workspace/w/hooks/$1') },
      { find: /^@\/app\/workspace\/\[workspaceId\]\/logs\/(.*)/, replacement: path.resolve(__dirname, './src/app/workspace/logs/$1') },
      { find: /^@\/app\/_styles\/fonts\/(.*)/, replacement: path.resolve(__dirname, './src/styles/fonts/$1') },
      // @/ catch-all - must be LAST
      { find: /^@\//, replacement: path.resolve(__dirname, './src') + '/' },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to the backend during development
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  css: {
    postcss: './postcss.config.mjs',
  },
})

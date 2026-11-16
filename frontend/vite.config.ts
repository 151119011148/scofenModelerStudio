import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地联调时后端常跑在 18099 等端口，用 SCOFEN_API 覆盖即可，不必改配置文件。
// 这里不用 process.env：前端工程没装 @types/node，直接写会过不了 tsc。
const apiTarget =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCOFEN_API
  ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../scofen-web/src/main/resources/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: apiTarget, ws: true },
    },
  },
})

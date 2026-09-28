import { defineConfig } from '@playwright/test'

// Pruebas end-to-end: abren la app Electron real (compilada en out/) y la usan como un usuario.
// Ejecutar con: npm run test:e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']]
})

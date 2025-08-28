import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev, you can point this to your deployed API later if needed
      // '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist'
  }
})

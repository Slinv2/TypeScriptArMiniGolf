import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required so WebXR / camera access works on real devices in the LAN.
// On localhost a secure context already exists, but phones/headsets need TLS.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    https: true,
    port: 5173
  },
  // AR.js gemeinsam mit three vorbündeln, damit nur EINE three.js-Instanz existiert
  optimizeDeps: {
    include: ['three', '@ar-js-org/ar.js/three.js/build/ar-threex.mjs', '@mediapipe/tasks-vision']
  },
  resolve: {
    dedupe: ['three']
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000
  }
});

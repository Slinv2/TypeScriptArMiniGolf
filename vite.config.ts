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
  build: {
    target: 'es2020'
  }
});

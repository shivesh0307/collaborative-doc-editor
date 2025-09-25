import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:80',
        ws: true,
        changeOrigin: true,
        timeout: 0, // No timeout for WebSocket connections
        proxyTimeout: 0,
        secure: false,
        followRedirects: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
              // Silently ignore EPIPE and ECONNRESET errors for WebSocket
              return;
            }
            console.log('WebSocket proxy error:', err.code, err.message);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            socket.on('error', (err) => {
              if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
                return; // Silently ignore these common WebSocket errors
              }
              console.log('WebSocket socket error:', err.code, err.message);
            });
          });
        },
      },
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
        timeout: 30000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
              console.log('API connection reset (normal)');
              return;
            }
            console.log('API proxy error:', err.code, err.message);
          });
        },
      }
    }
  }
})

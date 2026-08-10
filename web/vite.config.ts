import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import mkcert from 'vite-plugin-mkcert';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    mkcert(),
  ],
  server: {
    host: true,
    // Object form required by Vite 8 ServerOptions; mkcert still injects the cert.
    https: {},
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws/recording': { target: 'ws://localhost:3002', ws: true },
      '/ws/signaling': { target: 'ws://localhost:3001', ws: true },
    },
  },
});

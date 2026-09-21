import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['Qash.png'],
      manifest: {
        id: '/pos/',
        name: 'Q-SHOP',
        short_name: 'Q-SHOP',
        description: 'Shop point-of-sale terminal — process sales, manage stock, track performance.',
        theme_color: '#06b6d4',
        background_color: '#080c12',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/pos/',
        start_url: '/pos',
        icons: [
          { src: 'Qash.png', sizes: '192x192',  type: 'image/png', purpose: 'any' },
          { src: 'Qash.png', sizes: '512x512',  type: 'image/png', purpose: 'any' },
          { src: 'Qash.png', sizes: '1254x1254', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        disableDevLogs: true,
        navigateFallback: '/pos/index.html',
        navigateFallbackAllowlist: [/^\/pos/],
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/(rest|auth|storage)\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 60, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],

  // ── Top-level Vite options ──────────────────────────────────────────
  server: {
    host: true,                  // listen on 0.0.0.0 — reachable via LAN IP
    port: 5173,
    strictPort: true,            // fail loudly if 5173 is taken
    allowedHosts: [
      '.trycloudflare.com',      // any Cloudflare quick tunnel
      '.ngrok-free.app',         // any ngrok subdomain
      '.loca.lt',                // localtunnel
      '.local',                  // mDNS / bonjour names
      'owners.qashup.co.ke',     // production domain (for PWA testing)
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
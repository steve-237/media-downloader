import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx, defineManifest } from '@crxjs/vite-plugin'

const manifest = defineManifest({
  manifest_version: 3,
  name: "Media Downloader Pro",
  version: "1.0.0",
  description: "Detect and download media files from any webpage easily.",
  action: {
    default_popup: "index.html"
  },
  permissions: [
    "activeTab",
    "scripting",
    "downloads"
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"]
    }
  ]
})

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    crx({ manifest }),
  ],
})

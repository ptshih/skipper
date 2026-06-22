/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PUBLIC, HTTP-referrer-restricted Google Maps JS browser key, baked into the client bundle at
   *  build (dev: apps/admin/client/.env.development.local; prod: cloudbuild.admin.yaml --build-arg).
   *  The ONLY consumer is components/ui/google-map.tsx. Not a secret — it's referrer-locked. */
  readonly VITE_GOOGLE_MAPS_BROWSER_KEY?: string
  /** Cloud Map ID for AdvancedMarkers (GCP console → Map Management → Create Map ID, raster). Optional:
   *  google-map.tsx falls back to Google's DEMO_MAP_ID (works everywhere but watermarked "for
   *  development"). Baked at build like the browser key above. */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

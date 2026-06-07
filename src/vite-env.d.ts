/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_BETTERSTACK_SOURCE_TOKEN: string;
  readonly VITE_BETTERSTACK_SOURCE_ID: string;
  readonly VITE_AI_SIDECAR_URL?: string;
  readonly VITE_GROQ_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

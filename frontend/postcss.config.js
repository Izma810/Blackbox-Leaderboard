import { fileURLToPath } from 'node:url'

export default {
  plugins: {
    // Explicit path so Tailwind finds its config even when Vite is started
    // from outside the frontend folder (Tailwind otherwise looks in the cwd)
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) },
    autoprefixer: {},
  },
}

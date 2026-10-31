import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { analyserVersionsPlugin } from './scripts/analyser-versions.ts';
import { libraryPlugin } from './scripts/library-plugin.ts';

// BASE_PATH is set by the GitHub Pages workflow to "/<repo-name>/".
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), libraryPlugin({ dir: 'library' }), analyserVersionsPlugin()],
});

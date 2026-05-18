import { defineConfig } from 'vite';

// Relative base so the built app works on GitHub Pages project sites
// (served from /Vacation_Planner/) as well as any other static host.
export default defineConfig({
  base: './'
});

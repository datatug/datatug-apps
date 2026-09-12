import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://incidentius.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  outDir: './dist',
  integrations: [sitemap()],
});

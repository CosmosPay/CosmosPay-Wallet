import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cosmos.wallet',
  appName: 'Cosmos Wallet',
  // Astro builds the static site into dist/web/ — Capacitor packages that folder.
  webDir: 'dist/web',
  backgroundColor: '#080808',
  android: {
    backgroundColor: '#080808',
  },
  ios: {
    backgroundColor: '#080808',
    contentInset: 'always',
  },
};

export default config;

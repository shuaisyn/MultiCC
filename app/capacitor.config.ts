import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.webcc.app',
  appName: 'WebCC',
  webDir: 'www',
  server: {
    // Allow navigation to any server URL (user's self-hosted server)
    allowNavigation: ['*'],
  },
  ios: {
    allowsLinkPreview: false,
    contentInset: 'always',
    scrollEnabled: true,
    // Allow inline media playback (for voice notifications)
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: true,
    // Keep WebView active when app goes to background briefly
    webContentsDebuggingEnabled: true,
  },
};

export default config;

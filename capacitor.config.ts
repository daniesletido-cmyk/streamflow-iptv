import type { CapacitorConfig } from '@capacitor/cli';

/**
 * StreamFlow IPTV - Capacitor Configuration
 * Dual Strategy:
 * 1. Default: Points to live Vercel production deployment (instant over-the-air updates & active backend proxy)
 * 2. Local packaging: If CAPACITOR_LOCAL_BUNDLE=true, packages static public/ bundle.
 */
const isLocalBundle = process.env.CAPACITOR_LOCAL_BUNDLE === 'true';

const config: CapacitorConfig = {
  appId: 'com.streamflow.iptv',
  appName: 'StreamFlow IPTV',
  webDir: 'public',
  server: isLocalBundle
    ? {
        cleartext: true,
        androidScheme: 'https'
      }
    : {
        url: 'https://streamflow-iptv-eta.vercel.app',
        cleartext: true,
        allowNavigation: [
          'streamflow-iptv-eta.vercel.app',
          '*.vercel.app',
          '81.31.194.120',
          '*.sbs',
          '*.net',
          '*'
        ]
      },
  ios: {
    contentInset: 'always',
    allowsLinkPreview: false,
    scrollEnabled: true,
    backgroundColor: '#090b0f',
    // Allows inline video and audio streaming without requiring full-screen hijack
    allowsInlineMediaPlayback: true,
    preferredContentMode: 'mobile'
  },
  plugins: {
    // Routes HTTP requests through iOS native NSURLSession engine,
    // avoiding webview CORS and Mixed-Content restrictions completely.
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;

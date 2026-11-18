import type { CapacitorConfig } from '@capacitor/cli';

/**
 * StreamFlow IPTV - Native Capacitor Configuration for iOS / iPadOS
 * Features:
 * - Direct production Vercel cloud synchronization
 * - allowsInlineMediaPlayback: true for seamless video streaming & autoplay
 * - CapacitorHttp: true to route network calls through iOS native NSURLSession (bypassing CORS & Mixed Content)
 */
const config: CapacitorConfig = {
  appId: 'com.streamflow.iptv',
  appName: 'StreamFlow IPTV',
  webDir: 'public',
  server: {
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
    allowsInlineMediaPlayback: true,
    preferredContentMode: 'mobile'
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');

// Keep global reference of window to avoid garbage collection
let mainWindow = null;
let localServer = null;
const PORT = process.env.PORT || 3000;
const LOCAL_URL = `http://localhost:${PORT}`;
const CLOUD_URL = 'https://streamflow-iptv-eta.vercel.app';

function checkServerReady(url, maxAttempts = 20, intervalMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http.get(`${url}/api/info`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (attempts >= maxAttempts) {
          resolve(false);
        } else {
          setTimeout(check, intervalMs);
        }
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          resolve(false);
        } else {
          setTimeout(check, intervalMs);
        }
      });
    };
    check();
  });
}

function startBackendServer() {
  try {
    // Import and start Express app internally
    const expressApp = require('../server.js');
    if (expressApp && typeof expressApp.listen === 'function') {
      localServer = expressApp.listen(PORT, '0.0.0.0', () => {
        console.log(`[StreamFlow Electron] Servidor local iniciado en ${LOCAL_URL}`);
      });
      localServer.on('error', (err) => {
        console.warn(`[StreamFlow Electron] Servidor local ya en ejecución o puerto ocupado: ${err.message}`);
      });
    }
  } catch (err) {
    console.warn(`[StreamFlow Electron] No se pudo arrancar server.js directamente: ${err.message}`);
  }
}

async function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#090b0f',
    title: 'StreamFlow IPTV — Televisión y Cine',
    icon: path.join(__dirname, '../public/icons/icon-192.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows streaming directly without CORS blocking
      allowRunningInsecureContent: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Start internal server
  startBackendServer();

  // Wait for server or fallback to cloud URL
  const isLocalReady = await checkServerReady(LOCAL_URL, 15, 300);
  const targetUrl = isLocalReady ? LOCAL_URL : CLOUD_URL;
  console.log(`[StreamFlow Electron] Cargando interfaz desde: ${targetUrl}`);

  mainWindow.loadURL(targetUrl);

  // Keyboard Shortcuts: F11 Fullscreen, Esc exit Fullscreen, F5 Reload
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && input.type === 'keyDown' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    } else if (input.key === 'F5' && input.type === 'keyDown') {
      mainWindow.reload();
      event.preventDefault();
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (localServer) {
    try { localServer.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

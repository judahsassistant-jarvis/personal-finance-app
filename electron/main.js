const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

const isDev = !app.isPackaged;
const SERVER_PORT = 3001;

function startServer() {
  const serverPath = isDev
    ? path.join(__dirname, '..', 'server', 'src', 'index.js')
    : path.join(process.resourcesPath, 'server', 'src', 'index.js');

  const clientDistPath = isDev
    ? path.join(__dirname, '..', 'client', 'dist')
    : path.join(process.resourcesPath, 'client', 'dist');

  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      NODE_ENV: 'production',
      ELECTRON: '1',
      CLIENT_DIST_PATH: clientDistPath,
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });

  // Wait for server to be ready
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 30;
    const check = () => {
      attempts++;
      if (attempts > maxAttempts) {
        reject(new Error('Server failed to start within 15 seconds'));
        return;
      }
      fetch(`http://localhost:${SERVER_PORT}/api/health`)
        .then((res) => {
          if (res.ok) resolve();
          else setTimeout(check, 500);
        })
        .catch(() => setTimeout(check, 500));
    };
    setTimeout(check, 1000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Personal Finance App',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // In dev, load from Vite dev server (which proxies /api to Express)
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, Express serves both API and static files
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    console.log('Starting server...');
    await startServer();
    console.log('Server ready, creating window...');
    createWindow();
  } catch (err) {
    console.error('Failed to start:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

#!/usr/bin/env node
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

/**
 * Check if a port is available on both 0.0.0.0 and 127.0.0.1
 */
function isPortAvailable(port) {
  const check = (host) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      try {
        server.listen(port, host);
      } catch {
        resolve(false);
      }
    });

  return Promise.all([check('0.0.0.0'), check('127.0.0.1')]).then(
    ([freeAll, freeLocal]) => freeAll && freeLocal,
  );
}

/**
 * Find the first available port starting from startPort
 */
async function findAvailablePort(startPort = 3000, maxAttempts = 30) {
  for (let p = startPort; p < startPort + maxAttempts; p++) {
    if (await isPortAvailable(p)) {
      return p;
    }
  }
  return startPort;
}

/**
 * Cross-platform open browser function
 */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {
    // Ignore browser open errors
  }
}

/**
 * Poll the server until it responds, then open the browser
 */
function waitForServerAndOpen(url, timeoutMs = 30000) {
  const start = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - start > timeoutMs) {
      clearInterval(timer);
      return;
    }

    const req = http.get(url, () => {
      clearInterval(timer);
      openBrowser(url);
    });

    req.on('error', () => {
      // Server not ready yet
    });

    req.setTimeout(800, () => req.destroy());
  }, 400);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const mode = rawArgs[0] === 'start' ? 'start' : 'dev';
  const remainingArgs = rawArgs.filter((arg, idx) => !(idx === 0 && (arg === 'dev' || arg === 'start')));

  const shouldOpen = remainingArgs.includes('--open') || process.env.OPEN_BROWSER === 'true';
  const filteredArgs = remainingArgs.filter((arg) => arg !== '--open');

  // Parse custom port from -p or --port if supplied
  let requestedPort = 3000;
  if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    if (!Number.isNaN(parsed) && parsed > 0) requestedPort = parsed;
  }

  const portIndex = filteredArgs.findIndex((a) => a === '-p' || a === '--port');
  if (portIndex !== -1 && filteredArgs[portIndex + 1]) {
    const parsed = parseInt(filteredArgs[portIndex + 1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      requestedPort = parsed;
      filteredArgs.splice(portIndex, 2);
    }
  }

  const selectedPort = await findAvailablePort(requestedPort);

  if (selectedPort !== requestedPort) {
    console.log('\n\x1b[33m%s\x1b[0m', '──────────────────────────────────────────────────────────');
    console.log('\x1b[1m\x1b[33m[TJOCR]\x1b[0m Порт %d занят другим приложением.', requestedPort);
    console.log('\x1b[1m\x1b[32m[TJOCR]\x1b[0m Автоматически выбран свободный порт: \x1b[1m%d\x1b[0m', selectedPort);
    console.log('\x1b[1m\x1b[36m[TJOCR]\x1b[0m URL приложения: \x1b[4mhttp://localhost:%d\x1b[0m', selectedPort);
    console.log('\x1b[33m%s\x1b[0m\n', '──────────────────────────────────────────────────────────');
  }

  const serverUrl = `http://localhost:${selectedPort}`;

  const env = {
    ...process.env,
    PORT: String(selectedPort),
  };

  // Only override NEXT_PUBLIC_APP_URL if not explicitly configured to an external domain
  if (!process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL.includes('localhost') || process.env.NEXT_PUBLIC_APP_URL.includes('127.0.0.1')) {
    env.NEXT_PUBLIC_APP_URL = serverUrl;
  }

  if (shouldOpen) {
    waitForServerAndOpen(serverUrl);
  }

  const nextArgs = [nextBin, mode, '-p', String(selectedPort), ...filteredArgs];

  const child = spawn(process.execPath, nextArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });

  const handleSignal = (signal) => {
    if (child.pid) {
      try {
        child.kill(signal);
      } catch {
        // Child already dead
      }
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main().catch((err) => {
  console.error('[TJOCR Server Error]:', err);
  process.exit(1);
});

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'LastroBrowserLauncher');
const stateFile = path.join(stateDirectory, 'session.txt');
const launchId = (process.argv[2] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
if (!launchId) process.exit(2);

const readyFile = path.join(stateDirectory, `ready-${launchId}.txt`);
const errorFile = path.join(stateDirectory, `error-${launchId}.txt`);
fs.mkdirSync(stateDirectory, { recursive: true });

function writeLines(filename, lines) {
  fs.writeFileSync(filename, `${lines.join('\r\n')}\r\n`, { encoding: 'utf8' });
}

async function openExistingSession() {
  if (!fs.existsSync(stateFile)) return false;
  const [url, token] = fs.readFileSync(stateFile, 'utf8').split(/\r?\n/);
  if (!url || !token) return false;
  try {
    const response = await fetch(`${url}/api/launcher/ping`, {
      headers: { 'X-Lastro-Launcher-Token': token },
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return false;
    writeLines(readyFile, [url, token]);
    return true;
  } catch {
    return false;
  }
}

try {
  if (await openExistingSession()) process.exit(0);
  fs.rmSync(stateFile, { force: true });

  const token = randomBytes(32).toString('hex');
  process.env.LASTRO_BROWSER_LAUNCHER_TOKEN = token;
  const appDataDirectory = process.env.APPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  process.env.LASTRO_DB_PATH ||= path.join(
    appDataDirectory,
    'controle-rendimentos-investimentos',
    'rendimentos.db'
  );

  const { startServer } = await import('../server.js');
  const { server, url } = await startServer(3000, '127.0.0.1');
  writeLines(stateFile, [url, token]);
  writeLines(readyFile, [url, token]);

  const removeSession = () => {
    try {
      const [savedUrl, savedToken] = fs.readFileSync(stateFile, 'utf8').split(/\r?\n/);
      if (savedUrl === url && savedToken === token) fs.rmSync(stateFile, { force: true });
    } catch {}
  };
  server.once('close', removeSession);
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
} catch (error) {
  writeLines(errorFile, [error.message || 'Não foi possível iniciar o Lastro.']);
}

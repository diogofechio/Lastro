import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [tool, ...args] = process.argv.slice(2);
if (!tool) throw new Error('Informe o comando a executar.');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const cliPath = resolve('node_modules', tool, 'cli.js');
const child = spawn(process.execPath, [cliPath, ...args], {
  env,
  stdio: 'inherit'
});

child.once('error', error => {
  console.error(`Não foi possível iniciar ${tool}:`, error.message);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

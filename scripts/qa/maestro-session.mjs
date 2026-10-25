#!/usr/bin/env node
// Persistent local Maestro MCP connection. No application state is edited directly.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, chmod, readFile, writeFile, unlink, stat, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const socket = resolve(opt('--socket', '/private/tmp/hledger-qa-full/maestro.sock'));
if (!socket.startsWith('/private/tmp/hledger-qa-full/')) throw Error('Use a socket inside the dedicated QA directory');
const timeout = Number(opt('--timeout-ms', '180000'));
if (!Number.isSafeInteger(timeout) || timeout < 1000) throw Error('Invalid timeout');

if (command === 'serve') {
  await mkdir(dirname(socket), { recursive: true, mode: 0o700 });
  try { await stat(socket); throw Error('Socket exists; stop its owner before starting another session'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const binary = opt('--maestro', process.env.MAESTRO_BIN || 'maestro');
  const secrets = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--token-file') {
    const tokenPath = args[++i];
    const info = await lstat(tokenPath);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600) {
      throw Error('Token file must be a regular non-symlink file with mode 0600');
    }
    secrets.push((await readFile(tokenPath, 'utf8')).trim());
  }
  const redact = value => secrets.reduce((s, secret) => secret ? s.split(secret).join('[REDACTED]') : s, value);
  const child = spawn(binary, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const pending = new Map(); let nextId = 0, buffer = '', stopped = false, uncertain = false, errorBuffer = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => {
    errorBuffer += data;
    while (errorBuffer.includes('\n')) {
      const newline = errorBuffer.indexOf('\n'); process.stderr.write(redact(errorBuffer.slice(0, newline + 1))); errorBuffer = errorBuffer.slice(newline + 1);
    }
  });
  child.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n'), line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolveReply, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { uncertain = true; pending.delete(id); reject(Error('Maestro RPC timed out; stop this session and audit before retrying any mutation')); }, timeout);
    pending.set(id, { resolve: resolveReply, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  child.on('error', error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); });
  child.on('exit', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Maestro MCP exited')); } pending.clear(); });
  const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hledger-native-qa', version: '1' } });
  if (initialized.error) throw Error('Maestro initialization failed');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  let busy = false;
  const server = net.createServer(connection => {
    let input = ''; connection.setEncoding('utf8');
    connection.on('data', async data => {
      input += data; if (!input.includes('\n')) return;
      connection.removeAllListeners('data');
      const respond = value => connection.end(redact(JSON.stringify(value)) + '\n');
      if (busy) { respond({ error: 'Another Maestro request is active; device operations must be serial' }); return; }
      busy = true;
      try {
        const request = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (request.method === 'shutdown') { respond({ stopped: true }); await stop(); return; }
        if (uncertain) throw Error('Session had a timed-out request; only shutdown is allowed until its effects are audited');
        if (!['tools/list', 'tools/call'].includes(request.method)) throw Error('Only tools/list or tools/call are supported');
        const reply = await rpc(request.method, request.params);
        if (reply.result) reply.result = JSON.parse(redact(JSON.stringify(reply.result)));
        respond(reply);
      } catch (error) { respond({ error: error.message }); }
      finally { busy = false; }
    });
  });
  async function stop() {
    if (stopped) return; stopped = true;
    server.close(); child.kill('SIGTERM'); await unlink(socket).catch(() => {});
  }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
  server.listen(socket, async () => { await chmod(socket, 0o600); process.stdout.write(JSON.stringify({ ready: true, socket, maestroPid: child.pid }) + '\n'); });
} else if (['list', 'call', 'stop'].includes(command)) {
  const paramsFile = opt('--params', null);
  const tool = opt('--tool', null);
  if (command === 'call' && !tool) throw Error('--tool is required; discover its schema with list');
  const parameters = paramsFile ? JSON.parse(await readFile(paramsFile, 'utf8')) : {};
  const request = command === 'stop' ? { method: 'shutdown' } : command === 'list' ? { method: 'tools/list', params: {} } : { method: 'tools/call', params: { name: tool, arguments: parameters } };
  const reply = await new Promise((resolveReply, reject) => {
    const client = net.createConnection(socket); let response = '';
    client.setEncoding('utf8'); client.setTimeout(timeout + 5000, () => client.destroy(Error('Bridge timeout; do not blindly retry a write')));
    client.on('connect', () => client.write(JSON.stringify(request) + '\n'));
    client.on('data', data => { response += data; });
    client.on('error', reject); client.on('end', () => { try { resolveReply(JSON.parse(response)); } catch (e) { reject(e); } });
  });
  const output = opt('--output', null);
  if (output) {
    const base = resolve(output); await mkdir(base, { recursive: true, mode: 0o700 });
    let imageCount = 0;
    for (const block of reply.result?.content || []) {
      if (block.type === 'image' && typeof block.data === 'string') {
        const path = `${base}/image-${++imageCount}.${block.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
        await writeFile(path, Buffer.from(block.data, 'base64'), { mode: 0o600 }); delete block.data; block.path = path;
      }
    }
    await writeFile(`${base}/reply.json`, JSON.stringify(reply, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({ output: base, images: imageCount, error: Boolean(reply.error || reply.result?.isError) }) + '\n');
  } else process.stdout.write(JSON.stringify(reply) + '\n');
  if (reply.error || reply.result?.isError) process.exitCode = 1;
} else {
  process.stdout.write('serve --maestro BIN [--token-file FILE ...] | list | call --tool NAME --params JSON_FILE --output DIR | stop\nAll commands accept --socket /private/tmp/hledger-qa-full/NAME.sock and --timeout-ms. Never retry a timed-out write without auditing its request key.\n');
}

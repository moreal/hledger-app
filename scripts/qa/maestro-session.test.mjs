import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, chmod, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';

test('bridge rejects readable-by-others and symlink token files before launching Maestro', async () => {
  const root = await mkdtemp('/private/tmp/hledger-qa-full/bridge-token-test-');
  await writeFile(`${root}/public`, 'synthetic-secret', { mode: 0o644 });
  await chmod(`${root}/public`, 0o644);
  await writeFile(`${root}/private`, 'synthetic-secret', { mode: 0o600 });
  await symlink(`${root}/private`, `${root}/link`);
  for (const name of ['public', 'link']) {
    const result = await new Promise((resolveResult) => {
      const child = spawn(process.execPath, [
        resolve('scripts/qa/maestro-session.mjs'),
        'serve',
        '--socket',
        `${root}/${name}.sock`,
        '--maestro',
        '/nonexistent-maestro',
        '--token-file',
        `${root}/${name}`,
      ]);
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('close', (code) => resolveResult({ code, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Token file must be a regular non-symlink file with mode 0600/);
    assert.ok(!result.stderr.includes('synthetic-secret'));
  }
});

test('persistent bridge reuses MCP process, redacts tokens and saves image evidence', async () => {
  await mkdir('/private/tmp/hledger-qa-full', { recursive: true });
  const root = await mkdtemp('/private/tmp/hledger-qa-full/bridge-test-');
  const socket = `${root}/session.sock`,
    script = resolve('scripts/qa/maestro-session.mjs');
  const mock = `${root}/mock-maestro.mjs`,
    secret = 'synthetic-bridge-test-token';
  await writeFile(`${root}/token`, secret, { mode: 0o600 });
  await writeFile(
    mock,
    `#!/usr/bin/env node
import readline from 'node:readline';
let calls = 0;
for await (const line of readline.createInterface({input:process.stdin})) {
 const r=JSON.parse(line); if(r.id===undefined || r.params?.name==='stall')continue;
 const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mock',version:'1'}}:r.method==='tools/list'?{tools:[{name:'proof',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'${secret} 한글 '+(++calls)},{type:'image',mimeType:'image/png',data:'aW1hZ2U='}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
}
`,
  );
  await chmod(mock, 0o700);
  const server = spawn(
    process.execPath,
    [
      script,
      'serve',
      '--socket',
      socket,
      '--maestro',
      mock,
      '--token-file',
      `${root}/token`,
      '--timeout-ms',
      '1000',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let errors = '';
  server.stderr.on('data', (d) => {
    errors += d;
  });
  const call = (...args) =>
    new Promise((resolveCall, reject) => {
      const child = spawn(process.execPath, [script, ...args, '--socket', socket], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('error', reject);
      child.on('close', (code) => resolveCall({ code, stdout, stderr }));
    });
  try {
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(Error(`No bridge startup: ${errors}`)), 10000);
      server.stdout.once('data', () => {
        clearTimeout(timer);
        ready();
      });
      server.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`Bridge exited ${code}: ${errors}`));
      });
    });
    assert.equal((await call('list')).code, 0);
    for (let count = 1; count <= 2; count++) {
      const out = `${root}/proof-${count}`;
      assert.equal((await call('call', '--tool', 'proof', '--output', out)).code, 0);
      const reply = JSON.parse(await readFile(`${out}/reply.json`, 'utf8'));
      assert.equal(reply.result.content[0].text, `[REDACTED] 한글 ${count}`);
      assert.equal(reply.result.content[1].data, undefined);
      assert.equal(await readFile(reply.result.content[1].path, 'utf8'), 'image');
    }
    assert.equal((await call('call', '--tool', 'stall')).code, 1);
    assert.equal((await call('list')).code, 1, 'uncertain session must reject subsequent requests');
    assert.equal((await call('stop')).code, 0);
  } finally {
    server.kill('SIGTERM');
  }
});

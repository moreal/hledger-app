import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { catalogContent, checkCatalogs, translationProblems } from './i18n-check.mjs';

const cli = fileURLToPath(new URL('lingui.js', import.meta.resolve('@lingui/cli')));
const po = (translation = 'Hello', flags = '') => `msgid ""\nmsgstr ""\n"Language: en\\n"\n\n${flags}#. js-lingui-explicit-id\nmsgid "greeting"\nmsgstr "${translation}"\n`;

async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(full));
    else result[full] = await readFile(full, 'utf8');
  }
  return result;
}

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lingui-check-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'src'));
  // Lingui's extractor recognizes the i18n marker preceding a descriptor.
  await writeFile(path.join(cwd, 'src/message.ts'), 'const greeting = /*i18n*/ {id: "greeting", message: "안녕"};\n');
  const configPath = path.join(cwd, 'lingui.config.mjs');
  await writeFile(configPath, `import {formatter} from ${JSON.stringify(import.meta.resolve('@lingui/format-po'))};\nexport default {rootDir:${JSON.stringify(cwd)}, sourceLocale:'ko', locales:['ko','en'], fallbackLocales:{default:'ko'}, catalogs:[{path:'<rootDir>/locales/{locale}/messages',include:['<rootDir>/src']}], format:formatter({lineNumbers:false}), compileNamespace:'es'};\n`);
  const run = (command) => {
    const result = spawnSync(process.execPath, [cli, command, '--config', configPath, ...(command === 'compile' ? ['--typescript', '--strict'] : [])], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  run('extract');
  const english = path.join(cwd, 'locales/en/messages.po');
  const extracted = await readFile(english, 'utf8');
  assert.match(extracted, /msgid "greeting"/);
  await writeFile(english, extracted.replace('msgid "greeting"\nmsgstr ""', 'msgid "greeting"\nmsgstr "Hello"'));
  run('compile');
  return { cwd, configPath, english, run };
}

test('semantic comparison ignores headers and reference line numbers', () => {
  assert.equal(catalogContent(po() + '\n'), catalogContent(po().replace('Language: en', 'Language: ko')));
  const referenced = po().replace('#. js-lingui', '#: src/a.ts:1\n#. js-lingui');
  assert.equal(catalogContent(referenced), catalogContent(referenced.replace(':1', ':45')));
  assert.notEqual(catalogContent(referenced), catalogContent(referenced.replace('src/a.ts', 'src/b.ts')));
  assert.notEqual(catalogContent(po()), catalogContent(po('Changed')));
  assert.equal(translationProblems(po('   '), 'en').length, 1);
  assert.equal(translationProblems(po('Hello', '#, fuzzy\n'), 'en').length, 1);
});

test('passes current catalogs and detects stale compiled output without mutation', async (t) => {
  const options = await fixture(t);
  const before = await snapshot(options.cwd);
  await checkCatalogs(options);
  assert.deepEqual(await snapshot(options.cwd), before);
  const compiled = options.english.replace('.po', '.ts');
  await writeFile(compiled, 'stale');
  const stale = await snapshot(options.cwd);
  await assert.rejects(checkCatalogs(options), /Stale compiled catalog/);
  assert.deepEqual(await snapshot(options.cwd), stale);
});

test('detects stale extracted catalogs without mutation', async (t) => {
  const options = await fixture(t);
  await writeFile(path.join(options.cwd, 'src/message.ts'), 'const greeting = /*i18n*/ {id: "new", message: "새 메시지"};\n');
  const before = await snapshot(options.cwd);
  await assert.rejects(checkCatalogs(options), /Stale extracted catalog/);
  assert.deepEqual(await snapshot(options.cwd), before);
});

test('rejects blank and fuzzy English even though strict compile accepts Korean fallback', async (t) => {
  const options = await fixture(t);
  const original = await readFile(options.english, 'utf8');
  for (const replacement of ['msgstr ""', '#, fuzzy\nmsgstr "Hello"']) {
    await writeFile(options.english, original.replace('msgstr "Hello"', replacement));
    options.run('compile');
    const before = await snapshot(options.cwd);
    await assert.rejects(checkCatalogs(options), /en: greeting \((missing|fuzzy) translation\)/);
    assert.deepEqual(await snapshot(options.cwd), before);
  }
});

test('project extraction includes native and web UI packages and production interpolates transaction labels', async (t) => {
  const { getConfig } = await import('@lingui/conf');
  const { parsePoFile } = await import('@lingui/format-po');
  const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const project = getConfig({ cwd: repository });
  const cwd = await mkdtemp(path.join(tmpdir(), 'lingui-ui-production-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const directory of ['apps', 'packages/ui-native/src', 'packages/ui-web/src', 'packages/i18n/src']) await mkdir(path.join(cwd, directory), { recursive: true });
  await writeFile(path.join(cwd, 'packages/ui-native/src/index.tsx'), `
const date = /* i18n */ {id:'ui.transactions.dateAndStatus',message:'{date} · {status}'};
const row = /* i18n */ {id:'ui.transactions.accessibleRow',message:'{date}, {description}, {status}, {amount}, 거래 상세 보기'};
`);
  await writeFile(path.join(cwd, 'packages/ui-web/src/index.tsx'), `const label = /* i18n */ {id:'web.ui.coverage',message:'웹 UI'};\n`);
  const catalogs = project.catalogs.map(catalog => ({ ...catalog, path: '<rootDir>/locales/{locale}/messages', include: catalog.include.map(include => include.replace(project.rootDir, '<rootDir>')) }));
  const configPath = path.join(cwd, 'lingui.config.mjs');
  await writeFile(configPath, `import {formatter} from ${JSON.stringify(import.meta.resolve('@lingui/format-po'))};\nexport default {rootDir:${JSON.stringify(cwd)},sourceLocale:'ko',locales:['ko'],catalogs:${JSON.stringify(catalogs)},format:formatter({lineNumbers:false}),compileNamespace:'es'};\n`);
  for (const command of ['extract', 'compile']) {
    const result = spawnSync(process.execPath, [cli, command, '--config', configPath, ...(command === 'compile' ? ['--typescript', '--strict'] : [])], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (command === 'extract') {
      const ids = parsePoFile(await readFile(path.join(cwd, 'locales/ko/messages.po'), 'utf8')).items.filter(item => !item.obsolete).map(item => item.msgid);
      for (const id of ['ui.transactions.dateAndStatus', 'ui.transactions.accessibleRow', 'web.ui.coverage']) assert.ok(ids.includes(id), `Project extraction omitted ${id}`);
    }
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {setupI18n} from ${JSON.stringify(import.meta.resolve('@lingui/core'))};
    import {messages} from ${JSON.stringify(path.join(cwd, 'locales/ko/messages.ts'))};
    const i18n = setupI18n({locale:'ko',messages:{ko:messages}});
    assert.equal(i18n._('ui.transactions.dateAndStatus',{date:'2026-10-25',status:'확인됨'}),'2026-10-25 · 확인됨');
    assert.equal(i18n._('ui.transactions.accessibleRow',{date:'2026-10-25',description:'QA',status:'확인됨',amount:'1 KRW'}),'2026-10-25, QA, 확인됨, 1 KRW, 거래 상세 보기');
  `], { cwd: repository, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

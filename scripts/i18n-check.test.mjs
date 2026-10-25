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

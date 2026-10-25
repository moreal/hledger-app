import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfig } from '@lingui/conf';
import { getCatalogs } from '@lingui/cli/api';
import { parsePoFile } from '@lingui/format-po';

const cli = fileURLToPath(new URL('lingui.js', import.meta.resolve('@lingui/cli')));

// Headers contain dates and tool versions, and reference line numbers change when
// unrelated code moves. Compare the catalog's actual extraction data instead.
export function catalogContent(content) {
  return JSON.stringify(parsePoFile(content).items.map((item) => ({
    id: item.msgid,
    context: item.msgctxt,
    plural: item.msgid_plural,
    translations: item.msgstr,
    obsolete: item.obsolete,
    flags: Object.keys(item.flags).filter((flag) => item.flags[flag]).sort(),
    comments: [...item.comments].sort(),
    extractedComments: [...item.extractedComments].sort(),
    references: [...new Set(item.references.map((ref) => ref.replace(/:\d+(?::\d+)?$/, '')))].sort(),
  })).sort((a, b) => JSON.stringify([a.id, a.context]).localeCompare(JSON.stringify([b.id, b.context]))));
}

export function translationProblems(content, locale) {
  return parsePoFile(content).items.filter((item) => !item.obsolete && (
    item.flags.fuzzy || !item.msgstr.length || item.msgstr.some((value) => !value.trim())
  )).map((item) => `${locale}: ${item.msgid} (${item.flags.fuzzy ? 'fuzzy translation' : 'missing translation'})`);
}

function run(command, configPath, cwd) {
  const result = spawnSync(process.execPath, [cli, command, '--config', configPath,
    ...(command === 'compile' ? ['--typescript', '--strict'] : [])], {
    cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Lingui ${command} failed:\n${result.stdout}${result.stderr}`);
}

/** Regenerate only inside a private temporary directory, including on failure. */
export async function checkCatalogs({ cwd = process.cwd(), configPath } = {}) {
  const config = getConfig({ cwd, ...(configPath ? { configPath } : {}) });
  const originalConfigPath = config.resolvedConfigPath;
  if (!originalConfigPath) throw new Error('Lingui config file could not be resolved');
  const catalogs = await getCatalogs(config);
  if (!catalogs.length) throw new Error('No Lingui catalogs are configured');
  const temporary = await mkdtemp(path.join(tmpdir(), 'hledger-i18n-check-'));
  try {
    const staged = catalogs.map((catalog, index) => ({
      path: path.join(temporary, String(index), '{locale}', 'messages'),
      include: catalog.include,
      exclude: catalog.exclude,
    }));
    const pairs = [];
    for (const [index, catalog] of catalogs.entries()) {
      for (const locale of config.locales) {
        const original = catalog.getFilename(locale);
        const target = `${staged[index].path.replaceAll('{locale}', locale)}.po`;
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(original, target);
        pairs.push({ locale, original, target });
      }
    }
    const stagedConfig = path.join(temporary, 'lingui.config.mjs');
    await writeFile(stagedConfig, `import { getConfig } from ${JSON.stringify(import.meta.resolve('@lingui/conf'))};\nconst config = getConfig({cwd: ${JSON.stringify(cwd)}, configPath: ${JSON.stringify(originalConfigPath)}});\nexport default {...config, rootDir: ${JSON.stringify(config.rootDir)}, catalogs: ${JSON.stringify(staged)}, catalogsMergePath: undefined};\n`);
    run('extract', stagedConfig, cwd);
    const problems = [];
    for (const { locale, original, target } of pairs) {
      const [before, extracted] = await Promise.all([readFile(original, 'utf8'), readFile(target, 'utf8')]);
      if (catalogContent(before) !== catalogContent(extracted)) problems.push(`Stale extracted catalog: ${original}`);
      // Check before compilation: fallbackLocales can otherwise hide missing or
      // fuzzy translations even with compile --strict.
      problems.push(...translationProblems(extracted, locale));
    }
    if (problems.length) throw new Error(problems.join('\n'));
    run('compile', stagedConfig, cwd);
    for (const { original, target } of pairs) {
      const compiled = original.replace(/\.po$/, '.ts');
      let before;
      try { before = await readFile(compiled, 'utf8'); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (before !== await readFile(target.replace(/\.po$/, '.ts'), 'utf8')) {
        problems.push(`Stale compiled catalog: ${compiled}`);
      }
    }
    if (problems.length) throw new Error(problems.join('\n'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  checkCatalogs({ configPath: configIndex >= 0 ? path.resolve(args[configIndex + 1]) : undefined })
    .then(() => console.log('Lingui catalogs and compiled messages are up to date.'))
    .catch((error) => { console.error(`i18n:check: ${error.message}\nRun yarn i18n:extract, complete translations, then yarn i18n:compile.`); process.exitCode = 1; });
}

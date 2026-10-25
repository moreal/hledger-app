#!/usr/bin/env node
// Validates report structure and evidence references, not the truth of manual observations.
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const iso = (value) =>
  nonblank(value) &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));
const statuses = ['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'N/A'];
async function main() {
  const args = process.argv.slice(2),
    file = args.shift(),
    options = {};
  if (!file || file.startsWith('--')) throw Error('report argument required');
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--allow-incomplete') {
      options[key] = true;
      continue;
    }
    if (
      !['--ci-run', '--app-sha', '--fixture-run', '--since'].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw Error('invalid CLI arguments');
    if (options[key] !== undefined) throw Error('duplicate CLI option');
    options[key] = args[++i];
  }
  for (const key of ['--ci-run', '--app-sha', '--fixture-run'])
    if (!nonblank(options[key])) throw Error('expected run metadata required');
  if (options['--since'] && !iso(options['--since'])) throw Error('invalid since timestamp');
  const checklist = await readFile(
    new URL('../../docs/qa/mobile-release-checklist.md', import.meta.url),
    'utf8',
  );
  const ids = [...checklist.matchAll(/^\| ([NBUW]\d{2}\.\d+) \|/gm)].map((m) => m[1]);
  if (ids.length !== 54 || new Set(ids).size !== 54)
    throw Error('checklist must contain 54 unique IDs');
  const report = JSON.parse(await readFile(file, 'utf8')),
    errors = [],
    seen = new Set(),
    counts = Object.fromEntries(statuses.map((s) => [s, 0]));
  if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!['ios', 'android'].includes(report.platform)) errors.push('platform must be ios or android');
  for (const [field, flag] of [
    ['ciRun', '--ci-run'],
    ['appSha', '--app-sha'],
    ['fixtureRun', '--fixture-run'],
  ]) {
    if (!nonblank(report[field]) || report[field] !== options[flag])
      errors.push(`${field} does not match expected metadata`);
  }
  if (!Array.isArray(report.results)) errors.push('results must be an array');
  for (const [index, row] of (Array.isArray(report.results) ? report.results : []).entries()) {
    const label = `row ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${label}: object required`);
      continue;
    }
    if (!ids.includes(row.id)) errors.push(`${label}: unknown ID`);
    else if (seen.has(row.id)) errors.push(`${label}: duplicate ID`);
    else seen.add(row.id);
    if (!statuses.includes(row.status)) errors.push(`${label}: invalid status`);
    else counts[row.status]++;
    if (!nonblank(row.observed ?? row.observation))
      errors.push(`${label}: observation or N/A reason required`);
    if (!nonblank(row.method)) errors.push(`${label}: method required`);
    if (!iso(row.executedAt)) errors.push(`${label}: valid executedAt required`);
    else if (options['--since'] && Date.parse(row.executedAt) < Date.parse(options['--since']))
      errors.push(`${label}: execution predates since`);
    if (!Array.isArray(row.evidence)) errors.push(`${label}: evidence array required`);
    else {
      if (['PASS', 'FAIL'].includes(row.status) && !row.evidence.length)
        errors.push(`${label}: PASS/FAIL evidence required`);
      for (const path of row.evidence) {
        if (!nonblank(path)) {
          errors.push(`${label}: invalid evidence path`);
          continue;
        }
        try {
          const info = await stat(resolve(dirname(resolve(file)), path));
          if (!info.isFile() || !info.size)
            errors.push(`${label}: evidence must be a nonempty file`);
        } catch {
          errors.push(`${label}: evidence file does not exist`);
        }
      }
    }
  }
  const missingCount = ids.filter((id) => !seen.has(id)).length;
  const complete =
    missingCount === 0 && counts.FAIL === 0 && counts.BLOCKED === 0 && counts.PENDING === 0;
  console.log(
    JSON.stringify({
      valid: errors.length === 0,
      complete,
      expectedCount: 54,
      coveredCount: seen.size,
      missingCount,
      counts,
      errors,
    }),
  );
  process.exitCode = errors.length || (!options['--allow-incomplete'] && !complete) ? 1 : 0;
}
main().catch(() => {
  console.log(
    JSON.stringify({
      valid: false,
      errors: ['Unable to validate report; check arguments, JSON and readable files'],
    }),
  );
  process.exitCode = 1;
});

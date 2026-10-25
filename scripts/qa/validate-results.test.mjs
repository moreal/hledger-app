import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const cli=new URL('./validate-results.mjs',import.meta.url);
const checklist=await readFile(new URL('../../docs/qa/mobile-release-checklist.md',import.meta.url),'utf8');
const ids=[...checklist.matchAll(/^\| ([NBUW]\d{2}\.\d+) \|/gm)].map(m=>m[1]);
async function run(change=()=>{},extra=[]){
 const dir=await mkdtemp(join(tmpdir(),'qa-validator-'));
 try{const evidence=join(dir,'screen.png');await writeFile(evidence,'fixture evidence');
 const report={schemaVersion:1,platform:'ios',ciRun:'123',appSha:'abc',fixtureRun:'fresh',results:ids.map(id=>({id,status:'PASS',observed:'Native screen confirmed',evidence:[evidence],executedAt:new Date().toISOString(),method:'native-manual'}))};
 change(report);const file=join(dir,'results.json');await writeFile(file,JSON.stringify(report));
 return spawnSync(process.execPath,[cli.pathname,file,'--ci-run','123','--app-sha','abc','--fixture-run','fresh',...extra],{encoding:'utf8'});
 }finally{await rm(dir,{recursive:true,force:true});}}
test('full54 fresh evidence succeeds',async()=>{assert.equal(ids.length,54);const r=await run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).counts.PASS,54);});
for(const [name,change] of [
 ['unknown ID',r=>{r.results[0].id='N99.1';}],['duplicate ID',r=>{r.results[1].id=r.results[0].id;}],
 ['missing evidence',r=>{r.results[0].evidence=['/nonexistent/qa-evidence'];}],['stale SHA',r=>{r.appSha='old';}],
 ['blank observation',r=>{r.results[0].observed=' ';}],['old execution',r=>{r.results[0].executedAt='2000-01-01T00:00:00Z';}],
 ['NA without reason',r=>{r.results[0].status='N/A';r.results[0].observed='';}],
 ])test(`rejects ${name}`,async()=>assert.equal((await run(change,['--since','2026-01-01T00:00:00Z'])).status,1));
test('strict missing rows fails; allow incomplete reports coverage',async()=>{assert.equal((await run(r=>r.results.pop())).status,1);const r=await run(r=>r.results.pop(),['--allow-incomplete']);assert.equal(r.status,0,r.stdout);assert.equal(JSON.parse(r.stdout).missingCount,1);});
test('FAIL gate can be inspected but malformed evidence never bypassed',async()=>{assert.equal((await run(r=>{r.results[0].status='FAIL';})).status,1);assert.equal((await run(r=>{r.results[0].status='FAIL';},['--allow-incomplete'])).status,0);assert.equal((await run(r=>{r.results[0].evidence=[];},['--allow-incomplete'])).status,1);});

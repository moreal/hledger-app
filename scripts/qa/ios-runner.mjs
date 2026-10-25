#!/usr/bin/env node
/** Local iOS UI evidence runner. A successful flow is not a checklist PASS.
 * Supply separate reviewed per-ID observations via --observations JSON.
 * Secrets must be injected at runtime, never committed in YAML.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2);
const option = (key, fallback) => { const i=args.indexOf(key); return i<0 ? fallback : args[i+1]; };
const defaultOutput=join('/private/tmp/hledger-qa-full/ios/automation',new Date().toISOString().replaceAll(':','-'));
const output=resolve(option('--output',defaultOutput));
const device=option('--device', process.env.IOS_DEVICE_ID);
const maestro=process.env.MAESTRO_BIN || 'maestro';
const endpoint=option('--endpoint',null);
const tokenFile=option('--token-file',null);
if (Boolean(endpoint) !== Boolean(tokenFile)) throw Error('--endpoint and --token-file must be supplied together');
const runtimeToken=tokenFile ? readFileSync(tokenFile,'utf8').trim() : null;
if (tokenFile && !runtimeToken) throw Error('Empty token file');
const redact=text => runtimeToken ? text.split(runtimeToken).join('[REDACTED]') : text;
function redactArtifacts(dir) {
 for (const item of readdirSync(dir,{withFileTypes:true})) {
   const path=join(dir,item.name);
   if(item.isDirectory())redactArtifacts(path);
   else if(/\.(json|log|xml|txt|html|yaml|yml)$/.test(item.name))writeFileSync(path,redact(readFileSync(path,'utf8')));
 }
}
const timeoutMs=Number(option('--timeout-ms','600000'));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw Error('Invalid --timeout-ms');
const ciRun=option('--ci-run',process.env.QA_CI_RUN);
const appSha=option('--app-sha',process.env.QA_APP_SHA);
const fixtureRun=option('--fixture-run',process.env.QA_FIXTURE_RUN);
if (!ciRun || !appSha || !fixtureRun) throw Error('Supply --ci-run, --app-sha and --fixture-run (or QA_* environment values)');
const source=readFileSync(resolve('docs/qa/mobile-release-checklist.md'),'utf8');
const ids=[...source.matchAll(/^\| ((?:N\d\d|B\d\d|U\d\d|W\d\d)\.\d+) \|/gm)].map(m=>m[1]);
if (ids.length !==54 || new Set(ids).size!==54) throw Error('Expected 54 unique checklist IDs');
mkdirSync(output,{recursive:true});
const since=option('--since',null);
if (since && !Number.isFinite(Date.parse(since))) throw Error('Invalid --since');
const observationsPath=option('--observations',null);
const observations=observationsPath ? JSON.parse(readFileSync(observationsPath,'utf8')) : {};
for (const id of Object.keys(observations)) if (!ids.includes(id)) throw Error(`Unknown checklist ID: ${id}`);
const flows=option('--flows','auth-navigation').split(',');
if (!args.includes('--report-only') && flows.some(flow=>['books-validation','writes-recovery'].includes(flow)) && !args.includes('--allow-draft')) throw Error('Expanded iOS books/write suites are unverified drafts; use --allow-draft only after reviewing selectors and fixture guards');
const readCase=option('--read-case','search');
const readQuery=option('--read-query','QA');
if(!['search','pagination'].includes(readCase) || !readQuery.trim() || readQuery.length>200) throw Error('Invalid read case/query');
const writeStage=option('--write-stage','general');
const caseName=option('--case','offline');
const runId=option('--run-id',null);
const writeStages=['core','general','buy','sell','books','prepare','retry','response-loss','response-retry','cleanup','template'];
if(!writeStages.includes(writeStage) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(caseName)) throw Error('Invalid write stage/case');
if(flows.includes('writes-recovery') && (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(runId))) throw Error('Write stages require explicit safe --run-id');
if (!args.includes('--report-only') && flows.some(flow=>['auth-navigation','read-filters','books-validation'].includes(flow)) && !runtimeToken) throw Error('Authenticated flows require --endpoint and --token-file');
let fixtureLedgerId=null;
if (!args.includes('--report-only') && flows.some(flow=>['auth-navigation','writes-recovery','books-validation','read-filters'].includes(flow))) {
  if (!runtimeToken || !/^[a-zA-Z0-9_-]+$/.test(fixtureRun)) throw Error('Fixture flow requires isolated fixture runtime credentials');
  const url=new URL(endpoint);
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port!=='4202' || url.pathname!=='/graphql') throw Error('Fixture flows only permit isolated iOS proxy4202');
  const fixtureRoot=join('/private/tmp/hledger-qa-full-fixture',fixtureRun);
  if (realpathSync(tokenFile)!==realpathSync(join(fixtureRoot,'ios/token'))) throw Error('Token must belong to this isolated fixture run');
  const manifest=JSON.parse(readFileSync(join(fixtureRoot,'manifest.json'),'utf8'));
  if(manifest.kind!=='hledger-synthetic-full-qa-v1'||manifest.name!==fixtureRun) throw Error('Unknown isolated fixture manifest');
  fixtureLedgerId=manifest.ledgers.ios;
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${runtimeToken}`},body:JSON.stringify({query:'{ health { status details } }'}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok || data.data?.health?.details?.ledgerId!==fixtureLedgerId) throw Error('Backend ledger identity does not match fixture');
  if(flows.includes('writes-recovery')) {
    const auditResponse=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${runtimeToken}`},body:JSON.stringify({query:'query($query:String!){ transactions(first:200,filter:{query:$query}){ edges{ node{ id description } } pageInfo{hasNextPage} } }',variables:{query:runId}}),signal:AbortSignal.timeout(10000)});
    const audit=await auditResponse.json();
    if(!auditResponse.ok || audit.errors || !audit.data?.transactions)throw Error('Write preflight audit failed');
    writeFileSync(join(output,'write-preflight.json'),JSON.stringify({runId,writeStage,caseName,ledgerId:fixtureLedgerId,checkedAt:new Date().toISOString(),matchingTransactions:audit.data.transactions},null,2));
    if(writeStage==='core' && audit.data.transactions.edges.length)throw Error('Existing run transactions found: inspect audit and resume a stage instead of replaying core');
    const suffix={general:'general',buy:'stock-buy',sell:'stock-sell'}[writeStage];
    if(suffix && audit.data.transactions.edges.some(edge=>edge.node.description===`${runId}-${suffix}`))throw Error('This write stage already committed: inspect its audit before another attempt');
  }
}
const runs=[];
if (!args.includes('--report-only')) {
  if(!device) throw Error('Set IOS_DEVICE_ID or --device explicitly');
  for(const flow of flows){
    if(!['auth-navigation','read-filters','books-validation','writes-recovery'].includes(flow)) throw Error('Unknown flow');
    const dir=join(output,flow); mkdirSync(dir,{recursive:true});
    const invocation=['test','-p','ios','--device',device,resolve(`.maestro/ios/${flow}.yaml`),'--format','JUNIT','--output',join(dir,'junit.xml'),'--test-output-dir',dir,'--debug-output',join(dir,'debug')];
    if(flow==='read-filters')invocation.push('-e',`QA_READ_CASE=${readCase}`,'-e',`QA_READ_QUERY=${readQuery}`,'-e',`QA_READ_EMPTY=${args.includes('--expect-empty')}`);
    if(flow==='writes-recovery')invocation.push('-e',`QA_RUN_ID=${runId}`,'-e',`QA_WRITE_STAGE=${writeStage}`,'-e',`QA_CASE=${caseName}`);
    if(fixtureLedgerId)invocation.push('-e',`QA_LEDGER_ID=${fixtureLedgerId}`);
    if(runtimeToken)invocation.push('-e',`QA_ENDPOINT=${endpoint}`,'-e',`QA_TOKEN=${runtimeToken}`);
    const toolEnv={...process.env,JAVA_HOME:process.env.QA_JAVA_HOME || '/opt/homebrew/opt/openjdk@21',PATH:`${process.env.QA_PLATFORM_TOOLS || '/Users/moreal/.local/share/mise/installs/android-sdk/20.0/platform-tools'}:${process.env.PATH}`};
    const result=spawnSync(maestro,invocation,{encoding:'utf8',timeout:timeoutMs,env:toolEnv});
    writeFileSync(join(dir,'runner.log'),redact(`${result.stdout??''}\n${result.stderr??''}`));
    redactArtifacts(dir);
    runs.push({flow,exitCode:result.status,error:result.error?.message??null});
    if(result.status!==0)break;
  }
}
const results=ids.map(id=>{
 const observation=observations[id];
 if(!observation)return {id,status:'PENDING',observation:'No fresh per-ID observation supplied',evidence:[],executedAt:new Date().toISOString(),method:'maestro'};
 if(!['PASS','FAIL','BLOCKED','N/A','PENDING'].includes(observation.status))throw Error(`Invalid status ${id}`);
 if (observation.id && observation.id !== id) throw Error(`Mismatched observation ID: ${id}`);
 if (['PASS','FAIL'].includes(observation.status)) {
   if (!Array.isArray(observation.evidence) || !observation.evidence.length || typeof observation.observation !== 'string' || !observation.observation.trim()) throw Error(`Evidence and actual observation required: ${id}`);
   for (const path of observation.evidence) {
     if (typeof path !== 'string' || !realpathSync(path).startsWith(realpathSync(output) + '/') || !statSync(path).isFile() || !statSync(path).size) throw Error(`Evidence must exist inside current output: ${id}`);
   }
   if (!since || !Number.isFinite(Date.parse(observation.executedAt)) || Date.parse(observation.executedAt) < Date.parse(since)) throw Error(`Current-run timestamp and --since required: ${id}`);
   if (observation.appSha !== appSha || observation.fixtureRun !== fixtureRun) throw Error(`Current run identity required: ${id}`);
 }
 return {...observation,id};
});
const report={readCase,readQuery,schemaVersion:1,platform:'ios',ciRun,appSha,fixtureRun,writeStage,caseName,runId,generatedAt:new Date().toISOString(),device,checklistCount:54,runs,results};
const reportPath=join(output,'results.json');
writeFileSync(reportPath,JSON.stringify(report,null,2));
const validationArgs=[resolve('scripts/qa/validate-results.mjs'),reportPath,'--ci-run',ciRun,'--app-sha',appSha,'--fixture-run',fixtureRun,'--allow-incomplete'];
if(since)validationArgs.push('--since',since);
const validation=spawnSync(process.execPath,validationArgs,{encoding:'utf8'});
if(validation.status!==0) throw Error(`Invalid result report: ${validation.stdout || validation.stderr}`);
process.stdout.write(JSON.stringify({output,flows:runs,counts:Object.fromEntries(['PASS','FAIL','BLOCKED','N/A','PENDING'].map(s=>[s,results.filter(r=>r.status===s).length]))})+'\n');
if (runs.some(run => run.exitCode !== 0 || run.error)) process.exitCode = 1;

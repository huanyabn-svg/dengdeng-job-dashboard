import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobsPath = resolve(root, 'data/jobs.js');
const statusPath = resolve(root, 'data/run-status.js');
const source = await readFile(jobsPath, 'utf8');
const jobs = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;\s*$/, ''));

const migrated = jobs.map(job => {
  const searchEntry = job.sourceKind === 'official' && !job.discovered && job.status === 'watch';
  if (searchEntry) {
    return {
      ...job,
      title:`${job.company} 官方岗位搜索`,
      recordKind:'search',
      status:'watch',
      statusLabel:'官网岗位搜索',
      verificationState:'search-entry',
      verificationEvidence:'这是企业官方招聘搜索入口，不代表当前存在某个具体岗位',
      verifiedAt:null,
      active:true,
      linkState:job.linkState === 'closed' ? 'closed' : 'search-entry-pending-refresh'
    };
  }
  return {
    ...job,
    recordKind:'job',
    verificationState:'pending',
    verificationEvidence:'等待新版规则重新核验岗位标题与职位详情',
    verifiedAt:null,
    active:false,
    linkState:'pending-verification'
  };
});

await writeFile(jobsPath, `window.APPLYPILOT_JOBS = ${JSON.stringify(migrated, null, 2)};\n`, 'utf8');
await writeFile(statusPath, `window.APPLYPILOT_RUN_STATUS = ${JSON.stringify({
  lastRun:null,
  mode:'trust-model-migration',
  checked:migrated.length,
  active:migrated.filter(job => job.active).length,
  newJobs:0,
  removed:migrated.filter(job => !job.active).length,
  protected:0,
  errors:0,
  sourceEntries:migrated.filter(job => job.recordKind === 'search' && job.active).length,
  confirmedJobs:0,
  detectedBoards:0,
  message:'已停止展示未经职位详情核验的岗位；请运行一次实时搜索。'
}, null, 2)};\n`, 'utf8');

console.log(`Migrated ${migrated.length} records to strict verification.`);

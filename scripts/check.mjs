import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const dataSource = await readFile(resolve(root, 'data/jobs.js'), 'utf8');
const jobs = JSON.parse(dataSource.slice(dataSource.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
const errors = [];

if (!index.includes('./data/jobs.js') || !index.includes('./data/run-status.js')) errors.push('index.html does not load generated data');
if (!jobs.length) errors.push('job dataset is empty');
if (new Set(jobs.map(job => job.id)).size !== jobs.length) errors.push('duplicate job ids');
if (new Set(jobs.map(job => job.sourceUrl)).size !== jobs.length) errors.push('duplicate job urls');

for (const job of jobs) {
  if (!/^https?:\/\//.test(job.sourceUrl)) errors.push(`invalid url: ${job.id}`);
  if (!['bonjour', 'watch'].includes(job.status)) errors.push(`invalid status: ${job.id}`);
  if (job.status === 'bonjour' && !/上海|远程|remote/i.test(job.location)) errors.push(`bonjour location rule failed: ${job.id}`);
  if (/linkedin\.com/i.test(job.sourceUrl)) errors.push(`LinkedIn is not allowed: ${job.id}`);
  if (job.active && job.recordKind === 'job' && job.verificationState !== 'confirmed') errors.push(`unverified job is public: ${job.id}`);
  if (job.recordKind === 'search' && !/官方岗位搜索$/.test(job.title)) errors.push(`search entry looks like a job: ${job.id}`);
  if (job.recordKind === 'job' && job.active && !job.verifiedAt) errors.push(`confirmed job lacks verifiedAt: ${job.id}`);
}

const publicText = `${index}\n${dataSource}`;
const privacyPatterns = [
  /15336389590/,
  /651250559@qq\.com/i,
  /邓欢言/,
  /\/Users\/dhy\/Desktop/,
  /candidate_profile/i,
  /application_log\.csv/i
];
for (const pattern of privacyPatterns) if (pattern.test(publicText)) errors.push(`privacy check failed: ${pattern}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${jobs.length} jobs, no duplicate URLs, public privacy checks passed.`);

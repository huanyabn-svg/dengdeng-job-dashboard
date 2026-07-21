import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobsPath = resolve(projectRoot, 'data/jobs.js');
const statusPath = resolve(projectRoot, 'data/run-status.js');
const rulesPath = resolve(projectRoot, 'config/search-rules.json');
const now = new Date();
const nowIso = now.toISOString();

const rules = JSON.parse(await readFile(rulesPath, 'utf8'));
const currentJobs = parseAssignedJson(await readFile(jobsPath, 'utf8'), 'window.APPLYPILOT_JOBS');
const robotsCache = new Map();
const pageCache = new Map();

function parseAssignedJson(source, variableName) {
  const prefix = `${variableName} =`;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Cannot find ${variableName}`);
  return JSON.parse(source.slice(start + prefix.length).trim().replace(/;\s*$/, ''));
}

function stableId(url) {
  return `auto-${createHash('sha1').update(url).digest('hex').slice(0, 14)}`;
}

function canonicalUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol)) return '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'source', 'ref'].forEach(key => url.searchParams.delete(key));
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isBlockedUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return rules.blockedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    }
    return named[entity.toLowerCase()] ?? '';
  });
}

function plainText(html) {
  return decodeEntities(String(html || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, values) {
  const haystack = text.toLowerCase();
  return values.some(value => haystack.includes(value.toLowerCase()));
}

function roleFrom(text) {
  const operations = includesAny(text, rules.roleKeywords.operations);
  const sales = includesAny(text, rules.roleKeywords.sales);
  if (sales && !operations) return 'sales';
  if (operations) return 'operations';
  return '';
}

function locationFrom(text) {
  const lower = text.toLowerCase();
  const domestic = rules.domesticPriority.filter(city => lower.includes(city.toLowerCase()));
  const remote = rules.bonjourAllowedLocationKeywords.some(keyword => lower.includes(keyword.toLowerCase()) && keyword.toLowerCase() !== '上海');
  const overseas = rules.overseasKeywords.find(keyword => lower.includes(keyword.toLowerCase()));
  const parts = [...domestic];
  if (remote) parts.push('远程');
  if (overseas && !parts.some(part => part.toLowerCase() === overseas.toLowerCase())) parts.push(overseas);
  return parts.join(' / ');
}

function isOverleveled(text) {
  return /\b(senior manager|manager|director|vice president|head of|principal|lead)\b|经理|总监|副总裁|负责人|资深/i.test(text);
}

function isOutOfScopeTitle(text) {
  return /\b(designer|developer|engineer|scientist|researcher)\b|设计师|设计实习生|开发工程师|算法工程师|研究员/i.test(text);
}

function candidateFromFields({ title, company, location, url, description = '', sourceJob, sourceKind = 'official' }) {
  const compactTitle = plainText(title).slice(0, 180);
  const compactCompany = plainText(company || sourceJob?.company || '未知公司').slice(0, 100);
  const context = `${compactTitle} ${plainText(description).slice(0, 1200)} ${plainText(location)}`;
  const role = roleFrom(context);
  const foundLocation = plainText(location) || locationFrom(context);
  if (!compactTitle || !role || !foundLocation || isOverleveled(compactTitle) || isOutOfScopeTitle(compactTitle)) return null;
  if (sourceKind === 'bonjour' && !includesAny(foundLocation, rules.bonjourAllowedLocationKeywords)) return null;
  if (sourceKind !== 'bonjour' && !locationFrom(foundLocation)) return null;
  const sourceUrl = canonicalUrl(url, sourceJob?.sourceUrl);
  if (!sourceUrl || isBlockedUrl(sourceUrl)) return null;
  const entryLevel = includesAny(context, rules.entryLevelKeywords);
  const zone = includesAny(foundLocation, rules.domesticPriority) ? 'base' : 'overseas';
  return {
    id: stableId(sourceUrl),
    company: compactCompany,
    title: compactTitle,
    role,
    family: role === 'sales' ? '销售 / BD / GTM' : '运营 / 内容 / 营销',
    location: foundLocation.slice(0, 120),
    zone,
    status: sourceKind === 'bonjour' ? 'bonjour' : 'watch',
    statusLabel: sourceKind === 'bonjour' ? 'Bonjour 在招' : '官网新发现',
    ownership: sourceJob?.ownership || (sourceKind === 'bonjour' ? 'startup' : 'private'),
    priority: entryLevel || zone === 'base' ? '高' : '中',
    sourceKind,
    recordKind: 'job',
    sourceUrl,
    applyLabel: sourceKind === 'bonjour' ? '打开 Bonjour 职位' : '打开官网职位',
    linkType: sourceKind === 'bonjour' ? 'Bonjour 公开职位详情' : '企业官网或其官方 ATS 职位详情',
    next: '核验毕业时间、工作地点、到岗时间和申请截止日期后再投递。',
    reason: entryLevel ? '自动发现的初级、毕业生或实习相关岗位。' : '自动发现且符合目标方向与地点规则。',
    active: true,
    discovered: true,
    firstSeen: nowIso.slice(0, 10),
    lastChecked: nowIso,
    linkState: 'pending-verification',
    verificationState: 'pending',
    verificationEvidence: '',
    verifiedAt: null,
    httpStatus: null,
    failureCount: 0
  };
}

function isSearchEntry(job) {
  return job.recordKind === 'search' || (job.sourceKind === 'official' && !job.discovered && job.status === 'watch');
}

function normalizedTitle(value) {
  return plainText(value).toLowerCase().replace(/招聘雷达|官方岗位搜索|岗位搜索|职位搜索/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function titleMatches(expected, actual) {
  const left = normalizedTitle(expected);
  const right = normalizedTitle(actual);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const tokens = plainText(expected).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2);
  return tokens.length > 0 && tokens.filter(token => plainText(actual).toLowerCase().includes(token)).length / tokens.length >= 0.7;
}

function jobPostingTitles(html) {
  const titles = [];
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      walkJson(parsed, item => {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(type => String(type).toLowerCase() === 'jobposting') && (item.title || item.name)) titles.push(plainText(item.title || item.name));
      });
    } catch {}
  }
  return titles;
}

function hasClosedJobSignal(html) {
  const text = plainText(html).toLowerCase();
  return /job (is )?no longer available|position (has been )?filled|no longer accepting applications|job not found|posting (has )?expired|职位不存在|岗位不存在|职位已下线|岗位已下线|招聘已结束|停止招聘|已停止接受申请/.test(text);
}

function verifyJobPage(page, job) {
  if (!page.html || hasClosedJobSignal(page.html)) return { confirmed:false, evidence:'职位页显示已关闭或不存在' };
  const structuredTitle = jobPostingTitles(page.html).find(title => titleMatches(job.title, title));
  if (structuredTitle) return { confirmed:true, evidence:`结构化职位详情：${structuredTitle}` };
  const pageText = plainText(page.html).slice(0, 300000);
  const finalRoute = (() => { try { return new URL(page.finalUrl).pathname.toLowerCase(); } catch { return ''; } })();
  const jobLikeRoute = /\/(job|jobs|position|positions|vacancy|vacancies|posting|postings|requisition)(\/|$)/.test(finalRoute)
    || /job|position|requisition/.test((() => { try { return new URL(page.finalUrl).search; } catch { return ''; } })());
  if (jobLikeRoute && titleMatches(job.title, pageText)) return { confirmed:true, evidence:'职位详情页标题与看板一致' };
  return { confirmed:false, evidence:'页面可打开，但没有找到与看板标题一致的职位详情' };
}

function detectedAtsBoards(html) {
  const found = new Map();
  const patterns = [
    { type:'greenhouse', regex:/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/gi },
    { type:'lever', regex:/https?:\/\/jobs\.lever\.co\/([a-z0-9_-]+)/gi },
    { type:'ashby', regex:/https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/gi }
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern.regex)) {
      const token = match[1];
      if (token) found.set(`${pattern.type}:${token}`, { type:pattern.type, token });
    }
  }
  for (const match of String(html || '').matchAll(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/((?:[a-z]{2}-[A-Z]{2}\/)?)([a-z0-9_-]+)/g)) {
    const [, tenant, cluster, localePrefix = '', site] = match;
    if (!tenant || !cluster || !site || site.toLowerCase() === 'wday') continue;
    const origin = `https://${tenant}.${cluster}.myworkdayjobs.com`;
    found.set(`workday:${tenant}:${site}`, {
      type:'workday', token:`${tenant}:${site}`, tenant, site,
      apiBase:origin,
      publicBase:`${origin}/${localePrefix}${site}`
    });
  }
  return [...found.values()];
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rules.requestTimeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'ApplyPilotPublicJobMonitor/1.0 (+public job-link verification; one request per source per day)',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseRobots(source) {
  const groups = [];
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.toLowerCase().trim();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], allow: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current[key].push(value);
      current.hasRules = true;
    }
  }
  return groups;
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const response = await fetchWithTimeout(`${origin}/robots.txt`, { headers: { accept: 'text/plain' } });
        if (!response.ok) return [];
        return parseRobots((await response.text()).slice(0, 250000));
      } catch {
        return [];
      }
    })());
  }
  const groups = await robotsCache.get(origin);
  const applicable = groups.filter(group => group.agents.includes('*') || group.agents.some(agent => agent.includes('applypilot')));
  if (!applicable.length) return true;
  const path = `${parsed.pathname}${parsed.search}`;
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const group of applicable) {
    for (const rule of group.allow) if (rule && path.startsWith(rule)) bestAllow = Math.max(bestAllow, rule.length);
    for (const rule of group.disallow) if (rule && path.startsWith(rule)) bestDisallow = Math.max(bestDisallow, rule.length);
  }
  return bestDisallow < 0 || bestAllow >= bestDisallow;
}

async function fetchPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const task = (async () => {
    if (!(await robotsAllows(url))) return { blockedByRobots: true, status: null, html: '', finalUrl: url };
    const response = await fetchWithTimeout(url);
    const contentType = response.headers.get('content-type') || '';
    let html = '';
    if (response.ok && /html|json|text/.test(contentType)) html = (await response.text()).slice(0, 1500000);
    else if (response.body) await response.body.cancel().catch(() => {});
    return { blockedByRobots: false, status: response.status, html, finalUrl: response.url };
  })();
  pageCache.set(url, task);
  return task;
}

function walkJson(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) value.forEach(item => walkJson(item, callback));
  else Object.values(value).forEach(item => walkJson(item, callback));
}

function jsonLdCandidates(html, sourceJob) {
  const found = [];
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      walkJson(parsed, item => {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (!types.some(type => String(type).toLowerCase() === 'jobposting')) return;
        const addresses = [];
        walkJson(item.jobLocation, node => {
          if (node.address) addresses.push(node.address.addressLocality, node.address.addressRegion, node.address.addressCountry);
          if (node.addressLocality) addresses.push(node.addressLocality, node.addressRegion, node.addressCountry);
        });
        const candidate = candidateFromFields({
          title: item.title || item.name,
          company: item.hiringOrganization?.name,
          location: addresses.filter(Boolean).join(' / ') || (item.jobLocationType === 'TELECOMMUTE' ? '远程' : ''),
          url: item.url || item.sameAs || sourceJob.sourceUrl,
          description: item.description,
          sourceJob,
          sourceKind: sourceJob.sourceKind
        });
        if (candidate) found.push(candidate);
      });
    } catch {
      continue;
    }
  }
  return found;
}

function anchorCandidates(html, sourceJob) {
  const found = [];
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const title = plainText(match[2]);
    if (title.length < 5 || title.length > 180) continue;
    if (!roleFrom(title)) continue;
    const candidateUrl = canonicalUrl(hrefMatch[2], sourceJob.sourceUrl);
    let jobLikeUrl = false;
    try {
      const parsed = new URL(candidateUrl);
      const route = `${parsed.pathname}${parsed.search}`.toLowerCase();
      jobLikeUrl = /\/(job|jobs|position|positions|vacancy|vacancies|posting|postings|recruitment)\//.test(route) || /[?&](job|jobid|job_id|req|requisition|positionid)=/.test(route);
      if (/\/news\b|\/benefits?\b|\/culture\b|\/locations?\b|\/career-development\b/.test(route)) jobLikeUrl = false;
    } catch {
      jobLikeUrl = false;
    }
    if (!jobLikeUrl) continue;
    const nearby = plainText(html.slice(Math.max(0, match.index - 250), Math.min(html.length, match.index + match[0].length + 250)));
    const candidate = candidateFromFields({
      title,
      company: sourceJob.company,
      location: locationFrom(`${title} ${nearby}`),
      url: candidateUrl,
      description: nearby,
      sourceJob,
      sourceKind: sourceJob.sourceKind
    });
    if (candidate && candidate.sourceUrl !== canonicalUrl(sourceJob.sourceUrl)) found.push(candidate);
  }
  return found;
}

function bonjourCandidates(html) {
  const found = [];
  const rows = html.matchAll(/<div class="jp-job-row">([\s\S]*?)(?=<div class="jp-job-row">|$)/g);
  for (const row of rows) {
    const block = row[1];
    const href = block.match(/href="([^"]*\/jobs-mapping\/jobs\/[^"]+)"/i)?.[1];
    const aria = decodeEntities(block.match(/aria-label="([^"]+)"/i)?.[1] || '');
    const title = plainText(block.match(/class="jp-role-title"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || aria.replace(/^查看\s+.+?\s+的\s+/, '').replace(/\s+职位$/, ''));
    const company = plainText(block.match(/class="jp-team-name"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || aria.match(/^查看\s+(.+?)\s+的\s+/)?.[1] || 'Bonjour 团队');
    const tags = [...block.matchAll(/class="t4-chip jp-fact-tag"[^>]*>([\s\S]*?)<\/span>/gi)].map(match => plainText(match[1]));
    const location = tags[0] || locationFrom(block);
    const sourceJob = { company, sourceUrl: rules.bonjourListUrl, sourceKind: 'bonjour', ownership: 'startup' };
    const candidate = candidateFromFields({ title, company, location, url: href, description: tags.join(' '), sourceJob, sourceKind: 'bonjour' });
    if (candidate) found.push(candidate);
  }
  return found;
}

async function processExisting(job) {
  const searchEntry = isSearchEntry(job);
  const updated = {
    ...job,
    recordKind: searchEntry ? 'search' : 'job',
    title: searchEntry ? `${job.company} 官方岗位搜索` : job.title,
    statusLabel: searchEntry ? '官网岗位搜索' : job.statusLabel,
    lastChecked: nowIso
  };
  const discoveries = [];
  const boards = [];
  try {
    const page = await fetchPage(job.sourceUrl);
    if (page.blockedByRobots) {
      updated.linkState = 'robots-blocked';
      updated.httpStatus = null;
      updated.active = searchEntry;
      return { updated, discoveries, boards };
    }
    updated.httpStatus = page.status;
    if (page.status >= 200 && page.status < 400) {
      updated.failureCount = 0;
      if (searchEntry) {
        updated.linkState = 'search-entry-verified';
        updated.verificationState = 'search-entry';
        updated.verificationEvidence = '仅确认企业招聘入口可访问，不代表存在某个具体岗位';
        updated.active = true;
      } else {
        const verification = verifyJobPage(page, job);
        updated.verificationState = verification.confirmed ? 'confirmed' : 'rejected';
        updated.verificationEvidence = verification.evidence;
        updated.verifiedAt = verification.confirmed ? nowIso : (job.verifiedAt || null);
        updated.linkState = verification.confirmed ? 'job-confirmed' : 'job-not-confirmed';
        updated.active = verification.confirmed;
      }
      if (searchEntry && job.sourceKind === 'official' && page.html) {
        const candidates = [...jsonLdCandidates(page.html, job), ...anchorCandidates(page.html, job)];
        const unique = new Map(candidates.map(candidate => [canonicalUrl(candidate.sourceUrl), candidate]));
        discoveries.push(...[...unique.values()].slice(0, rules.maxDiscoveredPerSource));
        boards.push(...detectedAtsBoards(`${job.sourceUrl}\n${page.finalUrl}\n${page.html}`).map(board => ({ ...board, company:job.company, ownership:job.ownership })));
      }
    } else if ([401, 403, 429].includes(page.status)) {
      updated.linkState = 'protected';
      updated.failureCount = 0;
      updated.active = searchEntry || (updated.verifiedAt && (now - new Date(updated.verifiedAt)) / 36e5 <= rules.maxVerifiedAgeHours);
    } else if ([404, 410].includes(page.status)) {
      updated.linkState = 'closed';
      updated.failureCount = (job.failureCount || 0) + 1;
      updated.active = false;
    } else {
      updated.linkState = 'temporary-error';
      updated.failureCount = (job.failureCount || 0) + 1;
      updated.active = searchEntry
        ? updated.failureCount < rules.retireAfterFailures
        : Boolean(updated.verifiedAt && (now - new Date(updated.verifiedAt)) / 36e5 <= rules.maxVerifiedAgeHours);
    }
  } catch (error) {
    updated.httpStatus = null;
    updated.linkState = error?.name === 'AbortError' ? 'timeout' : 'network-error';
    updated.failureCount = (job.failureCount || 0) + 1;
    updated.active = searchEntry
      ? updated.failureCount < rules.retireAfterFailures
      : Boolean(updated.verifiedAt && (now - new Date(updated.verifiedAt)) / 36e5 <= rules.maxVerifiedAgeHours);
  }
  return { updated, discoveries, boards };
}

async function discoverBonjour() {
  try {
    const page = await fetchPage(rules.bonjourListUrl);
    if (!page.html) return null;
    return bonjourCandidates(page.html);
  } catch {
    return null;
  }
}

async function discoverAtsBoards(extraBoards = []) {
  const found = [];
  const boards = new Map();
  for (const board of [...rules.atsBoards.filter(board => board.enabled !== false), ...extraBoards]) {
    if (!board?.type || !board?.token) continue;
    boards.set(`${board.type}:${board.token}`, board);
  }
  for (const board of [...boards.values()].slice(0, rules.maxAutoDetectedBoards)) {
    try {
      if (board.type === 'workday') {
        const endpoint = `${board.apiBase}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}/jobs`;
        const rowsByPath = new Map();
        for (const searchText of ['marketing', 'operations', 'sales', 'business development', 'graduate', 'intern']) {
          const response = await fetchWithTimeout(endpoint, {
            method:'POST',
            headers:{ accept:'application/json', 'content-type':'application/json' },
            body:JSON.stringify({ appliedFacets:{}, limit:100, offset:0, searchText })
          });
          if (!response.ok) continue;
          const payload = await response.json();
          for (const row of payload.jobPostings || []) if (row.externalPath) rowsByPath.set(row.externalPath, row);
        }
        for (const row of rowsByPath.values()) {
          const sourceJob = { company:board.company, sourceUrl:board.publicBase, sourceKind:'official', ownership:board.ownership || 'foreign' };
          const candidate = candidateFromFields({
            title:row.title,
            company:board.company,
            location:row.locationsText,
            url:`${board.publicBase}${row.externalPath}`,
            description:[row.timeType, row.postedOn, ...(row.bulletFields || [])].join(' '),
            sourceJob
          });
          if (candidate) {
            candidate.verificationState = 'confirmed';
            candidate.verificationEvidence = '官方 Workday 职位接口当前返回该岗位';
            candidate.verifiedAt = nowIso;
            candidate.linkState = 'job-confirmed';
            found.push(candidate);
          }
        }
        continue;
      }
      let endpoint = '';
      if (board.type === 'greenhouse') endpoint = `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`;
      if (board.type === 'lever') endpoint = `https://api.lever.co/v0/postings/${board.token}?mode=json`;
      if (board.type === 'ashby') endpoint = `https://api.ashbyhq.com/posting-api/job-board/${board.token}`;
      if (!endpoint || isBlockedUrl(endpoint)) continue;
      const response = await fetchWithTimeout(endpoint, { headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const payload = await response.json();
      const rows = payload.jobs || payload.jobPostings || payload;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const sourceJob = { company: board.company, sourceUrl: endpoint, sourceKind: 'official', ownership: board.ownership || 'private' };
        const candidate = candidateFromFields({
          title: row.title || row.text,
          company: board.company,
          location: row.location?.name || row.location || row.categories?.location,
          url: row.absolute_url || row.hostedUrl || row.jobUrl || row.applyUrl,
          description: row.content || row.descriptionPlain || row.descriptionHtml,
          sourceJob
        });
        if (candidate) {
          candidate.verificationState = 'confirmed';
          candidate.verificationEvidence = `官方 ${board.type} 职位接口当前返回该岗位`;
          candidate.verifiedAt = nowIso;
          candidate.linkState = 'job-confirmed';
          found.push(candidate);
        }
      }
    } catch {
      continue;
    }
  }
  return found;
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

const processed = await mapConcurrent(currentJobs, rules.maxConcurrentRequests, processExisting);
const checkedJobs = processed.map(result => result.updated);
const discovered = processed.flatMap(result => result.discoveries);
const autoDetectedBoards = processed.flatMap(result => result.boards || []);
const bonjourResult = await discoverBonjour();
const bonjourNow = bonjourResult || [];
for (const job of bonjourNow) {
  job.verificationState = 'confirmed';
  job.verificationEvidence = 'Bonjour 当前公开职位列表仍包含该岗位';
  job.verifiedAt = nowIso;
  job.linkState = 'job-confirmed';
}
discovered.push(...bonjourNow, ...await discoverAtsBoards(autoDetectedBoards));

const verifiedDiscoveries = await mapConcurrent(discovered, rules.maxConcurrentRequests, async candidate => {
  if (candidate.verificationState === 'confirmed') return candidate;
  try {
    const page = await fetchPage(candidate.sourceUrl);
    if (!(page.status >= 200 && page.status < 400)) return { ...candidate, active:false, verificationState:'rejected', verificationEvidence:`职位详情返回 ${page.status || '错误'}` };
    const verification = verifyJobPage(page, candidate);
    return {
      ...candidate,
      active:verification.confirmed,
      verificationState:verification.confirmed ? 'confirmed' : 'rejected',
      verificationEvidence:verification.evidence,
      verifiedAt:verification.confirmed ? nowIso : null,
      linkState:verification.confirmed ? 'job-confirmed' : 'job-not-confirmed',
      httpStatus:page.status
    };
  } catch {
    return { ...candidate, active:false, verificationState:'rejected', verificationEvidence:'职位详情无法完成核验' };
  }
});

const merged = new Map();
for (const job of checkedJobs) merged.set(canonicalUrl(job.sourceUrl), job);
for (const job of verifiedDiscoveries) {
  const key = canonicalUrl(job.sourceUrl);
  if (!key) continue;
  merged.set(key, job);
}

if (bonjourResult) {
  const currentBonjourUrls = new Set(bonjourNow.map(job => canonicalUrl(job.sourceUrl)));
  for (const [key, job] of merged) {
    if (job.sourceKind === 'bonjour' && !currentBonjourUrls.has(key)) {
      merged.set(key, { ...job, active:false, verificationState:'rejected', linkState:'not-in-current-bonjour-list', verificationEvidence:'Bonjour 当前列表已不再显示该岗位' });
    }
  }
}

const jobs = [...merged.values()].sort((a, b) => {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.status !== b.status) return a.status === 'bonjour' ? -1 : 1;
  if (a.priority !== b.priority) return a.priority === '高' ? -1 : 1;
  return `${a.company}${a.title}`.localeCompare(`${b.company}${b.title}`, 'zh-CN');
});

const active = jobs.filter(job => job.active && (job.recordKind === 'search' || job.verificationState === 'confirmed'));
const closedThisRun = checkedJobs.filter(job => job.active === false && currentJobs.find(old => old.id === job.id)?.active !== false).length;
const newlyAdded = jobs.filter(job => !currentJobs.some(old => canonicalUrl(old.sourceUrl) === canonicalUrl(job.sourceUrl))).length;
const runStatus = {
  lastRun: nowIso,
  mode: 'automatic',
  checked: currentJobs.length,
  active: active.length,
  newJobs: newlyAdded,
  removed: closedThisRun,
  protected: active.filter(job => ['protected', 'robots-blocked'].includes(job.linkState)).length,
  errors: active.filter(job => ['timeout', 'network-error', 'temporary-error'].includes(job.linkState)).length,
  sourceEntries:active.filter(job => job.recordKind === 'search').length,
  confirmedJobs:active.filter(job => job.recordKind === 'job').length,
  detectedBoards:autoDetectedBoards.length,
  message: `本次核验 ${currentJobs.length} 条记录，确认 ${active.filter(job => job.recordKind === 'job').length} 个真实在招岗位，保留 ${active.filter(job => job.recordKind === 'search').length} 个官网搜索入口。`
};

async function writeAtomic(path, content) {
  const temp = `${path}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, path);
}

await writeAtomic(jobsPath, `window.APPLYPILOT_JOBS = ${JSON.stringify(jobs, null, 2)};\n`);
await writeAtomic(statusPath, `window.APPLYPILOT_RUN_STATUS = ${JSON.stringify(runStatus, null, 2)};\n`);

console.log(JSON.stringify(runStatus, null, 2));

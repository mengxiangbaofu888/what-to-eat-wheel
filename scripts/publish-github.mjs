/**
 * publish-github.mjs · 把仓库发布到 GitHub（建仓 + 提交 + 发 Release）
 *
 * 为什么不用 git push：
 *   有些网络环境里 github.com（git 走的就是这个域名）连不上，但 api.github.com 通。
 *   这个脚本改用 GitHub 的 REST API 完成同样的事：把每个文件作为 blob 传上去，
 *   组装成 tree、commit，再把分支指过去——结果和 git push 完全等价，
 *   连 commit SHA 都一样（见下面「为什么 SHA 会一致」）。
 *
 * 为什么 SHA 会一致：
 *   blob / tree / commit 的哈希只取决于内容，不看是谁传的。本地这个 commit 是根提交，
 *   只要上传时用的作者、提交者、时间、提交信息和本地一字不差，算出来的 SHA 就相同。
 *   脚本最后会比对本地 HEAD 和远端 commit 的 SHA，一致才敢说「对上了」。
 *
 * 用法：
 *   $env:GH_TOKEN = "ghp_xxx"      # 需要 repo 权限（classic）或 Contents 读写（fine-grained）
 *   node scripts/publish-github.mjs                 # 建仓 + 推送 + 发 Release
 *   node scripts/publish-github.mjs --no-release    # 只推代码，不发 Release
 *
 * 参数（都可用环境变量覆盖）：
 *   GH_OWNER   默认 mengxiangbaofu888
 *   GH_REPO    默认 what-to-eat-wheel
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.GH_OWNER || 'mengxiangbaofu888';
const REPO = process.env.GH_REPO || 'what-to-eat-wheel';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const BRANCH = 'main';
const TAG = `v${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}`;
const WITH_RELEASE = !process.argv.includes('--no-release');

if (!TOKEN) {
  console.error('❌ 没有 Token。先设置环境变量：$env:GH_TOKEN = "ghp_xxx"');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'what-to-eat-wheel-publish',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function api(method, path, body, extraHeaders) {
  const res = await fetch(API + path, {
    method,
    headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 200);
    const err = new Error(`${method} ${path} → HTTP ${res.status}：${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ------------------------------ 读取本地 git 状态 ------------------------------ */

/**
 * 跑一条 git 命令并把输出读回来。
 *
 * 为什么不用 spawnSync 的默认管道：受限环境（比如 DSH 的文件沙箱）里
 * 子进程不能开命名管道，`child_process` 用 pipe 捕获输出会直接 EPERM。
 * 这里改成把子进程的 stdout/stderr 直接接到一个普通文件的文件描述符上，
 * 既不开管道也不用经过 cmd.exe 的引号解析，读回来再关掉。
 */
const TMP_DIR = join(ROOT, '.git-publish-tmp');
mkdirSync(TMP_DIR, { recursive: true });

function git(args, opts = {}) {
  const outFile = join(TMP_DIR, 'out.bin');
  const errFile = join(TMP_DIR, 'err.txt');
  const outFd = openSync(outFile, 'w');
  const errFd = openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync('git', args, { cwd: ROOT, stdio: ['ignore', outFd, errFd] });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  const buf = readFileSync(outFile);
  const err = readFileSync(errFile, 'utf8');
  if (res.error) throw new Error(`无法执行 git：${res.error.message}`);
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} 失败（退出码 ${res.status}）：${err.trim()}`);
  return opts.buffer ? buf : buf.toString('utf8');
}

const headSha = git(['rev-parse', 'HEAD']).trim();
const headTree = git(['rev-parse', 'HEAD^{tree}']).trim();

/**
 * 从原始的 commit 对象里读元数据，而不是用 `git log --format=%B`。
 * 因为 log 的格式化输出会在结尾多补一个换行，而 commit 的 SHA 是对
 * 「原始字节」算的哈希——多一个 \n 就不一样了。
 * 顺手把 author/committer 行里的 unix 时间戳和时区偏移也解析出来，
 * 上传时按同样的时区偏移回填，SHA 才有可能一致。
 */
const rawCommit = git(['cat-file', 'commit', 'HEAD'], { buffer: true }).toString('utf8');
const splitAt = rawCommit.indexOf('\n\n');
const headerLines = rawCommit.slice(0, splitAt).split('\n');
const message = rawCommit.slice(splitAt + 2);   // 精确保留，包括结尾的换行

function parseIdent(prefix) {
  const line = headerLines.find((l) => l.startsWith(prefix + ' '));
  const m = /^(?:author|committer) ([\s\S]*) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(line);
  if (!m) throw new Error(`解析 ${prefix} 行失败：${line}`);
  return { name: m[1], email: m[2], ts: Number(m[3]), tz: m[4] };
}

/** 把 unix 时间戳 + 时区偏移还原成带偏移的 ISO 8601（保住 +0800 这种写法的语义） */
function isoWithOffset(ts, tz) {
  const offMin = (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const d = new Date((ts + offMin * 60) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${tz.slice(0, 3)}:${tz.slice(3)}`;
}

const authorIdent = parseIdent('author');
const committerIdent = parseIdent('committer');
const author = { name: authorIdent.name, email: authorIdent.email, date: isoWithOffset(authorIdent.ts, authorIdent.tz) };
const committer = { name: committerIdent.name, email: committerIdent.email, date: isoWithOffset(committerIdent.ts, committerIdent.tz) };
const hasParent = headerLines.some((l) => l.startsWith('parent '));

// git ls-files -s -z → "<mode> <sha> <stage>\t<path>\0"
const entries = git(['ls-files', '-s', '-z'], { buffer: true })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf('\t');
    const [mode, sha, stage] = line.slice(0, tab).split(' ');
    return { mode, sha, stage, path: line.slice(tab + 1) };
  });

console.log('\n=== 发布到 GitHub ===\n');
console.log(`  仓库   : ${OWNER}/${REPO}`);
console.log(`  分支   : ${BRANCH}`);
console.log(`  本地提交: ${headSha.slice(0, 10)}  ${entries.length} 个文件`);

/* ------------------------------ 1. 建仓 ------------------------------ */

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let repoInfo;
try {
  repoInfo = await api('GET', `/repos/${OWNER}/${REPO}`);
  console.log(`\n① 仓库已存在，直接用：${repoInfo.html_url}`);
} catch (e) {
  if (e.status !== 404) throw e;
  repoInfo = await api('POST', '/user/repos', {
    name: REPO,
    description: pkg.description,
    homepage: '',
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    has_downloads: true,
    auto_init: false,
  });
  console.log(`\n① 仓库已创建：${repoInfo.html_url}`);
}

/* ------------------------------ 2. 空仓库要先塞一个占位提交 ------------------------------ */

// GitHub 的 Git Data API 不能在「一个提交都没有」的仓库上建 blob，会返回 409。
// 所以先用 Contents API 建一个占位文件把仓库激活，最后再把分支强推到我自己的
// 根提交上——占位提交就变成不可达对象，仓库历史里只剩本地那一个提交。
let isEmpty = false;
try {
  await api('GET', `/repos/${OWNER}/${REPO}/commits?per_page=1`);
} catch (e) {
  if (e.status === 409 || e.status === 404) isEmpty = true;
  else throw e;
}
if (isEmpty) {
  await api('PUT', `/repos/${OWNER}/${REPO}/contents/.publish-placeholder`, {
    message: 'chore: 占位提交（GitHub 不允许在空仓库上直接使用 Git Data API）',
    content: Buffer.from('placeholder\n').toString('base64'),
    branch: BRANCH,
  });
  console.log('\n② 仓库原本是空的，已先用占位提交激活（稍后会被正式提交取代）');
}

/* ------------------------------ 3. 上传 blob ------------------------------ */

/** 用本地 git 的算法算 blob 哈希，用来确认「工作区文件内容 == 索引里的 blob」 */
function blobHash(buf) {
  const h = createHash('sha1');
  h.update(`blob ${buf.length}\0`, 'utf8');
  h.update(buf);
  return h.digest('hex');
}

console.log(`\n③ 上传 ${entries.length} 个文件…`);
const tree = [];
let reused = 0;
for (const entry of entries) {
  const abs = join(ROOT, entry.path);
  let buf = readFileSync(abs);
  if (blobHash(buf) !== entry.sha) {
    // 工作区文件被换行符转换之类动过，退回从 git 对象里取原始内容（用 SHA，避开中文路径）
    buf = git(['cat-file', 'blob', entry.sha], { buffer: true });
    reused++;
  }
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  tree.push({
    path: entry.path,
    mode: entry.mode === '100755' ? '100755' : '100644',
    type: 'blob',
    sha: blob.sha,
  });
  process.stdout.write(`\r   ${tree.length}/${entries.length} …`);
}
console.log(`\r   已上传 ${tree.length} 个 blob${reused ? `（其中 ${reused} 个取自 git 对象）` : ''}`);

/* ------------------------------ 3. 组装 tree + commit ------------------------------ */

const remoteTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  tree: tree.map(({ path, mode, type, sha }) => ({ path, mode, type, sha })),
});
console.log(`\n④ tree ${remoteTree.sha === headTree ? '✅ 与本地一致' : '⚠️ 与本地不一致'}`);
if (remoteTree.sha !== headTree) {
  console.log(`   本地 ${headTree}`);
  console.log(`   远端 ${remoteTree.sha}`);
}

const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message,
  tree: remoteTree.sha,
  author,
  committer,
  ...(hasParent ? {} : { parents: [] }),   // 显式声明根提交，别让 GitHub 自动挂到当前 HEAD 上
});
console.log(`\n⑤ commit ${commit.sha.slice(0, 10)} ${commit.sha === headSha ? '✅ 与本地 SHA 完全相同' : '（与本地 SHA 不同，但 tree 一致＝文件内容逐字节相同）'}`);

/* ------------------------------ 4. 更新分支 ------------------------------ */

const desiredRef = `refs/heads/${BRANCH}`;
// 注意 ref 的路径写法：读单个 ref 用 /git/ref/heads/xxx，改和建用 /git/refs/heads/xxx。
// 写成 refs/heads/xxx 去读会 404，然后误判成「分支不存在」再去建，撞 422。
let refSha = null;
try {
  const existing = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  refSha = existing.object.sha;
} catch (e) {
  if (e.status !== 404) throw e;
}

if (refSha === commit.sha) {
  console.log(`\n⑥ 分支 ${BRANCH} 已经指向这个提交，无需更新`);
} else if (refSha) {
  // force 是必要的：这里的提交是「根提交」（没有父提交），和占位提交没有共同祖先，
  // 非快进式更新只能强推。占位提交就此变成不可达对象，仓库历史里只剩本地那一个提交。
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  console.log(`\n⑥ 分支 ${BRANCH} 已更新（${refSha.slice(0, 10)} → ${commit.sha.slice(0, 10)}）`);
} else {
  await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: desiredRef, sha: commit.sha });
  console.log(`\n⑥ 分支 ${BRANCH} 已创建`);
}

// 默认分支设为 main（新仓库默认可能是 master）
if (repoInfo.default_branch !== BRANCH) {
  await api('PATCH', `/repos/${OWNER}/${REPO}`, { default_branch: BRANCH });
  console.log(`   默认分支已设为 ${BRANCH}`);
}

/* ------------------------------ 5. 发 Release（带 APK） ------------------------------ */

if (WITH_RELEASE) {
  const apk = join(ROOT, 'release', `吃啥转盘-${TAG}-debug.apk`);
  const repoUrl = `https://github.com/${OWNER}/${REPO}`;

  // 更新日志里对应这一版的段落，直接贴进 Release 说明
  let changelog = '';
  const changelogFile = join(ROOT, 'docs', '更新日志.md');
  if (existsSync(changelogFile)) {
    const lines = readFileSync(changelogFile, 'utf8').split('\n');
    const start = lines.findIndex((l) => l.trim().startsWith(`## ${TAG}`));
    if (start >= 0) {
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((l) => l.trim().startsWith('## '));
      changelog = (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim();
    }
  }

  const releaseBody = [
    changelog || `## 吃啥转盘 ${TAG}`,
    '',
    '### 下载',
    `- **\`what-to-eat-wheel-${TAG}-debug.apk\`** —— 安卓安装包（Android 7.0+，自签名，首次安装需允许「安装未知来源应用」）`,
    `- **\`what-to-eat-wheel-${TAG}.html\`** —— 单文件网页版，手机 / 电脑浏览器直接打开，也可以「添加到主屏幕」当 App 用`,
    '',
    '### 拍照识别需要自己配 Key',
    '在应用内「设置」里填一个视觉模型的 API Key（预置了智谱 / 硅基流动等，都有免费额度）。',
    '不配也不影响手动加菜和转盘。',
    '',
    `详见 [README](${repoUrl}#readme)、[使用说明](${repoUrl}/blob/${BRANCH}/docs/使用说明.md)、[更新日志](${repoUrl}/blob/${BRANCH}/docs/更新日志.md)。`,
  ].join('\n');

  let release = null;
  try {
    release = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    console.log(`\n⑦ Release ${TAG} 已存在：${release.html_url}`);
    if (release.body !== releaseBody) {   // 改过文案后重跑就会同步过来
      release = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, { body: releaseBody, name: `吃啥转盘 ${TAG}` });
      console.log('   说明文字已更新');
    }
  } catch (e) {
    if (e.status !== 404) throw e;
    release = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      target_commitish: BRANCH,
      name: `吃啥转盘 ${TAG}`,
      body: releaseBody,
      draft: false,
      prerelease: false,
    });
    console.log(`\n⑦ Release ${TAG} 已创建：${release.html_url}`);
  }

  // Release 的资源名只认 ASCII：中文会被 GitHub 悄悄处理掉
  //（「吃啥转盘-v1.0.0-debug.apk」会变成「-v1.0.0-debug.apk」，「吃啥转盘.html」会变成「default.html」），
  // 所以这里统一用英文名，并把命名不规范的旧资源删掉。
  const assets = [
    existsSync(apk) ? { file: apk, name: `what-to-eat-wheel-${TAG}-debug.apk`, type: 'application/vnd.android.package-archive' } : null,
    { file: join(ROOT, 'dist', '吃啥转盘.html'), name: `what-to-eat-wheel-${TAG}.html`, type: 'text/html; charset=utf-8' },
  ].filter((a) => a && existsSync(a.file));

  const wanted = new Set(assets.map((a) => a.name));
  for (const old of release.assets || []) {
    if (wanted.has(old.name)) continue;
    await api('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${old.id}`);
    console.log(`   （已删除命名不规范的旧资源 ${old.name}）`);
  }

  const existing = new Set((release.assets || []).map((a) => a.name));
  for (const asset of assets) {
    if (existing.has(asset.name)) {
      console.log(`   [跳过] ${asset.name} 已经传过了`);
      continue;
    }
    const buf = readFileSync(asset.file);
    const res = await fetch(`${UPLOADS}/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': asset.type, 'Content-Length': String(buf.length) },
      body: buf,
    });
    if (res.ok) {
      console.log(`   ✅ ${asset.name}  (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    } else if (res.status === 422) {
      console.log(`   [跳过] ${asset.name} 已经存在`);
    } else {
      console.log(`   ❌ ${asset.name} 上传失败：HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    }
  }
}

/* ------------------------------ 收尾提示 ------------------------------ */

console.log('\n=== 完成 ===');
console.log(`  仓库：${repoInfo.html_url}`);
console.log(`  Release：${repoInfo.html_url}/releases`);
console.log(`\n本地这个仓库还没配 remote。等你的网络能连上 github.com 时，执行：`);
console.log(`  git remote add origin https://github.com/${OWNER}/${REPO}.git`);
console.log(`  git branch -M ${BRANCH}`);
console.log(`  git fetch origin && git reset --soft origin/${BRANCH}   # SHA 一致的话这步会直接对上`);
console.log('');
rmSync(TMP_DIR, { recursive: true, force: true });

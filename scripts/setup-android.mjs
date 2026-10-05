/**
 * setup-android.mjs · 把安卓构建需要的缓存准备到仓库内部
 *
 * 为什么要这一步：
 *   Gradle 默认把家目录放在 ~/.gradle，debug 签名放在 ~/.android。
 *   这两个路径都在仓库之外。在受限环境（没有系统盘写权限、或者沙箱只允许写工作区）里，
 *   Gradle 连 wrapper 的 .lck 锁文件都建不出来，直接报「拒绝访问」。
 *   把它们复制进仓库，构建就完全不依赖工作区外的任何东西了。
 *
 * 复制 1 GB 的 Gradle 缓存听起来很吓人，但它省掉的是「从 Google Maven 重新下载
 * 所有依赖」——国内网络下那一步基本上不可能成功。
 *
 * 用法：
 *   node scripts/setup-android.mjs            # 自动找源并复制
 *   node scripts/setup-android.mjs <工具链目录>  # 手动指定含 gradle-home / android-user-home 的目录
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

const CANDIDATES = [
  process.argv[2],
  process.env.ANDROID_TOOLS_DIR,
  join(ROOT, '..', '.android-tools'),
  'D:/github/ElectroTutor-2026.10/.android-tools',
].filter(Boolean);

function findSource() {
  for (const dir of CANDIDATES) {
    if (dir && existsSync(join(dir, 'gradle-home'))) return dir;
  }
  return null;
}

function copyDir(src, dest, label) {
  if (existsSync(join(dest, '.')) && existsSync(dest) && readdirSync(dest).length) {
    console.log(`  [跳过] ${label} 已存在：${dest}`);
    return true;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`  [复制] ${label} …（可能要一两分钟）`);
  const res = IS_WIN
    ? spawnSync('robocopy', [src, dest, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' })
    : spawnSync('cp', ['-r', src, dest], { stdio: 'inherit' });
  // robocopy 的退出码 0-7 都算成功
  const code = res.status ?? 1;
  const okWin = IS_WIN && code >= 0 && code < 8;
  if (!okWin && code !== 0) {
    console.error(`  ❌ 复制失败（退出码 ${code}）`);
    return false;
  }
  console.log(`  ✅ ${label} → ${dest}`);
  return true;
}

console.log('\n=== 准备安卓构建缓存 ===\n');

const tools = findSource();
if (!tools) {
  console.error('找不到可复制的工具链目录（需要里面有 gradle-home/）。');
  console.error('可以手动指定：node scripts/setup-android.mjs D:/path/to/.android-tools');
  console.error('或者干脆不用这一步——只要你的 ~/.gradle 和 ~/.android 可写，Gradle 用默认路径也能构建。');
  process.exit(1);
}
console.log(`源目录：${tools}\n`);

const gradleOk = copyDir(join(tools, 'gradle-home'), join(ROOT, '.gradle-home'), 'Gradle 缓存（含依赖，约 1 GB）');

// debug 签名：整个目录很小，直接抄
const userHome = join(tools, 'android-user-home');
const keystoreDest = join(ROOT, '.android-home', 'debug.keystore');
if (existsSync(join(userHome, 'debug.keystore'))) {
  mkdirSync(dirname(keystoreDest), { recursive: true });
  if (existsSync(keystoreDest)) {
    console.log(`  [跳过] debug.keystore 已存在`);
  } else {
    copyFileSync(join(userHome, 'debug.keystore'), keystoreDest);
    console.log(`  ✅ debug 签名 → ${keystoreDest}  (${statSync(keystoreDest).size} 字节)`);
  }
} else if (!existsSync(keystoreDest)) {
  console.log('  ⚠️ 没找到现成的 debug.keystore，Gradle 会自己生成一个（需要 ~/.android 可写）');
}

console.log('');
if (!gradleOk) process.exit(1);
console.log('🎉 就绪，现在可以：npm run apk\n');

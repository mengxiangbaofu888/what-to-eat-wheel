/**
 * build-apk.mjs · 一键把网页打成安卓 APK
 *
 * 用法：
 *   node scripts/build-apk.mjs            # debug 版，直接能装
 *   node scripts/build-apk.mjs release    # release 版（需要自己配签名，见 README）
 *
 * 顺序：① 重新构建单文件网页 → ② cap sync 把产物塞进安卓工程 → ③ gradlew 打包
 * 第 ① 步不能省：只 sync 不重新构建的话，会把上一次的 dist 打进 APK，
 * 改了代码却拿到旧包，而且不会有任何报错。
 *
 * 工具链（JDK 21 + Android SDK）按这个顺序找：
 *   1. 环境变量 JAVA_HOME / ANDROID_HOME
 *   2. 仓库同级的 .android-tools/
 *   3. 本机已知位置（TOOL_FALLBACKS，方便在这个开发机上直接跑）
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'android');
const VARIANT = (process.argv[2] ?? 'debug').toLowerCase();
const IS_WIN = process.platform === 'win32';

const TOOL_FALLBACKS = [
  join(ROOT, '..', '.android-tools'),
  'D:/github/ElectroTutor-2026.10/.android-tools', // 本机上已有的工具链，避免重复下载
];

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function findJdk() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin'))) return process.env.JAVA_HOME;
  for (const dir of TOOL_FALLBACKS) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir)
      .filter((n) => /^jdk/i.test(n))
      .map((n) => join(dir, n))
      .find((p) => existsSync(join(p, 'bin')));
    if (hit) return hit;
  }
  return null;
}

function findSdk() {
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const v = process.env[key];
    if (v && existsSync(v)) return v;
  }
  for (const dir of TOOL_FALLBACKS) {
    const candidate = join(dir, 'android-sdk');
    if (existsSync(join(candidate, 'platform-tools'))) return candidate;
  }
  const localProps = join(ANDROID_DIR, 'local.properties');
  if (existsSync(localProps)) {
    const m = /sdk\.dir\s*=\s*(.+)/.exec(readFileSync(localProps, 'utf8'));
    if (m) {
      const dir = m[1].trim().replace(/\\\\/g, '\\').replace(/\\:/g, ':');
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

function run(cmd, args, cwd, extraEnv = {}) {
  const file = IS_WIN ? 'cmd.exe' : cmd;
  const fileArgs = IS_WIN ? ['/d', '/s', '/c', cmd, ...args] : args;
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(file, fileArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  });
  if (res.error) fail(`${cmd} 启动失败：${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} 退出码 ${res.status}`);
}

/**
 * Gradle 的家目录。
 * 默认是 ~/.gradle，但它不在工作区里——受限环境下 Gradle 连 wrapper 的 .lck
 * 文件都建不出来，会直接报「拒绝访问」。所以优先用仓库内的 .gradle-home
 * （由 npm run setup:gradle 从已有缓存复制过来，里面的依赖缓存能省掉全部下载）。
 */
function findGradleHome() {
  if (process.env.GRADLE_USER_HOME && existsSync(process.env.GRADLE_USER_HOME)) return process.env.GRADLE_USER_HOME;
  const local = join(ROOT, '.gradle-home');
  if (existsSync(local)) return local;
  for (const dir of TOOL_FALLBACKS) {
    const candidate = join(dir, 'gradle-home');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------ 前置检查 ------------------------------ */

const jdk = findJdk();
if (!jdk) fail('找不到 JDK 21。装一个并设置 JAVA_HOME，或把 JDK 放到仓库同级的 .android-tools/jdk-21/');
const sdk = findSdk();
if (!sdk) fail('找不到 Android SDK。设置 ANDROID_HOME，或把 SDK 放到仓库同级的 .android-tools/android-sdk/');
const gradleHome = findGradleHome();
if (!existsSync(join(ROOT, 'node_modules', '@capacitor', 'cli'))) {
  fail('还没有装依赖。先执行：npm install');
}
if (!existsSync(ANDROID_DIR)) {
  fail('还没有 android/ 工程。先执行：npx cap add android');
}

console.log('=== 构建环境 ===');
console.log(`  JDK        : ${jdk}`);
console.log(`  Android SDK: ${sdk}`);
console.log(`  Gradle 缓存: ${gradleHome || '（默认 ~/.gradle）'}`);
console.log(`  构建类型   : ${VARIANT}`);

const debugKeystore = process.env.WTW_DEBUG_KEYSTORE || join(ROOT, '.android-home', 'debug.keystore');
if (VARIANT !== 'release' && !existsSync(debugKeystore)) {
  fail(
    `找不到 debug 签名文件：${debugKeystore}\n` +
      '   执行 npm run setup:android 复制一份（会让构建完全不依赖工作区外的路径）',
  );
}

/* ------------------------------ 开始构建 ------------------------------ */

// ① 重新打包网页（保证打进 APK 的是最新代码）
run('node', ['scripts/build.mjs'], ROOT);

// ② 同步进安卓工程
run('npx', ['cap', 'sync', 'android'], ROOT);

// ②.5 清掉不该进 APK 的东西。
//      dist 里给用户直接下载的「吃啥转盘.html」和 index.html 是同一份内容，
//      打进 APK 纯属白白多一份体积；万一 dist 里还躺着上一版的 .apk，
//      那更会被整包塞进来（真的发生过一次，APK 里套 APK）。这里统一剔除。
const assetsDir = join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'public');
if (existsSync(assetsDir)) {
  for (const name of readdirSync(assetsDir)) {
    const redundant = name === '吃啥转盘.html' || name.startsWith('_') || /\.apk$/i.test(name);
    if (redundant) {
      rmSync(join(assetsDir, name), { force: true });
      console.log(`   （已从 APK 资源里剔除 ${name}）`);
    }
  }
}

// ③ Gradle 打包
const gradle = join(ANDROID_DIR, IS_WIN ? 'gradlew.bat' : 'gradlew');
if (!existsSync(gradle)) fail(`找不到 Gradle Wrapper：${gradle}`);
const task = VARIANT === 'release' ? 'assembleRelease' : 'assembleDebug';
run(gradle, [task, '--no-daemon'], ANDROID_DIR, {
  JAVA_HOME: jdk,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  ...(gradleHome ? { GRADLE_USER_HOME: gradleHome } : {}),
});

/* ------------------------------ 汇报 ------------------------------ */

const outDir = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', VARIANT);
if (!existsSync(outDir)) fail(`构建结束了，但没找到产物目录：${outDir}`);
const apks = readdirSync(outDir).filter((f) => f.endsWith('.apk'));
if (!apks.length) fail('构建结束了，但没有生成 apk');

// 复制一份到 release/，文件名带版本，方便直接发给别人。
// 注意别放进 dist/——cap sync 会把 dist 整个拷进 APK 资源，放进去就成了「APK 里套 APK」。
const releaseDir = join(ROOT, 'release');
mkdirSync(releaseDir, { recursive: true });
const version = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(join(ROOT, 'package.json'), 'utf8'))?.[1] ?? '1.0.0';
const friendly = join(releaseDir, `吃啥转盘-v${version}-${VARIANT}.apk`);
copyFileSync(join(outDir, apks[0]), friendly);

console.log('\n✅ APK 好了：');
for (const apk of apks) {
  const full = join(outDir, apk);
  console.log(`   ${full}  (${(statSync(full).size / 1024 / 1024).toFixed(1)} MB)`);
}
console.log(`   已另存一份：${friendly}`);
console.log('\n装到手机（需要开 USB 调试）：');
console.log(`   "${join(sdk, 'platform-tools', IS_WIN ? 'adb.exe' : 'adb')}" install -r "${friendly}"`);
console.log('或者直接把 apk 发到手机上点安装。');

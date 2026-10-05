/**
 * build.mjs · 把 src/ 里的 HTML + CSS + JS 打包成「一个文件就能跑」的单文件网页。
 *
 * 为什么不用 Vite/Webpack：
 *   这个应用总共就几百 KB、零第三方运行时依赖，用打包器属于杀鸡用牛刀。
 *   这里只做一件真正必要的事——把外链的 css/js 内联进 HTML，
 *   这样产物是**一个 .html 文件**：微信发给自己、丢进手机文件管理器、
 *   用 file:// 直接双击打开都能用，不需要服务器，也不需要联网（识别功能除外）。
 *
 * 用法：node scripts/build.mjs
 * 产物：dist/index.html（Capacitor 打包 APK 用）和 dist/吃啥转盘.html（发给别人用）
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

// 顺序不能乱：后面的模块依赖前面的（都是挂到 window.W 上的 IIFE）
const JS_ORDER = ['util.js', 'store.js', 'classify.js', 'wheel.js', 'vision.js', 'ui.js', 'app.js'];

function read(p) {
  return readFileSync(p, 'utf8');
}

const html = read(join(SRC, 'index.html'));
const css = read(join(SRC, 'styles.css'));
const js = JS_ORDER.map((name) => {
  const code = read(join(SRC, 'js', name));
  if (/<\/script/i.test(code)) {
    throw new Error(`${name} 里出现了 </script，内联进 HTML 会截断脚本，请改写`);
  }
  return `/* ===== ${name} ===== */\n${code}`;
}).join('\n');

if (!html.includes('<!-- INLINE:styles.css -->')) throw new Error('index.html 里找不到 CSS 占位注释');
if (!html.includes('<!-- INLINE:js -->')) throw new Error('index.html 里找不到 JS 占位注释');

// 注意：replace 的第二个参数如果是字符串，`$$`、`$&` 这些会被当成特殊转义序列，
// 代码里的 `$$: $$` 会被悄悄改写成 `$`（这个坑真的踩过一次），所以必须用函数式替换。
const out = html
  .replace('<!-- INLINE:styles.css -->', () => `<style>\n${css}\n</style>`)
  .replace('<!-- INLINE:js -->', () => `<script>\n${js}\n</script>`);

mkdirSync(DIST, { recursive: true });

const targets = [join(DIST, 'index.html'), join(DIST, '吃啥转盘.html')];
for (const file of targets) writeFileSync(file, out, 'utf8');

const kb = (statSync(targets[0]).size / 1024).toFixed(1);
console.log(`✅ 构建完成：${kb} KB`);
for (const file of targets) console.log(`   ${file}`);
console.log('\n直接双击 dist/吃啥转盘.html 就能用（无需服务器）。');
console.log('想要拍照识别不跨域，用：npm run serve');

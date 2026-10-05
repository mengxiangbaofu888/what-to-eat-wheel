/**
 * smoke-test.mjs · 不打开浏览器，用 jsdom 把整个应用真跑一遍
 *
 * 验证的是「真的能启动」这件事：脚本没有语法错误、DOM 元素都能找到、
 * 第一次打开会自动铺示例菜、点「转」能转出结果、增删改查不会抛异常。
 * canvas 用假的 2D context 顶替（jsdom 不自带画布），绘制调用只记录不渲染。
 *
 * 用法：node scripts/smoke-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

const problems = [];
const checks = [];
function ok(name, extra = '') { checks.push(`  ✅ ${name}${extra ? '　' + extra : ''}`); console.log(checks[checks.length - 1]); }
function bad(name, detail) { problems.push(name); checks.push(`  ❌ ${name}\n       ${detail}`); console.log(checks[checks.length - 1]); }

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => {
  problems.push('jsdomError: ' + e.message);
  console.log('  ⚠️ jsdomError: ' + (e.detail ? e.detail.stack || e.detail : e.message));
});
virtualConsole.on('error', (msg) => {
  problems.push('console.error: ' + msg);
  console.log('  ⚠️ console.error: ' + msg);
});
virtualConsole.on('warn', (msg) => console.log('  · warn: ' + msg));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/',
  virtualConsole,
  beforeParse(window) {
    // ---- 假 canvas ----
    const noop = () => {};
    const fakeCtx = {
      canvas: null,
      setTransform: noop, clearRect: noop, save: noop, restore: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
      fill: noop, stroke: noop, fillRect: noop, strokeRect: noop,
      translate: noop, rotate: noop, scale: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: (t) => ({ width: String(t).length * 8 }),
      fillText: noop, strokeText: noop, setLineDash: noop, drawImage: noop,
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    };
    window.HTMLCanvasElement.prototype.getContext = function () {
      const ctx = Object.create(fakeCtx);
      ctx.canvas = this;
      return ctx;
    };
    // jsdom 的布局都是 0，给个固定尺寸，让转盘按真实大小算
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 360, height: 360, top: 0, left: 0, right: 360, bottom: 360, x: 0, y: 0 };
    };
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => 360, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get: () => 360, configurable: true });
  },
});

const { window } = dom;
const doc = window.document;
const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => Array.from(doc.querySelectorAll(sel));

function click(node) {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(400);

console.log('\n=== 吃啥转盘 · 冒烟测试 ===\n');

/* ---------------- 启动 ---------------- */

if (!window.W || !window.W.Store || !window.W.Wheel) bad('模块挂载', 'window.W 上缺少模块');
else ok('模块挂载', 'W.Util / W.Store / W.Classify / W.Wheel / W.Vision / W.UI');

const S = window.W.Store;

if (S.data.items.length !== 7) bad('首次打开自动铺示例菜', `期望 7 道，实际 ${S.data.items.length}`);
else ok('首次打开自动铺示例菜', '7 道菜 / 3 个大类');

const seededNames = S.data.items.map((i) => i.name);
if (!seededNames.includes('麻辣鸡丁滑蛋饭')) bad('示例数据内容', JSON.stringify(seededNames));
else ok('示例数据内容', seededNames.slice(0, 3).join('、') + ' …');

const hdfCat = S.categoryByName('滑蛋饭');
if (!hdfCat) bad('示例菜已分好大类', '找不到「滑蛋饭」大类');
else {
  const inCat = S.itemsOf(hdfCat.id).map((i) => i.name);
  if (inCat.length === 3) ok('示例菜已分好大类', '滑蛋饭 → ' + inCat.join('、'));
  else bad('示例菜已分好大类', JSON.stringify(inCat));
}

/* ---------------- 界面渲染 ---------------- */

const groups = $$('#cat-list .cat-group');
if (groups.length < 3) bad('分类列表渲染', `只渲染了 ${groups.length} 组`);
else ok('分类列表渲染', `${groups.length} 组（含未分类）`);

const itemRows = $$('#cat-list .cat-item');
if (itemRows.length !== 7) bad('菜品条目渲染', `期望 7 行，实际 ${itemRows.length}`);
else ok('菜品条目渲染', '7 行');

if ($('#spin-sub').textContent !== '7 个') bad('转盘计数', $('#spin-sub').textContent);
else ok('转盘计数', '7 个');

const canvas = $('#wheel');
if (!canvas.width || canvas.width < 100) bad('转盘画布尺寸', `canvas.width=${canvas.width}`);
else ok('转盘画布尺寸', `${canvas.width}×${canvas.height}`);

/* ---------------- 添加 / 归类 ---------------- */

const addInput = $('#add-input');
addInput.value = '黑椒鸡排滑蛋饭';
click($('#btn-add'));
await wait(30);

const addedItem = S.itemByName('黑椒鸡排滑蛋饭');
if (!addedItem) bad('手动添加菜品', '没加进去');
else ok('手动添加菜品', '黑椒鸡排滑蛋饭');
if (addedItem && !addedItem.categoryId) bad('新菜自动归入已有大类', 'categoryId 为空');
else ok('新菜自动归入已有大类', '→ 滑蛋饭');

// 一次粘贴多行：<input> 会吞掉换行，必须走 paste 事件这条路径（这也是真实浏览器的行为）
const pasteEv = new window.Event('paste', { bubbles: true, cancelable: true });
pasteEv.clipboardData = { getData: () => '酸辣土豆丝\n宫保鸡丁\n酸辣土豆丝' };
addInput.dispatchEvent(pasteEv);
await wait(30);
if (!S.itemByName('酸辣土豆丝') || !S.itemByName('宫保鸡丁')) bad('粘贴多行批量添加', '有菜没加进去');
else ok('粘贴多行批量添加', '两行都加了，重复行被忽略');
// 用分隔符在一行里写多道菜
addInput.value = '可乐鸡翅、糖醋排骨';
click($('#btn-add'));
await wait(30);
if (!S.itemByName('可乐鸡翅') || !S.itemByName('糖醋排骨')) bad('顿号分隔批量添加', '有菜没加进去');
else ok('顿号分隔批量添加', '一行里两道菜都加了');
if (S.data.items.length !== 12) bad('重复菜名不重复添加', `期望 12 道，实际 ${S.data.items.length}`);
else ok('重复菜名不重复添加', '12 道');

/* ---------------- 勾选 ---------------- */

$('#btn-none') && click($('#btn-none'));
await wait(20);
if (S.enabledItems().length !== 0) bad('全不选', `还剩 ${S.enabledItems().length} 道`);
else ok('全不选');

const firstCatHead = $('#cat-list .cat-head input[type=checkbox]');
click(firstCatHead);
await wait(20);
const g = S.groups()[0];
const onInGroup = g.items.filter((i) => i.enabled).length;
if (onInGroup !== g.items.length) bad('勾选整个大类', `${onInGroup}/${g.items.length}`);
else ok('勾选整个大类', `「${g.name}」${onInGroup} 道全部上盘`);

click($('#btn-all'));
await wait(20);
if (S.enabledItems().length !== S.data.items.length) bad('全选', '不是全部选中');
else ok('全选', `${S.enabledItems().length} 道`);

/* ---------------- 转盘 ---------------- */

const spinBtn = $('#btn-spin');
S.setSetting('duration', 1.2);   // 测试里别真等 4.5 秒
await wait(20);
click(spinBtn);
await wait(2600);

const resultCard = $('#result-card');
if (resultCard.hidden) bad('转盘出结果', '结果卡片还是隐藏的');
else {
  const name = $('#result-name').textContent;
  if (!name || name === '—') bad('转盘出结果', '没写出菜名');
  else ok('转盘出结果', '抽到「' + name + '」');
}
if (!S.data.history.length) bad('历史记录', '没记录');
else ok('历史记录', S.data.history.slice(0, 3).join('、'));

/* ---------------- 设置 / 持久化 ---------------- */

S.setVision({ apiKey: 'sk-test-123', baseUrl: 'https://example.com/v1', model: 'test-vl' });
await wait(500);   // 写入是防抖的，等它落盘
const raw = window.localStorage.getItem('whatToEatWheel.v1');
if (!raw || raw.indexOf('sk-test-123') < 0) bad('本地持久化', 'localStorage 里没写进去');
else ok('本地持久化', 'localStorage 键 whatToEatWheel.v1');

const exported = S.exportObject();
if (exported.settings.vision.apiKey) bad('导出备份不带 Key', '导出内容里有 apiKey');
else ok('导出备份不带 Key', `${exported.items.length} 道菜 / ${exported.categories.length} 个大类`);

// 导入回去应该只跳过重复、不报错
const before = S.data.items.length;
const r = S.importObject(exported, 'append');
if (r.added !== 0 || r.dup !== before) bad('导入去重', JSON.stringify(r));
else ok('导入去重', `重复 ${r.dup} 道全部跳过`);

/* ---------------- 删除 / 清空 ---------------- */

S.removeItem(addedItem.id);
await wait(20);
if (S.itemByName('黑椒鸡排滑蛋饭')) bad('删除菜品', '没删掉');
else ok('删除菜品');

S.removeCategory(hdfCat.id, 'keep');
await wait(20);
const orphan = S.data.items.filter((i) => i.name.indexOf('滑蛋饭') >= 0);
if (S.categoryByName('滑蛋饭')) bad('删除大类', '大类还在');
else if (orphan.some((i) => i.categoryId)) bad('只解散大类时菜品保留', '菜品还挂在不存在的类上');
else ok('删除大类', '大类解散，' + orphan.length + ' 道菜回到未分类');

/* ---------------- 结果 ---------------- */

console.log(`\n=== ${checks.filter((c) => c.includes('✅')).length} 项通过，${problems.length} 项失败 ===`);
if (problems.length) {
  console.log('失败项：\n' + problems.map((p) => '  · ' + p).join('\n'));
  process.exit(1);
}
console.log('全部通过 🎉\n');
dom.window.close();
process.exit(0);

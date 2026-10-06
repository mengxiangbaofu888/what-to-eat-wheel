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

/** 给 jsdom 补上浏览器里才有的东西：假 canvas、假的元素尺寸 */
function stubBrowser(window, opts = {}) {
  // 标记「已经看过帮助」，免得启动 500ms 后的自动弹窗在测试中途冒出来打乱节奏
  try { window.localStorage.setItem('wtw-seen-help', '1'); } catch { /* ignore */ }
  if (opts.native) window.Capacitor = { isNativePlatform: () => true };

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
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/',
  virtualConsole,
  beforeParse(window) { stubBrowser(window); },
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

/* ---------------- 遮罩：曾经的致命 bug ---------------- */

// 线上出过一次「一打开就卡死」：`.modal-mask { display: grid }` 的优先级压过了
// 浏览器默认的 `[hidden] { display: none }`，于是遮罩从一开始就盖在整个界面上，
// 里面还是个空弹窗，点哪儿都没反应。
// jsdom 不做完整的 CSS 层叠（它两种情况都返回 none），复现不了这个 bug，
// 所以这里退一步：静态检查兜底规则还在，再真开一次弹窗确认有内容、点遮罩能关掉。
const cssText = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
if (!/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(cssText)) {
  bad('CSS 兜底规则 [hidden]', '缺少 [hidden] { display: none !important }，遮罩会一直盖住整个界面');
} else {
  ok('CSS 兜底规则 [hidden]', '[hidden] { display: none !important }');
}

const maskEl = $('#modal-mask');
const modalEl = $('#modal');
if (!maskEl.hidden) bad('刚启动时遮罩必须是关的', 'mask.hidden 是 false，界面会被挡住');
else ok('刚启动时遮罩必须是关的');

click($('#btn-help'));
await wait(60);
if (maskEl.hidden) bad('帮助弹窗能打开', 'mask 还是 hidden');
else if (!modalEl.childNodes.length) bad('帮助弹窗必须有内容', '弹窗是空的——这就是「一进去就卡死」的那个 bug');
else ok('帮助弹窗有内容', JSON.stringify(modalEl.textContent.slice(0, 16) + '…'));

click(maskEl);   // 点遮罩上的空白处应该能关掉
await wait(60);
if (!maskEl.hidden) bad('点遮罩空白处能关掉弹窗', '关不掉就会把界面彻底卡死');
else ok('点遮罩空白处能关掉弹窗');

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

/* ---------------- 「就吃这个」把结果定下来 ---------------- */

click($('#btn-done'));
await wait(120);
if ($('#decided-card').hidden) bad('点「就吃这个」应该出现已定卡片', '卡片还是隐藏的');
else ok('点「就吃这个」应该出现已定卡片', $('#decided-name').textContent);
if (!S.todayDecided()) bad('决定要记下来（当天有效）', 'todayDecided() 是空的');
else ok('决定要记下来（当天有效）', S.todayDecided().day);

click($('#btn-undecide'));
await wait(80);
if (!$('#decided-card').hidden) bad('点「换一个」应该取消已定状态', '卡片还在');
else ok('点「换一个」应该取消已定状态');

/* ---------------- 自己建大类 / 改名 / 菜单 ---------------- */

function buttonByText(root, text) {
  return Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').trim().includes(text));
}

click($('#btn-newcat'));
await wait(80);
let modal = $('#modal');
if (!modal.querySelector('input')) bad('新建大类：应该弹出输入框', '没找到 input');
else {
  modal.querySelector('input').value = '我的自定义大类';
  click(buttonByText(modal, '创建'));
  await wait(400);   // 创建完会顺带问一句要不要往里加菜
  const skip = buttonByText($('#modal'), '先不加');
  if (skip) click(skip);
  await wait(80);
  if (!S.categoryByName('我的自定义大类')) bad('新建大类：建出来了', '数据里找不到');
  else ok('新建大类', '「我的自定义大类」');

  // 往这个大类里加菜
  const cat = S.categoryByName('我的自定义大类');
  click(groupMenuFor(cat.name));
  await wait(80);
  const addItem = buttonByText($('#modal'), '往这个大类里加菜');
  if (!addItem) bad('大类菜单：应该有「往这个大类里加菜」', '没找到菜单项');
  else {
    click(addItem);
    await wait(80);
    const ta = $('#modal').querySelector('textarea');
    if (!ta) bad('往大类里加菜：应该有输入框', '没找到 textarea');
    else {
      ta.value = '测试菜甲\n测试菜乙';
      click(buttonByText($('#modal'), '加进去'));
      await wait(120);
      const inCat = S.itemsOf(cat.id).map((i) => i.name);
      if (inCat.length !== 2) bad('往大类里加菜', `期望 2 道，实际 ${inCat.length}`);
      else ok('往大类里加菜', inCat.join('、'));
    }
  }

  // 点大类右边的 ⋯ → 重命名
  click(groupMenuFor(cat.name));
  await wait(80);
  const renameItem = buttonByText($('#modal'), '重命名这个大类');
  if (!renameItem) bad('大类菜单：应该有「重命名这个大类」', '没找到菜单项');
  else {
    click(renameItem);
    await wait(80);
    const input = $('#modal').querySelector('input');
    input.value = '改名后的大类';
    click(buttonByText($('#modal'), '保存'));
    await wait(120);
    if (!S.categoryByName('改名后的大类')) bad('大类改名', '改完找不到新名字');
    else ok('大类改名', '我的自定义大类 → 改名后的大类');
  }
}

/** 找到某个大类那一组的 ⋯ 按钮 */
function groupMenuFor(catName) {
  const groups = $$('#cat-list .cat-group');
  for (const grp of groups) {
    const nameEl = grp.querySelector('.cat-name');
    if (nameEl && nameEl.textContent.trim() === catName) {
      return grp.querySelector('.cat-head button.mini');
    }
  }
  return null;
}

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

/* ---------------- 安卓原生壳的安全区（顶栏被状态栏挡住的那个问题） ---------------- */

if (!/html\.is-native\s*\{[^}]*--safe-t:\s*max\(env\(safe-area-inset-top/.test(cssText)) {
  bad('CSS 有原生壳安全区兜底', '缺少 html.is-native { --safe-t: max(env(safe-area-inset-top), 36px) }');
} else {
  ok('CSS 有原生壳安全区兜底', '--safe-t: max(env(safe-area-inset-top), 36px)');
}

// 再开一个「假装自己是安卓壳」的实例：window.Capacitor 在的时候应该给 html 打上 is-native
const nativeDom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/',
  virtualConsole: new VirtualConsole(),
  beforeParse(window) { stubBrowser(window, { native: true }); },
});
await wait(250);
const nativeHtml = nativeDom.window.document.documentElement;
if (!nativeHtml.classList.contains('is-native')) bad('原生壳里会给 html 加 is-native', 'class 没加上，顶栏还是会被状态栏压住');
else ok('原生壳里会给 html 加 is-native');
nativeDom.window.close();

/* ---------------- 结果 ---------------- */

console.log(`\n=== ${checks.filter((c) => c.includes('✅')).length} 项通过，${problems.length} 项失败 ===`);
if (problems.length) {
  console.log('失败项：\n' + problems.map((p) => '  · ' + p).join('\n'));
  process.exit(1);
}
console.log('全部通过 🎉\n');
dom.window.close();
process.exit(0);

/**
 * test-classify.mjs · 智能归类的自测（纯 Node，不需要浏览器）
 *
 * classify.js / util.js 都是「挂到 window.W」的 IIFE，所以在 Node 里用 vm
 * 造一个假的 window 就能直接跑，比引一堆测试框架省事。
 *
 * 用法：node scripts/test-classify.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'js');

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
vm.createContext(sandbox);

for (const file of ['util.js', 'classify.js']) {
  vm.runInContext(readFileSync(join(SRC, file), 'utf8'), sandbox, { filename: file });
}

const { Classify } = sandbox.W;

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}\n     期望 ${e}\n     实际 ${a}`); }
}

/** 把 planAll 的结果翻译成「菜名 -> 大类名」，方便断言 */
function groupNames(items, categories = []) {
  const plan = Classify.planAll(items, categories);
  const created = {};
  plan.created.forEach((c) => { created[c.id] = c.name; });
  const catName = {};
  categories.forEach((c) => { catName[c.id] = c.name; });
  const out = {};
  for (const it of items) {
    const cid = plan.assign[it.id];
    if (!cid) continue;
    out[it.name] = catName[cid] || created[cid] || '?';
  }
  out.__created = plan.created.map((c) => c.name).sort();
  return out;
}

console.log('\n=== 智能归类自测 ===\n');

console.log('1) 用户给的例子：滑蛋饭家族');
check('麻辣鸡丁滑蛋饭 / 五花肉滑蛋饭 → 大类「滑蛋饭」',
  groupNames([
    { id: 'a', name: '麻辣鸡丁滑蛋饭' },
    { id: 'b', name: '五花肉滑蛋饭' },
  ]),
  { '麻辣鸡丁滑蛋饭': '滑蛋饭', '五花肉滑蛋饭': '滑蛋饭', __created: ['滑蛋饭'] });

console.log('\n2) 单个菜不应该被归类');
check('只有一道菜时不建大类',
  groupNames([{ id: 'a', name: '麻辣鸡丁滑蛋饭' }]),
  { __created: [] });

console.log('\n3) 不相干的菜名不能被硬凑成一类');
check('黄焖鸡米饭 / 麻辣香锅 各自独立',
  groupNames([
    { id: 'a', name: '黄焖鸡米饭' },
    { id: 'b', name: '麻辣香锅' },
  ]),
  { __created: [] });

console.log('\n4) 已有大类名出现在菜名里 → 直接归入该大类');
check('番茄滑蛋饭 → 已有的「滑蛋饭」大类',
  groupNames(
    [{ id: 'a', name: '番茄滑蛋饭' }, { id: 'b', name: '咖喱滑蛋饭' }],
    [{ id: 'cat1', name: '滑蛋饭' }],
  ),
  { '番茄滑蛋饭': '滑蛋饭', '咖喱滑蛋饭': '滑蛋饭', __created: [] });

console.log('\n5) 更长的后缀优先（不能归成「蛋饭」）');
check('三字后缀胜过两字后缀', Classify.commonSuffix('麻辣鸡丁滑蛋饭', '五花肉滑蛋饭'), '滑蛋饭');

console.log('\n6) 面食家族');
check('红烧牛肉面 / 兰州牛肉面 → 大类「牛肉面」',
  groupNames([
    { id: 'a', name: '红烧牛肉面' },
    { id: 'b', name: '兰州牛肉面' },
  ]),
  { '红烧牛肉面': '牛肉面', '兰州牛肉面': '牛肉面', __created: ['牛肉面'] });

console.log('\n7) 加新菜时的建议');
check('加「黑椒鸡排滑蛋饭」，建议归到已有的滑蛋饭',
  Classify.suggestForNew('黑椒鸡排滑蛋饭', [{ id: 'x', name: '麻辣鸡丁滑蛋饭' }], []),
  { newCategoryName: '滑蛋饭', mateItemId: 'x' });

check('加「照烧鸡腿饭」，老菜名是「黄焖鸡米饭」→ 不建议归类',
  Classify.suggestForNew('照烧鸡腿饭', [{ id: 'x', name: '黄焖鸡米饭' }], []),
  null);

console.log(`\n=== 结果：${passed} 项通过，${failures.length} 项失败 ===`);
if (failures.length) {
  console.log('失败项：' + failures.join('、'));
  process.exit(1);
}
console.log('全部通过 🎉\n');

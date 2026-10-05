/**
 * render-wheel.mjs · 把转盘的绘制代码在 Node 里跑一遍，导出 PNG 来看
 *
 * 为什么要这个：转盘是 canvas 手绘的，光看代码看不出「文字会不会太小 / 会不会
 * 倒过来 / 扇区多了会不会糊成一团」。这台开发机上没有可用的无头浏览器，
 * 所以直接用 @napi-rs/canvas 提供真实的 canvas 实现，跑的是 src/js/wheel.js
 * 同一份代码，导出的 PNG 就是真机上会看到的画面。
 *
 * 用法：node scripts/render-wheel.mjs
 * 产物：docs/screenshots/wheel-7.png、wheel-24.png
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

/* ---- 造一个够用的浏览器环境，让 util.js / wheel.js 能跑起来 ---- */

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = setTimeout;
sandbox.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
sandbox.cancelAnimationFrame = clearTimeout;
sandbox.devicePixelRatio = 1;
sandbox.AudioContext = undefined;      // 没声音，正好
sandbox.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(sandbox);

for (const f of ['util.js', 'wheel.js']) {
  vm.runInContext(readFileSync(join(ROOT, 'src', 'js', f), 'utf8'), sandbox, { filename: f });
}

const { Wheel } = sandbox.W;

/** 画一张：size 逻辑像素，背景用应用的深色底 */
function render(items, file, size = 420, highlight = -1) {
  const real = createCanvas(size, size);
  // Wheel 只用到 canvas.getContext / getBoundingClientRect / width / height
  real.getBoundingClientRect = () => ({ width: size, height: size, top: 0, left: 0, right: size, bottom: size });
  const wheel = new Wheel(real, {});
  wheel.size = size;
  wheel.radius = size / 2 - 6;
  wheel.setItems(items.map((name, i) => ({ id: 'i' + i, name })));
  wheel.highlightIndex = highlight;
  wheel.draw();

  const out = createCanvas(size, size);
  const ctx = out.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#151221');
  g.addColorStop(1, '#1e1930');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(real, 0, 0);

  writeFileSync(join(OUT, file), out.toBuffer('image/png'));
  console.log(`  ${file}  ${items.length} 个扇区`);
}

console.log('\n=== 转盘渲染检查 ===\n');

render(['麻辣鸡丁滑蛋饭', '五花肉滑蛋饭', '番茄滑蛋饭', '兰州牛肉面', '黄焖鸡米饭', '麻辣香锅', '宫保鸡丁'],
  'wheel-7.png', 420, 2);

render(['酸辣土豆丝', '宫保鸡丁', '鱼香肉丝', '红烧牛肉面', '番茄鸡蛋面', '兰州拉面', '扬州炒饭', '蛋炒饭',
  '麻辣香锅', '黄焖鸡米饭', '可乐鸡翅', '糖醋排骨', '手抓饼', '肉夹馍', '麻辣烫', '砂锅米线',
  '滑蛋牛肉饭', '咖喱鸡排饭', '照烧鸡腿饭', '卤肉饭', '小笼包', '肠粉', '烧麦', '煎饼果子'],
  'wheel-24.png', 420, -1);

console.log('\n产物目录：' + OUT + '\n');

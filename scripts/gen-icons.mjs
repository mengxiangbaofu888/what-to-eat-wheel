/**
 * gen-icons.mjs · 生成安卓图标和启动图（默认的那个 Capacitor 图标太敷衍了）
 *
 * 用 @napi-rs/canvas 直接画：一个六色转盘。
 * 尺寸不是拍脑袋定的——先把 Capacitor 生成的原始 PNG 读进来量一下，
 * 按它原本的像素尺寸重新画，避免图标被系统拉伸变形。
 *
 * 用法：node scripts/gen-icons.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SHOTS = join(ROOT, 'docs', 'screenshots');

const BG_DARK = '#151221';
const SECTOR_COLORS = ['#ff8a3d', '#ffd166', '#06d6a0', '#8a5cf6', '#ef476f', '#4cc9f0'];

/** 在 (cx,cy) 画一个半径 R 的六色转盘 */
function drawWheel(ctx, cx, cy, R) {
  const n = SECTOR_COLORS.length;
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, i * step - Math.PI / 2, (i + 1) * step - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = SECTOR_COLORS[i];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, R * 0.035);
    ctx.stroke();
  }
  // 外圈
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, R * 0.09);
  ctx.stroke();
  // 中心
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // 中心内圈：轻轻一圈描边，像转盘中间那个按钮
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(21,18,33,0.22)';
  ctx.lineWidth = Math.max(1, R * 0.045);
  ctx.stroke();
}

/** 圆形裁切 */
function circleClip(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * kind：
 *   'legacy' —— 普通图标（方形圆角底 + 转盘）
 *   'round'  —— 圆形图标
 *   'fg'     —— 自适应图标的前景层（透明底，转盘画小一点，四周留安全边距）
 */
function renderIcon(size, kind) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#241d3d');
  grad.addColorStop(1, BG_DARK);

  if (kind === 'fg') {
    drawWheel(ctx, cx, cy, size * 0.31);   // 自适应图标只有中间 ~66% 一定会显示
    return c;
  }

  ctx.fillStyle = grad;
  if (kind === 'round') {
    circleClip(ctx, cx, cy, size / 2);
    ctx.fillRect(0, 0, size, size);
  } else {
    roundRect(ctx, 0, 0, size, size, size * 0.22);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0, 0, size, size, size * 0.22);
    ctx.clip();
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
  drawWheel(ctx, cx, cy, size * 0.34);
  return c;
}

/** 启动图：深色底 + 居中的转盘（不放文字，避免缺中文字体变成方块） */
function renderSplash(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a1530');
  grad.addColorStop(1, BG_DARK);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  drawWheel(ctx, w / 2, h / 2, Math.min(w, h) * 0.22);
  return c;
}

/* ------------------------------ 主流程 ------------------------------ */

if (!existsSync(RES)) {
  console.error('❌ 找不到 android/app/src/main/res，先执行：npx cap add android');
  process.exit(1);
}

const MIPMAPS = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
let count = 0;

for (const d of MIPMAPS) {
  const dir = join(RES, `mipmap-${d}`);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!/^ic_launcher(_round|_foreground)?\.png$/.test(file)) continue;
    const full = join(dir, file);
    const img = await loadImage(readFileSync(full));
    const kind = file.includes('foreground') ? 'fg' : file.includes('round') ? 'round' : 'legacy';
    writeFileSync(full, renderIcon(img.width, kind).toBuffer('image/png'));
    count++;
    console.log(`  ${`mipmap-${d}/${file}`.padEnd(38)} ${img.width}×${img.height}  ${kind}`);
  }
}

// 启动图：保持原始像素尺寸，逐个重新画
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (name.name === 'splash.png') out.push(full);
  }
  return out;
}

for (const full of walk(RES)) {
  const img = await loadImage(readFileSync(full));
  writeFileSync(full, renderSplash(img.width, img.height).toBuffer('image/png'));
  count++;
  console.log(`  ${full.replace(RES + '\\', '').replace(RES + '/', '').padEnd(38)} ${img.width}×${img.height}  splash`);
}

// 自适应图标的背景层：换成应用的深色底
const bgXml = join(RES, 'drawable', 'ic_launcher_background.xml');
if (existsSync(bgXml)) {
  writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#151221" android:pathData="M0,0h108v108h-108z" />
</vector>
`, 'utf8');
  count++;
  console.log('  drawable/ic_launcher_background.xml          纯色底 #151221');
}

// 顺手导出一张给 README 用的图标
mkdirSync(SHOTS, { recursive: true });
writeFileSync(join(SHOTS, 'icon.png'), renderIcon(512, 'legacy').toBuffer('image/png'));
console.log(`\n✅ 共生成/覆盖 ${count} 个图片资源，另外导出 docs/screenshots/icon.png`);

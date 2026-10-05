/* ============================================================
   wheel.js · 转盘绘制与旋转动画
   指针固定在正上方；旋转角度用弧度表示，canvas 的 0° 指向右侧、顺时针为正。
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});
  var U = W.Util;

  var TWO_PI = Math.PI * 2;
  var POINTER_ANGLE = -Math.PI / 2;   // 正上方

  /* ------------------------------ 音效 ------------------------------ */

  var Sound = {
    ctx: null,
    enabled: true,
    ensure: function () {
      if (this.ctx) return this.ctx;
      var Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return null;
      try { this.ctx = new Ctor(); } catch (e) { this.ctx = null; }
      return this.ctx;
    },
    resume: function () {
      var ctx = this.ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    /** 嘀嗒声：越到后面越慢（由调用方控制频率） */
    tick: function (strength) {
      if (!this.enabled) return;
      var ctx = this.ensure();
      if (!ctx || ctx.state !== 'running') return;
      var t = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1100 + 500 * (strength || 0);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    },
    fanfare: function () {
      if (!this.enabled) return;
      var ctx = this.ensure();
      if (!ctx || ctx.state !== 'running') return;
      var notes = [523.25, 659.25, 783.99, 1046.5];
      var self = this;
      notes.forEach(function (f, i) {
        var t = ctx.currentTime + i * 0.085;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.34);
      });
      void self;
    },
  };

  /* ------------------------------ 转盘 ------------------------------ */

  function Wheel(canvas, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.rotation = POINTER_ANGLE;
    this.size = 320;
    this.radius = 150;
    this.dpr = 1;
    this.spinning = false;
    this.highlightIndex = -1;
    this.onTick = options.onTick || null;
    this.raf = null;
    this.resize();
  }

  Wheel.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var cssSize = Math.max(180, Math.round(Math.min(rect.width || 320, rect.height || 320)));
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    if (this.size === cssSize && this.dpr === dpr) return;
    this.size = cssSize;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.radius = cssSize / 2 - 6;
    this.draw();
  };

  Wheel.prototype.setItems = function (items) {
    this.items = (items || []).slice();
    this.highlightIndex = -1;
    this.draw();
  };

  /** 估算一段文字的宽度（以字号为单位）：中文算 1 个字，英文数字算 0.56 个 */
  function textUnits(s) {
    var u = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      u += /[\u3000-\u9fff\uff00-\uffef]/.test(s[i]) ? 1 : 0.56;
    }
    return u || 1;
  }

  Wheel.prototype.fitText = function (text, maxWidth) {
    var ctx = this.ctx;
    if (ctx.measureText(text).width <= maxWidth) return text;
    var lo = 1, hi = text.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, Math.max(1, lo)) + '…';
  };

  Wheel.prototype.draw = function () {
    var ctx = this.ctx;
    var size = this.size, R = this.radius;
    var cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // 底圈
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    var items = this.items;
    if (!items.length) {
      ctx.save();
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.arc(cx, cy, R - 8, 0, TWO_PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.round(size * 0.055) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('转盘是空的', cx, cy - size * 0.13);
      ctx.font = '400 ' + Math.round(size * 0.042) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText('去下面「菜品」里加几个吧', cx, cy - size * 0.13 + size * 0.07);
      return;
    }

    var n = items.length;
    var step = TWO_PI / n;

    // 字号要在三个约束里取最小：
    //   ① 扇区弧长（扇区越多字越小）② 最长菜名能塞进半径方向 ③ 上限 26px
    // 这样短名字不会被长名字拖累太多，长名字也尽量别被截断。
    var hubR = size * 0.14;                                   // 中心按钮半径
    var maxTextWidth = Math.max(40, R - 16 - hubR - 8);       // 半径方向可用的文字长度
    var longest = 1;
    for (var k = 0; k < n; k++) longest = Math.max(longest, textUnits(items[k].name));
    var byName = maxTextWidth / longest;
    var byArc = step * (R * 0.62) * 0.72;
    var fontSize = U.clamp(Math.min(26, size * 0.075, byArc, byName), 10, 26);
    var showText = byArc >= 10;

    for (var i = 0; i < n; i++) {
      var a0 = this.rotation + i * step;
      var a1 = a0 + step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = U.paletteColor(i, n, 64, i === this.highlightIndex ? 66 : 56);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (this.highlightIndex === i) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.restore();
      }

      if (!showText) continue;

      var mid = a0 + step / 2;
      var norm = ((mid % TWO_PI) + TWO_PI) % TWO_PI;
      var flip = norm > Math.PI / 2 && norm < Math.PI * 1.5;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.textBaseline = 'middle';
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.font = '700 ' + fontSize.toFixed(1) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      var label = this.fitText(items[i].name, maxTextWidth);
      var x = flip ? -(R - 14) : R - 14;
      ctx.fillText(label, x + 0.8, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x, 0);
      ctx.restore();
    }

    // 外圈描边
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1.5, 0, TWO_PI);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
  };

  /**
   * 转动。返回 Promise<{item, index}>
   * opts: { duration: 秒, sound: bool }
   */
  Wheel.prototype.spin = function (opts) {
    var self = this;
    opts = opts || {};
    var items = this.items;
    if (this.spinning) return Promise.resolve(null);
    if (!items.length) return Promise.resolve(null);

    var n = items.length;
    var step = TWO_PI / n;
    var duration = Math.max(1.2, opts.duration || 4.5);
    var winner = Math.floor(Math.random() * n);

    // 让中奖扇区的中心（带一点随机偏移）正好停在指针下
    var jitter = (Math.random() - 0.5) * step * 0.62;
    var target = POINTER_ANGLE - (winner + 0.5) * step + jitter;
    var start = this.rotation;
    var turns = 6 + Math.floor(Math.random() * 2);
    var delta = (((target - start) % TWO_PI) + TWO_PI) % TWO_PI + turns * TWO_PI;

    this.spinning = true;
    this.highlightIndex = -1;
    Sound.resume();

    var startTime = 0;
    var lastSector = null;
    var ease = function (t) { return 1 - Math.pow(1 - t, 3.7); };

    return new Promise(function (resolve) {
      function frame(now) {
        if (!startTime) startTime = now;
        var t = U.clamp((now - startTime) / (duration * 1000), 0, 1);
        var eased = ease(t);
        self.rotation = start + delta * eased;

        if (opts.sound !== false) {
          var sector = Math.floor(self.rotation / step);
          if (lastSector === null) lastSector = sector;
          else if (sector !== lastSector) {
            lastSector = sector;
            Sound.tick(1 - t);
          }
        }

        self.draw();

        if (t < 1) {
          self.raf = global.requestAnimationFrame(frame);
          return;
        }

        self.rotation = ((start + delta) % TWO_PI + TWO_PI) % TWO_PI;
        self.spinning = false;
        self.raf = null;
        self.highlightIndex = winner;
        self.draw();
        if (opts.sound !== false) Sound.fanfare();
        if (self.onTick) self.onTick(1);
        resolve({ item: items[winner], index: winner });
      }
      self.raf = global.requestAnimationFrame(frame);
    });
  };

  W.Wheel = Wheel;
  W.Sound = Sound;
})(window);

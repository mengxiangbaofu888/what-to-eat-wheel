/* ============================================================
   util.js · 通用小工具（无依赖，挂到 window.W.Util）
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  /** 极简 hyperscript，避免到处 innerHTML 拼接 */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      if (attrs.type) node.setAttribute('type', attrs.type);
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'type') return;
        if (k === 'class' || k === 'className') { node.className = v; return; }
        if (k === 'text') { node.textContent = v; return; }
        if (k === 'html') { node.innerHTML = v; return; }
        if (k === 'dataset') { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); return; }
        if (k === 'style' && typeof v === 'object') { Object.assign(node.style, v); return; }
        if (k.slice(0, 2) === 'on' && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); return; }
        if (k === 'value') { node.value = v; return; }
        if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'indeterminate') { node[k] = !!v; return; }
        if (v === true) { node.setAttribute(k, ''); return; }
        node.setAttribute(k, String(v));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof children === 'object' ? children : document.createTextNode(String(children)));
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  function show(node, visible) { if (node) node.hidden = !visible; }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms || 200);
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------- 本地存储（带降级） ------------------------- */

  var memory = {};
  var lsOk = (function () {
    try {
      var k = '__wtw_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var storage = {
    ok: lsOk,
    get: function (key, def) {
      try {
        var raw = lsOk ? global.localStorage.getItem(key) : memory[key];
        return raw === null || raw === undefined ? def : JSON.parse(raw);
      } catch (e) { return def; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      try {
        if (lsOk) global.localStorage.setItem(key, raw); else memory[key] = raw;
      } catch (e) {
        memory[key] = raw;
        if (!storage.warned) {
          storage.warned = true;
          W.UI && W.UI.toast && W.UI.toast('本地存储写入失败，本次数据只保留在当前页面', 'err');
        }
      }
    },
    remove: function (key) {
      try { if (lsOk) global.localStorage.removeItem(key); } catch (e) { /* ignore */ }
      delete memory[key];
    },
  };

  /* ------------------------- 文件读写 ------------------------- */

  function download(filename, text, mime) {
    var blob = new global.Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function readDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('读取图片失败')); };
      fr.readAsDataURL(file);
    });
  }

  /** 压缩图片：长边不超过 maxSize，输出 jpeg dataURL（拍照识别省流量、提速） */
  function compressImage(file, maxSize, quality) {
    maxSize = maxSize || 1280;
    quality = quality || 0.85;
    return readDataURL(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { resolve(dataUrl); return; }
          var scale = Math.min(1, maxSize / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          try { resolve(canvas.toDataURL('image/jpeg', quality)); }
          catch (e) { resolve(dataUrl); }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  function pickFile(input) {
    return new Promise(function (resolve) {
      function onChange() {
        input.removeEventListener('change', onChange);
        resolve(Array.prototype.slice.call(input.files || []));
        input.value = '';
      }
      input.addEventListener('change', onChange);
      input.click();
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 文件名里的时间戳：20261005-2330 */
  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /** 稳定配色：黄金角撒点，相邻扇区颜色差异大 */
  function paletteColor(i, total, saturation, lightness) {
    var hue = (i * 137.508) % 360;
    if (total && total > 1) {
      // 少量扇区时均分色相，视觉上更规整
      var even = (360 / total) * i;
      hue = total <= 12 ? even : hue;
    }
    var s = saturation === undefined ? 62 : saturation;
    var l = lightness === undefined ? 58 : lightness;
    if (i % 2 === 1) l -= 8;
    return 'hsl(' + hue.toFixed(1) + ' ' + s + '% ' + l + '%)';
  }

  W.Util = {
    uid: uid, clamp: clamp, el: el, append: append, $: $, $$: $$, clear: clear, show: show,
    debounce: debounce, escapeHtml: escapeHtml, storage: storage, download: download,
    readTextFile: readTextFile, readDataURL: readDataURL, compressImage: compressImage,
    pickFile: pickFile, formatTime: formatTime, stamp: stamp, paletteColor: paletteColor,
  };
})(window);

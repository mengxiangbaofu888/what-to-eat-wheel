/* ============================================================
   ui.js · 弹窗 / 提示 / 表单 / 撒花
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});
  var U = W.Util;
  var el = U.el;

  var mask = null;
  var modalBox = null;
  var toastWrap = null;

  function init() {
    mask = U.$('#modal-mask');
    modalBox = U.$('#modal');
    toastWrap = U.$('#toast-wrap');
    mask.addEventListener('click', function (e) {
      if (e.target === mask && current && current.dismissible) current.close(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && current && current.dismissible) current.close(null);
    });
  }

  var current = null;

  function closeModal() {
    if (!mask) return;
    mask.hidden = true;
    U.clear(modalBox);
    current = null;
  }

  /**
   * 通用弹窗。opts:
   *   title, body(Node|string), actions:[{text, primary, danger, value}], dismissible
   * 返回 Promise，resolve 被点按钮的 value（点遮罩/ESC 为 null）
   */
  function open(opts) {
    if (!mask) init();
    return new Promise(function (resolve) {
      U.clear(modalBox);
      if (opts.title) modalBox.appendChild(el('h3', { text: opts.title }));
      if (opts.body) modalBox.appendChild(typeof opts.body === 'string' ? el('p', { text: opts.body }) : opts.body);
      var actions = opts.actions || [{ text: '知道了', primary: true, value: 'ok' }];
      var row = el('div', { class: 'modal-actions' });
      actions.forEach(function (a) {
        row.appendChild(el('button', {
          class: 'btn' + (a.primary ? ' primary' : a.danger ? ' danger' : ' ghost'),
          text: a.text,
          onclick: function () { current.close(a.value === undefined ? a.text : a.value); },
        }));
      });
      modalBox.appendChild(row);
      mask.hidden = false;
      current = {
        dismissible: opts.dismissible !== false,
        close: function (value) { closeModal(); resolve(value); },
      };
      var focusTarget = modalBox.querySelector('input, select, textarea, button');
      if (focusTarget) setTimeout(function () { try { focusTarget.focus(); } catch (e) { /* ignore */ } }, 30);
    });
  }

  /** 表单弹窗，返回 {action, values} 或 null */
  function form(opts) {
    if (!mask) init();
    return new Promise(function (resolve) {
      var inputs = {};
      var body = el('div');
      if (opts.hint) body.appendChild(el('p', { text: opts.hint }));
      (opts.fields || []).forEach(function (f) {
        var field = el('div', { class: 'field' });
        if (f.type === 'checkbox') {
          var cb = el('input', { type: 'checkbox', checked: !!f.value });
          inputs[f.key] = cb;
          field.appendChild(el('label', { class: 'check' }, [cb, el('span', { text: f.label })]));
        } else {
          field.appendChild(el('label', { class: 'label', text: f.label }));
          var input;
          if (f.type === 'select') {
            input = el('select', { class: 'input' });
            (f.options || []).forEach(function (o) {
              input.appendChild(el('option', { value: o.value === null ? '' : o.value, text: o.label, selected: String(o.value === null ? '' : o.value) === String(f.value === null ? '' : f.value) }));
            });
          } else if (f.type === 'textarea') {
            input = el('textarea', { class: 'input', rows: f.rows || 6, value: f.value === null || f.value === undefined ? '' : f.value });
            input.style.resize = 'vertical';
            input.style.fontFamily = 'ui-monospace, Menlo, Consolas, monospace';
            input.style.fontSize = '12px';
          } else {
            input = el('input', { class: 'input', type: f.type || 'text', value: f.value === null || f.value === undefined ? '' : f.value, placeholder: f.placeholder || '', autocomplete: 'off' });
          }
          inputs[f.key] = input;
          field.appendChild(input);
        }
        if (f.hint) field.appendChild(el('div', { class: 'hint', text: f.hint }));
        body.appendChild(field);
      });

      var actions = [];
      if (opts.extra) {
        opts.extra.forEach(function (a) {
          actions.push({
            text: a.text, danger: a.danger,
            value: a.value,
          });
        });
      }
      actions.push({ text: opts.cancelText || '取消', value: null });
      actions.push({ text: opts.okText || '确定', primary: true, value: '__ok__' });

      U.clear(modalBox);
      if (opts.title) modalBox.appendChild(el('h3', { text: opts.title }));
      modalBox.appendChild(body);
      var row = el('div', { class: 'modal-actions' });
      actions.forEach(function (a) {
        row.appendChild(el('button', {
          class: 'btn' + (a.primary ? ' primary' : a.danger ? ' danger' : ' ghost'),
          text: a.text,
          onclick: function () { submit(a.value); },
        }));
      });
      modalBox.appendChild(row);
      mask.hidden = false;

      function collect() {
        var values = {};
        Object.keys(inputs).forEach(function (k) {
          var node = inputs[k];
          values[k] = node.type === 'checkbox' ? node.checked : node.value;
        });
        return values;
      }

      var submitted = false;
      function submit(action) {
        if (submitted) return;
        submitted = true;
        var values = collect();
        closeModal();
        if (action === null) resolve(null);
        else if (action === '__ok__') resolve({ action: 'ok', values: values });
        else resolve({ action: action, values: values });
      }

      current = {
        dismissible: opts.dismissible !== false,
        close: function (v) { if (!submitted) { submitted = true; closeModal(); resolve(v); } },
      };

      // 回车提交
      Object.keys(inputs).forEach(function (k) {
        var node = inputs[k];
        if (node.tagName === 'INPUT') {
          node.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submit('__ok__'); }
          });
        }
      });
      var focusTarget = body.querySelector('input, select, textarea');
      if (focusTarget) setTimeout(function () { try { focusTarget.focus(); focusTarget.select && focusTarget.select(); } catch (e) { /* ignore */ } }, 30);
    });
  }

  function toast(message, type, ms) {
    if (!toastWrap) init();
    var node = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
    toastWrap.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 320);
    }, ms || (type === 'err' ? 4200 : 2200));
  }

  /* ------------------------------ 撒花 ------------------------------ */

  var confettiRaf = null;
  function confetti() {
    var canvas = U.$('#confetti');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W0 = global.innerWidth, H0 = global.innerHeight;
    canvas.width = W0 * dpr;
    canvas.height = H0 * dpr;
    canvas.hidden = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var colors = ['#ff8a3d', '#ffd166', '#06d6a0', '#8b5cf6', '#ef476f', '#4cc9f0'];
    var parts = [];
    for (var i = 0; i < 110; i++) {
      parts.push({
        x: W0 / 2 + (Math.random() - 0.5) * W0 * 0.5,
        y: H0 * 0.34 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9,
        vy: -6 - Math.random() * 9,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
      });
    }
    var start = 0;
    function frame(now) {
      if (!start) start = now;
      var elapsed = now - start;
      ctx.clearRect(0, 0, W0, H0);
      parts.forEach(function (p) {
        p.vy += 0.42;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.vx *= 0.995;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 2200);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        ctx.restore();
      });
      if (elapsed < 2200) confettiRaf = global.requestAnimationFrame(frame);
      else {
        ctx.clearRect(0, 0, W0, H0);
        canvas.hidden = true;
        confettiRaf = null;
      }
    }
    if (confettiRaf) global.cancelAnimationFrame(confettiRaf);
    confettiRaf = global.requestAnimationFrame(frame);
  }

  W.UI = { init: init, open: open, form: form, toast: toast, confetti: confetti, close: closeModal };
})(window);

/* ============================================================
   app.js · 主程序：把各个模块串起来
   ============================================================ */
(function (global) {
  'use strict';
  var W = global.W;
  var S = W.Store;
  var U = W.Util;
  var UI = W.UI;
  var el = U.el;

  var wheel = null;
  var lastPicked = null;
  var photoFiles = [];          // 最近一次选的图片（压缩后的 dataURL）
  var recognizedDishes = [];     // 识别结果

  var els = {};

  function $(id) { return document.getElementById(id); }

  /* ============================== 主题 ============================== */

  var media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: light)') : null;

  function applyTheme() {
    var t = S.settings.theme || 'auto';
    var resolved = t === 'auto' ? (media && media.matches ? 'light' : 'dark') : t;
    document.documentElement.setAttribute('data-theme', resolved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#fdf7f1' : '#151221');
    els.btnTheme.textContent = t === 'auto' ? '🌗' : t === 'light' ? '☀️' : '🌙';
    els.btnTheme.title = '主题：' + (t === 'auto' ? '跟随系统' : t === 'light' ? '浅色' : '深色');
  }

  function cycleTheme() {
    var order = ['auto', 'dark', 'light'];
    var i = order.indexOf(S.settings.theme || 'auto');
    S.setSetting('theme', order[(i + 1) % order.length]);
    applyTheme();
    UI.toast('主题：' + ({ auto: '跟随系统', dark: '深色', light: '浅色' })[S.settings.theme]);
  }

  /* ============================== 标签页 ============================== */

  function switchTab(name) {
    U.$$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    U.$$('.pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === name); });
  }

  /* ============================== 菜品列表 ============================== */

  function renderList() {
    var list = els.catList;
    U.clear(list);
    var groups = S.groups();
    var total = S.data.items.length;

    if (!total) {
      list.appendChild(el('div', {
        class: 'empty-tip',
        html: '还没有菜品～<br>在上面输入菜名回车就能加，或者去「📷 拍照识别」拍一张食堂菜牌。',
      }));
      return;
    }

    var visible = groups.filter(function (g) { return g.items.length || !g.virtual; });

    visible.forEach(function (g) {
      if (g.virtual && !g.items.length) return;
      var onCount = g.items.filter(function (i) { return i.enabled; }).length;
      var allOn = g.items.length > 0 && onCount === g.items.length;
      var someOn = onCount > 0 && !allOn;

      var headBox = el('input', { type: 'checkbox', checked: allOn });
      headBox.indeterminate = someOn;
      headBox.addEventListener('click', function (e) {
        e.stopPropagation();
        S.setManyEnabled(g.items.map(function (i) { return i.id; }), !allOn);
      });

      var head = el('div', { class: 'cat-head', onclick: function (e) {
        if (e.target.closest('button') || e.target === headBox) return;
        S.toggleCollapse(g.id);
      } }, [
        headBox,
        el('span', { class: 'cat-name', text: g.name }),
        el('span', { class: 'cat-count', text: onCount + '/' + g.items.length }),
      ]);

      if (!g.virtual) {
        head.appendChild(el('button', { class: 'mini', title: '重命名', text: '✏️', onclick: function (e) { e.stopPropagation(); editCategory(g.id); } }));
        head.appendChild(el('button', { class: 'mini danger', title: '删除大类', text: '🗑', onclick: function (e) { e.stopPropagation(); deleteCategory(g.id); } }));
      }
      head.appendChild(el('span', { class: 'chev', text: '▾' }));

      var itemsBox = el('div', { class: 'cat-items' });
      g.items.forEach(function (it) {
        var cb = el('input', { type: 'checkbox', checked: it.enabled });
        cb.addEventListener('change', function () { S.setEnabled(it.id, cb.checked); });
        var row = el('div', { class: 'cat-item' + (it.enabled ? '' : ' off') }, [
          cb,
          el('span', { class: 'item-name', text: it.name, title: it.name, onclick: function () { S.setEnabled(it.id, !it.enabled); } }),
          el('button', { class: 'mini', title: '只转这一道', text: '🎯', onclick: function () { solo(it.id); } }),
          el('button', { class: 'mini', title: '编辑', text: '✏️', onclick: function () { editItem(it.id); } }),
          el('button', { class: 'mini danger', title: '删除', text: '🗑', onclick: function () { S.removeItem(it.id); UI.toast('已删除「' + it.name + '」'); } }),
        ]);
        itemsBox.appendChild(row);
      });

      var group = el('div', { class: 'cat-group' + (g.collapsed ? ' collapsed' : '') }, [head, itemsBox]);
      list.appendChild(group);
    });
  }

  function solo(id) {
    S.soloItem(id);
    var it = S.findItem(id);
    switchTab('food');
    UI.toast('转盘上只留「' + (it ? it.name : '') + '」，转吧！');
    setTimeout(spin, 260);
  }

  function editItem(id) {
    var it = S.findItem(id);
    if (!it) return;
    var options = [{ value: '', label: '（未分类）' }].concat(S.data.categories.map(function (c) { return { value: c.id, label: c.name }; }));
    UI.form({
      title: '编辑菜品',
      fields: [
        { key: 'name', label: '菜名', value: it.name },
        { key: 'categoryId', label: '归属大类', type: 'select', options: options, value: it.categoryId || '' },
      ],
      extra: [{ text: '删除', danger: true, value: 'delete' }],
      okText: '保存',
    }).then(function (res) {
      if (!res) return;
      if (res.action === 'delete') { S.removeItem(id); UI.toast('已删除'); return; }
      S.updateItem(id, { name: res.values.name, categoryId: res.values.categoryId || null });
      UI.toast('已保存');
    });
  }

  function editCategory(id) {
    var cat = S.findCategory(id);
    if (!cat) return;
    UI.form({
      title: '重命名大类',
      hint: '改成一个已有大类的名字，会把两个大类合并。',
      fields: [{ key: 'name', label: '大类名', value: cat.name }],
      okText: '保存',
    }).then(function (res) {
      if (!res) return;
      S.renameCategory(id, res.values.name);
      UI.toast('已保存');
    });
  }

  function deleteCategory(id) {
    var cat = S.findCategory(id);
    if (!cat) return;
    var count = S.itemsOf(id).length;
    UI.open({
      title: '删除大类「' + cat.name + '」',
      body: count
        ? '这个大下面还有 ' + count + ' 道菜。你可以只解散大类（菜会回到「未分类」），也可以连菜一起删掉。'
        : '这个大下面没有菜。',
      actions: count
        ? [
            { text: '取消', value: null },
            { text: '只解散大类', value: 'keep' },
            { text: '连菜一起删', value: 'delete', danger: true },
          ]
        : [
            { text: '取消', value: null },
            { text: '删除', value: 'delete', danger: true },
          ],
    }).then(function (v) {
      if (!v) return;
      S.removeCategory(id, v === 'delete' ? 'delete' : 'keep');
      UI.toast('已删除大类「' + cat.name + '」');
    });
  }

  /* ============================== 添加菜品 ============================== */

  function parseNames(raw) {
    return String(raw || '')
      .split(/[\n\r,，、;；|]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** 真正把菜名写进数据，返回统计结果 */
  function addNames(raw) {
    var names = parseNames(raw);
    var added = 0, dup = 0, grouped = [];
    names.forEach(function (name) {
      if (S.itemByName(name)) { dup++; return; }
      var sug = W.Classify.suggestForNew(name, S.data.items, S.data.categories);
      var catId = null;
      if (sug && sug.categoryId) {
        catId = sug.categoryId;
      } else if (sug && sug.newCategoryName) {
        var cat = S.addCategory(sug.newCategoryName, true);
        catId = cat.id;
        S.data.items.forEach(function (it) {
          if (it.id === sug.mateItemId && !it.categoryId) it.categoryId = cat.id;
        });
        grouped.push(sug.newCategoryName);
      }
      S.addItem(name, catId, true);
      added++;
    });
    if (added) { S.save(true); S.emit(); }
    return { added: added, dup: dup, grouped: grouped };
  }

  function addResultToast(r, silent) {
    if (!r.added && !r.dup) { if (!silent) UI.toast('先输入菜名吧', 'err'); return; }
    var msg = [];
    if (r.added) msg.push('加了 ' + r.added + ' 道');
    if (r.grouped.length) msg.push('自动新建大类：' + r.grouped.join('、'));
    if (r.dup) msg.push(r.dup + ' 道已存在');
    UI.toast(msg.join('，'), r.added ? 'ok' : 'err');
  }

  function doAdd() {
    var r = addNames(els.addInput.value);
    if (!r.added && !r.dup) { UI.toast('先输入菜名吧', 'err'); return; }
    els.addInput.value = '';
    els.addInput.focus();
    addResultToast(r);
  }

  /**
   * 粘贴多行：`<input>` 会把换行符吃掉（HTML 规范里的 value 清洗算法），
   * 所以多行粘贴必须自己接管，否则「一行一个」根本用不了。
   */
  function onPaste(e) {
    var text = '';
    try {
      var cb = e.clipboardData || global.clipboardData;
      text = cb ? cb.getData('text') : '';
    } catch (err) { return; }
    if (!text || !/[\n\r]/.test(text)) return;
    e.preventDefault();
    var merged = (els.addInput.value ? els.addInput.value + '\n' : '') + text;
    var r = addNames(merged);
    els.addInput.value = '';
    els.addInput.focus();
    addResultToast(r);
  }

  function doSmartGroup() {
    if (!S.data.items.length) { UI.toast('还没有菜品', 'err'); return; }
    var plan = W.Classify.planAll(S.data.items, S.data.categories);
    var idMap = {};
    plan.created.forEach(function (c) {
      var cat = S.addCategory(c.name, true);
      if (cat) idMap[c.id] = cat.id;
    });
    var moved = 0;
    S.data.items.forEach(function (it) {
      var cid = plan.assign[it.id];
      if (!cid) return;
      if (idMap[cid]) cid = idMap[cid];
      if (it.categoryId !== cid) { it.categoryId = cid; moved++; }
    });
    S.save(true); S.emit();
    var created = plan.created.length;
    if (!moved && !created) UI.toast('没找到可以自动归类的规律，可以手动编辑大类');
    else UI.toast('归好 ' + moved + ' 道菜' + (created ? '，新建了 ' + created + ' 个大类' : ''), 'ok');
  }

  /* ============================== 转盘 ============================== */

  function syncWheel() {
    var items = S.enabledItems();
    wheel.setItems(items);
    els.spinSub.textContent = items.length + ' 个';
    els.btnSpin.disabled = items.length === 0 || wheel.spinning;
  }

  function spin() {
    var items = S.enabledItems();
    if (!items.length) {
      UI.toast('转盘上还没有菜，先去「菜品」里加几个', 'err');
      switchTab('food');
      return;
    }
    if (wheel.spinning) return;
    wheel.setItems(items);
    els.resultCard.hidden = true;
    els.resultEmpty.hidden = false;
    els.btnSpin.disabled = true;
    W.Sound.enabled = !!S.settings.sound;
    els.btnSpin.classList.add('spinning');

    wheel.spin({ duration: S.settings.duration, sound: !!S.settings.sound }).then(function (res) {
      els.btnSpin.classList.remove('spinning');
      els.btnSpin.disabled = false;
      if (!res) return;
      showResult(res.item);
      S.addHistory(res.item.name);
      if (S.settings.confetti) UI.confetti();
      if (S.settings.removeAfterPick) {
        setTimeout(function () { S.setEnabled(res.item.id, false); }, 1400);
      }
    });
  }

  function showResult(item) {
    lastPicked = item;
    var cat = item.categoryId ? S.findCategory(item.categoryId) : null;
    els.resultName.textContent = item.name;
    els.resultCat.textContent = cat ? '大类：' + cat.name : '';
    els.resultEmpty.hidden = true;
    els.resultCard.hidden = false;
    els.resultCard.style.animation = 'none';
    void els.resultCard.offsetWidth;
    els.resultCard.style.animation = '';
  }

  function renderHistory() {
    var box = els.history;
    U.clear(box);
    var list = (S.data.history || []).slice(0, 6);
    if (!list.length) return;
    box.appendChild(el('span', { class: 'history-chip', text: '最近：' }));
    list.forEach(function (n) {
      box.appendChild(el('span', { class: 'history-chip', text: n }));
    });
  }

  /* ============================== 拍照识别 ============================== */

  function setStatus(text, kind) {
    var box = els.photoStatus;
    U.clear(box);
    if (!text) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'loading') box.appendChild(el('span', { class: 'spinner' }));
    box.appendChild(el('span', { text: text }));
  }

  function renderPreview() {
    var box = els.photoPreview;
    U.clear(box);
    if (!photoFiles.length) { box.hidden = true; return; }
    box.hidden = false;
    photoFiles.forEach(function (url) {
      box.appendChild(el('img', { src: url, alt: '待识别的照片' }));
    });
  }

  function handleFiles(files) {
    files = (files || []).filter(function (f) { return /^image\//.test(f.type || ''); });
    if (!files.length) { UI.toast('没有选到图片', 'err'); return; }
    files = files.slice(0, 4);

    els.recognized.hidden = true;
    recognizedDishes = [];
    setStatus('正在压缩图片…', 'loading');

    Promise.all(files.map(function (f) { return U.compressImage(f, 1280, 0.85); }))
      .then(function (urls) {
        photoFiles = urls;
        renderPreview();
        var v = S.settings.vision;
        if (!v.apiKey) throw new Error('还没有配置视觉模型 API Key。去「⚙️ 设置」填一下，或者手动在「菜品」里输入菜名。');
        setStatus('正在识别（大约 5~20 秒）…', 'loading');
        return W.Vision.recognize(S.settings, urls, function (t) { setStatus(t, 'loading'); });
      })
      .then(function (res) {
        recognizedDishes = res.dishes || [];
        if (!recognizedDishes.length) {
          setStatus('这张照片里没认出菜品，换一张更清楚的菜牌试试～', 'err');
          return;
        }
        setStatus('认出 ' + recognizedDishes.length + ' 道菜，确认一下再加进转盘：', 'ok');
        renderRecognized();
      })
      .catch(function (err) {
        setStatus((err && err.message) || String(err), 'err');
      });
  }

  function renderRecognized() {
    var box = els.recognized;
    U.clear(box);
    if (!recognizedDishes.length) { box.hidden = true; return; }
    box.hidden = false;

    var datalist = el('datalist', { id: 'cat-options' });
    S.data.categories.forEach(function (c) { datalist.appendChild(el('option', { value: c.name })); });
    box.appendChild(datalist);

    box.appendChild(el('div', { class: 'rec-head' }, [
      el('span', { text: '识别结果（可改名字、可改大类）' }),
    ]));

    recognizedDishes.forEach(function (d, idx) {
      var nameInput = el('input', { class: 'input rec-name', type: 'text', value: d.name });
      var catInput = el('input', { class: 'input rec-cat', type: 'text', list: 'cat-options', value: d.category || '', placeholder: '大类' });
      nameInput.addEventListener('input', function () { d.name = nameInput.value; });
      catInput.addEventListener('input', function () { d.category = catInput.value; });
      var row = el('div', { class: 'rec-row' }, [
        nameInput,
        catInput,
        el('button', { class: 'mini danger', text: '✕', title: '不要这道', onclick: function () {
          recognizedDishes.splice(idx, 1);
          renderRecognized();
        } }),
      ]);
      box.appendChild(row);
    });

    box.appendChild(el('div', { class: 'rec-actions' }, [
      el('button', { class: 'btn primary', text: '全部加入转盘', onclick: commitRecognized }),
      el('button', { class: 'btn ghost', text: '都不要', onclick: function () {
        recognizedDishes = [];
        renderRecognized();
        setStatus('已取消', null);
      } }),
    ]));
  }

  function commitRecognized() {
    var added = 0, dup = 0, newCats = [];
    recognizedDishes.forEach(function (d) {
      var name = String(d.name || '').trim();
      if (!name) return;
      if (S.itemByName(name)) { dup++; return; }
      var catId = null;
      var catName = String(d.category || '').trim();
      if (catName) {
        var existed = S.categoryByName(catName);
        var cat = S.addCategory(catName, true);
        catId = cat ? cat.id : null;
        if (!existed && cat) newCats.push(catName);
      }
      S.addItem(name, catId, true);
      added++;
    });
    S.save(true); S.emit();
    recognizedDishes = [];
    renderRecognized();
    setStatus('已加入 ' + added + ' 道菜' + (newCats.length ? '，新建大类：' + newCats.join('、') : ''), 'ok');
    UI.toast('加了 ' + added + ' 道菜' + (dup ? '，' + dup + ' 道重复已跳过' : ''), 'ok');
    setTimeout(function () { switchTab('food'); }, 400);
  }

  /* ============================== 设置页 ============================== */

  function fillProviders() {
    var sel = els.setProvider;
    U.clear(sel);
    S.PROVIDERS.forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name }));
    });
  }

  function syncSettingsUI() {
    var v = S.settings.vision;
    els.setProvider.value = v.provider || 'custom';
    els.setBaseUrl.value = v.baseUrl || '';
    els.setModel.value = v.model || '';
    els.setApiKey.value = v.apiKey || '';
    els.setProxy.checked = !!v.useProxy;
    var p = null;
    S.PROVIDERS.forEach(function (x) { if (x.id === v.provider) p = x; });
    els.providerHint.textContent = p ? p.hint : '';

    els.setSound.checked = !!S.settings.sound;
    els.setRemove.checked = !!S.settings.removeAfterPick;
    els.setConfetti.checked = !!S.settings.confetti;
    els.setDuration.value = S.settings.duration;
    els.setDurationVal.textContent = Number(S.settings.duration).toFixed(1) + 's';
    if (location.protocol === 'file:') {
      els.setProxy.disabled = true;
      els.setProxy.checked = false;
      if (v.useProxy) S.setVision({ useProxy: false });
    }
    renderStats();
  }

  function renderStats() {
    var st = S.stats();
    var extra = U.storage.ok ? '' : '（注意：当前环境无法写入本地存储，刷新会丢数据，记得用「导出备份」）';
    els.statHint.textContent = st.items + ' 道菜 · ' + st.categories + ' 个大类 · 转盘上 ' + st.enabled + ' 道' + extra;
  }

  function saveVisionFromUI() {
    S.setVision({
      baseUrl: els.setBaseUrl.value.trim(),
      model: els.setModel.value.trim(),
      apiKey: els.setApiKey.value.trim(),
      useProxy: els.setProxy.checked,
    });
  }

  function testConnection() {
    saveVisionFromUI();
    var v = S.settings.vision;
    if (!v.apiKey) { UI.toast('先填 API Key', 'err'); return; }
    els.btnTest.disabled = true;
    els.btnTest.textContent = '测试中…';
    W.Vision.test(S.settings).then(function (r) {
      UI.toast(r.message, 'ok', 3600);
    }).catch(function (err) {
      UI.toast(err.message || String(err), 'err', 6000);
    }).then(function () {
      els.btnTest.disabled = false;
      els.btnTest.textContent = '测试连接';
    });
  }

  function exportData() {
    var data = S.exportObject();
    U.download('吃啥转盘-备份-' + U.stamp() + '.json', JSON.stringify(data, null, 2));
    UI.toast('备份已导出', 'ok');
  }

  function importData() {
    U.pickFile($('file-import')).then(function (files) {
      if (!files.length) return;
      U.readTextFile(files[0]).then(function (text) {
        var obj;
        try { obj = JSON.parse(text); }
        catch (e) { UI.toast('这个文件不是合法 JSON', 'err'); return; }
        return UI.open({
          title: '导入备份',
          body: '导入方式：追加（保留现有菜品，重复的跳过）还是覆盖（清空现有菜品再导入）？',
          actions: [
            { text: '取消', value: null },
            { text: '追加', value: 'append' },
            { text: '覆盖', value: 'replace', danger: true },
          ],
        }).then(function (mode) {
          if (!mode) return;
          try {
            var r = S.importObject(obj, mode);
            UI.toast('导入完成：新增 ' + r.added + ' 道，跳过重复 ' + r.dup + ' 道', 'ok', 3600);
          } catch (e) {
            UI.toast('导入失败：' + e.message, 'err', 5000);
          }
        });
      }).catch(function (e) { UI.toast('读取失败：' + e.message, 'err'); });
    });
  }

  function copyData() {
    var text = JSON.stringify(S.exportObject());
    function fallback() {
      UI.form({
        title: '复制数据',
        hint: '长按下面的文字全选复制，粘贴到备忘录或聊天窗口保存即可。',
        fields: [{ key: 'text', label: '备份内容', type: 'textarea', value: text }],
        okText: '关闭',
      });
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(function () { UI.toast('已复制到剪贴板', 'ok'); }, fallback);
    } else fallback();
  }

  function resetAll() {
    UI.open({
      title: '恢复出厂设置',
      body: '会清空所有菜品、大类、历史记录和设置（API Key 也会没）。确定吗？',
      actions: [
        { text: '取消', value: null },
        { text: '清空', value: 'yes', danger: true },
      ],
    }).then(function (v) {
      if (v !== 'yes') return;
      S.resetAll();
      syncSettingsUI();
      UI.toast('已清空', 'ok');
    });
  }

  /* ============================== 帮助 ============================== */

  function showHelp() {
    UI.open({
      title: '怎么用「吃啥转盘」',
      body: el('div', { html: [
        '<ul>',
        '<li><b>加菜</b>：在「🍽 菜品」里打字回车就能加；一行一个可以一次加一串。</li>',
        '<li><b>大类 / 小项</b>：像「麻辣鸡丁滑蛋饭」「五花肉滑蛋饭」会自动归到「滑蛋饭」这个大类。' +
          '勾大类 = 把这个大类下的都放上转盘；只勾某一道 = 只转那一道。</li>',
        '<li><b>智能归类</b>：如果菜名没归好，点一下「✨ 智能归类」，它会按菜名后缀重新分大类。</li>',
        '<li><b>拍照识别</b>：拍一张食堂菜牌，自动认出菜名再加进转盘。需要先在「⚙️ 设置」里填一个视觉模型的 API Key。</li>',
        '<li><b>转盘</b>：点中间那个「转」，停下来指到哪道就吃哪道。手机可以直接点转盘中间。</li>',
        '<li><b>数据在哪</b>：全部存在这台设备本地，不上传。换设备用「设置 → 导出备份 / 导入备份」。</li>',
        '</ul>',
        '<p>小技巧：把网页「添加到主屏幕」，就跟装了个 App 一样，全屏、离线都能用。</p>',
      ].join('') }),
      actions: [{ text: '开始干饭', primary: true, value: 'ok' }],
    });
  }

  /* ============================== 启动 ============================== */

  function cacheEls() {
    els.btnTheme = $('btn-theme');
    els.btnHelp = $('btn-help');
    els.btnSpin = $('btn-spin');
    els.spinSub = $('spin-sub');
    els.resultBar = $('result-bar');
    els.resultEmpty = $('result-empty');
    els.resultCard = $('result-card');
    els.resultName = $('result-name');
    els.resultCat = $('result-cat');
    els.btnAgain = $('btn-again');
    els.btnDrop = $('btn-drop');
    els.history = $('history');

    els.addInput = $('add-input');
    els.btnAdd = $('btn-add');
    els.btnSmart = $('btn-smart');
    els.btnAll = $('btn-all');
    els.btnNone = $('btn-none');
    els.btnInvert = $('btn-invert');
    els.btnClear = $('btn-clear');
    els.catList = $('cat-list');

    els.btnCamera = $('btn-camera');
    els.btnAlbum = $('btn-album');
    els.fileCamera = $('file-camera');
    els.fileAlbum = $('file-album');
    els.photoPreview = $('photo-preview');
    els.photoStatus = $('photo-status');
    els.recognized = $('recognized');

    els.setProvider = $('set-provider');
    els.providerHint = $('provider-hint');
    els.setBaseUrl = $('set-baseurl');
    els.setModel = $('set-model');
    els.setApiKey = $('set-apikey');
    els.setProxy = $('set-proxy');
    els.btnEye = $('btn-eye');
    els.btnTest = $('btn-test');
    els.btnSaveVision = $('btn-save-vision');
    els.setSound = $('set-sound');
    els.setRemove = $('set-remove');
    els.setConfetti = $('set-confetti');
    els.setDuration = $('set-duration');
    els.setDurationVal = $('set-duration-val');
    els.btnExport = $('btn-export');
    els.btnImport = $('btn-import');
    els.btnCopy = $('btn-copy');
    els.btnReset = $('btn-reset');
    els.statHint = $('stat-hint');
  }

  function bind() {
    els.btnTheme.addEventListener('click', cycleTheme);
    els.btnHelp.addEventListener('click', showHelp);

    U.$$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    els.btnSpin.addEventListener('click', spin);
    els.btnAgain.addEventListener('click', spin);
    els.btnDrop.addEventListener('click', function () {
      if (!lastPicked) return;
      S.setEnabled(lastPicked.id, false);
      UI.toast('「' + lastPicked.name + '」已从转盘移除');
      els.resultCard.hidden = true;
      els.resultEmpty.hidden = false;
      lastPicked = null;
    });

    els.btnAdd.addEventListener('click', doAdd);
    els.addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAdd(); }
    });
    els.addInput.addEventListener('paste', onPaste);
    els.btnSmart.addEventListener('click', doSmartGroup);
    els.btnAll.addEventListener('click', function () { S.setAllEnabled(true); });
    els.btnNone.addEventListener('click', function () { S.setAllEnabled(false); });
    els.btnInvert.addEventListener('click', function () { S.invertEnabled(); });
    els.btnClear.addEventListener('click', function () {
      if (!S.data.items.length) { UI.toast('已经是空的'); return; }
      UI.open({
        title: '清空所有菜品',
        body: '会删掉全部 ' + S.data.items.length + ' 道菜（大类保留）。确定吗？',
        actions: [{ text: '取消', value: null }, { text: '清空', value: 'yes', danger: true }],
      }).then(function (v) { if (v === 'yes') { S.clearItems(); UI.toast('已清空', 'ok'); } });
    });

    els.btnCamera.addEventListener('click', function () {
      U.pickFile(els.fileCamera).then(handleFiles);
    });
    els.btnAlbum.addEventListener('click', function () {
      U.pickFile(els.fileAlbum).then(handleFiles);
    });

    els.setProvider.addEventListener('change', function () {
      var p = S.applyProvider(els.setProvider.value);
      syncSettingsUI();
      if (p && !p.baseUrl) UI.toast('这是自定义服务商，手动填接口地址和模型名');
    });
    [els.setBaseUrl, els.setModel, els.setApiKey].forEach(function (node) {
      node.addEventListener('change', saveVisionFromUI);
      node.addEventListener('blur', saveVisionFromUI);
    });
    els.setProxy.addEventListener('change', function () {
      saveVisionFromUI();
      UI.toast(els.setProxy.checked ? '已开启本地代理' : '已关闭本地代理');
    });
    els.btnEye.addEventListener('click', function () {
      els.setApiKey.type = els.setApiKey.type === 'password' ? 'text' : 'password';
    });
    els.btnTest.addEventListener('click', testConnection);
    els.btnSaveVision.addEventListener('click', function () { saveVisionFromUI(); UI.toast('已保存', 'ok'); });

    els.setSound.addEventListener('change', function () { S.setSetting('sound', els.setSound.checked); });
    els.setRemove.addEventListener('change', function () { S.setSetting('removeAfterPick', els.setRemove.checked); });
    els.setConfetti.addEventListener('change', function () { S.setSetting('confetti', els.setConfetti.checked); });
    els.setDuration.addEventListener('input', function () {
      els.setDurationVal.textContent = Number(els.setDuration.value).toFixed(1) + 's';
    });
    els.setDuration.addEventListener('change', function () { S.setSetting('duration', Number(els.setDuration.value)); });

    els.btnExport.addEventListener('click', exportData);
    els.btnImport.addEventListener('click', importData);
    els.btnCopy.addEventListener('click', copyData);
    els.btnReset.addEventListener('click', resetAll);

    // 空格键转一把
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.code === 'Space' || e.key === ' ') {
        if (!els.resultCard.hidden) return;
        e.preventDefault();
        spin();
      }
    });

    if (media && media.addEventListener) {
      media.addEventListener('change', function () { if ((S.settings.theme || 'auto') === 'auto') applyTheme(); });
    }
  }

  function boot() {
    cacheEls();
    UI.init();
    S.load();
    applyTheme();
    fillProviders();

    wheel = new W.Wheel($('wheel'));
    W.Sound.enabled = !!S.settings.sound;

    var wrap = document.querySelector('.wheel-wrap');
    if (global.ResizeObserver) {
      new global.ResizeObserver(function () { wheel.resize(); }).observe(wrap);
    } else {
      global.addEventListener('resize', function () { wheel.resize(); });
    }

    S.on(function () {
      syncWheel();
      renderList();
      renderHistory();
      renderStats();
    });

    bind();
    syncSettingsUI();
    syncWheel();
    renderList();
    renderHistory();
    renderStats();
    setTimeout(function () { wheel.resize(); }, 60);

    var seenHelp = false;
    try {
      seenHelp = !!global.localStorage.getItem('wtw-seen-help');
      if (!seenHelp) global.localStorage.setItem('wtw-seen-help', '1');
    } catch (e) { seenHelp = true; /* 存储不可用就别弹了 */ }
    if (!seenHelp) setTimeout(showHelp, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

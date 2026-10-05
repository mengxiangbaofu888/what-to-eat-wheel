/* ============================================================
   store.js · 数据和本地持久化
   数据结构：
     categories: [{ id, name, collapsed }]        大类（例如「滑蛋饭」）
     items:      [{ id, name, categoryId, enabled, createdAt }]   具体菜品
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});
  var U = W.Util;

  var KEY = 'whatToEatWheel.v1';
  var HISTORY_MAX = 10;

  var PROVIDERS = [
    {
      id: 'zhipu',
      name: '智谱 AI · GLM-4.6V-Flash（免费）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6v-flash',
      hint: '学生党首选：glm-4.6v-flash 目前完全免费，识别食堂菜牌够用。要更准可换 glm-5v-turbo / glm-4.6v。',
    },
    {
      id: 'siliconflow',
      name: '硅基流动 SiliconFlow（有免费模型）',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3.5-4B',
      hint: 'Qwen/Qwen3.5-4B 免费且支持图片输入；模型名要写全，例如 Qwen/Qwen3.5-4B。',
    },
    {
      id: 'dashscope',
      name: '阿里云百炼 · 通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-vl-plus',
      hint: '新用户每个模型送 100 万 token（90 天）。视觉模型可选 qwen3-vl-plus / qwen3-vl-flash / qwen-vl-max，以控制台为准。',
    },
    {
      id: 'doubao',
      name: '火山方舟 · 豆包',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-1-6-vision-250815',
      hint: '新用户每个模型 50 万 token。模型名通常要填控制台里的「接入点 ID」（ep-xxxxxxxx）或模型名。',
    },
    {
      id: 'moonshot',
      name: '月之暗面 Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3',
      hint: '视觉模型 kimi-k3。注意 Kimi 只认 base64 图片，不接受公网图片链接——本应用正好就是传 base64，没问题。',
    },
    {
      id: 'gemini',
      name: 'Google Gemini（有免费额度）',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash',
      hint: '走 Gemini 的 OpenAI 兼容层。国内直连通常需要自备中转，免费层的数据会被用于训练。',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      hint: '没有免费额度；国内直连不通时需要自备中转地址。',
    },
    {
      id: 'custom',
      name: '自定义（任何 OpenAI 兼容接口）',
      baseUrl: '',
      model: '',
      hint: '只要接口兼容 OpenAI 的 /chat/completions 且支持图片输入即可，本地跑的模型（Ollama / LM Studio 等）也能填。',
    },
  ];

  var DEFAULT_SETTINGS = {
    theme: 'auto',
    sound: true,
    removeAfterPick: false,
    confetti: true,
    duration: 4.5,
    vision: {
      provider: 'zhipu',
      baseUrl: PROVIDERS[0].baseUrl,
      model: PROVIDERS[0].model,
      apiKey: '',
      useProxy: false,
    },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeSettings(raw) {
    var s = clone(DEFAULT_SETTINGS);
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) {
        if (k === 'vision' && raw.vision && typeof raw.vision === 'object') {
          Object.keys(raw.vision).forEach(function (vk) { s.vision[vk] = raw.vision[vk]; });
        } else if (raw[k] !== undefined) {
          s[k] = raw[k];
        }
      });
    }
    return s;
  }

  function defaultData() {
    return { version: 1, categories: [], items: [], history: [], settings: clone(DEFAULT_SETTINGS), seeded: false };
  }

  /** 首次打开给几道示例菜，好让人一眼看懂「大类 / 小项」怎么用 */
  function seed(data) {
    var demo = [
      { cat: '滑蛋饭', items: ['麻辣鸡丁滑蛋饭', '五花肉滑蛋饭', '番茄滑蛋饭'] },
      { cat: '面食', items: ['兰州牛肉面', '番茄鸡蛋面'] },
      { cat: '', items: ['黄焖鸡米饭', '麻辣香锅'] },
    ];
    demo.forEach(function (g) {
      var catId = null;
      if (g.cat) catId = api.addCategory(g.cat, true).id;
      g.items.forEach(function (name) { api.addItem(name, catId, true); });
    });
    data.seeded = true;
  }

  /* ------------------------------ 事件 ------------------------------ */

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  var saveTimer = null;
  function save(immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (immediate) { U.storage.set(KEY, data); return; }
    saveTimer = setTimeout(function () { saveTimer = null; U.storage.set(KEY, data); }, 250);
  }

  var data = defaultData();

  function normalizeItem(it) {
    return {
      id: it.id || U.uid('it'),
      name: String(it.name || '').trim(),
      categoryId: it.categoryId || null,
      enabled: it.enabled !== false,
      createdAt: it.createdAt || Date.now(),
    };
  }

  function normalizeCategory(c) {
    return { id: c.id || U.uid('cat'), name: String(c.name || '').trim(), collapsed: !!c.collapsed };
  }

  var api = {
    PROVIDERS: PROVIDERS,
    KEY: KEY,

    get data() { return data; },
    get settings() { return data.settings; },

    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    emit: emit,
    save: save,

    load: function () {
      var raw = U.storage.get(KEY, null);
      data = defaultData();
      if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.items)) data.items = raw.items.map(normalizeItem).filter(function (i) { return i.name; });
        if (Array.isArray(raw.categories)) data.categories = raw.categories.map(normalizeCategory).filter(function (c) { return c.name; });
        if (Array.isArray(raw.history)) data.history = raw.history.slice(0, HISTORY_MAX);
        data.settings = mergeSettings(raw.settings);
        data.seeded = !!raw.seeded;
      }
      // 清理指向已不存在大类的条目
      var ids = {};
      data.categories.forEach(function (c) { ids[c.id] = 1; });
      data.items.forEach(function (i) { if (i.categoryId && !ids[i.categoryId]) i.categoryId = null; });

      if (!data.seeded && !data.items.length) {
        seed(data);
        save(true);
      }
      return data;
    },

    /* ------------------------------ 大类 ------------------------------ */

    findCategory: function (id) {
      for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
      return null;
    },

    categoryByName: function (name) {
      name = String(name || '').trim();
      if (!name) return null;
      for (var i = 0; i < data.categories.length; i++) if (data.categories[i].name === name) return data.categories[i];
      return null;
    },

    addCategory: function (name, silent) {
      name = String(name || '').trim();
      if (!name) return null;
      var exist = api.categoryByName(name);
      if (exist) return exist;
      var cat = { id: U.uid('cat'), name: name, collapsed: false };
      data.categories.push(cat);
      if (!silent) { save(); emit(); }
      return cat;
    },

    renameCategory: function (id, name) {
      var cat = api.findCategory(id);
      name = String(name || '').trim();
      if (!cat || !name) return false;
      var other = api.categoryByName(name);
      if (other && other.id !== id) {
        // 重名 → 合并
        api.mergeCategory(id, other.id);
        return true;
      }
      cat.name = name;
      save(); emit();
      return true;
    },

    /** 把 fromId 大类下的条目并入 intoId，然后删掉 fromId */
    mergeCategory: function (fromId, intoId) {
      if (fromId === intoId) return;
      var cat = api.findCategory(fromId);
      if (!cat) return;
      data.items.forEach(function (i) { if (i.categoryId === fromId) i.categoryId = intoId; });
      data.categories = data.categories.filter(function (c) { return c.id !== fromId; });
      save(); emit();
    },

    removeCategory: function (id, mode) {
      var cat = api.findCategory(id);
      if (!cat) return;
      if (mode === 'delete') {
        data.items = data.items.filter(function (i) { return i.categoryId !== id; });
      } else {
        data.items.forEach(function (i) { if (i.categoryId === id) i.categoryId = null; });
      }
      data.categories = data.categories.filter(function (c) { return c.id !== id; });
      save(); emit();
    },

    toggleCollapse: function (id) {
      if (!id) { // 「未分类」这个虚拟分组
        data.uncategorizedCollapsed = !data.uncategorizedCollapsed;
        save(); emit();
        return;
      }
      var cat = api.findCategory(id);
      if (!cat) return;
      cat.collapsed = !cat.collapsed;
      save(); emit();
    },

    /* ------------------------------ 条目 ------------------------------ */

    findItem: function (id) {
      for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
      return null;
    },

    itemByName: function (name) {
      name = String(name || '').trim();
      for (var i = 0; i < data.items.length; i++) if (data.items[i].name === name) return data.items[i];
      return null;
    },

    addItem: function (name, categoryId, silent) {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!name) return null;
      var exist = api.itemByName(name);
      if (exist) {
        if (categoryId && !exist.categoryId) exist.categoryId = categoryId;
        if (!silent) { save(); emit(); }
        return exist;
      }
      var item = { id: U.uid('it'), name: name, categoryId: categoryId || null, enabled: true, createdAt: Date.now() };
      data.items.push(item);
      if (!silent) { save(); emit(); }
      return item;
    },

    /** 批量添加，返回 { added, dup } */
    addItems: function (names, categoryId) {
      var added = 0, dup = 0;
      (names || []).forEach(function (n) {
        var before = api.itemByName(n);
        var it = api.addItem(n, categoryId, true);
        if (!it) return;
        if (before) dup++; else added++;
      });
      save(); emit();
      return { added: added, dup: dup };
    },

    updateItem: function (id, patch) {
      var item = api.findItem(id);
      if (!item) return;
      if (patch.name !== undefined) {
        var name = String(patch.name).trim().replace(/\s+/g, ' ');
        if (name) item.name = name;
      }
      if (patch.categoryId !== undefined) item.categoryId = patch.categoryId || null;
      if (patch.enabled !== undefined) item.enabled = !!patch.enabled;
      save(); emit();
    },

    removeItem: function (id) {
      data.items = data.items.filter(function (i) { return i.id !== id; });
      save(); emit();
    },

    setEnabled: function (id, on) {
      var it = api.findItem(id);
      if (!it) return;
      it.enabled = !!on;
      save(); emit();
    },

    setManyEnabled: function (ids, on) {
      var set = {};
      (ids || []).forEach(function (id) { set[id] = 1; });
      data.items.forEach(function (i) { if (set[i.id]) i.enabled = !!on; });
      save(); emit();
    },

    setAllEnabled: function (on) {
      data.items.forEach(function (i) { i.enabled = !!on; });
      save(); emit();
    },

    invertEnabled: function () {
      data.items.forEach(function (i) { i.enabled = !i.enabled; });
      save(); emit();
    },

    /** 只留下这一个在转盘上 */
    soloItem: function (id) {
      data.items.forEach(function (i) { i.enabled = i.id === id; });
      save(); emit();
    },

    clearItems: function () {
      data.items = [];
      data.history = [];
      save(); emit();
    },

    /* ------------------------------ 查询 ------------------------------ */

    itemsOf: function (categoryId) {
      return data.items.filter(function (i) { return (i.categoryId || null) === (categoryId || null); });
    },

    enabledItems: function () {
      return data.items.filter(function (i) { return i.enabled; });
    },

    groups: function () {
      var list = data.categories.map(function (c) {
        return { id: c.id, name: c.name, collapsed: !!c.collapsed, items: api.itemsOf(c.id) };
      });
      list.push({ id: null, name: '未分类', collapsed: !!data.uncategorizedCollapsed, items: api.itemsOf(null), virtual: true });
      return list;
    },

    stats: function () {
      var on = api.enabledItems().length;
      return { items: data.items.length, enabled: on, categories: data.categories.length };
    },

    /* ------------------------------ 历史 ------------------------------ */

    addHistory: function (name) {
      data.history = [name].concat((data.history || []).filter(function (n) { return n !== name; })).slice(0, HISTORY_MAX);
      save(); emit();
    },

    clearHistory: function () {
      data.history = [];
      save(); emit();
    },

    /* ------------------------------ 设置 ------------------------------ */

    setSetting: function (key, value) {
      data.settings[key] = value;
      save(); emit();
    },

    setVision: function (patch) {
      Object.keys(patch).forEach(function (k) { data.settings.vision[k] = patch[k]; });
      save(); emit();
    },

    applyProvider: function (providerId) {
      var p = null;
      PROVIDERS.forEach(function (x) { if (x.id === providerId) p = x; });
      if (!p) return null;
      data.settings.vision.provider = p.id;
      if (p.baseUrl) data.settings.vision.baseUrl = p.baseUrl;
      if (p.model) data.settings.vision.model = p.model;
      save(); emit();
      return p;
    },

    /* ------------------------------ 导入导出 ------------------------------ */

    exportObject: function () {
      return {
        app: 'what-to-eat-wheel',
        version: 1,
        exportedAt: new Date().toISOString(),
        categories: data.categories,
        items: data.items,
        history: data.history,
        settings: (function () {
          var s = clone(data.settings);
          if (s.vision) s.vision.apiKey = ''; // 备份里不带走 Key
          return s;
        })(),
      };
    },

    importObject: function (obj, mode) {
      if (!obj || typeof obj !== 'object') throw new Error('文件内容不是合法的 JSON 对象');
      var items = Array.isArray(obj.items) ? obj.items : null;
      var cats = Array.isArray(obj.categories) ? obj.categories : null;
      if (!items && !cats) throw new Error('文件里没有 items / categories 字段，可能不是本应用导出的备份');

      if (mode === 'replace') { data.items = []; data.categories = []; }

      var idMap = {};
      var catByName = {};
      data.categories.forEach(function (c) { catByName[c.name] = c.id; });

      (cats || []).forEach(function (c) {
        var name = String(c.name || '').trim();
        if (!name) return;
        if (catByName[name]) { idMap[c.id] = catByName[name]; return; }
        var cat = api.addCategory(name, true);
        catByName[name] = cat.id;
        idMap[c.id] = cat.id;
      });

      var added = 0, dup = 0;
      (items || []).forEach(function (raw) {
        var name = String(raw.name || '').trim();
        if (!name) return;
        var targetCat = raw.categoryId ? idMap[raw.categoryId] || null : null;
        var exist = api.itemByName(name);
        if (exist) {
          dup++;
          if (targetCat && !exist.categoryId) exist.categoryId = targetCat;
          if (raw.enabled === false) exist.enabled = false;
          return;
        }
        var it = api.addItem(name, targetCat, true);
        if (it) { added++; if (raw.enabled === false) it.enabled = false; }
      });

      if (obj.settings && typeof obj.settings === 'object') {
        var s = mergeSettings(obj.settings);
        s.vision.apiKey = data.settings.vision.apiKey; // 保留本机已有的 Key
        data.settings = s;
      }
      data.seeded = true;
      save(true); emit();
      return { added: added, dup: dup, categories: (cats || []).length };
    },

    resetAll: function () {
      data = defaultData();
      data.seeded = true;
      save(true); emit();
    },
  };

  W.Store = api;
})(window);

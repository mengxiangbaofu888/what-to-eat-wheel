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
      name: '智谱 AI · GLM（推荐，有免费视觉模型）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6v-flash',
      hint: '学生党首选：glm-4.6v-flash 目前完全免费，识别食堂菜牌够用。要更准可换 glm-4.6v / glm-5v-turbo。',
    },
    {
      id: 'siliconflow',
      name: '硅基流动 SiliconFlow（有免费模型）',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3.5-4B',
      hint: 'Qwen/Qwen3.5-4B 免费且支持图片输入。模型名要写全（带斜杠），点「拉取」能看到全部可用的。',
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
      hint: '新用户每个模型 50 万 token。模型名可能要填控制台里的「接入点 ID」（ep-xxxxxxxx）或模型名。',
    },
    {
      id: 'hunyuan',
      name: '腾讯混元 Hunyuan',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      model: '',
      hint: '腾讯云的混元大模型，有免费额度。视觉模型点「拉取」看，认准带 vision / vl 的。',
    },
    {
      id: 'qianfan',
      name: '百度千帆 · 文心一言',
      baseUrl: 'https://qianfan.baidubce.com/v2',
      model: '',
      hint: '百度智能云千帆的 v2 接口（OpenAI 兼容）。新用户有免费额度。模型名点「拉取」选。',
    },
    {
      id: 'spark',
      name: '讯飞星火 Spark',
      baseUrl: 'https://spark-api-open.xf-yun.com/v1',
      model: '',
      hint: '讯飞星火，有免费额度。注意讯飞要求模型名带后缀（如 generalv3.5），点「拉取」看准了再选。',
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      model: '',
      hint: 'MiniMax 的 abab 系列，有视觉模型。点「拉取」列出可用的。',
    },
    {
      id: 'stepfun',
      name: '阶跃星辰 StepFun',
      baseUrl: 'https://api.stepfun.com/v1',
      model: '',
      hint: '阶跃星辰 step 系列，有视觉模型。点「拉取」列出可用的。',
    },
    {
      id: 'modelscope',
      name: '魔搭 ModelScope（免费推理）',
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      model: '',
      hint: '阿里达摩院的模型社区，绑定阿里云账号后可以免费调用一批开源模型。点「拉取」看有哪些。',
    },
    {
      id: 'moonshot',
      name: '月之暗面 Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3',
      hint: '视觉模型 kimi-k3。注意 Kimi 只认 base64 图片，不接受公网图片链接——本应用正好就是传 base64，没问题。',
    },
    {
      id: 'deepseek',
      name: '深度求索 DeepSeek（目前没有视觉模型）',
      baseUrl: 'https://api.deepseek.com/v1',
      model: '',
      hint: '⚠️ DeepSeek 目前的 API 只有文本模型，做不了看图识别。列在这里只是方便你确认——拍照识别请用上面带视觉模型的那几家。',
    },
    {
      id: 'ollama',
      name: '本地 Ollama（在自己电脑上跑）',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      hint: '如果在自己电脑上跑了 Ollama，填这个地址就能用（比如 llava、qwen2.5-vl）。'
        + '注意：手机上的 App 连不到你电脑的 localhost，这个只在电脑浏览器里打开时有用。',
    },
    {
      id: 'lmstudio',
      name: '本地 LM Studio（在自己电脑上跑）',
      baseUrl: 'http://localhost:1234/v1',
      model: '',
      hint: 'LM Studio 启动本地服务器后的默认地址。同样只能在电脑上打开时用。',
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
      hint: '只要接口兼容 OpenAI 的 /chat/completions 且支持图片输入即可。模型名可以点「拉取」自动列出。',
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

  /** 本地日期，形如 2026-10-06。用它判断「今天」而不是 UTC，免得跨零点那几小时出错 */
  function dayKey(ts) {
    var d = ts ? new Date(ts) : new Date();
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

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
    return { version: 1, categories: [], items: [], history: [], settings: clone(DEFAULT_SETTINGS), seeded: false, decided: null };
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
    return {
      id: c.id || U.uid('cat'),
      name: String(c.name || '').trim(),
      collapsed: !!c.collapsed,
      /*
       * 大类怎么上转盘：
       *   false（默认）—— 展开，下面勾中的每道菜各占一个扇区
       *   true        —— 整个大类只占一个扇区，扇区上写大类名，下面的菜不再单独出现
       * 适用场景：食堂那种「滑蛋饭」底下有七八种口味，全铺开扇区就挤爆了；
       * 而且实际去吃的时候本来就是先定吃哪一类，到了窗口再挑。
       */
      groupAsOne: !!c.groupAsOne,
      // 只在 groupAsOne 为 true 时有意义：这一个「整体」要不要上盘
      enabled: c.enabled !== false,
    };
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
        if (raw.decided && typeof raw.decided === 'object' && raw.decided.name) data.decided = raw.decided;
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
      var into = api.findCategory(intoId);
      if (!cat) return;
      data.items.forEach(function (i) { if (i.categoryId === fromId) i.categoryId = intoId; });
      // 被并进来的那个如果设了「整体上盘」，目标大类就跟着用整体模式，
      // 否则用户设过的模式会在合并时无声无息地丢掉
      if (into && cat.groupAsOne) {
        into.groupAsOne = true;
        into.enabled = cat.enabled !== false;
      }
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
      // 整体上盘的大类也算「转盘上的一项」，全选/全不选当然要带上它们
      data.categories.forEach(function (c) { if (c.groupAsOne) c.enabled = !!on; });
      save(); emit();
    },

    invertEnabled: function () {
      data.items.forEach(function (i) { i.enabled = !i.enabled; });
      data.categories.forEach(function (c) { if (c.groupAsOne) c.enabled = !(c.enabled !== false); });
      save(); emit();
    },

    /** 只留下这一个在转盘上 */
    soloItem: function (id) {
      data.items.forEach(function (i) { i.enabled = i.id === id; });
      // 整体上盘的大类每个都占一个扇区，会破坏「只留这一道」，先全部撤下
      data.categories.forEach(function (c) { c.enabled = false; });
      // 目标菜如果正好属于一个整体上盘的大类，会被那个大类吃掉，转盘就空了。
      // 用户点「只转这一道」本身就是在表达「我要按菜品细分」，所以把这个大类切回展开模式。
      var it = api.findItem(id);
      var soloCat = null;
      if (it && it.categoryId) {
        var cat = api.findCategory(it.categoryId);
        if (cat && cat.groupAsOne) {
          cat.groupAsOne = false;
          soloCat = cat;
        }
      }
      save(); emit();
      return soloCat;
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

    /**
     * 转盘上真正会出现的选项。
     *
     * 两种情况：
     *   · 大类设了「整体上盘」→ 只出 1 个选项，名字是大类名；这个大类的菜不论勾没勾都不再单独出扇区
     *   · 其余情况           → 每道勾中的菜各出 1 个选项（原来的行为）
     *
     * 返回的每一项都带 kind，因为转到「大类」和转到「某道菜」结果卡片要写得不一样：
     * 转到大类只说明「吃这一类」，具体哪道窗口前再挑。
     */
    wheelOptions: function () {
      var out = [];
      var grouped = {};
      data.categories.forEach(function (c) {
        if (!c.groupAsOne) return;
        grouped[c.id] = true;
        if (c.enabled === false) return;
        out.push({
          key: 'cat:' + c.id,
          kind: 'category',
          id: c.id,
          name: c.name,
          categoryId: c.id,
          count: api.itemsOf(c.id).length,
        });
      });
      data.items.forEach(function (i) {
        if (!i.enabled) return;
        if (i.categoryId && grouped[i.categoryId]) return;   // 归到整体里了，不单独出
        out.push({ key: 'it:' + i.id, kind: 'item', id: i.id, name: i.name, categoryId: i.categoryId || null });
      });
      return out;
    },

    /** 切换某个大类「整体上盘 / 展开成菜品」 */
    setCategoryMode: function (catId, groupAsOne) {
      var cat = api.findCategory(catId);
      if (!cat) return;
      cat.groupAsOne = !!groupAsOne;
      save(); emit();
    },

    /**
     * 一步到位：把这个大类切成「整体」并立刻放进转盘。
     *
     * 单独给一个方法，是因为「先切模式、再勾上盘」是两步，
     * 而用户点「整体」按钮时想要的是一步就看到转盘上多了一个位置。
     */
    enterCategoryAsOne: function (catId) {
      var cat = api.findCategory(catId);
      if (!cat) return;
      cat.groupAsOne = true;
      cat.enabled = true;
      save(); emit();
    },

    /** 批量勾选这些菜品；把它们所属的大类退出「整体」模式，否则它们不会生效 */
    setManyEntries: function (ids, catId, on) {
      var cat = catId ? api.findCategory(catId) : null;
      if (cat && cat.groupAsOne && on) cat.groupAsOne = false;
      var set = {};
      (ids || []).forEach(function (id) { set[id] = 1; });
      data.items.forEach(function (i) { if (set[i.id]) i.enabled = !!on; });
      save(); emit();
    },

    /** 整体模式下，这个大类要不要上盘 */
    setCategoryEnabled: function (catId, on) {
      var cat = api.findCategory(catId);
      if (!cat) return;
      cat.enabled = !!on;
      save(); emit();
    },

    groups: function () {
      var list = data.categories.map(function (c) {
        return {
          id: c.id, name: c.name, collapsed: !!c.collapsed, items: api.itemsOf(c.id),
          groupAsOne: !!c.groupAsOne, enabled: c.enabled !== false,
        };
      });
      list.push({ id: null, name: '未分类', collapsed: !!data.uncategorizedCollapsed, items: api.itemsOf(null), virtual: true, groupAsOne: false });
      return list;
    },

    stats: function () {
      return {
        items: data.items.length,
        enabled: api.wheelOptions().length,   // 「转盘上 N 道」：整体上盘时 1 个大类算 1 个
        categories: data.categories.length,
      };
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

    /* ------------------------------ 今天定了吃啥 ------------------------------ */

    /** 记下「就吃这个」。带日期，这样第二天打开不会还显示昨天的决定。 */
    setDecided: function (name, categoryId) {
      data.decided = { name: String(name || ''), categoryId: categoryId || null, at: Date.now(), day: dayKey() };
      save(); emit();
    },

    clearDecided: function () {
      data.decided = null;
      save(); emit();
    },

    /** 今天已经定过了？返回那条记录，否则 null */
    todayDecided: function () {
      var d = data.decided;
      if (!d || d.day !== dayKey()) return null;
      return d;
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

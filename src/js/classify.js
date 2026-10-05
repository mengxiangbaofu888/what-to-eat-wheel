/* ============================================================
   classify.js · 智能归类
   思路：中餐菜名基本是「前缀 + 品类词」的结构，例如
     麻辣鸡丁【滑蛋饭】 / 五花肉【滑蛋饭】
   所以用「共同后缀」聚类就能自动长出大类，不需要用户手动建。
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});
  var U = W.Util;

  /** 菜品品类词：后缀以它们结尾时，归类更可信 */
  var FOOD_WORDS = [
    '饭', '面', '粉', '线', '汤', '粥', '饼', '包', '卷', '馍', '饺', '锅', '煲', '串', '排', '扒',
    '翅', '腿', '肉', '鸡', '鸭', '鱼', '虾', '牛', '羊', '猪', '蛋', '菜', '豆', '丸', '糕', '酥',
    '茶', '汁', '奶', '派', '塔', '冻', '捞', '卤', '烤', '炸',
    '盖饭', '炒饭', '拌饭', '烩饭', '煲仔饭', '卤肉饭', '鸡排饭', '咖喱饭', '蛋炒饭', '饭团',
    '米线', '河粉', '肠粉', '拉面', '刀削面', '炒面', '汤面', '拌面', '凉面', '意面', '炒粉',
    '麻辣烫', '砂锅', '干锅', '火锅', '关东煮', '手抓饼', '肉夹馍', '煎饼', '烧麦', '小笼包',
    '汉堡', '披萨', '寿司', '沙拉', '三明治', '套餐', '盖浇饭',
  ];

  var MIN_LEN = 3;   // 后缀至少 3 个字，避免出现「肉面」「蛋饭」这种怪大类
  var MAX_LEN = 6;

  function endsWithFoodWord(suf) {
    for (var i = 0; i < FOOD_WORDS.length; i++) {
      var w = FOOD_WORDS[i];
      if (suf.length >= w.length && suf.slice(suf.length - w.length) === w) return true;
    }
    return false;
  }

  /** 后缀是否值得单独成为一个大类 */
  function isPlausible(suf, count) {
    if (suf.length < MIN_LEN) return false;
    if (endsWithFoodWord(suf)) return true;
    return count >= 3 && suf.length >= 4;
  }

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /** 名称里已经包含某个大类名 → 取最长匹配 */
  function matchExisting(name, categories) {
    var best = null;
    (categories || []).forEach(function (c) {
      if (!c.name || c.name === name) return;
      if (name.length > c.name.length && name.indexOf(c.name) >= 0) {
        if (!best || c.name.length > best.name.length) best = c;
      }
    });
    return best;
  }

  /** 计算两个名字的最长可信公共后缀 */
  function commonSuffix(a, b) {
    var maxLen = Math.min(MAX_LEN, Math.min(a.length, b.length) - 1);
    for (var len = maxLen; len >= MIN_LEN; len--) {
      var sa = a.slice(a.length - len);
      var sb = b.slice(b.length - len);
      if (sa === sb && (endsWithFoodWord(sa) || sa.length >= 4)) return sa;
    }
    return null;
  }

  /**
   * 全量规划：算出每个条目应该归到哪个大类，以及需要新建哪些大类。
   * 不会修改任何数据，纯函数，方便单测。
   */
  function planAll(items, categories) {
    var assign = {};                 // itemId -> categoryId
    var catByName = {};
    (categories || []).forEach(function (c) { catByName[c.name] = c; });
    var created = [];

    // 第一步：名字里已经含有现成大类名
    items.forEach(function (it) {
      var hit = matchExisting(it.name, categories);
      if (hit) assign[it.id] = hit.id;
    });

    // 第二步：剩下的按共同后缀聚类，长的后缀优先
    var free = items.filter(function (it) { return !assign[it.id] && it.name.length > MIN_LEN; });
    var buckets = {};
    free.forEach(function (it) {
      var n = it.name;
      var maxLen = Math.min(MAX_LEN, n.length - 1);
      for (var len = MIN_LEN; len <= maxLen; len++) {
        var suf = n.slice(n.length - len);
        (buckets[suf] = buckets[suf] || []).push(it.id);
      }
    });

    var candidates = Object.keys(buckets).map(function (suf) {
      return { suf: suf, ids: uniq(buckets[suf]) };
    }).filter(function (c) {
      return c.ids.length >= 2 && isPlausible(c.suf, c.ids.length);
    }).sort(function (a, b) {
      return b.suf.length - a.suf.length || b.ids.length - a.ids.length;
    });

    candidates.forEach(function (c) {
      var members = c.ids.filter(function (id) { return !assign[id]; });
      if (members.length < 2) return;
      var cat = catByName[c.suf];
      if (!cat) {
        cat = { id: U.uid('cat'), name: c.suf, virtual: false };
        created.push(cat);
        catByName[c.suf] = cat;
      }
      members.forEach(function (id) { assign[id] = cat.id; });
    });

    return { assign: assign, created: created };
  }

  /**
   * 添加单个新菜时猜测它该进哪个大类。
   * 返回 { categoryId } 或 { newCategoryName, mateItemId }（需要新建大类并把老条目一起挪进去）
   */
  function suggestForNew(name, items, categories) {
    name = String(name || '').trim();
    if (!name) return null;
    var hit = matchExisting(name, categories);
    if (hit) return { categoryId: hit.id };

    var best = null;
    (items || []).forEach(function (it) {
      if (it.name === name) return;
      var suf = commonSuffix(name, it.name);
      if (!suf) return;
      if (!best || suf.length > best.suf.length) best = { suf: suf, mate: it };
    });
    if (best) return { newCategoryName: best.suf, mateItemId: best.mate.id };
    return null;
  }

  W.Classify = {
    FOOD_WORDS: FOOD_WORDS,
    endsWithFoodWord: endsWithFoodWord,
    isPlausible: isPlausible,
    matchExisting: matchExisting,
    commonSuffix: commonSuffix,
    planAll: planAll,
    suggestForNew: suggestForNew,
  };
})(window);

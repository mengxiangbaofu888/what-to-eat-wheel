/* ============================================================
   vision.js · 拍照识别菜品（任何 OpenAI 兼容的视觉模型接口）
   ============================================================ */
(function (global) {
  'use strict';
  var W = (global.W = global.W || {});
  var U = W.Util;

  var PROMPT = [
    '你是一个食堂菜品识别助手。请看这张照片（可能是食堂菜牌、菜单、黑板、或者餐盘），列出所有能认出来的菜品或食物。',
    '严格要求：',
    '1. 只输出 JSON，不要任何解释文字，不要 markdown 代码块。',
    '2. 格式：{"dishes":[{"name":"菜名","category":"大类"}]}',
    '3. name 用中文菜名，尽量写完整，例如「麻辣鸡丁滑蛋饭」而不是「饭」；看不清口味就用最接近的通用名。',
    '4. category 是这道菜归属的大类，例如「麻辣鸡丁滑蛋饭」属于「滑蛋饭」，「红烧牛肉面」属于「牛肉面」；判断不出来就填 null。',
    '5. 最多列出 20 道，重复的只留一个。',
    '6. 如果照片里没有任何食物，返回 {"dishes":[]}。',
  ].join('\n');

  function endpoint(baseUrl) {
    var url = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error('还没有填接口地址');
    if (/\/chat\/completions$/.test(url)) return url;
    return url + '/chat/completions';
  }

  function extractJson(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续找 */ }
    var starts = [s.indexOf('{'), s.indexOf('[')].filter(function (i) { return i >= 0; });
    if (!starts.length) throw new Error('模型没有返回 JSON：' + s.slice(0, 120));
    var from = Math.min.apply(null, starts);
    var openCh = s[from];
    var closeCh = openCh === '{' ? '}' : ']';
    var depth = 0, inStr = false, esc = false, end = -1;
    for (var i = from; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === openCh) depth++;
      else if (ch === closeCh) { depth--; if (depth === 0) { end = i; break; } }
    }
    var raw = end >= 0 ? s.slice(from, end + 1) : s.slice(from);
    return JSON.parse(raw);
  }

  function normalizeDishes(parsed) {
    var list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.dishes)) list = parsed.dishes;
    else if (parsed && Array.isArray(parsed.data)) list = parsed.data;
    else if (parsed && Array.isArray(parsed.result)) list = parsed.result;
    else if (parsed && typeof parsed === 'object') {
      Object.keys(parsed).forEach(function (k) {
        if (Array.isArray(parsed[k])) list = list.concat(parsed[k]);
      });
    }
    var out = [];
    var seen = {};
    list.forEach(function (d) {
      var name = '', category = '';
      if (typeof d === 'string') name = d;
      else if (d && typeof d === 'object') {
        name = d.name || d.dish || d.title || d.food || '';
        category = d.category || d.cat || d.type || d.group || '';
      }
      name = String(name).trim().replace(/\s+/g, ' ');
      category = String(category || '').trim();
      if (!name || name === 'null') return;
      if (seen[name]) return;
      seen[name] = 1;
      out.push({ name: name, category: category || null });
    });
    return out;
  }

  function friendlyError(status, bodyText) {
    var detail = String(bodyText || '').slice(0, 220);
    if (status === 401 || status === 403) return 'API Key 不对或没有权限（HTTP ' + status + '）：' + detail;
    if (status === 404) return '接口地址或模型名不对（HTTP 404）：' + detail;
    if (status === 429) return '请求太频繁 / 额度用完了（HTTP 429）：' + detail;
    return '接口返回 HTTP ' + status + '：' + detail;
  }

  function postDirect(url, headers, payload, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 60000);
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      return res.text().then(function (text) {
        clearTimeout(timer);
        if (!res.ok) throw new Error(friendlyError(res.status, text));
        return text;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时（' + ((timeoutMs || 60000) / 1000) + ' 秒），网络太慢或图片太大');
      if (err instanceof Error && /^接口返回|^API Key|^接口地址/.test(err.message)) throw err;
      throw new Error('请求发不出去：' + (err && err.message ? err.message : err) +
        '。常见原因是浏览器跨域（CORS）被拦——打开「设置 → 通过本地代理请求」，或用手机浏览器直接打开本页面重试。');
    });
  }

  function readContent(text) {
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('接口返回的不是 JSON：' + String(text).slice(0, 160)); }
    if (json.error) throw new Error('接口报错：' + (json.error.message || JSON.stringify(json.error)).slice(0, 200));
    var choice = json.choices && json.choices[0];
    if (!choice) throw new Error('接口没有返回 choices：' + String(text).slice(0, 160));
    var msg = choice.message || {};
    var content = msg.content;
    if (Array.isArray(content)) {
      content = content.map(function (p) { return typeof p === 'string' ? p : (p && p.text) || ''; }).join('');
    }
    if (!content && msg.reasoning_content) content = msg.reasoning_content;
    return { content: String(content || ''), usage: json.usage || null };
  }

  var Vision = {
    PROMPT: PROMPT,
    endpoint: endpoint,
    extractJson: extractJson,
    normalizeDishes: normalizeDishes,

    /** 直接调用（或经本地代理）一次 chat/completions */
    call: function (settings, messages, opts) {
      opts = opts || {};
      var v = (settings && settings.vision) || settings || {};
      if (!v.apiKey) throw new Error('还没有填 API Key，去「设置」里填一下');
      var payload = {
        model: v.model,
        messages: messages,
        temperature: 0.1,
        max_tokens: opts.maxTokens || 1200,
      };
      if (!payload.model) throw new Error('还没有填模型名，去「设置」里填一下');

      var useProxy = !!v.useProxy && global.location && global.location.protocol !== 'file:';
      if (useProxy) {
        return postDirect('/api/vision', { 'Content-Type': 'application/json' }, {
          baseUrl: v.baseUrl, apiKey: v.apiKey, model: v.model, payload: payload,
        }, opts.timeoutMs).then(readContent);
      }
      return postDirect(endpoint(v.baseUrl), {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + v.apiKey,
      }, payload, opts.timeoutMs).then(readContent);
    },

    /** 识别一张或多张图片（dataURL 数组） */
    recognize: function (settings, images, onProgress) {
      var content = [{ type: 'text', text: PROMPT }];
      (images || []).forEach(function (url) {
        content.push({ type: 'image_url', image_url: { url: url } });
      });
      if (onProgress) onProgress('正在识别…');
      return Vision.call(settings, [{ role: 'user', content: content }], { timeoutMs: 90000 })
        .then(function (r) {
          var parsed = extractJson(r.content);
          return { dishes: normalizeDishes(parsed), raw: r.content, usage: r.usage };
        });
    },

    /** 测试连接：发一句纯文本，验证地址 / Key / 模型名是否可用 */
    test: function (settings) {
      return Vision.call(settings, [{ role: 'user', content: '回复两个字：收到' }], { maxTokens: 16, timeoutMs: 30000 })
        .then(function (r) { return { ok: true, message: '连接正常，模型回复：' + r.content.trim().slice(0, 40) }; });
    },
  };

  W.Vision = Vision;
})(window);

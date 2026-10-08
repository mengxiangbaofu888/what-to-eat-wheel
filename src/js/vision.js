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

  /** 把 base URL 变成 /models（拉模型列表用）；如果用户直接填了完整端点，就把尾巴削掉 */
  function modelsEndpoint(baseUrl) {
    var url = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error('还没有填接口地址');
    url = url.replace(/\/chat\/completions$/, '');
    return url + '/models';
  }

  /**
   * 猜这个模型名能不能看图。
   *
   * 「拉取模型列表」拉回来的是一大串名字，绝大多数是纯文字模型，
   * 用户根本分不清哪个能用来识别菜牌。按名字里的习惯叫法做个粗筛，
   * 能看图的排前面并标出来——不保证 100% 准，但比让用户一个个试强得多。
   */
  function looksLikeVisionModel(id) {
    var s = String(id || '').toLowerCase();

    // 明确写着视觉的
    if (/vision|multimodal|omni/.test(s)) return true;
    // vl 作为独立词：qwen-vl-max、qwen3-vl-plus
    if (/(^|[^a-z])vl([^a-z]|$)/.test(s)) return true;
    // 数字后面紧跟 v：glm-4.6v-flash、glm-5v-turbo、glm-4v-flash
    // 注意不能写成 v 加数字——那是版本号（moonshot-v1-8k 里的 v1 就不是 vision）
    if (/\d\s*v(\d)?([-_./]|$)/.test(s)) return true;
    if (/qwen\d*[-.]?vl/.test(s)) return true;
    // 开源多模态的常见名字
    if (/llava|internvl|minicpm-v|moondream|bakllava/.test(s)) return true;
    // 闭源里大家都知道的
    if (/gpt-[45]|gpt-4o/.test(s)) return true;
    if (/gemini/.test(s)) return true;
    if (/doubao.*(vision|seed)/.test(s)) return true;
    if (/step-1v|abab.*vl|hunyuan.*vision/.test(s)) return true;
    return false;
  }

  /**
   * 扫描一段 JSON 文本，找出「完整元素」的结束位置。
   *
   * 用来对付**被截断的 JSON**：模型输出到一半撞上 max_tokens，
   * 最后一个菜品对象往往是残的（`{"name":"五花`），但它前面的都是好的。
   */
  function scanCompleteItems(s, arrStart) {
    var depth = 0, inStr = false, esc = false;
    var ends = [];
    for (var i = arrStart; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 1) ends.push(i);      // 回到数组层 = 一个元素收尾了
        if (depth === 0) break;             // 整个数组结束
      }
    }
    return ends;
  }

  function extractJson(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var firstErr = null;

    try { return JSON.parse(s); } catch (e) { firstErr = e; }

    var starts = [s.indexOf('{'), s.indexOf('[')].filter(function (i) { return i >= 0; });
    if (!starts.length) {
      throw apiError('模型没有按格式返回 JSON。它说的是：' + s.slice(0, 120), 0);
    }
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

    if (end >= 0) {
      // 括号配平了，说明结构完整，解析失败只可能是内容本身有问题
      try { return JSON.parse(s.slice(from, end + 1)); } catch (e) { firstErr = e; }
    }

    /*
     * 走到这里说明 JSON 不完整（多半是被 max_tokens 截断了）。
     * 不要整段丢掉——把已经完整的那些菜品救出来，总比让用户重拍一次强。
     */
    var arrStart = s.indexOf('[', from);
    if (arrStart >= 0) {
      var ends = scanCompleteItems(s, arrStart);
      if (ends.length) {
        var salvaged = s.slice(arrStart, ends[ends.length - 1] + 1) + ']';
        try {
          var arr = JSON.parse(salvaged);
          if (Array.isArray(arr) && arr.length) {
            arr.__salvaged = true;   // 让上层知道「这是从截断的输出里救出来的」
            return arr;
          }
        } catch (e) { /* 救不回来就算了 */ }
      }
    }

    // 实在解析不了，给一句人话——绝不能把 JSON.parse 的英文异常直接甩给用户
    throw apiError(
      '模型返回的内容不是合法 JSON，解析不了。' +
      '多半是它没按要求只输出 JSON，或者输出太长被截断了（这次大约 ' + s.length + ' 个字符）。' +
      '可以再试一次；老是这样就在设置里换个模型。' +
      '（模型原文开头：' + s.slice(from, from + 80) + '…）',
      0,
    );
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

  /**
   * 从服务商的错误体里把**它自己那句话**抠出来。
   *
   * 各家的格式五花八门，但都有一句给人看的说明，而且往往是中文的、最准的：
   *   智谱   {"error":{"code":"1305","message":"该模型当前访问量过大，请您稍后再试"}}
   *   OpenAI {"error":{"message":"...","type":"..."}}
   *   有些网关直接给 {"message":"..."} 或 {"msg":"..."}
   * 把这句话放在报错的最前面，比我自己编一句「请求太频繁」有用得多。
   */
  function providerMessage(bodyText) {
    var s = String(bodyText || '').trim();
    if (!s) return '';
    try {
      var j = JSON.parse(s);
      var e = j && j.error;
      var m = (e && (e.message || e.msg)) || j.message || j.msg || (j.error && typeof j.error === 'string' ? j.error : '');
      var code = e && (e.code || e.type);
      if (typeof m === 'string' && m) return code ? '「' + m + '」（' + code + '）' : '「' + m + '」';
    } catch (err) { /* 不是 JSON，那就原样截一段 */ }
    return s.slice(0, 200);
  }

  /** 是不是跑在安卓原生壳里（用于给出「这个环境下真的做得到」的建议） */
  function isNativeShell() {
    try {
      var c = global.Capacitor;
      return !!(c && ((c.isNativePlatform && c.isNativePlatform()) || c.isNative));
    } catch (e) { return false; }
  }

  /**
   * 请求真的发不出去（断网、跨域被拦、证书问题）时给的提示。
   *
   * 注意：分环境给建议。App 里「通过本地代理请求」是禁用的，
   * 在这种环境下让用户去开那个开关等于把人指进死胡同。
   */
  function unreachableHint() {
    if (isNativeShell()) {
      return '连不上接口。检查一下手机的联网状态，或者换个网络（有些校园网会拦第三方接口）。';
    }
    if (global.location && global.location.protocol === 'file:') {
      return '连不上接口。本地双击打开的单文件没有代理可用；' +
        '换成 `npm run serve` 打开，并在设置里勾上「通过本地代理请求」，就能绕开浏览器跨域。';
    }
    return '连不上接口。浏览器可能把跨域请求拦了：用 `npm run serve` 打开，' +
      '并在设置里勾上「通过本地代理请求」再试。';
  }

  /**
   * 服务商返回了非 2xx 状态码时的提示。
   *
   * 这里的原则：**把服务商的原话放在最前面**，我自己的解释放后面。
   * 像 1305「该模型当前访问量过大」这种，本身就是最准确的答案；
   * 以前我在外面又套了一层「请求发不出去 / 浏览器跨域被拦」，方向完全是错的
   * （都收到 HTTP 响应了，怎么可能是发不出去）。
   */
  /**
   * 这个报错是不是「模型不收图片」。
   *
   * 纯文本模型遇到带 image_url 的消息，各家会在参数校验阶段拦下来，说法不同：
   *   智谱   400 {"code":"1210","message":"messages.content.type 参数非法，取值范围 ['text']"}
   *   OpenAI 400 "Invalid content type. Expected 'text'"
   *   有些网关会说 "image_url is not supported" / "model does not support vision"
   * 认出来之后要给一句人能看懂的结论：你选的不是视觉模型。
   */
  function looksLikeNoVision(bodyText) {
    var s = String(bodyText || '');
    return /messages\.content\.type|content\.type|image_url|image is not supported|does not support (vision|image)|multimodal|参数非法.*text|Expected 'text'/i.test(s);
  }

  function friendlyError(status, bodyText) {
    var said = providerMessage(bodyText);
    var head = said ? said + '　' : '';

    if ((status === 400 || status === 422) && looksLikeNoVision(bodyText)) {
      return head + '（HTTP ' + status + '）这个模型**不收图片**，它不是视觉模型。' +
        '拍照识别必须用支持图片输入的模型，比如智谱的 glm-4.6v-flash（免费）、' +
        '硅基流动的 Qwen/Qwen3.5-4B，或百炼的 qwen3-vl-plus。' +
        '去「设置」里换一个带 V 的模型名再试。';
    }

    if (status === 401 || status === 403) {
      return head + '（HTTP ' + status + '）API Key 不对或没有权限。检查 Key 有没有复制全、有没有开通这个模型。';
    }
    if (status === 404) {
      return head + '（HTTP 404）接口地址或模型名不对。检查 base URL 和模型名。';
    }
    if (status === 429) {
      return head + '（HTTP 429）服务商在限流。' +
        '免费的视觉模型（比如 glm-4.6v-flash）用的人多，很容易这样——' +
        '等一两分钟再试，或者在设置里换个模型、换个服务商。';
    }
    if (status >= 500) {
      return head + '（HTTP ' + status + '）服务商那边出错了，一般等一会儿会自己好。';
    }
    return head + '（HTTP ' + status + '）接口返回了错误。';
  }

  /**
   * 从 /models 的返回里把模型名抠出来。
   *
   * 标准 OpenAI 格式是 {"data":[{"id":"xxx"}]}，但实际见过好几种写法：
   *   {"data":[{"id":"..."}]}        标准
   *   {"models":[{"name":"..."}]}    有些网关
   *   {"data":["模型名", ...]}        直接给字符串数组
   *   直接就是一个数组
   * 全试一遍，别因为格式差一点就报「没找到模型列表」。
   */
  function pickModelIds(text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return []; }

    var list = null;
    if (Array.isArray(j)) list = j;
    else if (j && Array.isArray(j.data)) list = j.data;
    else if (j && Array.isArray(j.models)) list = j.models;
    else if (j && j.data && Array.isArray(j.data.models)) list = j.data.models;
    else if (j && Array.isArray(j.result)) list = j.result;
    if (!list) return [];

    var out = [];
    var seen = {};
    list.forEach(function (item) {
      var id = '';
      if (typeof item === 'string') id = item;
      else if (item && typeof item === 'object') id = item.id || item.name || item.model || item.model_name || '';
      id = String(id || '').trim();
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push(id);
    });
    return out;
  }

  /** 带标记的错误：告诉后面的 catch「这是接口返回的错，别再当网络故障重新包装一遍」 */
  function apiError(message, status) {
    var e = new Error(message);
    e.apiStatus = status || 0;
    return e;
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
        if (!res.ok) throw apiError(friendlyError(res.status, text), res.status);
        return text;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      // 接口返回的错原样抛出，不要动它
      if (err && err.apiStatus) throw err;
      if (err && err.name === 'AbortError') {
        throw apiError('请求超时（' + ((timeoutMs || 60000) / 1000) + ' 秒），网络太慢或图片太大', 0);
      }
      // 连响应都没拿到，才是真的发不出去
      throw apiError(unreachableHint() + '（' + ((err && err.message) || err) + '）', 0);
    });
  }

  function readContent(text) {
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw apiError('接口返回的不是 JSON（可能是接口地址填成了普通网址）：' + String(text).slice(0, 120), 0); }
    if (json.error) throw apiError('接口报错：' + providerMessage(text), 0);
    var choice = json.choices && json.choices[0];
    if (!choice) throw apiError('接口没有返回 choices：' + String(text).slice(0, 160), 0);
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

      /*
       * 要不要走本地代理。
       *
       * 「通过本地代理请求」是给浏览器 + `npm run serve` 用的：浏览器的 CORS 会拦住
       * 直连第三方接口，绕本地服务器转发就没事。
       *
       * 但在安卓原生壳（Capacitor）里根本没有那个本地服务器——WebView 自己跑在一个
       * https://localhost 上，于是 '/api/vision' 这种相对路径会打到 Capacitor 的
       * 静态资源服务器上，被 SPA 兜底规则返回成 index.html。
       * 用户看到的报错就是「接口返回的不是 JSON: <!doctype html> ... viewport-fit=cover ...」，
       * 而那串 HTML 其实就是应用自己的首页。
       *
       * 所以原生壳里必须无视这个开关（直连不受 CORS 限制，因为走的是原生网络栈）。
       */
      var nativeShell = isNativeShell();
      var useProxy = !!v.useProxy && !nativeShell && global.location && global.location.protocol !== 'file:';
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

    /**
     * 带自动重试的调用。
     *
     * 只重试 429（限流）和 5xx（服务商临时抽风）——这两种等一下再来通常就好了，
     * 而免费的视觉模型（glm-4.6v-flash 之类）被限流是家常便饭，
     * 与其让用户自己反复点，不如自己等两秒再试一次。
     * 401/404 这类重试多少次都一样，直接抛给用户。
     */
    callWithRetry: function (settings, messages, opts) {
      opts = opts || {};
      var tries = opts.retries === undefined ? 2 : opts.retries;
      var onWait = opts.onWait;
      var attempt = 0;

      function run() {
        attempt++;
        return Vision.call(settings, messages, opts).catch(function (err) {
          var st = (err && err.apiStatus) || 0;
          var retryable = st === 429 || st >= 500;
          if (!retryable || attempt > tries) throw err;
          var waitMs = 1500 * attempt;   // 越往后等越久
          if (onWait) onWait(attempt, waitMs);
          return new Promise(function (resolve) { setTimeout(resolve, waitMs); }).then(run);
        });
      }
      return run();
    },

    /** 识别一张或多张图片（dataURL 数组） */
    recognize: function (settings, images, onProgress) {
      var content = [{ type: 'text', text: PROMPT }];
      (images || []).forEach(function (url) {
        content.push({ type: 'image_url', image_url: { url: url } });
      });
      if (onProgress) onProgress('正在识别…');
      return Vision.callWithRetry(settings, [{ role: 'user', content: content }], {
        timeoutMs: 90000,
        // 给宽一点：菜牌上菜多的时候，20 条菜名加结构，1200 很容易被截断
        maxTokens: 2000,
        onWait: function (attempt) {
          if (onProgress) onProgress('模型那边在排队（第 ' + attempt + ' 次重试）…');
        },
      }).then(function (r) {
        var parsed = extractJson(r.content);
        var salvaged = !!(parsed && parsed.__salvaged);
        var dishes = normalizeDishes(parsed);
        return {
          dishes: dishes,
          raw: r.content,
          usage: r.usage,
          // 输出被截断、只救回了一部分——要如实告诉用户，别让他以为就这些菜
          salvaged: salvaged && dishes.length > 0,
        };
      });
    },

    /**
     * 拉取这个 Key 能用的模型列表。
     *
     * 为什么要这个：让用户自己去找模型名太折腾了——各家控制台里的写法五花八门，
     * 有的还要填带斜杠的全名（Qwen/Qwen3.5-4B）或者接入点 ID。
     * 但几乎所有人都提供了 OpenAI 兼容的 GET /models，直接问它就行。
     *
     * 返回 [{ id, vision }]，能看图的排在前面。
     */
    listModels: function (settings, opts) {
      opts = opts || {};
      var v = (settings && settings.vision) || settings || {};
      if (!v.apiKey) throw apiError('先填 API Key，再拉模型列表', 0);
      var url = modelsEndpoint(v.baseUrl);
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeoutMs || 25000);

      return fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + v.apiKey, Accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (res) {
        return res.text().then(function (text) {
          clearTimeout(timer);
          if (!res.ok) throw apiError(friendlyError(res.status, text), res.status);
          var ids = pickModelIds(text);
          if (!ids.length) {
            throw apiError('拉到了响应，但里面没找到模型列表。' +
              '可能这家不提供 /models 接口，那就只能手动填模型名了。（返回内容开头：' + String(text).slice(0, 80) + '）', 0);
          }
          return ids
            .map(function (id) { return { id: id, vision: looksLikeVisionModel(id) }; })
            .sort(function (a, b) {
              if (a.vision !== b.vision) return a.vision ? -1 : 1;   // 能看图的排前面
              return a.id.localeCompare(b.id);
            });
        });
      }).catch(function (err) {
        clearTimeout(timer);
        if (err && err.apiStatus) throw err;
        if (err && err.name === 'AbortError') throw apiError('拉取模型列表超时了', 0);
        throw apiError(unreachableHint() + '（' + ((err && err.message) || err) + '）', 0);
      });
    },

    /**
     * 测试连接。
     *
     * ⚠️ 必须带一张图片去测，不能只发纯文本。
     *   这是踩过的坑：用户换了个纯文本模型，点「测试连接」显示正常，
     *   一到拍照识别就报 400「messages.content.type 参数非法，取值范围 ['text']」——
     *   因为纯文本模型也收得下纯文本，"测试通过"是假的。
     *   这个接口存在的意义就是「能不能看图」，那就拿图去测。
     *
     * 用 1×1 的 PNG（一百来字节），几乎不耗额度，也不用等。
     */
    TEST_IMAGE: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',

    test: function (settings) {
      var content = [
        { type: 'text', text: '这是一张 1×1 的测试图。只回复两个字：收到' },
        { type: 'image_url', image_url: { url: Vision.TEST_IMAGE } },
      ];
      return Vision.callWithRetry(settings, [{ role: 'user', content: content }], {
        maxTokens: 16, timeoutMs: 30000, retries: 1,
      }).then(function (r) {
        return { ok: true, message: '连接正常，而且这个模型能收图片。模型回复：' + r.content.trim().slice(0, 30) };
      });
    },
  };

  // 把错误处理也挂出来：这两条是纯函数，测试里要直接验
  //（线上出过「明明收到了 HTTP 429，却提示用户去开跨域代理」的错，就是因为没人测这里）
  Vision.providerMessage = providerMessage;
  Vision.friendlyError = friendlyError;
  Vision.unreachableHint = unreachableHint;
  Vision.looksLikeNoVision = looksLikeNoVision;
  Vision.looksLikeVisionModel = looksLikeVisionModel;
  Vision.pickModelIds = pickModelIds;
  Vision.modelsEndpoint = modelsEndpoint;

  W.Vision = Vision;
})(window);

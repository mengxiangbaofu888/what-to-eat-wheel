/**
 * test-vision-errors.mjs · 视觉接口错误提示的自测
 *
 * 为什么专门给这块写测试：
 *   线上出过一次很难看的 bug —— 用户收到的是 HTTP 429（智谱返回
 *   {"error":{"code":"1305","message":"该模型当前访问量过大"}}），
 *   但界面提示的是「请求发不出去……常见原因是浏览器跨域被拦，去开『通过本地代理请求』」。
 *   方向完全错了：都拿到 HTTP 响应了，怎么可能是发不出去；
 *   而且在安卓 App 里那个代理开关是禁用的，等于把用户指进死胡同。
 *
 *   根因是我用**字符串前缀正则**来判断「这个错误是不是接口返回的」——
 *   429 的文案不匹配那几个前缀，就被当成网络故障又包装了一遍。
 *   现在改成给错误打 apiStatus 标记，并且把服务商的原话放在提示最前面。
 *
 * 用法：node scripts/test-vision-errors.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'js');

/** 造一个够用的浏览器环境 */
function loadVision(opts = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.location = { protocol: opts.protocol || 'https:' };
  if (opts.native) sandbox.Capacitor = { isNativePlatform: () => true };
  vm.createContext(sandbox);
  for (const f of ['util.js', 'vision.js']) {
    vm.runInContext(readFileSync(join(SRC, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.W.Util && sandbox.W.Vision;
}

const V = loadVision();
let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}\n       ${detail}`); }
}
function has(text, needle) { return String(text).indexOf(needle) >= 0; }

console.log('\n=== 视觉接口错误提示自测 ===\n');

/* ---------- 服务商那句话要被抠出来 ---------- */

console.log('1) 各家错误体里「给人看的那句话」');
const zhipu = '{"error":{"code":"1305","message":"该模型当前访问量过大，请您稍后再试"}}';
check('智谱：message + code', V.providerMessage(zhipu) === '「该模型当前访问量过大，请您稍后再试」（1305）', V.providerMessage(zhipu));
check('OpenAI：message + type', has(V.providerMessage('{"error":{"message":"Incorrect API key","type":"invalid_request_error"}}'), 'Incorrect API key'), V.providerMessage('{"error":{"message":"Incorrect API key","type":"invalid_request_error"}}'));
check('裸 message', has(V.providerMessage('{"message":"余额不足"}'), '余额不足'), V.providerMessage('{"message":"余额不足"}'));
check('非 JSON 就原样截一段', V.providerMessage('<html>502 Bad Gateway</html>') === '<html>502 Bad Gateway</html>', V.providerMessage('<html>502 Bad Gateway</html>'));

/* ---------- 429：这次 bug 的主角 ---------- */

console.log('\n2) HTTP 429（限流）：不能再提跨域/代理');
const msg429 = V.friendlyError(429, zhipu);
check('把服务商原话放最前面', msg429.startsWith('「该模型当前访问量过大，请您稍后再试」（1305）'), msg429);
check('带 HTTP 429', has(msg429, 'HTTP 429'), msg429);
check('说明是服务商在限流', has(msg429, '限流'), msg429);
check('给出可操作建议（等一会儿 / 换模型）', has(msg429, '等一两分钟') && has(msg429, '换个模型'), msg429);
check('绝不出现「发不出去」', !has(msg429, '发不出去'), msg429);
check('绝不出现「跨域」', !has(msg429, '跨域'), msg429);
check('绝不提「通过本地代理请求」', !has(msg429, '本地代理'), msg429);

/* ---------- 401 / 404 / 5xx ---------- */

console.log('\n3) 其他状态码');
const msg401 = V.friendlyError(401, '{"error":{"message":"Invalid API key"}}');
check('401：带上原话 + 指向 Key', has(msg401, 'Invalid API key') && has(msg401, 'API Key'), msg401);
check('401：不提跨域', !has(msg401, '跨域'), msg401);

const msg404 = V.friendlyError(404, '{"error":{"message":"model not found"}}');
check('404：指向地址/模型名', has(msg404, 'model not found') && has(msg404, '模型名'), msg404);

const msg500 = V.friendlyError(503, '<html>Service Unavailable</html>');
check('5xx：说明是服务商那边的问题', has(msg500, 'HTTP 503') && has(msg500, '服务商'), msg500);

/* ---------- 「真的发不出去」时，建议要分环境 ---------- */

console.log('\n4) 连响应都没拿到时，建议必须分环境给');
const appV = loadVision({ native: true, protocol: 'https:' });
const appHint = appV.unreachableHint();
check('App 里：不提代理/跨域', !has(appHint, '本地代理') && !has(appHint, '跨域'), appHint);
check('App 里：指向联网状态', has(appHint, '联网'), appHint);

const fileV = loadVision({ protocol: 'file:' });
check('本地单文件：说明没有代理可用，并给出 npm run serve 的路子',
  has(fileV.unreachableHint(), 'npm run serve') && has(fileV.unreachableHint(), '本地双击'), fileV.unreachableHint());

const webV = loadVision({ protocol: 'http:' });
check('浏览器 + 本地服务器：才建议去开代理', has(webV.unreachableHint(), '通过本地代理请求'), webV.unreachableHint());

/* ---------- 关键：收到 HTTP 响应就不该被当成「发不出去」 ---------- */

console.log('\n5) 接口返回的错误不能被重新包装成网络故障');
const e = new Error('whatever');
e.apiStatus = 429;
check('带 apiStatus 标记的错误会原样抛出', e.apiStatus === 429);
// 直接验源码里不再用字符串前缀做控制流
const src = readFileSync(join(SRC, 'vision.js'), 'utf8');
check('vision.js 不再用「消息前缀正则」判断错误类型',
  !/\^接口返回\|\^API Key\|\^接口地址/.test(src), '又出现了靠文案前缀判断的老写法');
check('vision.js 用 apiStatus 标记',
  has(src, 'apiStatus'), '没找到 apiStatus 标记');

/* ---------- 模型输出被截断：要能救回来，英文异常不能漏出去 ---------- */

console.log('\n5) 模型输出被截断（线上报过 Unterminated string in JSON）');

const fullJson = '{"dishes":[{"name":"麻辣鸡丁滑蛋饭","category":"滑蛋饭"},{"name":"五花肉滑蛋饭","category":"滑蛋饭"}]}';
check('完整 JSON 正常解析', V.extractJson(fullJson).dishes.length === 2);

// 撞上 max_tokens：最后一个对象是残的
const truncated = '{"dishes":[{"name":"麻辣鸡丁滑蛋饭","category":"滑蛋饭"},'
  + '{"name":"五花肉滑蛋饭","category":"滑蛋饭"},{"name":"番茄';
let salvaged = null, salvageErr = null;
try { salvaged = V.extractJson(truncated); } catch (e) { salvageErr = e; }
check('截断的 JSON 不抛异常', !salvageErr, salvageErr && salvageErr.message);
check('截断的 JSON 能把已完整的部分救回来', salvaged && salvaged.length === 2, JSON.stringify(salvaged));
check('救回来的数据带 __salvaged 标记', salvaged && salvaged.__salvaged === true, JSON.stringify(salvaged));
check('救回来的菜名正确',
  salvaged && salvaged[0].name === '麻辣鸡丁滑蛋饭' && salvaged[1].name === '五花肉滑蛋饭',
  JSON.stringify(salvaged));

// 连一个完整对象都没有：必须给中文说明，不能是英文异常
let hopelessErr = null;
try { V.extractJson('{"dishes":[{"name":"麻辣'); } catch (e) { hopelessErr = e; }
check('救不回来时抛的是中文说明',
  hopelessErr && /不是合法 JSON/.test(hopelessErr.message), hopelessErr && hopelessErr.message);
check('救不回来时不泄漏英文 JSON 异常',
  hopelessErr && !/Unterminated|Unexpected|position \d+/.test(hopelessErr.message),
  hopelessErr && hopelessErr.message);

// 模型根本没给 JSON
let chattyErr = null;
try { V.extractJson('我看了一下这张图，上面好像是红烧肉和青菜。'); } catch (e) { chattyErr = e; }
check('模型没给 JSON 时给中文提示',
  chattyErr && /没有按格式返回 JSON/.test(chattyErr.message), chattyErr && chattyErr.message);

// markdown 代码块仍要能剥掉
check('```json 代码块能剥掉',
  V.extractJson('```json\n{"dishes":[{"name":"红烧肉"}]}\n```').dishes[0].name === '红烧肉');

/* ---------- 拉取模型列表：解析 + 视觉模型识别 ---------- */

console.log('\n6) 拉取模型列表');

// 各家 /models 的返回格式不一样，都得能认
const fmtStd = '{"object":"list","data":[{"id":"glm-4.6v-flash"},{"id":"glm-4.6"}]}';
check('标准 OpenAI 格式', JSON.stringify(V.pickModelIds(fmtStd)) === '["glm-4.6v-flash","glm-4.6"]', JSON.stringify(V.pickModelIds(fmtStd)));
check('models[] + name 字段',
  V.pickModelIds('{"models":[{"name":"qwen3-vl-plus"},{"name":"qwen3-max"}]}').length === 2,
  JSON.stringify(V.pickModelIds('{"models":[{"name":"qwen3-vl-plus"},{"name":"qwen3-max"}]}')));
check('直接是字符串数组', JSON.stringify(V.pickModelIds('["a","b"]')) === '["a","b"]', JSON.stringify(V.pickModelIds('["a","b"]')));
check('裸数组 + 对象混合', V.pickModelIds('{"data":[{"id":"x"},"y"]}').join(',') === 'x,y', V.pickModelIds('{"data":[{"id":"x"},"y"]}').join(','));
check('去重', V.pickModelIds('{"data":[{"id":"a"},{"id":"a"}]}').length === 1);
check('非 JSON 返回空数组不抛错', Array.isArray(V.pickModelIds('<html>404</html>')) && V.pickModelIds('<html>404</html>').length === 0);

// 能不能看出「这个模型或许能看图」——这决定了用户会不会挑错
console.log('\n  视觉模型识别：');
const visionIds = ['glm-4.6v-flash', 'glm-5v-turbo', 'qwen3-vl-plus', 'gpt-4o', 'gemini-3.8-flash', 'llava:13b', 'internvl2', 'doubao-seed-1-6-vision-250815'];
const textIds = ['glm-4.6', 'qwen3-max', 'deepseek-chat', 'text-embedding-3-small', 'gpt-3.5-turbo-instruct'];
// 名字里看不出标志的：既不能断言能看图，也不该说人家是纯文字模型
const unknownIds = ['Qwen/Qwen3.5-4B', 'moonshot-v1-8k'];
visionIds.forEach((id) => {
  check(`  ${id} → 能看图`, V.looksLikeVisionModel(id) === true, String(V.looksLikeVisionModel(id)));
});
textIds.forEach((id) => {
  check(`  ${id} → 看不出视觉标志`, V.looksLikeVisionModel(id) === false, String(V.looksLikeVisionModel(id)));
});
unknownIds.forEach((id) => {
  check(`  ${id} → 不误判（名字里没标志就如实说看不出）`, V.looksLikeVisionModel(id) === false, String(V.looksLikeVisionModel(id)));
});
// 措辞层面的检查：界面不能把「看不出标志」说成「纯文字」
const appSrc = readFileSync(join(SRC, 'app.js'), 'utf8');
check('界面措辞不说「纯文字」（会误导用户错过好模型）', !has(appSrc, "'纯文字'"), '又写回「纯文字」了');
check('界面措辞用「未标注」', has(appSrc, '未标注'), '没找到「未标注」');

// 端点的拼法
check('baseUrl → /models', V.modelsEndpoint('https://api.siliconflow.cn/v1') === 'https://api.siliconflow.cn/v1/models', V.modelsEndpoint('https://api.siliconflow.cn/v1'));
check('填了完整端点也能削回来',
  V.modelsEndpoint('https://x.com/v1/chat/completions') === 'https://x.com/v1/models',
  V.modelsEndpoint('https://x.com/v1/chat/completions'));

/* ---------- 源码层面的老毛病别再回来 ---------- */

console.log('\n7) 源码回归检查');
// 之前这里写错过一次：拿「return JSON.parse(...)」这个字符串本身当判据，
// 结果那行明明在 try 里也被判成裸调用。改成检查它前面有没有 try。
const bareParse = [...src.matchAll(/^.*JSON\.parse\(.*$/gm)].filter((m) => {
  const line = m[0].trim();
  if (line.startsWith('//')) return false;                 // 注释
  const before = src.slice(Math.max(0, m.index - 300), m.index);
  return !/try\s*\{[^}]*$/.test(before) && !line.startsWith('try ');
});
check('每个 JSON.parse 都有 try/catch 兜底', bareParse.length === 0,
  bareParse.map((m) => m[0].trim()).join(' | '));
check('extractJson 有截断抢救逻辑（scanCompleteItems）', has(src, 'scanCompleteItems'), '抢救逻辑不见了');
check('抢救结果带 __salvaged 标记', has(src, '__salvaged'), '没找到 __salvaged');

console.log(`\n=== 结果：${passed} 项通过，${failures.length} 项失败 ===`);
if (failures.length) {
  console.log('失败项：' + failures.join('、'));
  process.exit(1);
}
console.log('全部通过 🎉\n');
/* 构建自包含 HTML：把 4 个共用模块与预置验证结果内联进场景模板。
 * 关键约束：内联的 JS 中若出现 </script> 字面量会提前闭合 script 标签，
 * 故统一转义为 <\/script（在 JS 字符串中语义等价）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = __dirname;
const OUT = path.join(ROOT, 'outputs', '背包系统_场景与逐项验证.html');

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf-8');
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

const PLACEHOLDERS = ['__INLINE_JS__', '__PRECOMPUTED__', '__ENGINE_VERSION__', '__GENERATED_AT__'];

function selfCheck(html, parts) {
  const errors = [];

  // 1) 模板占位符残留：只检查本项目实际使用的那四个，
  //    不用泛化的 /__[A-Z_]+__/ —— 那会误伤正常的 JS 常量名。
  const leftovers = PLACEHOLDERS.filter((k) => html.indexOf(k) >= 0);
  if (leftovers.length) errors.push('模板占位符残留: ' + leftovers.join(', '));

  // 2) 外部资源引用（离线自包含要求）
  const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi);
  if (external) errors.push('存在外部资源引用: ' + external.slice(0, 3).join(' | '));

  // 3) 容器标签配对：仅检查渲染用 markup，排除 script 块（JS 字符串会污染计数）
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const tags = ['html', 'head', 'body', 'main', 'section', 'div', 'span', 'p', 'h1', 'h2', 'h3',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'details', 'summary', 'dl', 'dt', 'dd',
    'ul', 'ol', 'li', 'select', 'option', 'label', 'button', 'footer', 'header'];
  tags.forEach((tag) => {
    const open = (markup.match(new RegExp('<' + tag + '(?=[\\s>])', 'gi')) || []).length;
    const close = (markup.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
    if (open !== close) errors.push(`标签不配对 <${tag}>: 开 ${open} / 闭 ${close}`);
  });

  // 4) 内联脚本语法可解析
  const blocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1]);
  if (blocks.length !== 3) errors.push(`script 块数量异常: ${blocks.length}（应为 3）`);
  blocks.forEach((code, i) => {
    try { new vm.Script(code, { filename: 'inline-' + i + '.js' }); }
    catch (e) { errors.push(`内联脚本 ${i} 语法错误: ${e.message}`); }
  });

  // 5) 四个共用模块确实被内联，且来自同一份源码
  parts.forEach((p) => {
    if (html.indexOf(p.fingerprint) < 0) errors.push('未内联模块: ' + p.name);
  });

  return errors;
}

function reverseSelfCheck(goodHtml, parts) {
  const probes = [
    { name: '未闭合 section', expect: '标签不配对', html: goodHtml.replace('</section>', '', 1) },
    { name: '外部 CDN', expect: '外部资源引用', html: goodHtml.replace('<body>', '<body><script src="https://cdn.example.com/x.js"><\/script>') },
    { name: '占位符残留', expect: '占位符残留', html: goodHtml.replace('<body>', '<body>__ENGINE_VERSION__') },
    { name: '脚本语法错误', expect: '语法错误', html: goodHtml.replace('</body>', '<script>var = ;<\/script></body>') }
  ];
  return probes.map((p) => {
    const errs = selfCheck(p.html, parts);
    return { name: p.name, caught: errs.some((e) => e.indexOf(p.expect) >= 0) };
  });
}

function main() {
  const parts = [
    { name: 'engine.js', code: read('engine.js'), fingerprint: 'root.BagNS = api' },
    { name: 'cases_meta.js', code: read('cases_meta.js'), fingerprint: 'root.CasesMeta = api' },
    { name: 'cases_impl.js', code: read('cases_impl.js'), fingerprint: 'root.CasesImpl = api' },
    { name: 'runner.js', code: read('runner.js'), fingerprint: 'root.VerifyNS = api' }
  ];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'verification_results.json'), 'utf-8'));
  let tpl = read('scene_template.html');

  const inlineJs = guard(parts.map((p) => '/* ==== ' + p.name + ' ==== */\n' + p.code).join('\n'));
  const inlineData = guard(JSON.stringify(data));

  const replacements = {
    '__INLINE_JS__': inlineJs,
    '__PRECOMPUTED__': inlineData,
    '__ENGINE_VERSION__': 'v' + data.engineVersion,
    '__GENERATED_AT__': new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  };
  Object.keys(replacements).forEach((k) => { tpl = tpl.split(k).join(replacements[k]); });

  const errors = selfCheck(tpl, parts);
  if (errors.length) {
    console.error('自检未通过，拒绝写出文件：');
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
  }
  const reverse = reverseSelfCheck(tpl, parts);
  const reverseOk = reverse.every((r) => r.caught);
  console.log('自检通过（标签配对 / 离线依赖 / 占位符 / 脚本语法 / 模块同源）');
  reverse.forEach((r) => console.log(`  反向测试 ${r.caught ? 'OK  ' : 'FAIL'} 注入「${r.name}」应被捕获`));
  if (!reverseOk) { console.error('反向测试未通过：自检可能是空壳'); process.exit(1); }

  fs.writeFileSync(OUT, tpl, 'utf-8');
  console.log('已写出 ' + OUT + ' (' + (Buffer.byteLength(tpl, 'utf-8') / 1024).toFixed(1) + ' KB)');
}

main();

'use strict';

/**
 * 构建期把前端 API_BASE 置为同源空串，使浏览器请求走本进程的 /api 反向代理。
 *
 * 只修改镜像内的 web/js/config.js 副本，不触碰仓库源码：
 *   - 仓库源码继续保留 http://127.0.0.1:8081，本机开发栈行为不变；
 *   - selfcheck.js / p0-baseline.json 的 57 文件基线保持 diffs=0。
 *
 * 替换是精确且带断言的：字面量数量不对、替换未生效、残留绝对地址都直接让构建失败。
 */
const fs = require('node:fs');
const path = require('node:path');

function assertPatched(src, patched) {
  if (!/API_BASE:\s*''/.test(patched)) {
    throw new Error('替换后 API_BASE 不是同源空串');
  }
  if (patched === src) {
    throw new Error('替换未生效');
  }
  if (/API_BASE:\s*['"]https?:\/\//.test(patched)) {
    throw new Error('仍残留绝对后端地址');
  }
}

const target = path.resolve(process.cwd(), 'web', 'js', 'config.js');
const src = fs.readFileSync(target, 'utf8');
const pattern = /API_BASE:\s*'[^']*'/g;
const hits = src.match(pattern) || [];

if (hits.length !== 1) {
  throw new Error(`期望恰好 1 处 API_BASE 字面量，实际 ${hits.length} 处；构建中止以免误改其它配置`);
}

const patched = src.replace(pattern, "API_BASE: ''");

if (process.argv.includes('--selftest')) {
  const cases = [
    ['替换未生效', () => assertPatched(src, src)],
    ['残留绝对地址', () => assertPatched(src, "API_BASE: 'https://api.example.com'")],
  ];
  for (const [name, fn] of cases) {
    let caught = false;
    try { fn(); } catch (err) { caught = true; }
    if (!caught) throw new Error(`反向测试失败：自检未捕获「${name}」`);
    console.log(`  PASS 反向注入：${name}`);
  }
  assertPatched(src, patched);
  console.log('[patch-config] 反向测试通过');
  process.exit(0);
}

assertPatched(src, patched);
fs.writeFileSync(target, patched, 'utf8');
console.log('[patch-config] API_BASE 已置为同源空串（仅镜像内副本）');

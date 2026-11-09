/* 真实执行冒烟测试：在最小 DOM 上跑生成的 HTML 内联脚本。
 * 语法检查只能证明"能解析"，这里验证页面初始化、交互按钮、验证按钮确实可运行。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'outputs', '背包系统_场景与逐项验证.html');
const html = fs.readFileSync(file, 'utf-8');
const blocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1]);
if (blocks.length !== 3) throw new Error('script 块数量应为 3，实际 ' + blocks.length);

const nodes = {};
function el(id) {
  if (nodes[id]) return nodes[id];
  const node = {
    id, innerHTML: '', textContent: '', value: 'ALL', checked: false, scrollTop: 0, scrollHeight: 0,
    onclick: null, onchange: null, className: '',
    querySelectorAll: () => [],
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, removeChild() {}, click() {}
  };
  nodes[id] = node;
  return node;
}
const sandbox = {
  console, Date, Math, JSON, Set, Map, RegExp, Intl, setTimeout, clearTimeout,
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    createElement: () => el('_tmp'),
    body: { appendChild() {}, removeChild() {} }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

const failures = [];
function step(name, fn) {
  try { fn(); console.log('  OK   ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL ' + name + ' -> ' + e.message); }
}

step('加载 4 个共用模块', () => {
  vm.runInContext(blocks[1], ctx, { filename: 'modules.js' });
  ['BagNS', 'CasesMeta', 'CasesImpl', 'VerifyNS'].forEach((k) => {
    if (!sandbox[k]) throw new Error('缺少全局模块 ' + k);
  });
  if (sandbox.CasesMeta.length !== 100) throw new Error('用例元数据不是 100 条');
});
step('预置结果数据可解析', () => {
  vm.runInContext(blocks[0], ctx, { filename: 'preset.js' });
  if (!sandbox.PRESET || sandbox.PRESET.baseline.summary.total !== 100) throw new Error('PRESET 数据异常');
});
step('页面初始化（渲染场景 + 结果列表 + 验收结论）', () => {
  vm.runInContext(blocks[2], ctx, { filename: 'page.js' });
  if (!/test_bag_01/.test(nodes.statusbar.innerHTML)) throw new Error('状态栏未渲染');
  if (nodes.grid.innerHTML.indexOf('class="cell') < 0) throw new Error('背包网格未渲染');
  if (nodes.results.innerHTML.indexOf('A01') < 0) throw new Error('结果列表未渲染 A01');
  if (nodes.verdict.innerHTML.indexOf('验收通过') < 0) throw new Error('验收结论未渲染');
});
step('游戏按钮：击杀怪物 → 拾取全部', () => {
  nodes.bKill.onclick();
  const afterKill = nodes.ground.innerHTML;
  if (afterKill.indexOf('class="drop"') < 0) throw new Error('未生成掉落物');
  nodes.bPickAll.onclick();
  if (nodes.grid.innerHTML.indexOf('cell has') < 0) throw new Error('拾取后背包仍为空');
});
step('游戏按钮：整理 / 断网 / 重连 / 时间推进', () => {
  nodes.bSort.onclick();
  nodes.bOffline.onclick();
  nodes.bReconnect.onclick();
  nodes.bTime5.onclick();
  if (nodes.log.innerHTML.indexOf('重连完成') < 0) throw new Error('重连日志缺失');
});
step('验证按钮：运行完整验证（浏览器内重跑 100 条 ×3 组）', () => {
  nodes.bRunClean.onclick();
  if (nodes.results.innerHTML.indexOf('A01') < 0) throw new Error('重跑后结果列表为空');
  if (nodes.verdict.innerHTML.indexOf('验收通过') < 0) throw new Error('重跑后验收未通过');
  if (nodes.reverseBox.innerHTML.indexOf('捕获') < 0) throw new Error('反向测试表未渲染');
});
step('验证按钮：按勾选缺陷运行能产生 FAIL', () => {
  nodes.f_noIdempotency.checked = true;
  nodes.bRunFaults.onclick();
  if (nodes.verdict.innerHTML.indexOf('FAIL') < 0) throw new Error('注入后未出现失败');
  nodes.f_noIdempotency.checked = false;
});
step('筛选器与展开/收起不抛异常', () => {
  nodes.fStatus.value = 'FAIL'; nodes.fStatus.onchange();
  nodes.fStatus.value = 'ALL'; nodes.fStatus.onchange();
  nodes.bExpand.onclick(); nodes.bCollapse.onclick();
});

console.log('\n冒烟测试结果：' + (failures.length ? failures.length + ' 项失败' : '全部通过'));
if (failures.length) process.exit(1);

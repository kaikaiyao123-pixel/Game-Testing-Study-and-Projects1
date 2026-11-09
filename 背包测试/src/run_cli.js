/* Node 入口：执行全量验证并写出机器可读结果 */
const fs = require('fs');
const path = require('path');
const NS = require('./engine.js');
const META = require('./cases_meta.js');
const IMPL = require('./cases_impl.js');
const V = require('./runner.js');

const data = V.runAll(NS, META, IMPL);
const out = path.join(__dirname, '..', 'outputs', 'verification_results.json');
fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf-8');

const b = data.baseline.summary;
const d = data.injected.summary;
console.log('=== 基准版 ===');
console.log(JSON.stringify(b));
console.log('=== 缺陷注入版 ===');
console.log(JSON.stringify(d));
console.log('注入版失败用例:', data.injected.results.filter(r => r.status === 'FAIL').map(r => r.id).join(', '));
console.log('=== 反向注入测试 ===');
data.reverseTest.checks.forEach(c => console.log(`  ${c.pass ? 'OK  ' : 'FAIL'} ${c.fault}: ${c.note}`));
console.log('=== 验收 ===');
console.log(JSON.stringify(data.acceptance));
const failed = data.baseline.results.filter(r => r.status === 'FAIL');
if (failed.length) {
  console.log('\n基准版失败明细:');
  failed.forEach(r => console.log(`  ${r.id} ${r.title} => ${r.actual}`));
}
console.log('\n已写出 ' + out);

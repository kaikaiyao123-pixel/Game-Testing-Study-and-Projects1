/* 逐项验证执行器：把元数据 + 可执行规格合并，逐条真实运行 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VerifyNS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENGINE_VERSION = '1.0.0';

  function summary(results) {
    var s = { total: results.length, auto: 0, proxy: 0, manual: 0, pass: 0, fail: 0, manualCount: 0, missing: 0 };
    results.forEach(function (r) {
      if (r.kind === 'manual') { s.manual++; s.manualCount++; }
      else if (r.kind === 'proxy') s.proxy++;
      else if (r.kind === 'missing') { s.missing++; return; }
      else s.auto++;
      if (r.status === 'PASS') s.pass++;
      else if (r.status === 'FAIL') s.fail++;
    });
    return s;
  }

  function runSuite(NS, META, IMPL, faults, label) {
    var results = META.map(function (meta) {
      var impl = IMPL[meta.id];
      var base = {
        id: meta.id, group: meta.group, title: meta.title, method: meta.method,
        priority: meta.priority, pre: impl ? impl.pre : '', steps: impl ? impl.steps : '',
        expect: impl ? impl.expect : '', kind: impl ? impl.kind : 'missing',
        checklist: impl && impl.checklist ? impl.checklist : ''
      };
      if (!impl) return Object.assign(base, { status: 'MISSING', actual: '未找到该编号的可执行断言' });
      if (impl.kind === 'manual') return Object.assign(base, { status: 'MANUAL', actual: '需真机/人工判定：' + impl.checklist });
      var e = new NS.BagEngine({ faults: faults || {} });
      var out;
      try {
        out = impl.run(e, NS) || { pass: false, actual: '断言未返回判定结果' };
      } catch (err) {
        out = { pass: false, actual: '执行异常：' + (err && err.message ? err.message : String(err)) };
      }
      return Object.assign(base, { status: out.pass ? 'PASS' : 'FAIL', actual: out.actual });
    });
    return { label: label, summary: summary(results), results: results };
  }

  // 每个缺陷单独注入，验证「至少有一条预期用例能抓到它」
  var FAULT_EXPECT = {
    swallowDrop: ['A04'],
    noExpireCheck: ['C08'],
    noIdempotency: ['E09'],
    sortMovesLocked: ['D04'],
    purchaseLosesItem: ['A07', 'E04'],
    badLayout: ['F01']
  };

  function reverseTest(NS, META, IMPL) {
    var checks = [];
    Object.keys(FAULT_EXPECT).forEach(function (fault) {
      var f = {}; f[fault] = true;
      var suite = runSuite(NS, META, IMPL, f, '注入 ' + fault);
      var failedIds = suite.results.filter(function (r) { return r.status === 'FAIL'; }).map(function (r) { return r.id; });
      var expected = FAULT_EXPECT[fault];
      var hit = expected.filter(function (id) { return failedIds.indexOf(id) >= 0; });
      checks.push({
        fault: fault, expected: expected, caught: failedIds,
        pass: hit.length > 0, note: hit.length > 0
          ? '缺陷被 ' + hit.join('/') + ' 捕获，共 ' + failedIds.length + ' 条用例失败'
          : '没有任何预期用例捕获该缺陷——测试集存在盲区'
      });
    });
    return {
      pass: checks.every(function (c) { return c.pass; }),
      checks: checks
    };
  }

  function runAll(NS, META, IMPL) {
    var clean = runSuite(NS, META, IMPL, {}, '基准版（无缺陷注入）');
    var allFaults = {};
    NS.FAULT_KEYS.forEach(function (k) { allFaults[k] = true; });
    var dirty = runSuite(NS, META, IMPL, allFaults, '缺陷注入版（6 个典型缺陷）');
    var reverse = reverseTest(NS, META, IMPL);

    var metaIds = META.map(function (m) { return m.id; });
    var implIds = Object.keys(IMPL);
    var consistency = {
      metaCount: META.length,
      implCount: implIds.length,
      missingImpl: metaIds.filter(function (id) { return implIds.indexOf(id) < 0; }),
      orphanImpl: implIds.filter(function (id) { return metaIds.indexOf(id) < 0; }),
      groups: {}
    };
    META.forEach(function (m) { consistency.groups[m.group] = (consistency.groups[m.group] || 0) + 1; });

    return {
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      faultKeys: NS.FAULT_KEYS.slice(),
      consistency: consistency,
      baseline: clean,
      injected: dirty,
      reverseTest: reverse,
      acceptance: {
        metaMatchesDoc: META.length === 100,
        noMissingImpl: consistency.missingImpl.length === 0 && consistency.orphanImpl.length === 0,
        baselineNoFail: clean.summary.fail === 0 && clean.summary.missing === 0,
        reverseEffective: reverse.pass,
        injectedDetected: dirty.summary.fail > 0
      }
    };
  }

  return { runAll: runAll, runSuite: runSuite, reverseTest: reverseTest, summary: summary, ENGINE_VERSION: ENGINE_VERSION };
});

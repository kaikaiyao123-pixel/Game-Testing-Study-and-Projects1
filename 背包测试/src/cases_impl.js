/* 100 条用例的可执行规格
 * 编号 / 标题 / 设计方法 / 优先级 由 cases_meta.js 提供（源文档自动提取），
 * 本文件补齐：前置条件、操作步骤、可判定预期结果、程序化断言。
 * kind: auto=逻辑可验证 | proxy=代理指标（不替代真机） | manual=需真机/人工
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CasesImpl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var IMPL = {};
  function C(id, pre, steps, expect, run) { IMPL[id] = { pre: pre, steps: steps, expect: expect, run: run, kind: 'auto' }; }
  function P(id, pre, steps, expect, run) { IMPL[id] = { pre: pre, steps: steps, expect: expect, run: run, kind: 'proxy' }; }
  function M(id, pre, steps, expect, checklist) { IMPL[id] = { pre: pre, steps: steps, expect: expect, checklist: checklist, kind: 'manual' }; }
  function R(pass, actual) { return { pass: !!pass, actual: String(actual) }; }
  function qtyOf(e, itemId) {
    return e.srv.items.filter(function (x) { return x.itemId === itemId; })
      .reduce(function (a, b) { return a + b.qty; }, 0);
  }
  // 合并同类会减少"堆数"但不应改变"道具种类"，故 ID 校验用去重集合
  function uniqIds(items) {
    return Array.from(new Set(items.map(function (i) { return i.itemId; }))).sort().join(',');
  }
  // 构造判定表 8 种条件组合（容量 8 便于制造"无空格"）
  function mkSort(NS, e, hasEmpty, hasStackable, hasLocked) {
    var x = new NS.BagEngine({ capacity: 8, faults: e.faults });
    if (hasStackable) { x.addItem('I1001', 3); x.addItem('I1001', 3); }
    else { x.addItem('I1009', 1); x.addItem('I1002', 1); }
    var target = hasEmpty ? 4 : 8;
    while (x.srv.items.length < target) x.addItem('I1009', 1);
    // 锁定最后一个普通道具（I1009），不可锁定可堆叠堆，否则条件组合会被自己改掉
    if (hasLocked) {
      var last = x.srv.items[x.srv.items.length - 1];
      x.lock(last.uid);
      x.lockUid = last.uid;
      x.lockSlot = last.slot;
    }
    return x;
  }

  /* ============ A 容量与拾取（18 条） ============ */
  C('A01', '账号已登录；容量上限 200；背包为空；网络正常',
    '1. 生成 1 个掉落物 I1001×1　2. 点击拾取　3. 查看服务端、客户端与地面',
    '入包成功；服务端 1 格；客户端显示 1 格；地面掉落物消失；空状态引导消失',
    function (e) {
      var r = e.pickup(e.spawnDrop('I1001', 1));
      return R(r.ok && e.srv.items.length === 1 && e.getView().length === 1 && e.ground.length === 0,
        'code=' + r.code + '；服务端=' + e.srv.items.length + '格；客户端=' + e.getView().length + '格；地面=' + e.ground.length + '个');
    });
  C('A02', '背包已有 1 个不堆叠道具；容量 200',
    '1. 生成掉落　2. 点击拾取　3. 核对数量与排序',
    '拾取成功；背包共 2 格；两格道具 ID 与数量均正确',
    function (e) {
      e.addItem('I1009', 1);
      var r = e.pickup(e.spawnDrop('I1002', 1));
      return R(r.ok && e.srv.items.length === 2 && qtyOf(e, 'I1002') === 1 && e.getView().length === 2,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；I1002数量=' + qtyOf(e, 'I1002'));
    });
  C('A03', '背包已放入 199 个不堆叠道具（差 1 格满）',
    '1. 生成掉落　2. 点击拾取第 200 个　3. 核对容量',
    '仍可拾取第 200 个；背包恰好 200 格；无溢出与报错',
    function (e) {
      e.fill('I1009', 199);
      var r = e.pickup(e.spawnDrop('I1002', 1));
      return R(r.ok && e.srv.items.length === 200,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格（上限200）');
    });
  C('A04', '背包容量 200；已放入 200 个不堆叠道具；地面有 1 个掉落',
    '1. 生成掉落　2. 点击拾取第 201 个　3. 观察提示、掉落物与背包',
    '提示「背包已满」；掉落物保留在地面不被吞掉；背包仍为 200；服务端无新增；客户端无新增',
    function (e) {
      e.fill('I1009', 200);
      var r = e.pickup(e.spawnDrop('I1002', 1));
      return R(r.code === 'BAG_FULL' && e.ground.length === 1 && e.srv.items.length === 200 && e.getView().length === 200,
        'code=' + r.code + '；地面保留=' + e.ground.length + '个；背包=' + e.srv.items.length + '格；客户端=' + e.getView().length + '格');
    });
  C('A05', '背包 200 格满；其中 1 堆 I1001×50（未满堆，可再容纳 49）；地面 4 个 I1001×20',
    '1. 执行批量拾取 4 个掉落　2. 统计成功/失败数　3. 核对地面剩余与总数量',
    '部分成功：能合并入未满堆的先入包；放不下的保留在地面并给出提示；背包不超 200；总数量守恒',
    function (e) {
      e.fill('I1009', 199); e.addItem('I1001', 50);
      var ds = []; for (var i = 0; i < 4; i++) ds.push(e.spawnDrop('I1001', 20));
      var r = e.pickupBatch(ds);
      var total = qtyOf(e, 'I1001') + e.ground.reduce(function (a, b) { return a + b.qty; }, 0);
      return R(r.data.success >= 1 && r.data.failed >= 1 && e.ground.length > 0 && e.srv.items.length <= 200 && total === 130,
        '成功=' + r.data.success + '，拒绝=' + r.data.failed + '；地面剩余=' + e.ground.length + '个；背包=' + e.srv.items.length + '格；I1001总数=' + total);
    });
  C('A06', '背包 200 格满；系统邮件待发放 I1001×1',
    '1. 触发系统邮件发放　2. 查收邮件与背包',
    '背包不溢出；道具进入邮件且可领取；有明确提示；不得静默丢失',
    function (e) {
      e.fill('I1009', 200);
      var r = e.grant('I1001', 1, 'mail');
      return R(r.code === 'GRANT_TO_MAIL' && e.srv.mail.length === 1 && e.srv.items.length === 200,
        'code=' + r.code + '；邮件=' + e.srv.mail.length + '封；背包=' + e.srv.items.length + '格');
    });
  C('A07', '背包 200 格满；账号钻石/金币 1000；商城商品 I1002 单价 20',
    '1. 打开商城购买 I1002×1　2. 支付　3. 查看货币、背包、邮件与提示',
    '要么拦截购买且不扣款，要么扣款成功后通过邮件补发并给出提示；绝不出现「扣款成功、道具丢失、无提示」',
    function (e) {
      e.fill('I1009', 200);
      var before = e.srv.gold;
      var r = e.purchase('I1002', 1);
      var consistent = e.srv.mail.length === 1 && r.data.inMail === true && !r.data.silentLost;
      return R(e.srv.gold === before - 20 && consistent,
        '扣款=' + (before - e.srv.gold) + '；code=' + r.code + '；邮件补发=' + e.srv.mail.length + '封；静默丢失=' + !!r.data.silentLost);
    });
  C('A08', '背包 200 格满；已购买扩容道具',
    '1. 扩容至 201 格　2. 立即拾取新掉落　3. 核对容量与道具',
    '扩容即时生效；拾取成功；背包 201 格；无旧数据丢失',
    function (e) {
      e.fill('I1009', 200);
      var c = e.setCapacity(201);
      var r = e.pickup(e.spawnDrop('I1002', 1));
      return R(c.ok && r.ok && e.srv.capacity === 201 && e.srv.items.length === 201,
        '扩容=' + c.code + '；拾取=' + r.code + '；容量=' + e.srv.capacity + '；背包=' + e.srv.items.length + '格');
    });
  C('A09', '背包容量 200；已放入 200 个道具',
    '1. 发起缩容至 100 格　2. 观察服务端响应　3. 核对道具数量',
    '缩容被拒绝或按规则明确处理；不得静默丢弃 100 个道具；道具总数仍为 200',
    function (e) {
      e.fill('I1009', 200);
      var r = e.setCapacity(100);
      return R(r.code === 'SHRINK_BLOCKED' && e.srv.items.length === 200 && e.srv.capacity === 200,
        'code=' + r.code + '；容量=' + e.srv.capacity + '；道具=' + e.srv.items.length + '个');
    });
  C('A10', '背包为空；容量 200；构造单次拾取 300 个的掉落堆',
    '1. 点击拾取该掉落　2. 观察响应与数据',
    '拦截超上限拾取；不写入 300 个道具；掉落物保留在地面；服务端不产生脏数据',
    function (e) {
      var r = e.pickup(e.spawnDrop('I1001', 300));
      return R(r.code === 'QTY_OVER_LIMIT' && e.srv.items.length === 0 && e.ground.length === 1,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；地面=' + e.ground.length + '个');
    });
  C('A11', '地面存在数量为 0 的异常掉落堆',
    '1. 点击拾取　2. 查服务端道具流水',
    '拦截；不产生 0 数量道具；不写入脏数据',
    function (e) {
      var r = e.pickup(e.spawnDrop('I1001', 0));
      return R(r.code === 'INVALID_QTY' && e.srv.items.length === 0,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格');
    });
  C('A12', '地面存在数量为 -5 的异常掉落堆（伪造包/配置错误）',
    '1. 点击拾取　2. 查服务端数量字段',
    '拦截；服务端不得写入负数量；记日志',
    function (e) {
      var r = e.pickup(e.spawnDrop('I1001', -5));
      var negative = e.srv.items.some(function (x) { return x.qty < 0; });
      return R(r.code === 'INVALID_QTY' && !negative,
        'code=' + r.code + '；负数道具=' + negative);
    });
  C('A13', '掉落物携带不存在的道具 ID I9999',
    '1. 点击拾取　2. 观察客户端与日志',
    '拦截并记日志；不崩溃；不产生无 ID 道具',
    function (e) {
      var r = e.pickup(e.spawnDrop('I9999', 1));
      return R(r.code === 'INVALID_ITEM_ID' && e.srv.items.length === 0,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格');
    });
  C('A14', '掉落物携带已下架道具 ID I1008',
    '1. 点击拾取　2. 观察响应',
    '拦截并给出明确提示；不产生已下架道具；不崩溃',
    function (e) {
      var r = e.pickup(e.spawnDrop('I1008', 1));
      return R(r.code === 'INVALID_ITEM_ID' && e.srv.items.length === 0,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格');
    });
  C('A15', '地面有 1 个掉落；客户端按钮未做防抖（可连点）',
    '1. 200ms 内连续点击拾取 10 次　2. 查道具流水与地面',
    '仅入包一次；服务端流水只有 1 条；地面无残留；不重复发放',
    function (e) {
      var d = e.spawnDrop('I1001', 1), op = e.nextOpId(), rs = [];
      for (var i = 0; i < 10; i++) rs.push(e.pickup(d, { opId: op }));
      var picks = e.srv.ledger.filter(function (x) { return x.type === 'pickup'; }).length;
      return R(picks === 1 && e.srv.items.length === 1 && e.ground.length === 0,
        '流水=' + picks + '条；背包=' + e.srv.items.length + '格；地面=' + e.ground.length + '个；成功响应=' + rs.filter(function (x) { return x.ok; }).length + '次');
    });
  C('A16', '背包 100 格；地面 1 个掉落；可在拾取瞬间断网',
    '1. 点击拾取的瞬间断开网络　2. 恢复网络并等待重连　3. 核对背包与地面',
    '一致性约束：重连后要么拾取成功且道具在背包，要么失败且道具仍在地面；不得两端都扣或两端都在',
    function (e) {
      e.fill('I1009', 100);
      var d = e.spawnDrop('I1001', 1);
      e.setOnline(false);
      var r = e.pickup(d, { opId: 'OP-A16' });
      e.reconnect();
      var inBag = qtyOf(e, 'I1001'), onGround = e.ground.reduce(function (a, b) { return a + b.qty; }, 0);
      var viewOk = e.getView().length === e.srv.items.length;
      return R(r.code === 'OFFLINE' && inBag + onGround === 1 && viewOk,
        '断网响应=' + r.code + '；重连后在包=' + inBag + '、在地面=' + onGround + '、合计=' + (inBag + onGround) + '；前后端格数一致=' + viewOk);
    });
  C('A17', '背包 100 格；拾取成功后可强杀进程重进',
    '1. 拾取 1 个道具　2. 杀进程　3. 重进游戏读取服务端数据',
    '重进后道具仍在；数量与 ID 与服务端一致；不出现回档或重复',
    function (e) {
      e.fill('I1009', 100);
      e.pickup(e.spawnDrop('I1001', 1));
      var srvQty = qtyOf(e, 'I1001');
      e.reloadFromServer();
      var viewQty = e.getView().filter(function (x) { return x.itemId === 'I1001'; }).reduce(function (a, b) { return a + b.qty; }, 0);
      return R(srvQty === 1 && viewQty === 1 && e.getView().length === e.srv.items.length,
        '服务端 I1001=' + srvQty + '；重进后客户端=' + viewQty + '；总格数=' + e.getView().length);
    });
  C('A18', '账号 A 有 1 个待拾取掉落；已准备账号 B',
    '1. 断网后发起拾取　2. 拾取过程中切换账号 B　3. 切回账号 A',
    '账号数据严格隔离；B 中看不到 A 的道具或掉落；切回 A 后未完成操作不污染 B',
    function (e) {
      var d = e.spawnDrop('I1001', 1);
      e.setOnline(false);
      var r = e.pickup(d, { opId: 'OP-A18' });
      e.switchAccount('test_bag_02');
      var bEmpty = e.srv.items.length === 0 && e.ground.length === 0;
      e.switchAccount('test_bag_01');
      var aKeep = e.ground.length === 1 && e.srv.items.length === 0;
      return R(r.code === 'OFFLINE' && bEmpty && aKeep,
        '切换前响应=' + r.code + '；B账号背包=' + 0 + '格/掉落=' + 0 + '个；A账号切回后地面=' + e.ground.length + '个、背包=' + e.srv.items.length + '格');
    });

  /* ============ B 道具操作（22 条） ============ */
  C('B01', '持有 I1001 治疗药水×1；角色等级 60 战士；网络正常',
    '1. 打开背包　2. 点击使用　3. 查效果流水与道具',
    '使用成功；效果结算 1 次；道具扣除 1 个；流水含「持有→使用中→已消耗」',
    function (e) {
      var it = e.addItem('I1001', 1), r = e.use(it.uid);
      var rec = e.srv.ledger.filter(function (x) { return x.type === 'use'; })[0];
      return R(r.ok && e.srv.effects === 1 && !e._find(it.uid) && rec && rec.transitions.join('→') === '持有→使用中→已消耗',
        'code=' + r.code + '；效果=' + e.srv.effects + '次；迁移=' + (rec ? rec.transitions.join('→') : '无'));
    });
  C('B02', '持有三次数卷轴，剩余次数已消耗至 1',
    '1. 点击使用　2. 观察道具与次数',
    '允许最后一次使用；使用后剩余次数 0 且道具从背包消失；不出现负数次数',
    function (e) {
      var it = e.addItem('I1006', 1, { uses: 1 }), r = e.use(it.uid);
      return R(r.ok && it.uses === 0 && !e._find(it.uid) && e.srv.effects === 1,
        'code=' + r.code + '；剩余次数=' + it.uses + '；道具仍在=' + !!e._find(it.uid));
    });
  C('B03', '持有多次使用道具，剩余次数为 0 且道具未从背包消失',
    '1. 点击使用　2. 观察界面与服务端流水',
    '不可使用；按钮置灰或提示次数已用尽；不触发效果；服务端不产生消耗记录',
    function (e) {
      var it = e.addItem('I1006', 1, { uses: 0 }), r = e.use(it.uid);
      return R(!r.ok && e.srv.effects === 0 && e.srv.ledger.filter(function (x) { return x.type === 'use'; }).length === 0,
        'code=' + r.code + '；效果=' + e.srv.effects + '次；消耗流水=' + 0 + '条');
    });
  C('B04', '持有三次数卷轴，剩余次数 3',
    '1. 连续点击使用直至耗尽　2. 第 4 次继续点击　3. 核对效果次数与道具',
    '前 3 次效果各结算 1 次；第 4 次被拒绝；道具在次数耗尽时消失；总数守恒',
    function (e) {
      var it = e.addItem('I1006', 1), rs = [];
      for (var i = 0; i < 4; i++) rs.push(e.use(it.uid));
      return R(rs[0].ok && rs[1].ok && rs[2].ok && !rs[3].ok && e.srv.effects === 3 && !e._find(it.uid),
        '响应=' + rs.map(function (x) { return x.code; }).join('/') + '；效果合计=' + e.srv.effects + '次；道具仍在=' + !!e._find(it.uid));
    });
  C('B05', '持有 I1001×1；客户端已刷新',
    '1. 使用道具　2. 同时检查服务端与客户端视图',
    '前后端该 uid 均已移除；不出现「服务端扣了、界面还显示」的幽灵道具',
    function (e) {
      var it = e.addItem('I1001', 1); e.use(it.uid);
      var inView = e.getView().some(function (x) { return x.uid === it.uid; });
      return R(!e._find(it.uid) && !inView,
        '服务端存在=' + !!e._find(it.uid) + '；客户端存在=' + inView);
    });
  C('B06', '角色等级 1；持有需要等级 10 的战士专属徽章',
    '1. 点击使用　2. 观察服务端校验结果',
    '服务端拒绝（不可只依赖客户端置灰）；无效果；道具保留',
    function (e, NS) {
      var x = new NS.BagEngine({ level: 1, faults: e.faults });
      var it = x.addItem('I1004', 1), r = x.use(it.uid);
      return R(r.code === 'LEVEL_LOW' && x.srv.effects === 0 && !!x._find(it.uid),
        'code=' + r.code + '；效果=' + x.srv.effects + '次；道具保留=' + !!x._find(it.uid));
    });
  C('B07', '角色职业为法师；持有限定「战士」职业的徽章',
    '1. 点击使用　2. 观察服务端校验结果',
    '服务端拒绝职业不符；无效果；道具保留',
    function (e, NS) {
      var x = new NS.BagEngine({ job: '法师', faults: e.faults });
      var it = x.addItem('I1004', 1), r = x.use(it.uid);
      return R(r.code === 'JOB_MISMATCH' && x.srv.effects === 0 && !!x._find(it.uid),
        'code=' + r.code + '；效果=' + x.srv.effects + '次；道具保留=' + !!x._find(it.uid));
    });
  C('B08', '持有冷却型药剂 I1007×2，冷却时间 30 秒',
    '1. 使用 1 次　2. 冷却期间立即再次使用　3. 推进 30 秒后再使用',
    '第 2 次被拒绝且不扣道具；冷却结束后第 3 次成功；效果共 2 次',
    function (e) {
      var it = e.addItem('I1007', 2);
      var r1 = e.use(it.uid), r2 = e.use(it.uid);
      e.advanceTime(30000);
      var r3 = e.use(it.uid);
      return R(r1.ok && r2.code === 'COOLDOWN' && r3.ok && e.srv.effects === 2 && it.qty === 0,
        '响应=' + [r1.code, r2.code, r3.code].join('/') + '；效果=' + e.srv.effects + '次；剩余数量=' + it.qty);
    });
  C('B09', '持有 I1002×1；支持丢弃二次确认',
    '1. 选中道具点击丢弃　2. 在确认框点击确认　3. 查看背包',
    '道具从背包移除；记入可回收记录；前后端一致',
    function (e) {
      var it = e.addItem('I1002', 1), r = e.discard(it.uid, { confirm: true });
      return R(r.ok && !e._find(it.uid) && e.srv.recycle.length === 1 && e.getView().length === 0,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；回收记录=' + e.srv.recycle.length + '条');
    });
  C('B10', '持有 I1002×1；已打开丢弃确认框',
    '1. 点击丢弃　2. 在确认框点击取消　3. 查看背包',
    '数据完全不变；道具数量与状态与操作前一致；不写流水',
    function (e) {
      var it = e.addItem('I1002', 1), r = e.discard(it.uid, { confirm: false });
      return R(r.code === 'CANCELLED' && e.srv.items.length === 1 && it.qty === 1 && r.data.changed !== true,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；数量=' + it.qty);
    });
  C('B11', '持有 I1002×1 且已锁定',
    '1. 点击丢弃并确认　2. 查看背包与提示',
    '拒绝丢弃；道具保留且仍为已锁定；给出明确提示',
    function (e) {
      var it = e.addItem('I1002', 1); e.lock(it.uid);
      var r = e.discard(it.uid, { confirm: true });
      return R(r.code === 'LOCKED' && e.srv.items.length === 1 && it.state === '已锁定',
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；状态=' + it.state);
    });
  C('B12', '持有 I1002×1；支持输入丢弃数量',
    '1. 丢弃数量填 0　2. 确认　3. 查流水',
    '拦截；道具不变；不产生 0 数量丢弃流水',
    function (e) {
      var it = e.addItem('I1002', 1), r = e.discard(it.uid, { qty: 0 });
      return R(r.code === 'INVALID_QTY' && e.srv.items.length === 1 && e.srv.ledger.filter(function (x) { return x.type === 'discard'; }).length === 0,
        'code=' + r.code + '；背包=' + e.srv.items.length + '格；丢弃流水=0条');
    });
  C('B13', '背包 3 个道具，第 2 个已锁定；支持多选批量丢弃',
    '1. 进入批量选择　2. 全选 3 个　3. 确认丢弃',
    '仅未锁定的 2 个被丢弃；锁定道具保留且仍锁定；提示「已跳过锁定道具」；部分成功被正确处理',
    function (e) {
      var a = e.addItem('I1009', 1), b = e.addItem('I1009', 1), c = e.addItem('I1009', 1);
      e.lock(b.uid);
      var r = e.discardBatch([a.uid, b.uid, c.uid], { confirm: true });
      return R(r.data.dropped.length === 2 && r.data.skipped.length === 1 && e.srv.items.length === 1 && !!e._find(b.uid) && b.state === '已锁定',
        '丢弃=' + r.data.dropped.length + '个；跳过=' + r.data.skipped.length + '个；剩余=' + e.srv.items.length + '个（状态' + b.state + '）');
    });
  C('B14', '账号金币 1000；持有 I1002×1（单价 20）',
    '1. 出售该道具　2. 查金币与背包',
    '金币 = 1000 + 20 = 1020；道具移除；流水记录 gain=20',
    function (e) {
      var it = e.addItem('I1002', 1), r = e.sell(it.uid);
      var rec = e.srv.ledger.filter(function (x) { return x.type === 'sell'; })[0];
      return R(r.ok && e.srv.gold === 1020 && !e._find(it.uid) && rec.gain === 20,
        '金币=' + e.srv.gold + '（预期1020）；流水gain=' + (rec ? rec.gain : '无'));
    });
  C('B15', '账号金币 = 持有上限 - 5；持有 I1002×1（出售可得 20）',
    '1. 出售道具　2. 查金币与道具',
    '出售后金币将超过上限时明确拦截；金币不变；道具不丢失；不出现金币溢出为负',
    function (e) {
      e.srv.gold = 999999999 - 5;
      var it = e.addItem('I1002', 1), r = e.sell(it.uid);
      return R(r.code === 'GOLD_OVER_CAP' && e.srv.gold === 999999994 && !!e._find(it.uid),
        'code=' + r.code + '；金币=' + e.srv.gold + '；道具保留=' + !!e._find(it.uid));
    });
  C('B16', '持有绑定·新手礼包 I1005（不可交易）',
    '1. 点击出售　2. 观察响应',
    '拒绝出售；不增加金币；道具保留；提示不可交易',
    function (e) {
      var it = e.addItem('I1005', 1), r = e.sell(it.uid);
      return R(r.code === 'NOT_TRADEABLE' && e.srv.gold === 1000 && !!e._find(it.uid),
        'code=' + r.code + '；金币=' + e.srv.gold + '；道具保留=' + !!e._find(it.uid));
    });
  C('B17', '账号金币 1000；刚售出 I1002×1',
    '1. 出售道具　2. 立即点击回购　3. 核对金币与道具',
    '回购成功；金币回到 1000；道具数量与出售前一致；不产生重复发放',
    function (e) {
      var it = e.addItem('I1002', 1); e.sell(it.uid);
      var r = e.buyback();
      return R(r.ok && e.srv.gold === 1000 && qtyOf(e, 'I1002') === 1,
        'code=' + r.code + '；金币=' + e.srv.gold + '；I1002数量=' + qtyOf(e, 'I1002'));
    });
  C('B18', '持有 I1001 一堆已达堆叠上限 99；背包未满',
    '1. 生成同类道具掉落 1 个　2. 点击拾取　3. 核对堆叠',
    '不覆盖原堆；新开一格存放；总数量 = 100；每堆均不超过 99',
    function (e) {
      e.addItem('I1001', 99);
      var r = e.pickup(e.spawnDrop('I1001', 1));
      var stacks = e.srv.items.filter(function (x) { return x.itemId === 'I1001'; }).map(function (x) { return x.qty; });
      return R(r.ok && qtyOf(e, 'I1001') === 100 && stacks.length === 2 && stacks.every(function (q) { return q <= 99; }),
        'code=' + r.code + '；堆叠=' + stacks.join('+') + '；总数=' + qtyOf(e, 'I1001'));
    });
  C('B19', '持有 I1001×10 一堆；背包有空格',
    '1. 选择拆分数量为 4　2. 确认　3. 核对两堆数量',
    '拆分为 6 + 4 两堆；总数仍为 10；生成新 uid；不出现数量丢失',
    function (e) {
      var it = e.addItem('I1001', 10), r = e.split(it.uid, 4);
      var stacks = e.srv.items.filter(function (x) { return x.itemId === 'I1001'; }).map(function (x) { return x.qty; }).sort(function (a, b) { return a - b; });
      return R(r.ok && stacks.length === 2 && stacks[0] === 4 && stacks[1] === 6 && qtyOf(e, 'I1001') === 10,
        'code=' + r.code + '；两堆=' + stacks.join('+') + '；总数=' + qtyOf(e, 'I1001'));
    });
  C('B20', '持有 I1001×10 一堆',
    '1. 拆分数量填 10（等于总数）　2. 确认',
    '拦截；不产生 0 数量空堆；原堆保持不变',
    function (e) {
      var it = e.addItem('I1001', 10), r = e.split(it.uid, 10);
      return R(r.code === 'SPLIT_INVALID' && e.srv.items.length === 1 && it.qty === 10,
        'code=' + r.code + '；堆数=' + e.srv.items.length + '；原堆数量=' + it.qty);
    });
  C('B21', '持有 I1001×10 一堆',
    '1. 拆分数量填 11（大于总数）　2. 确认',
    '拦截；不产生负数量；原堆保持不变',
    function (e) {
      var it = e.addItem('I1001', 10), r = e.split(it.uid, 11);
      return R(r.code === 'SPLIT_INVALID' && it.qty === 10 && !e.srv.items.some(function (x) { return x.qty < 0; }),
        'code=' + r.code + '；原堆数量=' + it.qty + '；负数堆=无');
    });
  C('B22', '背包容量 200；持有 I1009×1 位于格位 0',
    '1. 拖放该道具到格位 250（越界）　2. 观察位置',
    '拒绝拖放；道具保持在原格位；不出现数组越界或道具丢失',
    function (e) {
      var it = e.addItem('I1009', 1), r = e.move(it.uid, 250);
      return R(r.code === 'ILLEGAL_SLOT' && it.slot === 0 && e.srv.items.length === 1,
        'code=' + r.code + '；格位=' + it.slot + '（预期0）；道具数=' + e.srv.items.length);
    });

  /* ============ C 状态与迁移（16 条） ============ */
  C('C01', '道具处于「未获得」状态；地面有 1 个合法掉落',
    '1. 执行拾取　2. 查状态迁移流水',
    '合法迁移「未获得→持有」；流水记录完整；道具状态为持有',
    function (e) {
      e.pickup(e.spawnDrop('I1001', 1));
      var rec = e.srv.ledger.filter(function (x) { return x.type === 'pickup'; })[0];
      return R(rec && rec.transitions.join('→') === '未获得→持有' && e.srv.items[0].state === '持有',
        '迁移=' + (rec ? rec.transitions.join('→') : '无') + '；当前状态=' + e.srv.items[0].state);
    });
  C('C02', '道具处于「持有」状态',
    '1. 点击使用　2. 查状态迁移流水',
    '合法迁移含「持有→使用中」；服务端有使用记录',
    function (e) {
      var it = e.addItem('I1001', 1); e.use(it.uid);
      var rec = e.srv.ledger.filter(function (x) { return x.type === 'use'; })[0];
      return R(rec && rec.transitions[0] === '持有' && rec.transitions[1] === '使用中',
        '迁移=' + (rec ? rec.transitions.join('→') : '无'));
    });
  C('C03', '道具已进入「使用中」状态',
    '1. 等待结算完成　2. 查最终状态与流水',
    '合法迁移「使用中→已消耗」；道具移除；效果只结算 1 次',
    function (e) {
      var it = e.addItem('I1001', 1); e.use(it.uid);
      var rec = e.srv.ledger.filter(function (x) { return x.type === 'use'; })[0];
      return R(rec && rec.transitions[2] === '已消耗' && it.state === '已消耗' && e.srv.effects === 1,
        '迁移=' + (rec ? rec.transitions.join('→') : '无') + '；最终状态=' + it.state + '；效果=' + e.srv.effects + '次');
    });
  C('C04', '持有限时道具 I1003，5 分钟后到期；服务器时间可控',
    '1. 推进服务器时间至到期时刻之后　2. 观察道具状态',
    '合法迁移「持有→已过期」；状态标记为已过期；倒计时归零不为负',
    function (e) {
      var it = e.addItem('I1003', 1);
      e.advanceTime(300001);
      return R(it.state === '已过期' && e.countdown(it.uid) === 0,
        '状态=' + it.state + '；倒计时=' + e.countdown(it.uid) + 'ms');
    });
  C('C05', '道具处于「持有」状态',
    '1. 点击锁定　2. 查状态',
    '合法迁移「持有→已锁定」；格位保持不变',
    function (e) {
      var it = e.addItem('I1009', 1), slot = it.slot, r = e.lock(it.uid);
      return R(r.ok && it.state === '已锁定' && it.slot === slot,
        'code=' + r.code + '；状态=' + it.state + '；格位=' + it.slot);
    });
  C('C06', '道具处于「已锁定」状态',
    '1. 点击解锁　2. 查状态',
    '合法迁移「已锁定→持有」；数量与格位不变',
    function (e) {
      var it = e.addItem('I1009', 1); e.lock(it.uid);
      var r = e.unlock(it.uid);
      return R(r.ok && it.state === '持有' && it.qty === 1,
        'code=' + r.code + '；状态=' + it.state + '；数量=' + it.qty);
    });
  C('C07', '服务端存在状态为「已消耗」的道具（伪造数据/旧存档）',
    '1. 直接对该道具发起使用　2. 观察服务端校验',
    '非法迁移被拒绝；状态不得回退到「持有」；不产生效果与消耗记录',
    function (e) {
      var it = e.addItem('I1001', 1, { state: '已消耗' });
      var r = e.use(it.uid);
      return R(!r.ok && it.state === '已消耗' && e.srv.effects === 0,
        'code=' + r.code + '；状态=' + it.state + '；效果=' + e.srv.effects + '次');
    });
  C('C08', '持有限时道具；停留在背包界面未刷新；服务器时间已越过过期时刻',
    '1. 不重进游戏、不刷新界面　2. 直接点击使用　3. 查服务端校验',
    '服务端拒绝；提示已过期；不产生效果；道具被标记或清理为已过期',
    function (e) {
      var it = e.addItem('I1003', 1);
      e.advanceTime(300001);
      var viewState = e._viewFind(it.uid) ? e._viewFind(it.uid).state : '缺失'; // 未刷新，仍显示持有
      var r = e.use(it.uid);
      return R(r.code === 'EXPIRED' && e.srv.effects === 0 && it.state === '已过期',
        '界面显示状态=' + viewState + '；使用响应=' + r.code + '；效果=' + e.srv.effects + '次；服务端状态=' + it.state);
    });
  C('C09', '道具处于「已锁定」状态；客户端按钮未置灰',
    '1. 直接对该道具发起使用　2. 观察服务端校验',
    '非法迁移「已锁定→已消耗」被拒绝；道具仍为已锁定；不产生效果',
    function (e) {
      var it = e.addItem('I1001', 1); e.lock(it.uid);
      var r = e.use(it.uid);
      return R(r.code === 'LOCKED' && it.state === '已锁定' && e.srv.effects === 0,
        'code=' + r.code + '；状态=' + it.state + '；效果=' + e.srv.effects + '次');
    });
  C('C10', '限时道具在当日 23:59:59 后（次日 00:00:00）到期；服务器时间可控',
    '1. 23:59:59 查看倒计时　2. 推进到 00:00:00　3. 观察状态与倒计时',
    '00:00:00 准时失效；倒计时不出现 -1 秒或 00:00:00 仍可使用；状态为已过期',
    function (e) {
      var midnight = Date.UTC(2026, 10, 10, 0, 0, 0);
      e.setServerTime(midnight - 1000);
      var it = e.addItem('I1003', 1, { expireAt: midnight });
      var before = e.countdown(it.uid);
      e.advanceTime(1000);
      var after = e.countdown(it.uid), r = e.use(it.uid);
      return R(before === 1000 && after === 0 && it.state === '已过期' && r.code === 'EXPIRED',
        '23:59:59倒计时=' + before + 'ms；00:00:00倒计时=' + after + 'ms；状态=' + it.state + '；使用=' + r.code);
    });
  C('C11', '限时道具将在 00:00:00 到期；当前服务器时间 23:59:59',
    '1. 在 23:59:59 点击使用　2. 观察结果',
    '未到期应允许使用；效果结算 1 次；道具消耗；不出现提前失效',
    function (e) {
      var midnight = Date.UTC(2026, 10, 10, 0, 0, 0);
      e.setServerTime(midnight - 1000);
      var it = e.addItem('I1003', 1, { expireAt: midnight });
      var r = e.use(it.uid);
      return R(r.ok && e.srv.effects === 1 && it.state === '已消耗',
        '23:59:59使用=' + r.code + '；效果=' + e.srv.effects + '次；状态=' + it.state);
    });
  C('C12', '服务器时间与本地时间不一致（玩家把本地时间往回调 1 小时）；限时道具已按服务器时间过期',
    '1. 修改客户端本地时间　2. 不刷新界面直接点击使用　3. 观察判定依据',
    '以服务器时间为唯一判据；使用被拒绝；客户端改时间不能绕过有效期',
    function (e) {
      var it = e.addItem('I1003', 1);
      e.setLocalTimeOffset(-3600000);
      e.advanceTime(300001);
      var clientSaysExpired = e.clientTime() >= it.expireAt;
      var r = e.use(it.uid);
      return R(!clientSaysExpired && r.code === 'EXPIRED' && e.srv.effects === 0,
        '客户端时间判定为已过期=' + clientSaysExpired + '；服务端响应=' + r.code + '；效果=' + e.srv.effects + '次');
    });
  C('C13', '持有限时道具；可切后台 5 分钟后返回',
    '1. 切后台　2. 等待 5 分钟　3. 返回游戏并刷新界面',
    '返回后界面状态与服务器一致（已过期）；倒计时不出现负数；使用被拒绝',
    function (e) {
      var it = e.addItem('I1003', 1);
      e.advanceTime(300000);
      e.refresh();
      var viewState = e._viewFind(it.uid) ? e._viewFind(it.uid).state : '缺失';
      var r = e.use(it.uid);
      return R(viewState === '已过期' && it.state === '已过期' && r.code === 'EXPIRED',
        '返回后界面状态=' + viewState + '；倒计时=' + e.countdown(it.uid) + 'ms；使用=' + r.code);
    });
  C('C14', '道具数据已发生变更；可模拟断线重连',
    '1. 使用 1 个道具　2. 断线　3. 重连后读取服务端状态',
    '重连后以服务端为准；客户端与服务端数量、状态、效果次数完全一致',
    function (e) {
      var it = e.addItem('I1001', 3); e.use(it.uid);
      e.setOnline(false); e.reconnect();
      var v = e.getView().filter(function (x) { return x.uid === it.uid; })[0];
      return R(v && v.qty === it.qty && v.state === it.state && e.getView().length === e.srv.items.length,
        '客户端数量=' + (v ? v.qty : '缺失') + '，服务端数量=' + it.qty + '；状态=' + (v ? v.state : '-') + '/' + it.state + '；格数一致=' + (e.getView().length === e.srv.items.length));
    });
  C('C15', '同一账号在设备 A 与 B 同时在线；持有 I1001×5',
    '1. 两端几乎同时使用同一道具　2. 查两端显示与服务端记录',
    '仅一次生效；另一端收到状态刷新；道具只扣 1 个；不出现重复效果或负数',
    function (e) {
      var it = e.addItem('I1001', 5);
      var rs = e.concurrent([
        function () { e.createSession('A'); return e.use(it.uid, { opId: 'OP-C15-A' }); },
        function () { e.createSession('B'); return e.use(it.uid, { opId: 'OP-C15-B' }); }
      ]);
      var success = rs.filter(function (x) { return x.ok; }).length;
      return R(success === 1 && e.srv.effects === 1 && it.qty === 4 && e.getView().length === e.srv.items.length,
        '成功请求=' + success + '/2；响应=' + rs.map(function (x) { return x.code; }).join('/') + '；效果=' + e.srv.effects + '次；剩余=' + it.qty);
    });
  C('C16', '背包中有普通道具与锁定道具；已产生使用流水',
    '1. 记录状态　2. 重进游戏　3. 逐项比对',
    '道具 ID、数量、状态、格位与效果次数全部恢复且以服务端为准',
    function (e) {
      var a = e.addItem('I1009', 1), b = e.addItem('I1001', 3);
      e.lock(a.uid); e.use(b.uid);
      var before = e.srv.items.map(function (x) { return x.uid + ':' + x.qty + ':' + x.state + ':' + x.slot; }).join('|');
      var fx = e.srv.effects;
      e.reloadFromServer();
      var after = e.getView().map(function (x) { return x.uid + ':' + x.qty + ':' + x.state + ':' + x.slot; }).join('|');
      return R(before === after && fx === e.srv.effects,
        '重进前=' + before + '；重进后=' + after + '；效果次数=' + e.srv.effects);
    });

  /* ============ D 判定表：整理规则（12 条） ============ */
  C('D01', '容量 8；有空格；无可堆叠道具；无锁定道具',
    '1. 点击「整理」　2. 观察规则命中与排列结果',
    '命中 R1：按默认顺序紧凑排列；合并数 0；道具总数不变',
    function (e, NS) {
      var x = mkSort(NS, e, true, false, false), before = x.srv.items.length, r = x.sort();
      return R(r.ok && r.data.rule === 'R1' && r.data.merged === 0 && x.srv.items.length === before,
        '规则=' + r.data.rule + '；合并=' + r.data.merged + '；道具格数=' + before + '→' + x.srv.items.length);
    });
  C('D02', '容量 8；有空格；无可堆叠道具；有锁定道具',
    '1. 记录锁定道具格位　2. 点击整理　3. 核对格位',
    '命中 R2：排列但锁定格位保留；锁定道具位置不变',
    function (e, NS) {
      var x = mkSort(NS, e, true, false, true), lockUid = x.lockUid, slot = x.lockSlot, r = x.sort();
      var after = x._find(lockUid).slot;
      return R(r.ok && r.data.rule === 'R2' && after === slot && r.data.lockedMoved === 0,
        '规则=' + r.data.rule + '；锁定格位=' + slot + '→' + after + '；锁定移动数=' + r.data.lockedMoved);
    });
  C('D03', '容量 8；有空格；有两堆可合并同类道具；无锁定道具',
    '1. 点击整理　2. 核对合并结果',
    '命中 R3：先合并同类再紧凑排列；合并数量 > 0；总数守恒',
    function (e, NS) {
      var x = mkSort(NS, e, true, true, false), total = qtyOf(x, 'I1001'), r = x.sort();
      return R(r.ok && r.data.rule === 'R3' && r.data.merged > 0 && qtyOf(x, 'I1001') === total,
        '规则=' + r.data.rule + '；合并=' + r.data.merged + '个；I1001总数=' + total + '→' + qtyOf(x, 'I1001'));
    });
  C('D04', '容量 8；有空格；有两堆可合并同类道具；有 1 个锁定道具',
    '1. 记录全部道具 ID、数量与锁定状态　2. 点击整理　3. 等待动画结束并核对',
    '命中 R4：同类正确合并；锁定道具不参与合并与移动、位置不变；整理前后道具 ID 与总数量完全一致',
    function (e, NS) {
      var x = mkSort(NS, e, true, true, true);
      var lockUid = x.lockUid, slot = x.lockSlot, lockQty = x._find(lockUid).qty;
      var ids = uniqIds(x.srv.items);
      var total = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      var r = x.sort();
      var after = x._find(lockUid);
      var idsAfter = uniqIds(x.srv.items);
      var totalAfter = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      var pass = r.ok && r.data.rule === 'R4' && r.data.merged > 0 && after.slot === slot &&
        after.qty === lockQty && after.state === '已锁定' && ids === idsAfter && total === totalAfter;
      return R(pass,
        '规则=' + r.data.rule + '；合并=' + r.data.merged + '；锁定格位=' + slot + '→' + after.slot + '；锁定数量=' + lockQty + '→' + after.qty + '；ID种类集合[' + ids + ']一致=' + (ids === idsAfter) + '；总数量=' + total + '→' + totalAfter);
    });
  C('D05', '容量 8；无空格；无可堆叠道具；无锁定道具',
    '1. 点击整理　2. 观察按钮状态与响应',
    '命中 R5：无可整理内容，提示或按钮置灰；数据完全不变',
    function (e, NS) {
      var x = mkSort(NS, e, false, false, false), before = JSON.stringify(x.srv.items), r = x.sort();
      return R(!r.ok && r.code === 'NO_SORTABLE' && r.data.rule === 'R5' && JSON.stringify(x.srv.items) === before,
        'code=' + r.code + '；规则=' + r.data.rule + '；数据未变=' + (JSON.stringify(x.srv.items) === before));
    });
  C('D06', '容量 8；无空格；无可堆叠道具；有锁定道具',
    '1. 记录锁定格位　2. 点击整理　3. 核对',
    '命中 R6：无可整理内容；锁定道具保持原位；数据完全不变',
    function (e, NS) {
      var x = mkSort(NS, e, false, false, true), slot = x.lockSlot, before = JSON.stringify(x.srv.items), r = x.sort();
      var afterSlot = x._find(x.lockUid).slot;
      return R(!r.ok && r.data.rule === 'R6' && afterSlot === slot && JSON.stringify(x.srv.items) === before,
        'code=' + r.code + '；规则=' + r.data.rule + '；锁定格位=' + afterSlot + '；数据未变=' + (JSON.stringify(x.srv.items) === before));
    });
  C('D07', '容量 8；无空格；有两堆可合并同类道具；无锁定道具',
    '1. 点击整理　2. 核对合并后空格数',
    '命中 R7：仅执行合并；合并后腾出空格；总数量守恒',
    function (e, NS) {
      var x = mkSort(NS, e, false, true, false), total = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0), r = x.sort();
      var after = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      return R(r.ok && r.data.rule === 'R7' && r.data.merged > 0 && x.srv.items.length < 8 && total === after,
        '规则=' + r.data.rule + '；合并=' + r.data.merged + '；格数=8→' + x.srv.items.length + '（腾出空格）；总数量=' + total + '→' + after);
    });
  C('D08', '容量 8；无空格；有两堆可合并同类道具；有 1 个锁定道具',
    '1. 记录锁定道具状态　2. 点击整理　3. 核对',
    '命中 R8：只合并非锁定道具；锁定道具不参与合并且位置不变；总数守恒',
    function (e, NS) {
      var x = mkSort(NS, e, false, true, true), lockUid = x.lockUid, slot = x.lockSlot;
      var total = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0), r = x.sort();
      var after = x._find(lockUid), totalAfter = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      return R(r.ok && r.data.rule === 'R8' && r.data.merged > 0 && after.slot === slot && after.state === '已锁定' && total === totalAfter,
        '规则=' + r.data.rule + '；合并=' + r.data.merged + '；锁定格位=' + slot + '→' + after.slot + '；总数量=' + total + '→' + totalAfter);
    });
  C('D09', '容量 4；4 个道具全部为已锁定状态',
    '1. 记录所有格位　2. 点击整理　3. 核对',
    '全部锁定时不产生任何移动；格位逐一不变；不报错不崩溃',
    function (e, NS) {
      var x = new NS.BagEngine({ capacity: 4, faults: e.faults });
      for (var i = 0; i < 4; i++) x.addItem('I1009', 1);
      x.srv.items.forEach(function (it) { x.lock(it.uid); });
      var before = x.srv.items.map(function (i) { return i.uid + ':' + i.slot; }).join('|');
      var r = x.sort();
      var after = x.srv.items.map(function (i) { return i.uid + ':' + i.slot; }).join('|');
      return R(before === after && x.srv.items.length === 4,
        'code=' + r.code + '；规则=' + (r.data.rule || '-') + '；格位未变=' + (before === after));
    });
  C('D10', '容量 4；4 堆同类道具均已达到堆叠上限 99',
    '1. 点击整理　2. 观察是否误判为可合并',
    '全部满堆时不存在可合并内容；不得产生 0 数量空堆或数量溢出；数据不变',
    function (e, NS) {
      var x = new NS.BagEngine({ capacity: 4, faults: e.faults });
      for (var i = 0; i < 4; i++) x.addItem('I1001', 99);
      var before = JSON.stringify(x.srv.items), r = x.sort();
      var noEmptyStack = x.srv.items.every(function (i) { return i.qty > 0 && i.qty <= 99; });
      return R(r.code === 'NO_SORTABLE' && noEmptyStack && JSON.stringify(x.srv.items) === before,
        'code=' + r.code + '；规则=' + (r.data.rule || '-') + '；堆数=' + x.srv.items.length + '；无异常堆=' + noEmptyStack);
    });
  C('D11', '存在可整理内容；可在点击整理瞬间断网',
    '1. 断网后点击整理　2. 恢复网络重连　3. 核对整理结果与总数',
    '断网期间服务端数据不变；重连重放后状态一致；不出现重复整理导致的数据错乱或丢失',
    function (e, NS) {
      var x = mkSort(NS, e, true, true, false);
      var total = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      x.setOnline(false);
      var r = x.sort();
      var unchangedWhileOffline = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0) === total;
      x.reconnect();
      var totalAfter = x.srv.items.reduce(function (a, b) { return a + b.qty; }, 0);
      return R(r.code === 'OFFLINE' && unchangedWhileOffline && totalAfter === total && x.getView().length === x.srv.items.length,
        '断网响应=' + r.code + '；断网期间总数未变=' + unchangedWhileOffline + '；重连后总数=' + total + '→' + totalAfter);
    });
  C('D12', '含普通、可堆叠、锁定三类道具；整理前已记录基线',
    '1. 记录整理前各 itemId 总数量、ID 集合与锁定状态　2. 执行整理　3. 逐项比对',
    '整理前后各 itemId 总数量不变、ID 集合不变、锁定状态与格位不变；验证「数据不变」而非「看起来整齐」',
    function (e, NS) {
      var x = mkSort(NS, e, true, true, true);
      var sumBy = function () {
        var m = {}; x.srv.items.forEach(function (i) { m[i.itemId] = (m[i.itemId] || 0) + i.qty; }); return JSON.stringify(m);
      };
      var before = sumBy();
      var ids = uniqIds(x.srv.items);
      var locks = x.srv.items.filter(function (i) { return i.state === '已锁定'; }).map(function (i) { return i.uid + ':' + i.slot; }).join('|');
      x.sort();
      var after = sumBy();
      var idsAfter = uniqIds(x.srv.items);
      var locksAfter = x.srv.items.filter(function (i) { return i.state === '已锁定'; }).map(function (i) { return i.uid + ':' + i.slot; }).join('|');
      return R(before === after && ids === idsAfter && locks === locksAfter,
        '数量映射=' + before + '→' + after + '；ID集合一致=' + (ids === idsAfter) + '；锁定格位一致=' + (locks === locksAfter));
    });

  /* ============ E 场景法：完整链路（16 条） ============ */
  C('E01', '账号已登录；副本可产生掉落；背包有空格',
    '1. 击杀怪物产生掉落　2. 拾取　3. 打开背包查看　4. 使用　5. 确认消耗',
    '基本流走通：流水依次含 pickup 与 use；ID 与数量正确；效果结算 1 次；道具最终移除',
    function (e) {
      e.pickup(e.spawnDrop('I1001', 1));
      var it = e.srv.items[0]; e.use(it.uid);
      var types = e.srv.ledger.map(function (x) { return x.type; }).join('→');
      return R(types === 'pickup→use' && e.srv.effects === 1 && e.srv.items.length === 0,
        '流水=' + types + '；效果=' + e.srv.effects + '次；背包=' + e.srv.items.length + '格');
    });
  C('E02', '地面有 1 个掉落；支持丢弃找回',
    '1. 拾取　2. 丢弃并确认　3. 通过回收入口找回',
    '备选流走通：找回后道具重新入包；数量与 ID 与最初一致；不重复发放',
    function (e) {
      e.pickup(e.spawnDrop('I1001', 1));
      var uid = e.srv.items[0].uid;
      e.discard(uid, { confirm: true });
      var r = e.recoverFromRecycle(uid);
      return R(r.ok && qtyOf(e, 'I1001') === 1 && e.srv.items.length === 1,
        '找回=' + r.code + '；I1001数量=' + qtyOf(e, 'I1001') + '；背包=' + e.srv.items.length + '格');
    });
  C('E03', '地面有 3 个掉落；支持锁定与整理',
    '1. 全部拾取　2. 锁定其中 1 个　3. 执行整理　4. 核对',
    '锁定道具不参与整理移动；总数量与 ID 不变；整理结果符合判定表规则',
    function (e) {
      var ds = []; for (var i = 0; i < 3; i++) ds.push(e.spawnDrop('I1001', 10));
      e.pickupBatch(ds);
      var uid = e.srv.items[0].uid, slot = e.srv.items[0].slot;
      e.lock(uid);
      var total = qtyOf(e, 'I1001'), r = e.sort();
      return R(r.ok && e._find(uid).slot === slot && qtyOf(e, 'I1001') === total,
        '整理=' + r.code + '（' + r.data.rule + '）；锁定格位=' + slot + '→' + e._find(uid).slot + '；I1001总数=' + total + '→' + qtyOf(e, 'I1001'));
    });
  C('E04', '背包 200 格满；金币 1000；商城有货',
    '1. 商城购买 I1002×1　2. 支付　3. 查看背包与邮件',
    '扣款成功后因满包自动邮件补发；玩家可领取；全程有明确提示；道具不丢失',
    function (e) {
      e.fill('I1009', 200);
      var r = e.purchase('I1002', 1);
      return R(e.srv.gold === 980 && e.srv.mail.length === 1 && r.data.inMail === true && !r.data.silentLost,
        '金币=1000→' + e.srv.gold + '；邮件=' + e.srv.mail.length + '封（' + (e.srv.mail[0] ? e.srv.mail[0].reason : '-') + '）；静默丢失=' + !!r.data.silentLost);
    });
  C('E05', '背包 200 格满；副本可产生掉落并自动拾取',
    '1. 击杀怪物产生掉落　2. 触发自动拾取　3. 观察提示与地面',
    '给出「背包已满」明确提示；掉落物保留在地面；背包仍 200 格；不吞道具',
    function (e) {
      e.fill('I1009', 200);
      var r = e.pickup(e.spawnDrop('I1001', 1));
      return R(r.code === 'BAG_FULL' && /背包已满/.test(r.msg) && e.ground.length === 1 && e.srv.items.length === 200,
        'code=' + r.code + '；提示="' + r.msg + '"；地面=' + e.ground.length + '个；背包=' + e.srv.items.length + '格');
    });
  C('E06', '账号在线；交易对方发起交付 I1002×1；背包有空格',
    '1. 接收交易　2. 查看到账　3. 检查客户端状态刷新',
    '道具到账；数量与 ID 正确；客户端视图与服务端一致；无延迟显示',
    function (e) {
      var r = e.grant('I1002', 1, 'trade');
      var v = e.getView().filter(function (x) { return x.itemId === 'I1002'; });
      return R(r.ok && qtyOf(e, 'I1002') === 1 && v.length === 1 && v[0].qty === 1,
        'code=' + r.code + '；服务端数量=' + qtyOf(e, 'I1002') + '；客户端显示=' + (v[0] ? v[0].qty : 0));
    });
  C('E07', '持有 I1001×2；可在点击使用瞬间断网',
    '1. 断网后点击使用　2. 恢复网络并等待重连　3. 核对数量与效果',
    '一致性约束：重连后要么成功扣 1 且结算 1 次，要么完全不扣不结算；不得「扣了但没效果」',
    function (e) {
      var it = e.addItem('I1001', 2);
      e.setOnline(false);
      var r = e.use(it.uid, { opId: 'OP-E07' });
      var beforeQty = it.qty, beforeFx = e.srv.effects;
      e.reconnect();
      var consistent = (it.qty === 1 && e.srv.effects === 1) || (it.qty === 2 && e.srv.effects === 0);
      return R(r.code === 'OFFLINE' && consistent && e.getView().length === e.srv.items.length,
        '断网响应=' + r.code + '；断网前数量=' + beforeQty + '、效果=' + beforeFx + '；重连后数量=' + it.qty + '、效果=' + e.srv.effects + '；一致性=' + consistent);
    });
  C('E08', '持有 I1001×2；已点击使用并获得成功响应；可强杀进程',
    '1. 使用道具　2. 响应到达后立即杀进程　3. 重进游戏',
    '以服务端权威数据为准：道具扣 1、效果结算 1 次；重进后不回档、不重复扣',
    function (e) {
      var it = e.addItem('I1001', 2); e.use(it.uid);
      e.reloadFromServer();
      var v = e.getView().filter(function (x) { return x.uid === it.uid; })[0];
      return R(it.qty === 1 && e.srv.effects === 1 && v && v.qty === 1,
        '服务端数量=' + it.qty + '；效果=' + e.srv.effects + '次；重进后客户端数量=' + (v ? v.qty : '缺失'));
    });
  C('E09', '持有 I1001×5；可在测试环境重放同一条使用成功响应 3 次',
    '1. 使用 1 个道具并捕获 opId　2. 将同一响应重复推送 3 次　3. 查数量与效果流水',
    '效果只结算一次；道具只扣 1 个；服务端有幂等去重；不产生重复副作用',
    function (e) {
      var it = e.addItem('I1001', 5), op = 'OP-E09';
      var rs = [e.use(it.uid, { opId: op }), e.use(it.uid, { opId: op }), e.use(it.uid, { opId: op })];
      var useLogs = e.srv.ledger.filter(function (x) { return x.type === 'use'; }).length;
      return R(e.srv.effects === 1 && it.qty === 4 && useLogs === 1,
        '响应=' + rs.map(function (x) { return x.code; }).join('/') + '；效果=' + e.srv.effects + '次；剩余=' + it.qty + '；使用流水=' + useLogs + '条');
    });
  C('E10', '持有 I1001×5；弱网 300ms 延迟 10% 丢包；按钮可重复点击',
    '1. 在 200ms 内连续点击使用两次　2. 等待两个响应都返回',
    '两次点击合并为一次有效操作；只扣 1 个道具、只结算 1 次效果；不出现「扣 2 结算 1」',
    function (e) {
      var it = e.addItem('I1001', 5);
      var rs = e.concurrent([
        function () { return e.use(it.uid, { opId: 'OP-E10-1' }); },
        function () { return e.use(it.uid, { opId: 'OP-E10-2' }); }
      ]);
      return R(e.srv.effects === 1 && it.qty === 4 && rs.filter(function (x) { return x.ok; }).length === 1,
        '响应=' + rs.map(function (x) { return x.code; }).join('/') + '；效果=' + e.srv.effects + '次；剩余=' + it.qty);
    });
  C('E11', '玩家停留在背包界面；服务端后台推送 1 个道具',
    '1. 后台推送道具（不主动通知前端）　2. 观察前台显示　3. 手动刷新界面',
    '推送已写入服务端；前台在无刷新时可暂时落后；刷新后立即与服务端一致；不出现静默吞掉',
    function (e) {
      var r = e.grant('I1002', 1, 'push');
      var lag = e.srv.items.length - e.getView().length;
      e.refresh();
      var synced = e.getView().length === e.srv.items.length;
      return R(r.ok && lag === 1 && synced && qtyOf(e, 'I1002') === 1,
        '推送=' + r.code + '；服务端=' + e.srv.items.length + '格、前台=' + (e.srv.items.length - lag) + '格（落后' + lag + '）；刷新后一致=' + synced);
    });
  C('E12', '存在热更新前产生的背包存档；准备 v2.4.2 新配置（新增 season / schema 字段）',
    '1. 用旧版本产生背包数据　2. 热更新到新版本　3. 打开背包并使用道具',
    '旧道具可正常显示与使用；新增字段有默认值；不出现解析失败、闪退或道具丢失',
    function (e) {
      var it = e.addItem('I1001', 1);
      delete it.season; delete it.schema;
      var u = e.hotUpdate('2.4.2');
      var r = e.use(it.uid);
      return R(u.ok && it.season === 'S0' && it.schema === 2 && r.ok && e.srv.version === '2.4.2',
        '热更新=' + u.code + '；补字段=' + u.data.fieldsAdded + '个；版本=' + e.srv.version + '；使用=' + r.code);
    });
  C('E13', '存在 v2.4.1 老版本存档（缺 slot / season / schema 字段）',
    '1. 用新版本客户端打开老存档　2. 检查字段与显示　3. 使用道具',
    '兼容加载不报错；缺失字段有默认值；道具数量正确；可正常使用',
    function (e) {
      var r = e.loadLegacySave({ items: [{ uid: 'OLD1', itemId: 'I1001', qty: 2 }], gold: 500 });
      var it = e.srv.items[0];
      // 基线必须在使用前取值：use() 会修改 uses 与 qty
      var fixedSlot = it.slot, fixedSchema = it.schema, fixedUses = it.uses;
      var use = e.use(it.uid);
      return R(r.ok && fixedSlot === 0 && fixedSchema === 1 && fixedUses === 1 && use.ok && it.qty === 1,
        '加载=' + r.code + '；补齐 slot=' + fixedSlot + '、schema=' + fixedSchema + '、uses=' + fixedUses + '；使用=' + use.code + '；剩余=' + it.qty);
    });
  C('E14', '账号在 S1 服持有 3 个道具；可执行跨服转区',
    '1. 记录道具 uid 与数量　2. 转区到 S2　3. 打开背包核对',
    '道具全部保留；uid、数量、状态不变；不出现重复发放或丢失',
    function (e) {
      e.addItem('I1001', 5); e.addItem('I1009', 1); e.addItem('I1002', 3);
      var before = e.srv.items.map(function (x) { return x.uid + ':' + x.qty; }).join('|');
      var r = e.transferServer('S2');
      var after = e.srv.items.map(function (x) { return x.uid + ':' + x.qty; }).join('|');
      return R(r.ok && r.data.unchanged && before === after && e.srv.serverId === 'S2',
        '转区=' + r.code + '；目标服=' + e.srv.serverId + '；数据一致=' + (before === after));
    });
  C('E15', '账号处于封禁状态；持有限时道具即将到期',
    '1. 封禁期间推进服务器时间越过到期时刻　2. 解封　3. 查道具状态',
    '到期判定仍以服务器时间为准；解封后道具不会「复活」；不因封禁产生额外补偿',
    function (e) {
      e.setBan(true);
      var it = e.addItem('I1003', 1);
      e.advanceTime(300001);
      e.setBan(false);
      return R(it.state === '已过期' && e.srv.banned === false && e.countdown(it.uid) === 0,
        '解封后状态=' + it.state + '；倒计时=' + e.countdown(it.uid) + 'ms；封禁标记=' + e.srv.banned);
    });
  C('E16', '已取得服务器快照；快照后发生过使用消耗',
    '1. 记录快照　2. 使用道具　3. 执行服务器回档　4. 核对状态',
    '回档后道具数量、状态与效果计数以快照为准；不出现「状态回退但流水未回退」的不一致',
    function (e) {
      var it = e.addItem('I1001', 3);
      var snap = e.snapshot();
      e.use(it.uid);
      var midQty = it.qty, midFx = e.srv.effects;
      e.rollback(snap);
      var back = e.srv.items.filter(function (x) { return x.uid === it.uid; })[0];
      return R(back && back.qty === 3 && e.srv.effects === 0 && e.getView().length === e.srv.items.length,
        '回档前数量=' + midQty + '、效果=' + midFx + '；回档后数量=' + (back ? back.qty : '缺失') + '、效果=' + e.srv.effects);
    });

  /* ============ F 兼容、性能与界面（16 条） ============ */
  P('F01', '720×1280 小屏分辨率；背包内有至少 20 个道具',
    '1. 打开背包　2. 滑到最右一列　3. 观察图标显示',
    '最后一列图标完整显示、可正常点击；布局算法计算的内容宽度不超过视口宽度',
    function (e) {
      var r = e.gridLayout(720);
      return R(r.lastColumnClipped === false && r.overflow === 0,
        '视口=' + r.viewport + 'px；列数=' + r.cols + '；内容宽=' + r.contentWidth + 'px；溢出=' + r.overflow + 'px；末列裁切=' + r.lastColumnClipped);
    });
  P('F02', '平板设备；分别处于横屏 1024px 与竖屏 768px',
    '1. 横屏打开背包　2. 切换竖屏　3. 分别检查布局',
    '两种方向下列数自适应且均无横向溢出；切换后道具可点击',
    function (e) {
      var a = e.gridLayout(1024), b = e.gridLayout(768);
      return R(a.overflow === 0 && b.overflow === 0 && a.cols > b.cols,
        '横屏=' + a.cols + '列/溢出' + a.overflow + 'px；竖屏=' + b.cols + '列/溢出' + b.overflow + 'px');
    });
  P('F03', '折叠屏设备；折叠态 600px 与展开态 1100px',
    '1. 折叠态打开背包　2. 展开屏幕　3. 分别检查布局',
    '展开/折叠均不裁切；列数随宽度增加；无布局残留',
    function (e) {
      var a = e.gridLayout(600), b = e.gridLayout(1100);
      return R(a.overflow === 0 && b.overflow === 0 && b.cols > a.cols,
        '折叠=' + a.cols + '列/溢出' + a.overflow + 'px；展开=' + b.cols + '列/溢出' + b.overflow + 'px');
    });
  P('F04', '中低端机型基准；背包内有 200 个道具；已接入耗时采集',
    '1. 记录开始时间　2. 打开 200 格背包　3. 记录结束时间',
    '同步构建 200 格视图数据的耗时低于宽松阈值 500ms（代理指标，不替代真机帧耗时）',
    function (e) {
      e.fill('I1009', 200);
      var t0 = Date.now(); e.openBag(); var ms = Date.now() - t0;
      return R(ms < 500 && e.getView().length === 200,
        '打开耗时=' + ms + 'ms（阈值<500ms）；视图格数=' + e.getView().length);
    });
  P('F05', '中端机型；已接入对象计数；背包内有 150 个道具',
    '1. 记录初始监听器与缓存对象数　2. 连续开关背包 50 次　3. 等待 GC 后复查',
    '监听器与缓存对象数回到基线（无累积增长）；不出现 OOM（代理指标，非真实内存采样）',
    function (e) {
      e.fill('I1009', 150);
      var base = e.cli.listeners, cache = e.cli.cacheSize;
      for (var i = 0; i < 50; i++) { e.openBag(); e.closeBag(); }
      return R(e.cli.listeners === base && e.cli.cacheSize === cache,
        '50次开关后监听器=' + e.cli.listeners + '（基线' + base + '）；缓存对象=' + e.cli.cacheSize + '（基线' + cache + '）');
    });
  M('F06', '中端机型；背包 200 格；已接入帧率采集工具',
    '1. 打开背包　2. 快速连续滚动列表　3. 采集帧率曲线',
    '滚动过程无持续掉帧，最低帧率与项目标准对齐；无卡顿白块',
    '真机验证项：需在目标机型上采集 FPS 曲线与 GPU 耗时，记录最低帧率、掉帧次数与阈值；纯逻辑场景无法模拟刷新率与合成器行为。');
  C('F07', '道具图标资源 URL 缺失或加载失败',
    '1. 打开背包　2. 观察该道具格位',
    '显示内置占位图；格位仍可点击；不出现空白格或崩溃',
    function (e) {
      var r = e.iconFallback(null);
      return R(r.placeholder === true && !!r.src,
        '占位图启用=' + r.placeholder + '；资源=' + r.src);
    });
  C('F08', '存在名称长度 30 字符的道具；名称显示上限 12 字符',
    '1. 在背包列表查看名称　2. 检查截断与省略号',
    '按字符安全截断并带省略号；不撑破布局；不截断出半个代理对',
    function (e) {
      var raw = '超长道具名称测试用字符串ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      var r = e.truncateName(raw, 12);
      return R(Array.from(r).length === 13 && r.slice(-1) === '…',
        '原长=' + Array.from(raw).length + '字符；截断后=' + Array.from(r).length + '字符；结果="' + r + '"');
    });
  C('F09', '具备自定义道具名称能力；输入含 % 、单引号、分号、尖括号与 emoji 的名称',
    '1. 保存名称　2. 在背包、交易行、排行榜三处查看　3. 检查脚本注入',
    '正确保存并原样显示；不引发脚本执行；三处显示一致；尖括号被实体转义',
    function (e) {
      var raw = "药%水';<script>alert(1)</script>🎮";
      var d = e.displayName(raw);
      return R(d.bag === d.market && d.market === d.rank && d.bag.indexOf('<script>') === -1 && d.bag.indexOf('&lt;script&gt;') >= 0,
        '三处一致=' + (d.bag === d.market && d.market === d.rank) + '；含可执行<script>=' + (d.bag.indexOf('<script>') >= 0) + '；转义后片段=' + d.bag.slice(0, 30));
    });
  C('F10', '多语言环境；名称含中文、英文、emoji 混合字符',
    '1. 设置不同语言　2. 查看截断后的名称',
    '按 Unicode 码点截断；emoji 不被切成两半；不出现乱码方块',
    function (e) {
      var raw = '中文Name混合🎮测试 emoji截断边界';
      var r = e.truncateName(raw, 8);
      var noBroken = !/\uFFFD/.test(r) && Array.from(r).length === 9;
      return R(noBroken && r.slice(-1) === '…',
        '截断结果="' + r + '"；码点数=' + Array.from(r).length + '；替换字符=' + /\uFFFD/.test(r));
    });
  C('F11', '道具数量超过显示上限 999999',
    '1. 查看数量角标格式化结果',
    '显示为「999999+」；不出现数值溢出或科学计数法；实际数量仍以服务端整数为准',
    function (e) {
      var r = e.formatQty(1000000);
      return R(r === '999999+', 'formatQty(1000000)="' + r + '"');
    });
  C('F12', '道具数量为 0（异常数据或边界）',
    '1. 查看数量角标',
    '数量为 0 时不显示角标；不出现「0」字样；不出现负数',
    function (e) {
      var r = e.formatQty(0);
      return R(r === '', 'formatQty(0)="' + r + '"（空字符串即不渲染角标）');
    });
  M('F13', '设备音量与震动权限正常；背包中有可用消耗品',
    '1. 使用道具　2. 听音效与感受震动　3. 在静音模式下重复',
    '音效与震动按设置触发；静音模式下不误触发；无延迟与重复播放',
    '真机验证项：需人工听感与触觉确认，并覆盖静音/勿扰/无障碍设置组合；纯逻辑场景无音频与马达接口。');
  C('F14', '账号处于新手引导阶段；背包入口存在',
    '1. 引导期间尝试进入背包　2. 引导结束后再次进入',
    '引导期间按需求锁定或给出提示；引导结束后入口恢复可用；不出现卡死',
    function (e) {
      e.setTutorial(true); var a = e.bagEntrance();
      e.setTutorial(false); var b = e.bagEntrance();
      return R(a.blocked === true && b.blocked === false && a.visible === true,
        '引导中锁定=' + a.blocked + '（原因"' + a.reason + '"）；引导后可进入=' + (!b.blocked));
    });
  P('F15', '开启系统大字体（fontScale=1.5）与无障碍模式；视口 720px',
    '1. 开启大字体　2. 打开背包　3. 检查图标与文字可读性',
    '布局单元随字级放大后仍不横向溢出；文字不被裁切（代理指标，真实可读性需人工确认）',
    function (e) {
      var r = e.gridLayout(720, { fontScale: 1.5 });
      return R(r.overflow === 0 && r.cell === 60,
        '字级=' + r.fontScale + '；单元=' + r.cell + 'px；列数=' + r.cols + '；溢出=' + r.overflow + 'px');
    });
  P('F16', '深色模式；前景 #E8EAF0，背景 #1A1D24',
    '1. 切换深色模式　2. 计算图标与背景的对比度',
    'WCAG 对比度 ≥ 4.5:1；低对比度图标需有描边或替代色（计算值，非屏幕实测亮度）',
    function (e) {
      var ratio = e.contrastRatio('#E8EAF0', '#1A1D24');
      return R(ratio >= 4.5, '对比度=' + ratio.toFixed(2) + ':1（阈值≥4.5）');
    });

  return IMPL;
});

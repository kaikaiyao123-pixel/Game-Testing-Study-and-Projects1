/* 背包系统游戏场景引擎（被测对象 SUT）
 * 结构：服务端权威数据 srv + 客户端投影 cli + 地面掉落 ground
 * Node 与浏览器共用本文件，保证交互场景与自动化验证对象是同一份实现。
 * 规则取自源学习包：容量 200 / 堆叠上限 99 / 六态道具 / 整理判定表 R1-R8。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BagNS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STATES = ['未获得', '持有', '使用中', '已消耗', '已锁定', '已过期'];
  var T0 = Date.UTC(2026, 10, 9, 8, 0, 0); // 固定基准时间，保证验证可复现

  var ITEM_DB = {
    I1001: { name: '小型治疗药水', stack: 99, price: 10, uses: 1, level: 1, job: null, bound: false, tradeable: true },
    I1002: { name: '初级强化石', stack: 99, price: 20, uses: 1, level: 1, job: null, bound: false, tradeable: true },
    I1003: { name: '限时双倍经验卡', stack: 1, price: 50, uses: 1, level: 1, job: null, bound: false, tradeable: true, durationMs: 300000 },
    I1004: { name: '战士专属徽章', stack: 1, price: 100, uses: 1, level: 10, job: '战士', bound: false, tradeable: true },
    I1005: { name: '绑定·新手礼包', stack: 1, price: 0, uses: 1, level: 1, job: null, bound: true, tradeable: false },
    I1006: { name: '三次数卷轴', stack: 1, price: 80, uses: 3, level: 1, job: null, bound: false, tradeable: true },
    I1007: { name: '冷却型药剂', stack: 99, price: 15, uses: 1, level: 1, job: null, bound: false, tradeable: true, cooldownMs: 30000 },
    I1008: { name: '已下架道具', stack: 1, price: 5, uses: 1, level: 1, job: null, bound: false, tradeable: false, deprecated: true },
    I1009: { name: '不可堆叠宝箱', stack: 1, price: 30, uses: 1, level: 1, job: null, bound: false, tradeable: true }
  };

  var FAULT_KEYS = [
    'swallowDrop',        // 满包拾取时先删地面掉落物（吞道具）
    'noExpireCheck',      // 服务端不校验过期（界面未刷新仍可使用）
    'noIdempotency',      // 使用接口无幂等键（重复回调 / 双击重复结算）
    'sortMovesLocked',    // 整理移动锁定道具
    'purchaseLosesItem',  // 满包商城购买扣款成功但未到账且无补发
    'badLayout'           // 小屏分辨率下最后一列溢出裁切
  ];

  function ok(code, msg, data) { return { ok: true, code: code, msg: msg || '', data: data || {} }; }
  function fail(code, msg, data) { return { ok: false, code: code, msg: msg || '', data: data || {} }; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function sum(arr, f) { return arr.reduce(function (a, b) { return a + f(b); }, 0); }

  function BagEngine(opts) {
    opts = opts || {};
    this.faults = {};
    for (var i = 0; i < FAULT_KEYS.length; i++) this.faults[FAULT_KEYS[i]] = !!opts.faults && !!opts.faults[FAULT_KEYS[i]];
    this.DEF = { capacity: 200, stackLimit: 99, goldCap: 999999999, level: opts.level || 60, job: opts.job || '战士' };
    this._uid = 0;
    this._dropId = 0;
    this._batch = false;
    this._inflight = {};
    this.accounts = {};
    this.groundByAccount = {};
    this.account = 'test_bag_01';
    this.srv = this._newServer(opts.capacity || 200);
    this.accounts[this.account] = this.srv;
    this.cli = { view: [], open: false, listeners: 0, cacheSize: 0, localTimeOffset: 0, session: 'A' };
    this.ground = [];
    this.eventLog = [];
    this.refresh();
  }

  BagEngine.prototype._newServer = function (capacity) {
    return {
      capacity: capacity, items: [], gold: 1000, time: T0, mail: [], recycle: [],
      processed: {}, ledger: [], effects: 0, cooldowns: {}, lastSold: null,
      version: '2.4.1', schema: 2, serverId: 'S1', banned: false, pending: []
    };
  };

  BagEngine.prototype._log = function (text) {
    this.eventLog.push({ t: this.srv.time, text: text });
    if (this.eventLog.length > 400) this.eventLog.shift();
  };

  BagEngine.prototype.nextUid = function () { this._uid += 1; return 'U' + String(this._uid).padStart(5, '0'); };
  BagEngine.prototype.nextOpId = function () { return 'OP' + (this._uid + 1) + '-' + Math.floor(this.srv.ledger.length) + '-' + Math.random().toString(36).slice(2, 7); };

  function mkItem(engine, itemId, qty, extra) {
    var def = ITEM_DB[itemId];
    var it = {
      uid: engine.nextUid(), itemId: itemId, qty: qty, state: '持有',
      slot: engine.srv.items.length, uses: def.uses,
      expireAt: def.durationMs ? engine.srv.time + def.durationMs : null,
      lockedAt: null, season: 'S0', schema: engine.srv.schema
    };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  }

  /* ---------- 客户端投影 ---------- */
  BagEngine.prototype.refresh = function () {
    this.cli.view = copy(this.srv.items);
    return ok('REFRESHED', '客户端已按服务端数据刷新');
  };
  BagEngine.prototype.getView = function () { return copy(this.cli.view); };
  BagEngine.prototype.getState = function () {
    return {
      capacity: this.srv.capacity, items: copy(this.cli.view), ground: copy(this.ground),
      mail: copy(this.srv.mail), gold: this.srv.gold, time: this.srv.time,
      online: this.netOnline(), account: this.account, session: this.cli.session,
      version: this.srv.version, effects: this.srv.effects, open: this.cli.open,
      listeners: this.cli.listeners, faults: copy(this.faults), log: copy(this.eventLog.slice(-12))
    };
  };

  /* ---------- 网络 / 会话 ---------- */
  BagEngine.prototype.netOnline = function () { return this._online === undefined ? true : this._online; };
  BagEngine.prototype.setOnline = function (v) {
    this._online = !!v;
    this._log(this._online ? '网络恢复' : '网络断开');
    return ok('NET', this._online ? 'online' : 'offline');
  };
  BagEngine.prototype._gate = function (op) {
    if (!this.netOnline()) {
      this.srv.pending.push(op);
      return fail('OFFLINE', '请求已进入待重放队列，服务端未做任何变更', { pending: true });
    }
    return null;
  };
  BagEngine.prototype.reconnect = function () {
    this._online = true;
    var pending = this.srv.pending.slice();
    this.srv.pending = [];
    var replayed = [];
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      var r = this[p.fn].apply(this, p.args);
      replayed.push({ fn: p.fn, code: r.code });
    }
    this.refresh();
    this._log('重连完成，重放 ' + replayed.length + ' 个请求（幂等去重）');
    return ok('RECONNECTED', '重连完成', { replayed: replayed });
  };
  BagEngine.prototype.createSession = function (id) { this.cli.session = id || 'B'; return this.cli.session; };
  BagEngine.prototype.concurrent = function (fns) {
    this._batch = true;
    var rs = [];
    try { for (var i = 0; i < fns.length; i++) rs.push(fns[i]()); }
    finally { this._batch = false; this._inflight = {}; }
    return rs;
  };

  /* ---------- 时间与账号 ---------- */
  BagEngine.prototype.setServerTime = function (ms) { this.srv.time = ms; return ms; };
  BagEngine.prototype.advanceTime = function (ms) { this.srv.time += ms; this.expireSweep(); return this.srv.time; };
  BagEngine.prototype.setLocalTimeOffset = function (ms) { this.cli.localTimeOffset = ms; return ms; };
  BagEngine.prototype.clientTime = function () { return this.srv.time + this.cli.localTimeOffset; };
  BagEngine.prototype.isExpired = function (it) { return it.expireAt !== null && this.srv.time >= it.expireAt; };
  BagEngine.prototype.expireSweep = function () {
    var n = 0;
    for (var i = 0; i < this.srv.items.length; i++) {
      var it = this.srv.items[i];
      if (it.state === '持有' && this.isExpired(it)) { it.state = '已过期'; n++; }
    }
    return n;
  };
  BagEngine.prototype.setBan = function (v) { this.srv.banned = !!v; return this.srv.banned; };
  BagEngine.prototype.switchAccount = function (id) {
    if (!this.accounts[id]) this.accounts[id] = this._newServer(this.DEF.capacity);
    this.accounts[this.account] = this.srv;
    this.groundByAccount[this.account] = this.ground;
    this.account = id;
    this.srv = this.accounts[id];
    this.ground = this.groundByAccount[id] || [];
    this.cli.view = [];
    this.cli.session = 'A';
    this.refresh();
    this._log('切换账号至 ' + id + '（数据与会话隔离）');
    return ok('ACCOUNT_SWITCHED', '已切换账号', { account: id });
  };

  /* ---------- 容量与拾取 ---------- */
  BagEngine.prototype._findStack = function (itemId) {
    return this.srv.items.filter(function (it) {
      return it.itemId === itemId && it.state === '持有' && it.qty < ITEM_DB[itemId].stack;
    });
  };
  BagEngine.prototype._canInsert = function (itemId, qty) {
    var stack = ITEM_DB[itemId].stack;
    var room = sum(this._findStack(itemId), function (it) { return stack - it.qty; });
    var rest = Math.max(0, qty - room);
    var need = Math.ceil(rest / stack);
    return { can: this.srv.items.length + need <= this.srv.capacity, need: need, room: room };
  };
  BagEngine.prototype._insert = function (itemId, qty, extra) {
    var chk = this._canInsert(itemId, qty);
    if (!chk.can) return fail('BAG_FULL', '背包已满', { remain: qty });
    var left = qty;
    var stacks = this._findStack(itemId);
    for (var i = 0; i < stacks.length && left > 0; i++) {
      var add = Math.min(ITEM_DB[itemId].stack - stacks[i].qty, left);
      stacks[i].qty += add; left -= add;
    }
    while (left > 0) {
      var take = Math.min(ITEM_DB[itemId].stack, left);
      var it = mkItem(this, itemId, take, extra);
      it.slot = this.srv.items.length;
      this.srv.items.push(it);
      left -= take;
    }
    return ok('INSERTED', '入包成功', { inserted: qty });
  };

  BagEngine.prototype.spawnDrop = function (itemId, qty, owner) {
    qty = qty === undefined ? 1 : qty;
    this._dropId += 1;
    var d = { dropId: 'D' + this._dropId, itemId: itemId, qty: qty, owner: owner || this.account };
    this.ground.push(d);
    this._log('地面出现掉落：' + (ITEM_DB[itemId] ? ITEM_DB[itemId].name : itemId) + ' ×' + qty);
    return d.dropId;
  };

  BagEngine.prototype.pickup = function (dropId, opts) {
    var self = this;
    opts = opts || {};
    var opId = opts.opId || (opts.autoOp === false ? this.nextOpId() : this.nextOpId());
    var gated = this._gate({ fn: 'pickup', args: [dropId, opts] });
    if (gated) return gated;
    // 幂等：同一操作键只结算一次
    if (!(this.faults.noIdempotency && this.srv.processed[opId]) && this.srv.processed[opId]) return this.srv.processed[opId];
    var idx = -1;
    for (var i = 0; i < this.ground.length; i++) if (this.ground[i].dropId === dropId) idx = i;
    if (idx < 0) return fail('DROP_NOT_FOUND', '掉落物不存在');
    var d = this.ground[idx];
    var def = ITEM_DB[d.itemId];
    if (!def || def.deprecated) return fail('INVALID_ITEM_ID', '道具 ID 不存在或已下架，已记日志');
    if (!(typeof d.qty === 'number') || !isFinite(d.qty) || d.qty <= 0) return fail('INVALID_QTY', '拾取数量必须为正整数');
    if (d.qty > this.srv.capacity || d.qty > 9999) return fail('QTY_OVER_LIMIT', '单次拾取数量超过容量上限');
    var chk = this._canInsert(d.itemId, d.qty);
    if (!chk.can) {
      if (this.faults.swallowDrop) { this.ground.splice(idx, 1); this._log('缺陷：满包时掉落物被提前删除'); }
      return fail('BAG_FULL', '背包已满，掉落物保留在地面', { remain: d.qty, groundKept: !this.faults.swallowDrop });
    }
    var r = this._insert(d.itemId, d.qty);
    this.ground.splice(idx, 1);
    r.data.opId = opId;
    this.srv.ledger.push({ type: 'pickup', opId: opId, itemId: d.itemId, qty: d.qty, time: this.srv.time, transitions: ['未获得', '持有'] });
    this._log('拾取成功：' + def.name + ' ×' + d.qty + '（op=' + opId + '）');
    this.refresh();
    this.srv.processed[opId] = r;
    return r;
  };

  BagEngine.prototype.pickupBatch = function (dropIds, opts) {
    var results = [];
    for (var i = 0; i < dropIds.length; i++) results.push({ dropId: dropIds[i], result: this.pickup(dropIds[i], opts || {}) });
    this.refresh();
    return ok('BATCH_DONE', '批量拾取结束', {
      success: results.filter(function (x) { return x.result.ok; }).length,
      failed: results.filter(function (x) { return !x.result.ok; }).length,
      results: results
    });
  };

  /* ---------- 发放：邮件 / 商城 / 交易 / 后台推送 ---------- */
  BagEngine.prototype.grant = function (itemId, qty, source, opts) {
    opts = opts || {};
    var def = ITEM_DB[itemId];
    if (!def || def.deprecated) return fail('INVALID_ITEM_ID', '道具 ID 无效');
    if (!(qty > 0)) return fail('INVALID_QTY', '发放数量必须为正');
    var chk = this._canInsert(itemId, qty);
    if (chk.can) {
      var r = this._insert(itemId, qty);
      this.srv.ledger.push({ type: 'grant', source: source, itemId: itemId, qty: qty, time: this.srv.time });
      if (source !== 'push') this.refresh(); // 后台推送刻意不刷新前端（E11）
      return ok('GRANTED', '直接入包', { source: source, inMail: false });
    }
    // 满包
    if (source === 'purchase' && this.faults.purchaseLosesItem) {
      this.srv.ledger.push({ type: 'grant_lost', source: source, itemId: itemId, qty: qty, time: this.srv.time });
      return ok('GRANTED', '', { source: source, inMail: false, silentLost: true });
    }
    if (source === 'mail' || source === 'purchase') {
      this.srv.mail.push({ mailId: 'M' + (this.srv.mail.length + 1), itemId: itemId, qty: qty, reason: '背包已满，邮件补发' });
      this.refresh();
      return ok('GRANT_TO_MAIL', '背包已满，道具通过邮件补发', { source: source, inMail: true });
    }
    return fail('BAG_FULL', '背包已满，发放被拒绝且未扣减来源', { source: source, remain: qty });
  };

  BagEngine.prototype.purchase = function (itemId, qty, opts) {
    opts = opts || {};
    var gated = this._gate({ fn: 'purchase', args: [itemId, qty, opts] });
    if (gated) return gated;
    var def = ITEM_DB[itemId];
    if (!def || def.deprecated) return fail('INVALID_ITEM_ID', '商品不存在');
    var cost = def.price * qty;
    if (this.srv.gold < cost) return fail('NOT_ENOUGH_GOLD', '货币不足，未扣款');
    this.srv.gold -= cost;
    var r = this.grant(itemId, qty, 'purchase', opts);
    r.data.cost = cost;
    r.data.gold = this.srv.gold;
    this._log('商城购买：' + def.name + ' ×' + qty + '，扣款 ' + cost);
    return r;
  };

  BagEngine.prototype.setCapacity = function (n) {
    if (!(n > 0) || n > 1000) return fail('INVALID_CAPACITY', '容量值非法');
    if (n < this.srv.items.length) return fail('SHRINK_BLOCKED', '缩容会使现有道具数超过新上限，已拒绝且不丢弃任何道具', { current: this.srv.items.length, target: n });
    this.srv.capacity = n;
    this.refresh();
    return ok('CAPACITY_SET', '容量已设为 ' + n, { capacity: n });
  };

  /* ---------- 道具操作 ---------- */
  BagEngine.prototype._find = function (uid) {
    for (var i = 0; i < this.srv.items.length; i++) if (this.srv.items[i].uid === uid) return this.srv.items[i];
    return null;
  };
  BagEngine.prototype._viewFind = function (uid) {
    for (var i = 0; i < this.cli.view.length; i++) if (this.cli.view[i].uid === uid) return this.cli.view[i];
    return null;
  };

  BagEngine.prototype.use = function (uid, opts) {
    opts = opts || {};
    var opId = opts.opId || this.nextOpId();
    var gated = this._gate({ fn: 'use', args: [uid, opts] });
    if (gated) return gated;
    if (!this.faults.noIdempotency && this.srv.processed[opId]) return this.srv.processed[opId];
    var key = 'use:' + uid;
    if (this._inflight[key]) return fail('IN_FLIGHT', '同一道具存在处理中的请求，已合并');
    this._inflight[key] = true;
    var finish = (function (self, r) {
      if (!self._batch) delete self._inflight[key];
      return r;
    }).bind(null, this);
    var it = this._find(uid);
    if (!it) return finish(fail('ITEM_NOT_FOUND', '道具不存在'));
    var def = ITEM_DB[it.itemId];
    if (it.state === '已锁定') return finish(fail('LOCKED', '已锁定道具不可使用'));
    if (it.state === '已消耗' || it.state === '使用中') return finish(fail('ILLEGAL_STATE', '已消耗/使用中状态不可再次使用'));
    if (this.isExpired(it) && !this.faults.noExpireCheck) {
      it.state = '已过期';
      this.refresh();
      return finish(fail('EXPIRED', '道具已过期，服务端拒绝使用', { serverTime: this.srv.time }));
    }
    var multiUse = def.uses > 1;
    if (it.qty <= 0 || (multiUse && it.uses <= 0)) return finish(fail('USES_EXHAUSTED', '剩余次数为 0，不可使用'));
    if (this.DEF.level < def.level) return finish(fail('LEVEL_LOW', '等级不足'));
    if (def.job && this.DEF.job !== def.job) return finish(fail('JOB_MISMATCH', '职业不符'));
    var cd = this.srv.cooldowns[it.itemId] || 0;
    if (this.srv.time < cd) return finish(fail('COOLDOWN', '冷却中，剩余 ' + (cd - this.srv.time) + 'ms'));
    if (def.cooldownMs) this.srv.cooldowns[it.itemId] = this.srv.time + def.cooldownMs;
    // 合法迁移链：持有 → 使用中 → 已消耗
    it.state = '使用中';
    it.uses -= 1;
    if (multiUse) { if (it.uses <= 0) it.qty -= 1; }
    else it.qty -= 1;
    this.srv.effects += 1;
    if (it.qty <= 0 || (multiUse && it.uses <= 0)) {
      it.state = '已消耗';
      this.srv.recycle.push({ uid: it.uid, itemId: it.itemId, qty: 1, reason: 'consumed' });
      this.srv.items.splice(this.srv.items.indexOf(it), 1);
    } else {
      it.state = '持有';
    }
    this.srv.ledger.push({ type: 'use', opId: opId, uid: uid, itemId: it.itemId, time: this.srv.time,
      transitions: ['持有', '使用中', '已消耗'], effectNo: this.srv.effects });
    this._log('使用道具：' + def.name + '，效果结算第 ' + this.srv.effects + ' 次（op=' + opId + '）');
    this.refresh();
    var r = ok('USED', '使用成功', { opId: opId, effects: this.srv.effects, remainingUses: it.uses });
    this.srv.processed[opId] = r;
    return finish(r);
  };

  BagEngine.prototype.discard = function (uid, opts) {
    opts = opts || {};
    var gated = this._gate({ fn: 'discard', args: [uid, opts] });
    if (gated) return gated;
    if (opts.confirm === false) return ok('CANCELLED', '用户取消丢弃，数据未变化', { changed: false });
    var qty = opts.qty === undefined ? 1 : opts.qty;
    if (!(qty > 0)) return fail('INVALID_QTY', '丢弃数量必须为正');
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    if (it.state === '已锁定') return fail('LOCKED', '已锁定道具不可丢弃');
    if (qty > it.qty) return fail('QTY_EXCEED', '丢弃数量大于持有数量');
    it.qty -= qty;
    if (it.qty <= 0) this.srv.items.splice(this.srv.items.indexOf(it), 1);
    this.srv.recycle.push({ uid: uid, itemId: it.itemId, qty: qty, reason: 'discarded' });
    this.srv.ledger.push({ type: 'discard', uid: uid, qty: qty, time: this.srv.time });
    this.refresh();
    return ok('DISCARDED', '丢弃成功', { qty: qty });
  };

  BagEngine.prototype.discardBatch = function (uids, opts) {
    var dropped = [], skipped = [];
    for (var i = 0; i < uids.length; i++) {
      var it = this._find(uids[i]);
      if (!it) { skipped.push({ uid: uids[i], reason: 'not found' }); continue; }
      if (it.state === '已锁定') { skipped.push({ uid: uids[i], reason: 'locked' }); continue; }
      this.discard(uids[i], opts);
      dropped.push(uids[i]);
    }
    return ok('BATCH_DISCARDED', '仅未锁定道具被丢弃；已跳过锁定道具', { dropped: dropped, skipped: skipped });
  };

  BagEngine.prototype.lock = function (uid) {
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    if (it.state === '已锁定') return fail('ALREADY_LOCKED', '已是锁定状态');
    if (it.state !== '持有') return fail('ILLEGAL_STATE', '仅持有状态可锁定');
    it.state = '已锁定'; it.lockedAt = this.srv.time;
    this.srv.ledger.push({ type: 'lock', uid: uid, time: this.srv.time, transitions: ['持有', '已锁定'] });
    this.refresh();
    return ok('LOCKED', '已锁定');
  };
  BagEngine.prototype.unlock = function (uid) {
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    if (it.state !== '已锁定') return fail('ILLEGAL_STATE', '仅已锁定状态可解锁');
    it.state = '持有';
    this.srv.ledger.push({ type: 'unlock', uid: uid, time: this.srv.time, transitions: ['已锁定', '持有'] });
    this.refresh();
    return ok('UNLOCKED', '已解锁');
  };

  BagEngine.prototype.split = function (uid, n) {
    if (!(n > 0)) return fail('INVALID_QTY', '拆分数量必须为正');
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    if (n >= it.qty) return fail('SPLIT_INVALID', '拆分数量必须小于原堆数量，不产生空堆');
    if (this.srv.items.length >= this.srv.capacity) return fail('BAG_FULL', '无空格可存放新堆');
    var def = ITEM_DB[it.itemId];
    if (def.stack <= 1) return fail('NOT_STACKABLE', '该道具不可堆叠');
    it.qty -= n;
    var nw = mkItem(this, it.itemId, n);
    nw.slot = this.srv.items.length;
    this.srv.items.push(nw);
    this.refresh();
    return ok('SPLIT', '拆分成功', { newUid: nw.uid, left: it.qty, right: n });
  };

  BagEngine.prototype.move = function (uid, slot) {
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.srv.capacity) return fail('ILLEGAL_SLOT', '目标格子非法，道具保持原位');
    var occupied = this.srv.items.some(function (x) { return x.uid !== uid && x.slot === slot; });
    if (occupied) return fail('SLOT_OCCUPIED', '目标格子已被占用，道具保持原位');
    it.slot = slot;
    this.refresh();
    return ok('MOVED', '拖放成功', { slot: slot });
  };

  BagEngine.prototype.sell = function (uid, opts) {
    opts = opts || {};
    var qty = opts.qty || 1;
    var it = this._find(uid);
    if (!it) return fail('ITEM_NOT_FOUND', '道具不存在');
    var def = ITEM_DB[it.itemId];
    if (it.state === '已锁定') return fail('LOCKED', '锁定道具不可出售');
    if (!def.tradeable || def.bound) return fail('NOT_TRADEABLE', '绑定/不可交易道具不可出售');
    if (qty > it.qty) return fail('QTY_EXCEED', '出售数量大于持有数量');
    var gain = def.price * qty;
    if (this.srv.gold + gain > this.DEF.goldCap) return fail('GOLD_OVER_CAP', '出售后金币将超过持有上限，已拦截且金币不变');
    it.qty -= qty;
    if (it.qty <= 0) this.srv.items.splice(this.srv.items.indexOf(it), 1);
    this.srv.gold += gain;
    this.srv.lastSold = { itemId: it.itemId, qty: qty, price: gain, uid: uid };
    this.srv.ledger.push({ type: 'sell', uid: uid, gain: gain, time: this.srv.time });
    this.refresh();
    return ok('SOLD', '出售成功', { gain: gain, gold: this.srv.gold });
  };
  BagEngine.prototype.buyback = function () {
    if (!this.srv.lastSold) return fail('NOTHING_TO_BUYBACK', '无可回购记录');
    var s = this.srv.lastSold;
    if (this.srv.gold < s.price) return fail('NOT_ENOUGH_GOLD', '货币不足');
    var r = this._insert(s.itemId, s.qty);
    if (!r.ok) return r;
    this.srv.gold -= s.price;
    this.srv.lastSold = null;
    this.refresh();
    return ok('BUYBACK', '回购成功', { gold: this.srv.gold });
  };

  /* ---------- 整理：判定表 R1-R8 ---------- */
  BagEngine.prototype.sortRules = function () {
    var items = this.srv.items;
    var hasEmpty = items.length < this.srv.capacity;
    var groups = {}, mergeable = {};
    var hasLocked = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.state === '已锁定') { hasLocked = true; continue; }
      var stack = ITEM_DB[it.itemId].stack;
      if (stack > 1 && it.state === '持有') {
        groups[it.itemId] = (groups[it.itemId] || 0) + 1;
        if (it.qty < stack) mergeable[it.itemId] = true; // 至少存在一堆未满
      }
    }
    var hasStackable = Object.keys(groups).some(function (k) { return groups[k] >= 2 && !!mergeable[k]; });
    var rule = (hasEmpty ? '1' : '0') + (hasStackable ? '1' : '0') + (hasLocked ? '1' : '0');
    var map = { '100': 'R1', '101': 'R2', '110': 'R3', '111': 'R4', '000': 'R5', '001': 'R6', '010': 'R7', '011': 'R8' };
    return { rule: map[rule], hasEmpty: hasEmpty, hasStackable: hasStackable, hasLocked: hasLocked };
  };

  BagEngine.prototype.sort = function (opts) {
    opts = opts || {};
    var gated = this._gate({ fn: 'sort', args: [opts] });
    if (gated) return gated;
    var flags = this.sortRules();
    var items = this.srv.items;
    var merged = 0, moved = 0;
    if (flags.rule === 'R5' || flags.rule === 'R6') {
      return fail('NO_SORTABLE', flags.rule === 'R6' ? '无可整理内容，锁定道具保持原位' : '无可整理内容，按钮置灰', { rule: flags.rule });
    }
    // 合并同类（锁定道具永不参与）
    if (flags.hasStackable) {
      var buckets = {};
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.state !== '持有') continue;
        var k = it.itemId;
        if (!buckets[k]) buckets[k] = [];
        buckets[k].push(it);
      }
      var remove = [];
      for (var key in buckets) {
        var arr = buckets[key];
        if (arr.length < 2) continue;
        var target = arr[0];
        for (var j = 1; j < arr.length; j++) {
          var space = ITEM_DB[key].stack - target.qty;
          if (space <= 0) { target = arr[j]; continue; }
          var take = Math.min(space, arr[j].qty);
          target.qty += take; arr[j].qty -= take;
          merged += take;
          if (arr[j].qty <= 0) remove.push(arr[j]);
        }
      }
      for (var r = 0; r < remove.length; r++) {
        var pos = items.indexOf(remove[r]);
        if (pos >= 0) items.splice(pos, 1);
      }
    }
    // 紧凑排列：锁定道具保持原格位
    var locked = items.filter(function (x) { return x.state === '已锁定'; });
    var normal = items.filter(function (x) { return x.state !== '已锁定'; });
    var before = {};
    for (var b = 0; b < locked.length; b++) before[locked[b].uid] = locked[b].slot;
    if (flags.hasEmpty) {
      var used = {};
      for (var l = 0; l < locked.length; l++) used[locked[l].slot] = true;
      var cursor = 0;
      for (var n = 0; n < normal.length; n++) {
        while (used[cursor]) cursor++;
        if (normal[n].slot !== cursor) moved++;
        normal[n].slot = cursor;
        cursor++;
      }
    }
    var ordered = locked.concat(normal).sort(function (a, b2) { return a.slot - b2.slot; });
    if (this.faults.sortMovesLocked) {
      for (var q = 0; q < ordered.length; q++) if (ordered[q].state === '已锁定') ordered[q].slot = this.srv.capacity - 1 - q;
      ordered.sort(function (a, b2) { return a.slot - b2.slot; });
    }
    this.srv.items = ordered;
    var lockedMoved = 0;
    for (var p = 0; p < locked.length; p++) if (before[locked[p].uid] !== locked[p].slot) lockedMoved++;
    this.srv.ledger.push({ type: 'sort', rule: flags.rule, merged: merged, moved: moved, time: this.srv.time });
    this.refresh();
    return ok('SORTED', '整理完成（' + flags.rule + '）', {
      rule: flags.rule, merged: merged, moved: moved, lockedMoved: lockedMoved
    });
  };

  /* ---------- 持久化 / 版本 / 回档 ---------- */
  BagEngine.prototype.snapshot = function () {
    return copy({ capacity: this.srv.capacity, items: this.srv.items, gold: this.srv.gold,
      time: this.srv.time, effects: this.srv.effects, mail: this.srv.mail, version: this.srv.version });
  };
  BagEngine.prototype.restore = function (snap) {
    this.srv.capacity = snap.capacity;
    this.srv.items = copy(snap.items);
    this.srv.gold = snap.gold;
    this.srv.time = snap.time;
    this.srv.effects = snap.effects;
    this.srv.mail = copy(snap.mail || []);
    this.refresh();
    return ok('RESTORED', '已从快照恢复');
  };
  BagEngine.prototype.reloadFromServer = function () {
    this.cli.view = [];
    this.cli.open = false;
    this.cli.listeners = 0;
    this.refresh();
    return ok('RELOADED', '已按服务端权威数据重建客户端状态');
  };
  BagEngine.prototype.hotUpdate = function (version) {
    var added = 0;
    for (var i = 0; i < this.srv.items.length; i++) {
      var it = this.srv.items[i];
      if (it.season === undefined) { it.season = 'S0'; added++; }
      if (it.schema === undefined) { it.schema = this.srv.schema; added++; }
    }
    this.srv.version = version || '2.4.2';
    this.refresh();
    return ok('HOT_UPDATED', '热更新完成', { version: this.srv.version, fieldsAdded: added });
  };
  BagEngine.prototype.loadLegacySave = function (legacy) {
    // 老版本存档：缺 season / schema / slot 等新字段
    this.srv.items = (legacy.items || []).map(function (raw) {
      return { uid: raw.uid, itemId: raw.itemId, qty: raw.qty, state: raw.state || '持有',
        uses: raw.uses === undefined ? ITEM_DB[raw.itemId].uses : raw.uses,
        expireAt: raw.expireAt === undefined ? null : raw.expireAt,
        slot: raw.slot === undefined ? 0 : raw.slot,
        season: 'S0', schema: 1 };
    });
    this.srv.gold = legacy.gold || 0;
    this.srv.version = '2.4.2';
    this.refresh();
    return ok('LEGACY_LOADED', '旧存档兼容加载完成', { count: this.srv.items.length });
  };
  BagEngine.prototype.transferServer = function (id) {
    var before = this.srv.items.map(function (x) { return x.uid + ':' + x.qty; }).join(',');
    this.srv.serverId = id;
    this.srv.items = copy(this.srv.items);
    this.refresh();
    return ok('TRANSFERRED', '跨服转区完成', { serverId: id, unchanged: before === this.srv.items.map(function (x) { return x.uid + ':' + x.qty; }).join(',') });
  };
  BagEngine.prototype.rollback = function (snap) {
    var r = this.restore(snap);
    r.code = 'ROLLED_BACK';
    r.msg = '服务器回档完成，道具状态以快照为准';
    return r;
  };

  /* ---------- UI 辅助（可逻辑验证部分） ---------- */
  BagEngine.prototype.openBag = function () { this.cli.open = true; this.cli.listeners += 1; this.refresh(); return this.cli.listeners; };
  BagEngine.prototype.closeBag = function () { this.cli.open = false; this.cli.listeners -= 1; return this.cli.listeners; };
  BagEngine.prototype.gridLayout = function (widthPx, opts) {
    opts = opts || {};
    var scale = opts.fontScale || 1;
    var cell = Math.round(40 * scale), gap = 4, pad = 12;
    var cols = Math.floor((widthPx - pad * 2 + gap) / (cell + gap));
    if (this.faults.badLayout && widthPx <= 720) cols += 1; // BUG-05 仅特定小屏分辨率出现
    var content = pad * 2 + cols * cell + (cols - 1) * gap;
    return { cols: cols, cell: cell, contentWidth: content, viewport: widthPx,
      overflow: Math.max(0, content - widthPx), lastColumnClipped: content > widthPx, fontScale: scale };
  };
  BagEngine.prototype.formatQty = function (n) {
    if (!(n > 0)) return '';
    if (n > 999999) return '999999+';
    return String(n);
  };
  BagEngine.prototype.truncateName = function (s, maxChars) {
    var arr = Array.from(String(s));
    return arr.length <= maxChars ? s : arr.slice(0, maxChars).join('') + '…';
  };
  BagEngine.prototype.escapeHtml = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  BagEngine.prototype.iconFallback = function (url) {
    if (url) return { placeholder: false, src: url };
    return { placeholder: true, src: 'builtin://icon_missing' };
  };
  BagEngine.prototype.contrastRatio = function (hex1, hex2) {
    function lum(h) {
      var v = h.replace('#', '');
      if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
      var c = [0, 2, 4].map(function (i) { return parseInt(v.slice(i, i + 2), 16) / 255; });
      var f = c.map(function (x) { return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }
    var a = lum(hex1), b = lum(hex2);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  BagEngine.prototype.bagEntrance = function () {
    return { visible: true, blocked: !!this.tutorial, reason: this.tutorial ? '新手引导期间入口按需求锁定' : '' };
  };
  BagEngine.prototype.setTutorial = function (v) { this.tutorial = !!v; return this.tutorial; };
  BagEngine.prototype.countdown = function (uid) {
    var it = this._find(uid);
    if (!it || it.expireAt === null) return null;
    return Math.max(0, it.expireAt - this.srv.time); // 服务器时间剩余，永不为负
  };
  BagEngine.prototype.recoverFromRecycle = function (uid) {
    var idx = -1;
    for (var i = 0; i < this.srv.recycle.length; i++) if (this.srv.recycle[i].uid === uid) idx = i;
    if (idx < 0) return fail('NOT_RECOVERABLE', '找回记录不存在');
    var rec = this.srv.recycle[idx];
    var r = this._insert(rec.itemId, rec.qty || 1);
    if (!r.ok) return r;
    this.srv.recycle.splice(idx, 1);
    this.refresh();
    return ok('RECOVERED', '丢弃道具已找回', { uid: uid });
  };
  BagEngine.prototype.displayName = function (raw) {
    // 用于 F09：背包 / 交易行 / 排行榜三处显示一致
    var safe = this.escapeHtml(this.truncateName(raw, 24));
    return { bag: safe, market: safe, rank: safe };
  };

  BagEngine.prototype.fill = function (itemId, count) {
    // 测试辅助：直接构造满包等前置状态（绕过掉落链路）
    for (var i = 0; i < count; i++) {
      var it = mkItem(this, itemId || 'I1009', 1);
      it.slot = this.srv.items.length;
      this.srv.items.push(it);
    }
    this.refresh();
    return this.srv.items.length;
  };
  BagEngine.prototype.addItem = function (itemId, qty, extra) {
    var it = mkItem(this, itemId, qty, extra);
    it.slot = this.srv.items.length;
    this.srv.items.push(it);
    this.refresh();
    return it;
  };

  return {
    BagEngine: BagEngine, ITEM_DB: ITEM_DB, STATES: STATES, FAULT_KEYS: FAULT_KEYS, T0: T0,
    ok: ok, fail: fail, copy: copy
  };
});

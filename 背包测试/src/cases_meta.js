// 由 extract_meta.py 从源学习包自动生成，请勿手工编辑。
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CasesMeta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return [
  {
    "id": "A01",
    "group": "A 容量与拾取",
    "title": "空背包首次拾取单个道具",
    "method": "边界值·零点",
    "priority": "P1"
  },
  {
    "id": "A02",
    "group": "A 容量与拾取",
    "title": "背包仅 1 个道具时拾取",
    "method": "边界值·内点",
    "priority": "P2"
  },
  {
    "id": "A03",
    "group": "A 容量与拾取",
    "title": "背包 199 格时拾取第 200 个",
    "method": "边界值·内点",
    "priority": "P1"
  },
  {
    "id": "A04",
    "group": "A 容量与拾取",
    "title": "背包 200 格满时拾取第 201 个",
    "method": "边界值·上点",
    "priority": "P0"
  },
  {
    "id": "A05",
    "group": "A 容量与拾取",
    "title": "背包满时批量拾取（部分可放入）",
    "method": "边界值+场景法",
    "priority": "P1"
  },
  {
    "id": "A06",
    "group": "A 容量与拾取",
    "title": "背包满时系统邮件发放道具",
    "method": "边界值",
    "priority": "P0"
  },
  {
    "id": "A07",
    "group": "A 容量与拾取",
    "title": "背包满时商城购买道具",
    "method": "边界值",
    "priority": "P0"
  },
  {
    "id": "A08",
    "group": "A 容量与拾取",
    "title": "扩容后立即再次拾取",
    "method": "状态迁移",
    "priority": "P1"
  },
  {
    "id": "A09",
    "group": "A 容量与拾取",
    "title": "缩容后道具数量超过新上限",
    "method": "状态迁移·非法",
    "priority": "P0"
  },
  {
    "id": "A10",
    "group": "A 容量与拾取",
    "title": "单次拾取数量超过上限（如 300 个）",
    "method": "边界值·离点",
    "priority": "P1"
  },
  {
    "id": "A11",
    "group": "A 容量与拾取",
    "title": "拾取数量为 0 的道具堆",
    "method": "等价类·无效",
    "priority": "P2"
  },
  {
    "id": "A12",
    "group": "A 容量与拾取",
    "title": "拾取数量为负数的异常数据",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "A13",
    "group": "A 容量与拾取",
    "title": "拾取不存在的道具 ID",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "A14",
    "group": "A 容量与拾取",
    "title": "拾取已下架或已过期的道具 ID",
    "method": "等价类·无效",
    "priority": "P2"
  },
  {
    "id": "A15",
    "group": "A 容量与拾取",
    "title": "快速连续点击拾取 10 次",
    "method": "场景法·重复",
    "priority": "P1"
  },
  {
    "id": "A16",
    "group": "A 容量与拾取",
    "title": "拾取过程中断网",
    "method": "场景法·异常",
    "priority": "P0"
  },
  {
    "id": "A17",
    "group": "A 容量与拾取",
    "title": "拾取成功后杀进程重进",
    "method": "场景法·异常",
    "priority": "P0"
  },
  {
    "id": "A18",
    "group": "A 容量与拾取",
    "title": "拾取过程中切换账号",
    "method": "场景法·异常",
    "priority": "P1"
  },
  {
    "id": "B01",
    "group": "B 道具操作",
    "title": "使用普通消耗品",
    "method": "场景法·基本流",
    "priority": "P0"
  },
  {
    "id": "B02",
    "group": "B 道具操作",
    "title": "使用剩余次数为 1 的道具",
    "method": "边界值",
    "priority": "P1"
  },
  {
    "id": "B03",
    "group": "B 道具操作",
    "title": "使用剩余次数为 0 的道具",
    "method": "边界值·零点",
    "priority": "P1"
  },
  {
    "id": "B04",
    "group": "B 道具操作",
    "title": "连续使用同道具直至耗尽",
    "method": "边界值",
    "priority": "P1"
  },
  {
    "id": "B05",
    "group": "B 道具操作",
    "title": "使用后道具是否正确消失",
    "method": "功能",
    "priority": "P0"
  },
  {
    "id": "B06",
    "group": "B 道具操作",
    "title": "等级不足时使用有等级限制的道具",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "B07",
    "group": "B 道具操作",
    "title": "职业不符时使用限定职业道具",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "B08",
    "group": "B 道具操作",
    "title": "冷却期间再次使用",
    "method": "状态迁移·非法",
    "priority": "P1"
  },
  {
    "id": "B09",
    "group": "B 道具操作",
    "title": "丢弃道具并确认",
    "method": "场景法",
    "priority": "P1"
  },
  {
    "id": "B10",
    "group": "B 道具操作",
    "title": "丢弃时点击取消",
    "method": "场景法·备选流",
    "priority": "P2"
  },
  {
    "id": "B11",
    "group": "B 道具操作",
    "title": "丢弃已锁定道具",
    "method": "判定表",
    "priority": "P0"
  },
  {
    "id": "B12",
    "group": "B 道具操作",
    "title": "丢弃数量为 0",
    "method": "等价类·无效",
    "priority": "P2"
  },
  {
    "id": "B13",
    "group": "B 道具操作",
    "title": "批量丢弃中混有锁定道具",
    "method": "判定表",
    "priority": "P0"
  },
  {
    "id": "B14",
    "group": "B 道具操作",
    "title": "出售道具后金币正确增加",
    "method": "功能",
    "priority": "P0"
  },
  {
    "id": "B15",
    "group": "B 道具操作",
    "title": "出售后金币将超过持有上限",
    "method": "边界值",
    "priority": "P0"
  },
  {
    "id": "B16",
    "group": "B 道具操作",
    "title": "出售已绑定或不可交易道具",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "B17",
    "group": "B 道具操作",
    "title": "出售后立即回购",
    "method": "场景法",
    "priority": "P2"
  },
  {
    "id": "B18",
    "group": "B 道具操作",
    "title": "堆叠已达上限时拾取同类道具",
    "method": "边界值",
    "priority": "P1"
  },
  {
    "id": "B19",
    "group": "B 道具操作",
    "title": "将堆叠道具拆分为两堆",
    "method": "功能",
    "priority": "P2"
  },
  {
    "id": "B20",
    "group": "B 道具操作",
    "title": "拆分数量等于总数量",
    "method": "边界值",
    "priority": "P2"
  },
  {
    "id": "B21",
    "group": "B 道具操作",
    "title": "拆分数量大于总数量",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "B22",
    "group": "B 道具操作",
    "title": "拖放道具到非法格子",
    "method": "状态迁移·非法",
    "priority": "P2"
  },
  {
    "id": "C01",
    "group": "C 状态与迁移",
    "title": "未获得 → 持有（拾取）",
    "method": "状态迁移·合法",
    "priority": "P0"
  },
  {
    "id": "C02",
    "group": "C 状态与迁移",
    "title": "持有 → 使用中（使用）",
    "method": "状态迁移·合法",
    "priority": "P0"
  },
  {
    "id": "C03",
    "group": "C 状态与迁移",
    "title": "使用中 → 已消耗",
    "method": "状态迁移·合法",
    "priority": "P0"
  },
  {
    "id": "C04",
    "group": "C 状态与迁移",
    "title": "持有 → 已过期（限时到期）",
    "method": "状态迁移·合法",
    "priority": "P1"
  },
  {
    "id": "C05",
    "group": "C 状态与迁移",
    "title": "持有 → 已锁定",
    "method": "状态迁移·合法",
    "priority": "P1"
  },
  {
    "id": "C06",
    "group": "C 状态与迁移",
    "title": "已锁定 → 持有（解锁）",
    "method": "状态迁移·合法",
    "priority": "P1"
  },
  {
    "id": "C07",
    "group": "C 状态与迁移",
    "title": "已消耗 → 持有（非法回退）",
    "method": "状态迁移·非法",
    "priority": "P0"
  },
  {
    "id": "C08",
    "group": "C 状态与迁移",
    "title": "已过期 → 使用中（非法使用）",
    "method": "状态迁移·非法",
    "priority": "P0"
  },
  {
    "id": "C09",
    "group": "C 状态与迁移",
    "title": "已锁定 → 已消耗（非法使用）",
    "method": "状态迁移·非法",
    "priority": "P0"
  },
  {
    "id": "C10",
    "group": "C 状态与迁移",
    "title": "跨天 00:00:00 限时道具到期",
    "method": "边界值·时间",
    "priority": "P0"
  },
  {
    "id": "C11",
    "group": "C 状态与迁移",
    "title": "23:59:59 使用限时道具",
    "method": "边界值·时间",
    "priority": "P1"
  },
  {
    "id": "C12",
    "group": "C 状态与迁移",
    "title": "服务器时间与本地时间不一致",
    "method": "边界值",
    "priority": "P0"
  },
  {
    "id": "C13",
    "group": "C 状态与迁移",
    "title": "切后台 5 分钟后返回",
    "method": "场景法",
    "priority": "P1"
  },
  {
    "id": "C14",
    "group": "C 状态与迁移",
    "title": "断线重连后道具状态一致",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "C15",
    "group": "C 状态与迁移",
    "title": "多端同时登录操作同一道具",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "C16",
    "group": "C 状态与迁移",
    "title": "重进游戏后状态恢复",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "D01",
    "group": "D 判定表：整理规则",
    "title": "有空格 + 无可堆叠 + 无锁定",
    "method": "判定表 R1",
    "priority": "P2"
  },
  {
    "id": "D02",
    "group": "D 判定表：整理规则",
    "title": "有空格 + 无可堆叠 + 有锁定",
    "method": "判定表 R2",
    "priority": "P1"
  },
  {
    "id": "D03",
    "group": "D 判定表：整理规则",
    "title": "有空格 + 有可堆叠 + 无锁定",
    "method": "判定表 R3",
    "priority": "P1"
  },
  {
    "id": "D04",
    "group": "D 判定表：整理规则",
    "title": "有空格 + 有可堆叠 + 有锁定",
    "method": "判定表 R4",
    "priority": "P0"
  },
  {
    "id": "D05",
    "group": "D 判定表：整理规则",
    "title": "无空格 + 无可堆叠 + 无锁定",
    "method": "判定表 R5",
    "priority": "P2"
  },
  {
    "id": "D06",
    "group": "D 判定表：整理规则",
    "title": "无空格 + 无可堆叠 + 有锁定",
    "method": "判定表 R6",
    "priority": "P1"
  },
  {
    "id": "D07",
    "group": "D 判定表：整理规则",
    "title": "无空格 + 有可堆叠 + 无锁定",
    "method": "判定表 R7",
    "priority": "P1"
  },
  {
    "id": "D08",
    "group": "D 判定表：整理规则",
    "title": "无空格 + 有可堆叠 + 有锁定",
    "method": "判定表 R8",
    "priority": "P0"
  },
  {
    "id": "D09",
    "group": "D 判定表：整理规则",
    "title": "全部为锁定道具时整理",
    "method": "判定表·边界",
    "priority": "P1"
  },
  {
    "id": "D10",
    "group": "D 判定表：整理规则",
    "title": "全部为堆叠已满道具时整理",
    "method": "判定表·边界",
    "priority": "P1"
  },
  {
    "id": "D11",
    "group": "D 判定表：整理规则",
    "title": "整理过程中断网",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "D12",
    "group": "D 判定表：整理规则",
    "title": "整理前后道具总数与 ID 不变",
    "method": "场景法·校验",
    "priority": "P0"
  },
  {
    "id": "E01",
    "group": "E 场景法：完整链路",
    "title": "基本流：拾取→查看→使用→消耗",
    "method": "场景法·基本流",
    "priority": "P0"
  },
  {
    "id": "E02",
    "group": "E 场景法：完整链路",
    "title": "拾取→丢弃→找回",
    "method": "场景法·备选流",
    "priority": "P2"
  },
  {
    "id": "E03",
    "group": "E 场景法：完整链路",
    "title": "拾取→锁定→批量整理",
    "method": "场景法",
    "priority": "P1"
  },
  {
    "id": "E04",
    "group": "E 场景法：完整链路",
    "title": "商城购买→背包已满→邮件补发",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E05",
    "group": "E 场景法：完整链路",
    "title": "副本掉落→自动拾取→满包提示",
    "method": "场景法",
    "priority": "P1"
  },
  {
    "id": "E06",
    "group": "E 场景法：完整链路",
    "title": "交易接收→到账→状态刷新",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E07",
    "group": "E 场景法：完整链路",
    "title": "使用过程中断网",
    "method": "场景法·异常",
    "priority": "P0"
  },
  {
    "id": "E08",
    "group": "E 场景法：完整链路",
    "title": "使用过程中杀进程",
    "method": "场景法·异常",
    "priority": "P0"
  },
  {
    "id": "E09",
    "group": "E 场景法：完整链路",
    "title": "使用回调重复推送",
    "method": "场景法·幂等",
    "priority": "P0"
  },
  {
    "id": "E10",
    "group": "E 场景法：完整链路",
    "title": "弱网下重复点击使用",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E11",
    "group": "E 场景法：完整链路",
    "title": "后台推送道具时前台无刷新",
    "method": "场景法",
    "priority": "P1"
  },
  {
    "id": "E12",
    "group": "E 场景法：完整链路",
    "title": "热更新后背包数据兼容",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E13",
    "group": "E 场景法：完整链路",
    "title": "老版本存档在新版本打开",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E14",
    "group": "E 场景法：完整链路",
    "title": "跨服转区后道具保留",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "E15",
    "group": "E 场景法：完整链路",
    "title": "账号封禁期间道具到期",
    "method": "场景法",
    "priority": "P2"
  },
  {
    "id": "E16",
    "group": "E 场景法：完整链路",
    "title": "服务器回档后道具状态",
    "method": "场景法",
    "priority": "P0"
  },
  {
    "id": "F01",
    "group": "F 兼容、性能与界面",
    "title": "小屏幕分辨率下背包布局",
    "method": "兼容性",
    "priority": "P2"
  },
  {
    "id": "F02",
    "group": "F 兼容、性能与界面",
    "title": "平板横竖屏切换",
    "method": "兼容性",
    "priority": "P2"
  },
  {
    "id": "F03",
    "group": "F 兼容、性能与界面",
    "title": "折叠屏展开与折叠",
    "method": "兼容性",
    "priority": "P2"
  },
  {
    "id": "F04",
    "group": "F 兼容、性能与界面",
    "title": "低端机打开 200 格背包耗时",
    "method": "性能",
    "priority": "P1"
  },
  {
    "id": "F05",
    "group": "F 兼容、性能与界面",
    "title": "连续开关背包 50 次内存增长",
    "method": "性能",
    "priority": "P1"
  },
  {
    "id": "F06",
    "group": "F 兼容、性能与界面",
    "title": "背包快速滚动帧率",
    "method": "性能",
    "priority": "P2"
  },
  {
    "id": "F07",
    "group": "F 兼容、性能与界面",
    "title": "道具图标加载失败的占位",
    "method": "功能",
    "priority": "P2"
  },
  {
    "id": "F08",
    "group": "F 兼容、性能与界面",
    "title": "道具名称超长时的显示",
    "method": "边界值",
    "priority": "P2"
  },
  {
    "id": "F09",
    "group": "F 兼容、性能与界面",
    "title": "道具名称含特殊字符",
    "method": "等价类·无效",
    "priority": "P1"
  },
  {
    "id": "F10",
    "group": "F 兼容、性能与界面",
    "title": "多语言下名称截断",
    "method": "本地化",
    "priority": "P2"
  },
  {
    "id": "F11",
    "group": "F 兼容、性能与界面",
    "title": "数量超过显示上限（999999+）",
    "method": "边界值",
    "priority": "P1"
  },
  {
    "id": "F12",
    "group": "F 兼容、性能与界面",
    "title": "数量为 0 时不显示角标",
    "method": "边界值",
    "priority": "P2"
  },
  {
    "id": "F13",
    "group": "F 兼容、性能与界面",
    "title": "使用时的音效与震动反馈",
    "method": "UI",
    "priority": "P3"
  },
  {
    "id": "F14",
    "group": "F 兼容、性能与界面",
    "title": "新手引导期间背包入口",
    "method": "场景法",
    "priority": "P2"
  },
  {
    "id": "F15",
    "group": "F 兼容、性能与界面",
    "title": "无障碍与大字体模式",
    "method": "兼容性",
    "priority": "P3"
  },
  {
    "id": "F16",
    "group": "F 兼容、性能与界面",
    "title": "深色模式下图标对比度",
    "method": "兼容性",
    "priority": "P3"
  }
];
});

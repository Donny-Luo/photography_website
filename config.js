// ==================== 功能开关 ====================
// 付费订阅功能总开关：
//   false = 关闭（订阅页、订阅接口、付费门控、前端订阅入口全部停用；付费作品转为免费可见）
//   true  = 开启（恢复完整付费订阅流程）
//
// 想重新开启时，只需把下面的值改成 true 即可（相关代码均未删除）。
const SUBSCRIPTION_ENABLED = false;

module.exports = { SUBSCRIPTION_ENABLED };

# fgame 原型 v0.1 验收记录

## 范围

当前实现是《突然成为百亿富二代》第一章垂直切片，用于验证状态模型、确定性规则、延迟事件、条件随机事件、多个阶段性结果、IndexedDB 存档和 PWA 离线壳。

它不是完整 8–10 章剧情，也不是已完成真实设备验收的发布版。

## 自动化验收

| 验收项 | 证据 / 命令 | 当前状态 |
|---|---|---|
| 事件 ID 与调度引用校验 | validateStory + story JSON | CI 待运行 |
| 条件 AST（all/any/not） | npm run test | CI 待运行 |
| 同 seed + 同选择序列复现 | replayChoices 测试 | CI 待运行 |
| 不同能力导致不同结果 | take_over 情境测试 | CI 待运行 |
| 延迟事件先于下一主线 | audit_findings 测试 | CI 待运行 |
| 不满足条件的选项隐藏 | choice requires 测试 | CI 待运行 |
| 条件随机事件 | random event 测试 | CI 待运行 |
| 结局与兜底 | ending 独立路径测试 | CI 待运行 |
| 类型检查 | npm run typecheck | CI 待运行 |
| 生产构建 | npm run build | CI 待运行 |
| 生产界面不暴露卦爻术语 | 文案测试 | CI 待运行 |

## 设备验收（尚未执行）

| 设备 / 场景 | 验收内容 | 当前状态 |
|---|---|---|
| iPhone Safari | 首次加载、添加到主屏幕、独立窗口显示 | MISSING |
| iPhone 离线 | 首次成功加载后关闭网络，再次启动应用 | MISSING |
| Android Chrome | 首次加载、安装/添加桌面、屏幕适配 | MISSING |
| Android 离线 | 断网启动、选择存档恢复 | MISSING |
| 存档 | 刷新、关闭重开、继续游戏 | MISSING |
| 小屏与大屏 | 文字换行、按钮触控面积、安全区 | MISSING |

## 已知边界

- 浏览器首次加载或 PWA 首次安装需要网络；Service Worker 激活并缓存资源后，才可验证离线启动。
- 当前 PWA 图标为 SVG 占位图，iOS 桌面图标仍需实体设备核验；如显示不符合预期，再补专用 PNG 图标。
- 当前只有单一故事和第一章流程，尚无完整自动试玩机器人、数万局策略分布或完整故事可达性验证。
- 目前用单元测试验证关键引擎规则，不将其等同于剧情质量或用户体验验收。

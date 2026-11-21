# 存档保护 v0.1 实施记录

## 本次范围

本次只处理第一章原型的本地存档保护，不修改剧情 JSON、人物关系、能力值、随机事件和结局条件。

## 存储结构

IndexedDB 数据库 fgame-local 升级到版本 2：

- saves：以 saveId 为主键，保存多份独立游戏记录。
- meta：以 key 为主键，保存 activeSaveId。
- legacySaves：保留 v1 单记录格式迁移前的原始记录，主键仍为 key。

存档记录包含：

- saveId、storyId；
- saveVersion、storyVersion、contentHash；
- engineVersion、engineCompatibilityVersion；
- createdAt、updatedAt、status；
- 完整 state。

status 使用 in_progress、completed、incompatible、corrupt。活动存档由 meta.activeSaveId 唯一确定，不再用 active 状态表示。

## 兼容性校验

读取时按以下顺序检查：

1. saveVersion
2. storyId
3. storyVersion
4. contentHash
5. engineCompatibilityVersion

任意一项不匹配，存档标记为 incompatible。只更新记录的状态元数据，不修改 state。当前应用不尝试把旧故事内容映射到新故事。

contentHash 使用 SHA-256，对对象键排序后的规范 JSON 计算；数组顺序保留。当前样板故事的运行时哈希覆盖 src/content/sudden-billionaire.json。打包脚本同时生成 content.manifest.json，记录每个内容文件的哈希及总内容哈希。

## 写入约束

- 新游戏生成新的 saveId，使用 IndexedDB add 创建记录。
- 新存档记录和 activeSaveId 在同一个 readwrite 事务中写入。
- 事务失败时，记录写入和活动指针切换一起回滚。
- 自动保存只更新当前活动记录，并校验故事版本、内容哈希、引擎兼容版本及游戏 seed。
- 已损坏或不兼容的存档不能被自动保存覆盖。
- 旧页面发现活动存档已切换时，拒绝用旧页面状态覆盖新游戏。

## v1 迁移策略

旧版本使用 saves store，主键为 key，固定键为 active-story。数据库升级时：

1. 在 versionchange 事务内逐条复制原记录到 legacySaves。
2. 等游标复制完成后，删除旧 saves store 并创建 saveId 主键的新 store。
3. 初始化空的 activeSaveId 指针。
4. 如果存在旧归档而没有新活动存档，读取层返回“旧格式存档已保留、当前版本不能直接继续”的提示。

升级事务失败时，IndexedDB 会回滚该次 schema 变更；旧数据库不会被部分迁移后继续使用。

## 本地打包

先执行：

    npm run build
    npm run pack

打包产物输出到 artifacts/：

- fgame-source-<shortsha>.zip
- fgame-web-<shortsha>.zip
- BUILD_INFO.json
- content.manifest.json
- acceptance-report.json

acceptance-report.json 的 reportType 为 build-package，只声明打包检查，不冒充路径穷举或完整游戏验收报告。报告记录被测 commit、内容哈希、引擎兼容版本和打包命令。

## 自动化验收范围

本次测试覆盖：

- v1 存档迁移后 state 内容不变；
- 新游戏创建独立 saveId，旧记录不被覆盖；
- `saveVersion`、`storyId`、`storyVersion`、`contentHash`、`engineCompatibilityVersion` 五项兼容门禁分别测试；不匹配时标记不兼容且 state 保持不变；
- 损坏存档被标记为 corrupt，读取不崩溃且不修改原始 state；
- 同一 saveId 冲突导致事务回滚，活动存档指针不切换；
- 原有中途保存、恢复和继续游戏回放测试继续运行。

旧 v1 迁移的保留断言使用完整对象深比较及 state 的 JSON 序列化结果比较，确认 IndexedDB structured-clone 数据层内容一致；它不是对浏览器数据库底层物理页字节的比较。兼容状态改变只更新记录状态元数据，不修改 state 负载。

Playwright Chromium 验收通过持久浏览器配置目录执行：开始新游戏、选择并自动保存、关闭整个 Chromium 持久化上下文、使用同一 profile 重新启动、继续游戏；随后关闭网络，验证 Service Worker 缓存启动、离线继续选择并再次关闭/重启后恢复进度。该 CI 验收覆盖 Chromium 桌面浏览器，不等同于 iOS Safari / Android Chrome 实体设备验收。

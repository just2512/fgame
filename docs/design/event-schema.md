# 剧情事件数据 Schema 与条件语法 v0.1

本文定义 v0.1 JSON 内容文件的作者契约。TypeScript 类型位于 src/engine/types.ts；运行时结构检查位于 src/engine/validation.ts。JSON 内容必须通过校验后才能开始游戏。

## 1. Story 根对象

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 故事稳定 ID |
| version | string | 是 | 内容版本；存档必须记录 |
| title | string | 是 | 故事标题 |
| chapterTitle | string | 是 | 当前章节名称 |
| startEventId | string | 是 | 首个主线事件 |
| fallbackEndingId | string | 是 | 无其他结局命中时的兜底结局 |
| randomPerMainEvent | boolean | 是 | 主线事件后是否开放一次随机事件抽取 |
| randomChance | number | 是 | 0–1 的抽取门槛，只影响随机事件是否出现 |
| initial | object | 是 | 玩家、势线、NPC、flags、压力与时间的初始状态 |
| events | Event[] | 是 | 人工编写的事件库 |

## 2. Event

    {
      "id": "ch1_control_decision",
      "kind": "main",
      "chapter": 1,
      "order": 1,
      "title": "遗嘱宣读后的第三天",
      "scene": "叔叔在书房等你。",
      "when": {
        "path": "time.chapter",
        "op": "eq",
        "value": 1
      },
      "choices": []
    }

| 字段 | 说明 |
|---|---|
| id | 全故事唯一；pending、completed 和历史记录使用此 ID |
| kind | main / random / delayed / ending |
| chapter | 内容所属章节 |
| order | main 事件的主线先后顺序 |
| priority | ending 之间的优先级，数值越大越先匹配 |
| title / scene | 玩家可见内容，不能包含内部状态或易学术语 |
| when | 事件触发条件；缺省表示无额外条件 |
| weight | random 事件的权重；必须大于 0 才参与抽取 |
| choices | 非 ending 事件必须有至少一个选择 |
| reflection | ending 的可选感悟 |
| key | 内容作者标记关键节点，供编辑检查使用 |

## 3. Choice 与 ResolutionRule

    {
      "id": "hire_auditors",
      "text": "聘请专业团队，进行全面审计",
      "requires": {
        "path": "player.skills.insight",
        "op": "gte",
        "value": 2
      },
      "resolve": [
        {
          "id": "audit_with_experience",
          "when": {
            "path": "player.skills.insight",
            "op": "gte",
            "value": 3
          },
          "outcome": "information_first",
          "narrative": "你要求独立团队核对账目。",
          "effects": []
        },
        {
          "id": "audit_default",
          "outcome": "information_first",
          "narrative": "你要求独立团队核对账目。",
          "effects": []
        }
      ]
    }

- requires：不满足时选项不显示；不能显示后再用“失败率”处理。
- resolve：按文件顺序匹配第一条满足 when 的规则。
- 最后一条必须省略 when，作为无条件兜底规则。
- outcome：内部稳定 ID，不直接展示给玩家。
- narrative：选择结算后的玩家可见叙事反馈。
- effects：按数组顺序依次应用。

## 4. Condition AST

不支持字符串表达式、脚本片段或 eval。仅支持以下结构：

### 4.1 单字段比较

    { "path": "forces.company_health.value", "op": "gte", "value": 40 }

支持操作符：

| op | 含义 | 约束 |
|---|---|---|
| eq | 严格相等 | 类型和值都必须相同 |
| ne | 严格不相等 | 类型和值都必须相同 |
| gt / gte | 大于 / 大于等于 | 双方必须是数字 |
| lt / lte | 小于 / 小于等于 | 双方必须是数字 |
| in | 实际值是否包含在 value 数组中 | value 必须是数组 |
| contains | 数组或字符串是否包含 value | 不进行隐式类型转换 |

### 4.2 逻辑组合

    {
      "all": [
        { "path": "flags.audit_started", "op": "eq", "value": true },
        {
          "any": [
            { "path": "npcs.chen.trust", "op": "gte", "value": 60 },
            { "path": "player.skills.insight", "op": "gte", "value": 3 }
          ]
        },
        {
          "not": {
            "path": "flags.audit_report_seen",
            "op": "eq",
            "value": true
          }
        }
      ]
    }

- all：全部子条件满足。
- any：至少一个子条件满足。
- not：对子条件取反。
- 空 all / any 不建议写入内容文件；内容校验应在后续版本补齐此限制。
- path 必须指向 GameState 中真实存在的字段。未知路径视为内容错误并抛出异常，不静默放行。

## 5. Effect

| type | 字段 | 作用 |
|---|---|---|
| force.delta | force, delta | 修改势线，数值限制在 0–100，并更新 trend |
| force.phase | force, phase | 设置阶段标签 |
| skill.delta | skill, delta | 修改能力，限制在 0–5 |
| standing.set | key, value | 更新玩家身份、职务或位置描述 |
| npc.delta | npcId, metric, delta | 修改 NPC 的 trust / debt / rivalry / reliability |
| flag.set | name, value | 记录事实标记 |
| pressure.delta | name, delta | 修改累积器，限制在 0–100 |
| trajectory.add | tag | 添加唯一的生涯轨迹标签 |
| disposition.delta | trait, delta | 累积隐性行为倾向 |
| schedule | eventId, afterTurns, reason | 排程延迟事件；afterTurns 必须 >= 1 |

调度示例：

    {
      "type": "schedule",
      "eventId": "audit_findings",
      "afterTurns": 1,
      "reason": "独立审计启动，初步线索将在下一阶段出现。"
    }

延迟事件到期时仍需重新检查 Event.when；条件已不成立时丢弃该待办，不播放过时剧情。

## 6. 引擎调度优先级

每次选择结算后，顺序如下：

1. 到期的 delayed 事件，按 dueAtTurn 从早到晚处理。
2. 若本次结算来自 main 事件，按 randomChance 和权重抽取一个符合条件、尚未发生的 random 事件。
3. 选择 order 最小、尚未完成且满足 when 的 main 事件。
4. 若没有可继续的 main 事件，按 priority 从高到低匹配 ending。
5. 没有任何专用 ending 命中时使用 fallbackEndingId。

随机事件每个主线决策最多插入一个；延迟事件可以在同一阶段连续处理。random/delayed 事件本身不增加主线 turn。

## 7. 确定性约定

- seed 在新游戏开始时生成并保存。
- 引擎从 seed 初始化 PRNG 状态，后续只通过显式 rngState 推进。
- 任何影响剧情的抽取都必须经过该 PRNG。
- 不得在引擎、内容解析和结局匹配中使用 Math.random、Date.now 或网络响应。
- 选择历史记录 eventId + choiceId；结合 seed 和内容版本可重放。
- 内容版本发生变化后，旧存档不能不经迁移直接读取新规则。

## 8. 内容文件验收

- event ID 唯一。
- startEventId 必须指向 main 事件。
- fallbackEndingId 必须指向 ending 事件。
- 非 ending 事件必须至少有一个选项。
- 每个选项必须有 resolution，且最后一条为 fallback。
- schedule 必须指向已定义事件，afterTurns 为正整数。
- force / NPC 引用必须存在。
- 每个事件应由作者完成六问检查并通过人工审阅。

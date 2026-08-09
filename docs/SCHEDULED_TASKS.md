# 计划任务

Aster Code 的计划任务是本地持久化的 Codex 自动化。调度器运行在 Electron 主进程中，只有电脑开机且应用正在运行时才会准时触发；应用退出期间不会安装后台守护进程。

## 执行模型

1. 任务以 RFC 5545 `RRULE` 和 IANA 时区计算下一次墙上时间。
2. 到期记录先写入 SQLite 队列，再按单实例顺序执行。同一任务不会重叠运行。
3. 每个项目启动真实 `codex app-server` thread/turn，不使用静态结果。执行默认采用 `approvalPolicy=never`，因此提示词和沙箱必须在普通任务中先验证。
4. `Local` 在项目目录执行；`隔离 worktree` 通过托管 Git 工作树执行，并保留工作树供用户审阅。
5. 成功、失败、取消和跳过均写入运行收件箱。错误在持久化前脱敏，摘要限制为 128 KiB。

任务可选择每次创建新对话，或在 Local 模式下继续同一项目的既有任务。工作树路径每次不同，因此 worktree 模式强制新对话，避免恢复旧 thread 时使用错误 cwd。

## 错过运行、重试与恢复

- `run_once`：应用重新启动后只补跑最近一个已错过周期，不回放每个历史周期。
- `skip`：记录一次明确的跳过结果，不执行智能体。
- 失败可配置 1–4 次尝试和 1–1440 分钟退避；取消不重试。
- 进程退出时主动中断运行中的 turn。若进程崩溃，启动迁移会把遗留的 `running` 记录标为失败，不盲目重放可能已有副作用的 turn。
- 单次执行上限为 6 小时；当前调度队列全局串行，优先保证可解释性与避免本机资源争用。

## RRULE 示例

```text
RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0
RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30
RRULE:FREQ=HOURLY;INTERVAL=4;BYMINUTE=0
```

时区使用如 `Asia/Shanghai`、`America/Los_Angeles` 的 IANA 名称。编辑器会拒绝无效时区、换行注入、超过 2000 字符的规则以及无法解析的 RRULE。

## 安全边界

- Renderer 只能提交已登记项目 ID，不能注入 cwd、命令或环境变量。
- API Key 仍只从环境或加密凭据保险库进入 app-server 子进程。
- `danger-full-access` 会显示高风险提示；推荐 `workspace-write`，只读报告任务使用 `read-only`。
- 无人值守任务不会等待命令或文件审批。需要交互审批的工作应留在普通任务中。
- 任务删除会保留历史；运行中的任务不可删除，必须先取消。

## 已验证范围

- 单元/集成测试覆盖时区换算、持久化、编辑、暂停/恢复、删除后保留历史、重试、脱敏、错过跳过和 AbortSignal 取消。
- Electron E2E 从计划任务 UI 创建 Local/只读任务，真实 app-server 返回 `ASTER_SCHEDULED_OK`，并验证完成记录、未读和已读状态。
- worktree 创建与任务 cwd 已分别通过既有真实回归；计划任务专属 worktree 在线回归留在最终跨功能测试中。

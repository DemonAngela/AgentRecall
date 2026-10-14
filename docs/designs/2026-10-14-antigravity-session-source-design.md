# Antigravity 只读会话来源设计

## 文档状态

- 状态：只读来源 `antigravity` 已在 V1 与 V2 实现（默认关闭，需要用户在设置中开启）
- 适用范围：`apps/main-1.0` 与 `apps/main-2.0` 的会话索引
- 主要读者：负责实现、审查和验证会话来源的维护者
- 内容类型：设计说明与格式参考

本文定义 Google Antigravity（Electron 桌面 IDE）本地会话的发现、解析与索引契约。格式事实来自对 Antigravity 2.13.0（Windows）真实会话数据的分析，并与此前已核实的社区逆向结论互相印证（见文末参考）。Antigravity 是闭源产品，Google 未公开该格式，也没有官方开源仓库描述它；本文是当前 checkout 的唯一权威说明。

## 要解决的问题

Antigravity 是常见的同类编码代理之一，但 AgentRecall 此前无法索引它的会话。它的数据目录位于 `~/.gemini/` 之下，与 Gemini CLI 共享父目录、格式完全不同，因此不能复用 Gemini CLI 的来源实现。

## 目标

- 只读索引本机 Antigravity 会话：消息、思维链、工具调用与结果、上下文压缩标记、代理间消息。
- 恢复会话所属工作区路径、默认分支与会话标题，用于分组与展示。
- 与现有可选来源一致：默认关闭、开启后增量索引、关闭后清理索引；源文件永不被修改或删除。
- 对格式漂移保持容错：未知条目类型被忽略并保留已解析内容，不使整批失败。

## 非目标

- 不支持 Antigravity CLI（`agy`，`~/.gemini/antigravity-cli/`）：它的会话内容只存在于 SQLite `steps.step_payload` protobuf 中，需要完整逆向 schema；本设计只读取该 CLI 目录之外的桌面版数据（见"分期"）。
- 不提供 live 跟踪、恢复、迁移、团队会话同步或"在应用中打开"能力（capabilities 全为 false）。
- 不读取或展示 token 用量与模型名：转录中没有这些字段；DB 中仅有 protobuf 文本片段，噪声大不可靠。
- 不索引 `conversations/*.db` 中未出现在 `brain/` 的会话（例如仅剩归档注解的已删除会话）。
- 不实现 `~/.gemini/antigravity-ide/` 等未经本机验证的候选路径。

## 数据结构（实测）

```
~/.gemini/antigravity/                      # 桌面版根目录（Windows/macOS/Linux 同构）
├── brain/<会话id>/.system_generated/logs/
│   ├── transcript_full.jsonl               # 主数据源：逐行 JSON，长字段不截断
│   ├── transcript.jsonl                    # 同一条目集合，长字段截断并标注 truncated_fields
│   └── chunks/transcript*/                 # 滚动分片副本，内容与 transcript 相同（备用）
├── conversations/<会话id>.db              # SQLite：steps 表（protobuf payload，不读）+ 轨迹元数据
├── annotations/<会话id>.pbtxt             # 文本 protobuf：标题、归档状态、最近查看时间
~/.gemini/config/projects/<项目id>.json    # 项目注册表（folderUri、名称），由元数据字段 18 关联
```

转录条目（每行一个对象）：

| 字段 | 说明 |
|---|---|
| `step_index` | 会话内序号；**转录按写入顺序追加，不是 step_index 顺序** |
| `source` | `USER_EXPLICIT` / `MODEL` / `SYSTEM` |
| `type` | `USER_INPUT`、`PLANNER_RESPONSE`、`GENERIC`、`CHECKPOINT`、`ERROR_MESSAGE`、`SYSTEM_MESSAGE` |
| `status` | `DONE` / `RUNNING`（实时写入） |
| `created_at` | ISO 8601 UTC |
| `content` / `thinking` / `tool_calls` | 可选；`tool_calls[i]` 为 `{ name, args }` |

DB `steps.step_type` 与转录类型的对应（逐条 join 验证）：`14→USER_INPUT`、`15→PLANNER_RESPONSE`、`132→GENERIC`（工具结果）、`17→ERROR_MESSAGE`、`23→CHECKPOINT`、`101→SYSTEM_MESSAGE`（代理间/后台任务消息）。`status=7`（取消）的步骤不写入转录，因此转录是"可见视图"，比 `steps` 表少 0–4 条取消的工具步；本来源接受这一损失。

工作区恢复：`conversations/<id>.db` 的 `trajectory_metadata_blob(id='main')` 是一个小型 protobuf（wire format，字段少且稳定）：

- 字段 1：工作区描述（1.1 `file:///` folderUri、1.3 git {1: slug, 2: url}、1.4 默认分支）
- 字段 2：轨迹创建时间戳（秒）
- 字段 18：项目 id，对应 `config/projects/<id>.json`

只解码字段 1.1 与 1.4（工作区与分支），不做 `steps`/`step_payload` 的 schema 逆向。

## 行为契约

### 发现与身份

- 根目录：`<homeDir>/.gemini/antigravity`；`homeDir` 来自加载选项，测试用临时目录注入。
- 会话枚举 `brain/*/`，其 `.system_generated/logs/` 下存在可用转录（优先 `transcript_full.jsonl`，回退 `transcript.jsonl`）才成为会话。`chunks/` 分片与转录内容重复且边界语义未验证，不参与读取。
- 身份：`source = "antigravity"`，`rawId = 会话目录名`（UUID），`sessionKey = "antigravity:<uuid>"`，`filePath = 转录文件`，`isSubagent = false`。
- 新鲜度：以转录文件 mtime/size 判定；`conversations/<id>.db` 与 `annotations/<id>.pbtxt` 的 mtime 作为 dependency 参与变更判定（元数据变化需要重新索引）。
- 工作区：`projectPath` 取元数据 folderUri 的本地路径；缺失时回退 `filePath`。`gitBranch` 取元数据字段 1.4。
- 标题：注解 `title:` 优先，其次首条用户请求，最后会话 id。
- 时间戳：元数据创建时间优先，其次首条条目 `created_at`，最后文件 mtime。

### 条目映射

| 转录条目 | 映射 |
|---|---|
| `USER_INPUT` | 用户消息；提取 `<USER_REQUEST>…</USER_REQUEST>`，剥离 `<ADDITIONAL_METADATA>`/`<USER_SETTINGS_CHANGE>` 等系统块 |
| `PLANNER_RESPONSE` | `thinking` → 推理事件；`content` → 助手消息；`tool_calls` → 工具调用事件（`antigravity.toolCall`，`callId = antigravity:<stepIndex>:<i>`） |
| `GENERIC` | 工具结果事件（`antigravity.toolResult`），按 step_index 顺序与尚未闭合的调用配对，剥离 `Created At:`/`Completed At:` 头行；无待配对调用时按助手文本处理 |
| `CHECKPOINT` | 上下文压缩事件（`antigravity.context.compaction`），detail 为截断摘要 |
| `ERROR_MESSAGE` | 失败事件（`antigravity.error`，`status = failed`） |
| `SYSTEM_MESSAGE` | 代理间/后台任务消息事件（`antigravity.collaboration.message`） |
| 未知类型 | 忽略，不失败 |

工具结果与调用一一配对：实测转录中未闭合的调用对应被取消而未写入转录的步骤，配对按顺序消费，不依赖工具名或参数结构（`args` 同时存在 PascalCase 与 lowercase 两种命名，原样透传）。

### 失败与边界

- `conversations/`、`annotations/`、`brain/` 任一目录缺失时静默返回空集合（这是未安装 Antigravity 的正常状态）；单个会话解析失败不影响其他会话。
- 元数据 protobuf、注解 pbtxt、未知 wire type 均按"尽力而为"处理：解析失败只丢失工作区/标题信息，会话仍按转录索引。
- 源目录只读：不写入、不移动、不删除任何 Antigravity 文件；删除会话仅删除本地索引记录。
- 不做 tail-append 增量：转录在压缩与重写场景下可能整体重写，按文件级 mtime/size 全量重读。

## 接入点（两版本一致）

- 注册表行：`optionalSetting: "includeAntigravity"`、`pendingKey: "antigravity"`、`uiFamily: "other"`、capabilities 全 false。
- 加载器：V1 `core/session-loader.ts`（两个 generator）；V2 `core/session-loaders/alternative-sources.ts` 导出 `loadAntigravitySessionsIterator`，在 `core/session-loader.ts` 的两个 generator 派发。
- 开关链路：`AppSettings.includeAntigravity`、worker payload、worker 协议白名单、设置界面开关、关闭后 prune（注册表驱动，自动生效）。
- 只读删除门：`canDeleteSessionLocally` 与批量删除服务的只读名单（V1 四处、V2 四处）。
- 事件呈现：`trace-presentation.ts` 增加 `antigravity.thought`（reasoning）、`antigravity.collaboration.*`（collaboration）、`antigravity.context.compaction`（context）、`antigravity.error`（lifecycle/turn_summary）。

## 分期

- 已完成（Phase 1）：桌面版转录索引，只读。
- Phase 2（未实现）：CLI（`agy`）支持，需要 `steps.step_payload` 的完整 protobuf 解码；社区项目已恢复出可借鉴的 schema（见参考）。CLI 的会话 DB 位于 `~/.gemini/antigravity-cli/conversations/`。
- 未决：`chunks/` 与转录的边界差异（少 1 行）语义；版本升级后的格式漂移；被取消步骤的恢复（需要 Phase 2 的 DB 解码）。

## 验证

- 单元测试：`apps/*/src/core/session-loader-antigravity.test.ts`，合成 fixture 覆盖顺序重排、用户请求提取、工具配对与未闭合调用、压缩标记、错误条目、代理间消息、未知条目忽略、注解标题、protobuf 元数据、缺失回退与开关默认关闭。
- 注册表不变量：`session-sources.test.ts`（V1 有序来源数组、可选来源开关数组）。
- 手工核对：对 Antigravity 2.13.0 的真实安装运行加载器，6 个会话的标题、工作区路径、分支、消息数、工具调用/结果数（含 3 条未闭合的取消调用）、压缩标记与代理间消息均与源数据一致。
- 回归对照：两版本全量测试的失败项与本分支基线逐一相同（Windows 路径与进程探测类既有失败），未新增失败。

## 参考

- [rajbos/ai-engineering-fluency · antigravity-session-format.md](https://github.com/rajbos/ai-engineering-fluency/blob/main/docs/logFilesSchema/antigravity-session-format.md)：转录字段与 `<USER_REQUEST>` 结构的公开格式说明；其中记录的 `conversations/*.pb` 已被本机的 `*.db` 取代。
- [shubzkothekar/antigravity-acp](https://github.com/shubzkothekar/antigravity-acp)：CLI 会话 DB 读取与恢复出的 protobuf 定义，供 Phase 2 参考。
- [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)、[Pika-Yalei/antigravity-decryptor](https://github.com/Pika-Yalei/antigravity-decryptor)：经语言服务器访问 Antigravity，依赖运行时进程，不适用于离线只读索引。

# Yee Stack for Pi

给 [Pi](https://github.com/earendil-works/pi) 用的一组小扩展，**一次安装，一个配置页**：

| 功能 | 入口 | 一句话 |
|---|---|---|
| **Wish** 许愿特化器 | `/wish`、`Ctrl+Alt+W` | 一句话愿望 → 补上工作模型真正需要的“方向性要求”，在浮窗里改完再写回输入框 |
| **Ask** 只读问答 | `/ask`、`Ctrl+Alt+A` | 进入后 agent 只做问答：能读、搜、列文件，但不能改文件、不能跑命令 |
| **配置页** | `/yee-config` | 多标签配置页，Wish / Ask 的设置都在里面 |

> 前身是 [pi-wish-specializer](https://github.com/akirousnow/pi-wish-specializer)（仓库已更名为 `pi-yee-stack`，旧链接会自动跳转）。Wish 的行为**完全照旧**，只是设置搬进了 `/yee-config`。

在 Pi 1.4.0 与 1.5.x 上测试过。

## 安装

从 GitHub 安装：

```bash
pi install git:github.com/akirousnow/pi-yee-stack@v0.3.0
```

然后在 Pi 里重新加载：

```text
/reload
```

用 `/hotkeys` 可以在 **Extensions** 一栏看到注册的快捷键。

本地开发 / 试用：

```bash
git clone https://github.com/akirousnow/pi-yee-stack.git
pi -e ./pi-yee-stack

# 或安装为长期包
pi install ./pi-yee-stack
```

### 从 pi-wish-specializer 迁移

**先卸载旧包再装新包。** 两个包同时加载会重复注册 `/wish` 和 `Ctrl+Alt+W`，Pi 会把命令改名成 `/wish:1`、`/wish:2` 并报告快捷键冲突（Yee Stack 启动时也会提示一次）。

```bash
pi list                                   # 找到旧包的来源
pi remove git:github.com/akirousnow/pi-wish-specializer@v0.2.0   # 以 pi list 显示的为准
pi install git:github.com/akirousnow/pi-yee-stack@v0.3.0
```

你原来的设置不会丢：首次运行时，`~/.pi/agent/wish-specializer.json` 里的模型、风格、快捷键会被自动导入（旧文件原样保留，不会被修改或删除），第一次在 `/yee-config` 里改动后才会写入新的 `yee-stack.json`。`/wish-config` 仍然可用，会直接打开配置页的 Wish 标签。

## /yee-config

```text
/yee-config          # 打开配置页
/yee-config ask      # 直接打开 Ask 标签
/wish-config         # 直接打开 Wish 标签（旧入口）
```

```text
 Yee Stack 设置

 [ 许愿 Wish ]   提问 Ask
 ─────────────────────────────────────────────

 → 模型      跟随当前 Pi 模型
   默认风格  标准 (standard)
   快捷键    Ctrl+Alt+W

 ←/→ 切换标签 · ↑/↓ 选择 · Enter 修改 · Esc 关闭
```

- `←` / `→`（或 `Tab` / `Shift+Tab`）切换标签，`↑` / `↓` 选择，`Enter` / `Space` 修改，`Esc` 关闭。
- 改动**立即保存**；选模型、选工具这类选项会进入一个子视图，`Esc` 返回。
- **快捷键**：按下新的组合键即可。支持 `Ctrl` / `Alt` / `Super` + 字母或数字，或 `F1`–`F12`；必须带修饰键或使用功能键，避免吞掉正常输入；与 Pi 内置快捷键、或另一个功能的快捷键冲突时会拒绝并提示；`Backspace` 清除（不设置快捷键）。
- 改了快捷键后，关闭配置页时会自动重载扩展让它生效；如果 Pi 正在生成回复，则在当前回合结束后手动 `/reload`。

## Wish：许愿特化器

- 原话**一个字都不改**，只补上工作模型真正需要的“方向性要求”；
- 支持**快捷键**和 **slash 命令**触发；
- 生成后弹出可编辑的小浮窗，支持 **确认** / **取消**；
- 确认后写回 Pi 输入框，取消则输入框原样保留。

### 快捷键

1. 在输入框里写下愿望，例如：
   ```text
   画一只赛博朋克风格的猫，用于网站首屏
   ```
2. 按当前配置的快捷键，默认是 `Ctrl+Alt+W`。
3. 等待生成后，在浮窗里编辑结果：
   - `Enter`：确认，写回输入框
   - `Esc`：取消，输入框保持原样
   - `Shift+Enter`：换行
   - `PgUp` / `PgDn`：滚动较长内容
   - `Tab`：编辑器补全（与主编辑器一致）
4. 回到输入框后按 `Enter` 发送。

### 命令

```text
/wish <愿望>
/wish light <愿望>
/wish standard <愿望>
/wish heavy <愿望>
```

```text
/wish 做一个深色主页，卖手冲咖啡
/wish heavy 给我一个可操作的坦克模型展示页
```

命令执行后输入框会被清空；确认结果时写回输入框，取消则保持为空。

### 设置（/yee-config → Wish）

| 设置 | 说明 |
|---|---|
| 模型 | 从 Pi 当前可用模型里选（来源与 `/model` 一致，输入文字可模糊搜索）。`↺ 跟随当前 Pi 模型` 为默认；固定后不会修改 Pi 自己的当前模型；固定的模型不可用时（登录失效、模型被移除等）会提示一次，并临时退回当前 Pi 模型。 |
| 默认风格 | `light` / `standard` / `heavy`，作用于快捷键触发和未显式指定档位的 `/wish`；`/wish light ...` 仍可单次覆盖。`Enter` 依次切换。 |
| 快捷键 | 默认 `Ctrl+Alt+W`。 |

### 档位

| 档位 | 行为 | 预算 |
|---|---|---|
| `light` | 只给 2–3 条最高杠杆的方向 | 约 700 字符 |
| `standard` | 4–6 条关键方向 + 一行验收口径 | 约 1200 字符 |
| `heavy` | 把最有决定性的少数方向写透，可带一小段分阶段建议 + 验收口径 | 约 2000 字符 |

档位控制“补多少”，不会替用户做决定。

### 生成规则

系统提示词要求模型：

- 只输出**补充要求**，不重写、不重复原话；
- 使用与原愿望相同的语言；
- 不写代码、不写具体数值参数、不写实现步骤；
- 不替用户做架构/范围/不可逆选择；
- 从这些维度里只挑对结果真正重要的：审美取向、光影与材质、构图与层次、场景与氛围、交互与状态、验收口径；
- 原愿望已经足够具体时，允许零增量。

最终 prompt 的结构是：

```text
<原话，逐字保留>

---

<模型生成的补充要求>
```

## Ask：只读问答

进入 Ask 模式后，agent **只做问答**：可以用只读工具查资料再回答，但改不了文件、也跑不了命令。适合“先把代码问明白，再决定改不改”。

### 使用

| 操作 | 效果 |
|---|---|
| `/ask` 或 `Ctrl+Alt+A` | 切换 Ask 模式 |
| `/ask <问题>` | 进入 Ask 模式并立刻提问（已在 Ask 模式则直接提问） |
| `/ask on` / `/ask off` | 明确开 / 关 |
| `/ask status` | 看当前状态、放行和屏蔽了哪些工具 |

Ask 模式开启时，Pi 底栏会显示 `❓ ask`。快捷键可以在 `/yee-config → Ask` 里改。

用在脚本里：

```bash
pi --ask -p "这个项目的入口在哪？"      # 一次性只读问答
pi -p "这个项目的入口在哪？" --ask       # 等价
```

> `--ask` 不要直接放在问题前面（`pi --ask "问题"`）：Pi 会把后面的文字当成 `--ask` 的值，问题就被吞了。

### 哪些工具可用

| 放行 | 说明 |
|---|---|
| `read` `grep` `find` `ls` | Pi 自带的只读工具（和 Pi SDK 的 `createReadOnlyTools` 是同一组），进入 Ask 模式时自动启用 |
| 声明了 `readOnlyHint` 的工具 | 例如 MCP server 标注为只读的工具；仅当它在进入前已启用时保留 |
| 你在 `/yee-config → Ask → 额外放行的工具` 里勾选的工具 | 给那些没有标注、但你确认只读的工具（比如联网搜索） |

`bash`、`powershell`、`edit`、`write` **永远不放行**，勾选也不行：shell 命令没法证明是只读的。要跑命令请先 `/ask` 退出。

### 怎么保证“只问答”

三层，缺一层其它层也还在：

1. **工具集**：进入时把启用的工具砍到只读集合，**每次开始回答前**再校正一遍（防止别的扩展中途又把写工具打开）；
2. **调用拦截**：`tool_call` 守卫拦住一切不在放行范围内的调用，并告诉模型原因；
3. **提示词**：给系统提示词加一个 `<yee-ask>` 分区，说明这是只读问答、不要假装改过东西、需要改动时让用户先退出 Ask 模式。Pi 只对变动的分区打补丁，所以切换模式不会重建整个提示词；退出后该分区会被移除。

### 状态保存

Ask 模式按**会话**保存：`/reload`、`/resume`、`pi -c`、`/tree` 切换分支后都会恢复；`/new` 是新会话，默认关闭。退出 Ask 模式时，工具会恢复成进入前的样子。

## 配置文件

位置：

```text
~/.pi/agent/yee-stack.json
```

示例：

```json
{
  "version": 1,
  "wish": {
    "model": { "provider": "magpie", "id": "auto/deepseek-v4.1-flash" },
    "tier": "standard",
    "shortcut": "ctrl+alt+w"
  },
  "ask": {
    "shortcut": "ctrl+alt+a",
    "extraTools": ["web_search"]
  }
}
```

- `wish.model` 为 `null` 表示跟随当前 Pi 模型；
- `shortcut` 为 `null` 表示不设置快捷键；缺省则使用默认值；
- 两个功能的快捷键相同时，Wish 保留，Ask 的会被停用（启动时提示）；
- 读取时对缺失、损坏、未知字段都会退回默认值；写入是原子的，并且每次保存前都会重新读取文件，同时开着多个 Pi 也不会互相覆盖对方的改动。

## 实现说明

- Wish 默认使用当前 Pi 会话的 `ctx.model`，固定模型后优先使用固定模型；调用 `ctx.modelRegistry.complete()`，模型来源与 Pi 自带的 `/model` 一致。
- 生成期间显示可取消的 loader；`Esc` / `Ctrl+C` 会中止请求。如果模型出错、被取消、或返回空内容，不会覆盖输入框。
- 结果浮窗使用 `ctx.ui.custom(..., { overlay: true })`，内含 Pi 的 `Editor` 组件，保留光标、IME、换行、滚动和补全行为；每行都铺满主题 `customMessageBg` 背景。
- `/yee-config` 是同一种浮窗：标签栏 + 每个功能自己的设置行，选模型 / 录快捷键 / 勾选工具时会替换成对应的子视图。
- 快捷键通过 `pi.registerShortcut()` 注册（Pi 没有“取消注册”，所以改键后要重载）。
- 扩展不会修改 Pi 本身，也不会修改 Pi 的当前模型。

## 注意事项

- 如果快捷键被终端占用，可以直接用命令（`/wish`、`/ask`），或在 `/yee-config` 里换一个。
- Wish 的每次特化会产生一次额外的模型请求。
- `/yee-config` 与 Wish 浮窗需要 TUI 交互模式；`/ask` 在 TUI、RPC 和 print 模式下都能用。

## 开发

```bash
npm install
npm test          # tsc --noEmit + 单元测试
pi -e .           # 本地加载
```

目录结构：

```text
extensions/yee-stack/
├── index.ts               # 入口：注册各功能和 /yee-config
├── config.ts              # yee-stack.json 的读取、校验、原子写入、旧配置导入
├── shortcut.ts            # 快捷键校验 / 显示 / 冲突检测
├── features/
│   ├── wish/              # /wish、浮窗、提示词、Wish 标签
│   └── ask/               # /ask、工具策略、提示词分区、Ask 标签
└── ui/                    # 配置页、模型选择、快捷键录入、勾选列表
```

新增一个功能 = 在 `features/` 下加一个目录，返回 `{ id, tab }`，并在 `index.ts` 里注册。

## License

MIT

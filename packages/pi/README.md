# Yee Stack for Pi

给 [Pi](https://github.com/earendil-works/pi) 用的一组小扩展，**一次安装，一个配置页**：

| 功能 | 入口 | 一句话 |
|---|---|---|
| **Wish** 许愿特化器 | `/wish`、`Ctrl+Alt+W` | 一句话愿望 → 补上工作模型真正需要的“方向性要求”，在浮窗里改完再写回输入框 |
| **Ask** 只读问答 | `/ask`、`Ctrl+Alt+A` | 进入后 agent 只做问答：能读、搜、列文件，但不能改文件、不能跑命令 |
| **Browser** 浏览器操控 | `/browser`、`$t3` | 连上真实 Chrome，用 `$t3` 选定 tab 后直接看快照、点击、填表 |
| **配置页** | `/yee-config` | 多标签配置页，Wish / Ask / Browser 的设置都在里面 |

> 前身是 [pi-wish-specializer](https://github.com/akirousnow/pi-wish-specializer)（仓库已更名为 `pi-yee-stack`，旧链接会自动跳转）。Wish 的行为**完全照旧**，只是设置搬进了 `/yee-config`。
>
> 0.5.0 起本包是 [yee-stack monorepo](https://github.com/akirousnow/pi-yee-stack) 里的 `packages/pi`，共享逻辑在 `@yee-stack/core` 与 `@yee-stack/{wish,ask,browser}`。同一个仓库里还有 DeepSeek Harness 版本 `@yee-stack/dsh`。

在 Pi 1.4.0 与 1.5.x 上测试过。

## 安装

```bash
pi install pi-yee-stack@0.5.0
```

然后在 Pi 里重新加载：

```text
/reload
```

用 `/hotkeys` 可以在 **Extensions** 一栏看到注册的快捷键。

本地开发 / 试用（先构建共享包，Pi 才能解析 `@yee-stack/*`）：

```bash
git clone https://github.com/akirousnow/pi-yee-stack.git
cd pi-yee-stack
npm install
npm run build

pi -e ./packages/pi          # 直接加载

# 或安装为长期包
pi install ./packages/pi
```

### 从 pi-wish-specializer 迁移

**先卸载旧包再装新包。** 两个包同时加载会重复注册 `/wish` 和 `Ctrl+Alt+W`，Pi 会把命令改名成 `/wish:1`、`/wish:2` 并报告快捷键冲突（Yee Stack 启动时也会提示一次）。

```bash
pi list                                   # 找到旧包的来源
pi remove git:github.com/akirousnow/pi-wish-specializer@v0.2.0   # 以 pi list 显示的为准
pi install pi-yee-stack@0.5.0
```

你原来的设置不会丢：首次运行时，`~/.pi/agent/wish-specializer.json` 里的模型、风格、快捷键会被自动导入（旧文件原样保留，不会被修改或删除），第一次在 `/yee-config` 里改动后才会写入新的 `yee-stack.json`。`/wish-config` 仍然可用，会直接打开配置页的 Wish 标签。

## /yee-config

```text
/yee-config          # 打开配置页
/yee-config ask      # 直接打开 Ask 标签
/yee-config browser  # 直接打开 Browser 标签
/wish-config         # 直接打开 Wish 标签（旧入口）
```

```text
 Yee Stack 设置

 [ 许愿 Wish ]   提问 Ask   浏览器 Browser
 ─────────────────────────────────────────────

 → 模型      跟随当前 Pi 模型
   默认风格  标准 (standard)
   快捷键    Ctrl+Alt+W

 ←/→ 切换标签 · ↑/↓ 选择 · Enter 修改 · Esc 关闭
```

- `←` / `→`（或 `Tab` / `Shift+Tab`）切换标签，`↑` / `↓` 选择，`Enter` / `Space` 修改，`Esc` 关闭。
- 改动**立即保存**；选模型、选工具、填地址这类选项会进入一个子视图，`Esc` 返回。
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

## Browser：浏览器操控

Yee Stack 自己当 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 的 MCP 客户端：一个 Pi 进程只起一个 MCP 子进程，`/reload`、`/new`、`/resume` 不会重连，也不会重复触发 Chrome 的授权弹窗。连上之后：

- 在输入框里打 `$` 会列出所有 tab（显示标题，编号和 URL 作为副标题），选中后插入 `$t3 `；
- 发送 `$t3 把近 7 天数据整理成表格` 时，`$t3` 成为本次的**当前 tab**；默认只在 Pi 里切换，不把 Chrome 切到前台（可在 `/yee-config → Browser` 打开）；
- 模型用 `browser_*` 工具看无障碍快照、点击、填表、导航；每次调用默认就是当前 tab。

你的原话不会被改写：`$t3` 留在消息里，由 `<yee-browser>` 系统提示分区解释。

### 连接

| 方式 | 说明 |
|---|---|
| 自动连接（默认） | 找到已经允许远程调试的 Chrome（Chrome 144+ 打开 `chrome://inspect/#remote-debugging`），否则试 `127.0.0.1:9222` |
| 指定地址 | `/browser on http://host:9222` 或 `ws://…`，适合远程机器和 SSH 隧道 |
| 自己启动 | `/browser launch`，使用 `~/.pi/agent/yee-browser/profile` 这个独立 profile；没有 `DISPLAY` 时自动无头，root 下自动加 `--no-sandbox` |

Chrome 136 起，默认 profile 会忽略 `--remote-debugging-port`。想连日常用的 Chrome，用 Chrome 144+ 的 `chrome://inspect` 开关；否则用 `/browser launch`。

### 命令

| 命令 | 效果 |
|---|---|
| `/browser` | 未连接时连接；已连接时弹出 tab 选择框（最后一项是断开） |
| `/browser on [地址]` | 连接；带地址时按「指定地址」连，成功后保存，下次 `/browser on` 直接复用 |
| `/browser launch` | 启动一个独立 profile 的 Chrome 并连接，成功后保存为默认连接方式 |
| `/browser off` | 断开 |
| `/browser status` | 连接方式、版本、pid、tab 数、当前 tab、激活的工具 |
| `/browser tabs` | 列出 tab |
| `/browser use $t3` | 只切换当前 tab，不发送消息 |
| `pi --browser` | 启动时连接（也可在 `/yee-config → Browser` 打开「启动时监听」） |

底栏显示 `🌐 3 tabs · $t3 标题`。

### `$` 与 tab

- `$` 后面可以继续打字过滤标题、域名或 URL；列表显示标题，插入的仍是 `$t3`。`$HOME`、`$5` 这类不匹配任何 tab 的输入会交回 Pi 原来的补全。
- tab 名就是 chrome-devtools-mcp 的 pageId：`$t3` = `pageId 3`。
- 会话里保存的是 `{pageId, epoch, url, title}`。MCP 重启后 pageId 会变，恢复时按 URL、再按标题找回。
- 多个 tab 时不给 `page` 参数会报错并列出 tab；只有一个 tab 时直接用它。

### 工具

| 工具 | 作用 | 只读 |
|---|---|---|
| `browser_tabs` | 列出 tab | ✓ |
| `browser_snapshot` | 无障碍快照，元素带 uid | ✓ |
| `browser_screenshot` | 视口 / 整页 / 单个元素截图（JPEG，≤1280px） | ✓ |
| `browser_wait` | 等文字出现 | ✓ |
| `browser_navigate` | 打开 URL、后退、前进、刷新 | |
| `browser_new_tab` / `browser_close_tab` | 新建 / 关闭 tab | |
| `browser_click` / `browser_hover` | 按 uid 点击 / 悬停 | |
| `browser_fill` / `browser_fill_form` | 填一个 / 批量填表单 | |
| `browser_type` / `browser_press` | 键盘输入 / 按键 | |
| `browser_dialog` | 处理 alert / confirm / prompt | |
| `browser_upload` | 给 file input 设置文件（限当前项目目录） | |

- 工具只在连接期间激活，断开即移除。`browser_new_tab` 默认 `background: true`，新 tab 不会带到前台；需要前台时传 `background: false`。
- `browser_screenshot` 除了返回图像块，还会把图写到临时文件，并在文本里给出路径。codemode 模式会丢掉图像块，这时用文本里的路径配合 `read` + `image()` 看图。
- 操作类工具默认带 `includeSnapshot`，但只回传**新增或变化的元素**（uid 稳定，新元素用新一代前缀）；导航后自动回整页。
- 描述和参数是重写过的，15 个工具约 2.2k token，而不是上游 33 个的 7–8k。
- 不提供 `filePath` 这类会写文件的参数；快照过长时中间截断，全文存到临时文件并把路径告诉模型。

### 和 Ask 模式一起用

Ask 模式会放行带 `readOnlyHint` 的工具，所以 `/ask $t3 这页讲了什么` 能看快照、截图，但不能点击、输入、导航。

### 安全

本扩展**不弹确认框**：点击、提交、上传都直接执行。需要只读时用 Ask 模式；不确定时先 `/ask` 看清楚，再退出 Ask 操作。

chrome-devtools-mcp 默认关闭 JavaScript 求值（`--no-javascript-evaluation`），并隐藏网络请求里的敏感头（`--redactNetworkHeaders`）；可以在 `/yee-config → Browser` 打开「允许执行 JS」（重新连接后生效）。

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
  },
  "browser": {
    "connect": "auto",
    "channel": "stable",
    "endpoint": null,
    "executable": null,
    "headless": "auto",
    "profileDir": null,
    "listenOnStartup": false,
    "focusTab": false,
    "allowEval": false,
    "shortcut": null
  }
}
```

- `wish.model` 为 `null` 表示跟随当前 Pi 模型；
- `shortcut` 为 `null` 表示不设置快捷键；缺省则使用默认值；
- 三个功能的快捷键冲突时按 Wish > Ask > Browser 保留，后面的会被停用（启动时提示）；
- `browser.connect` 取 `auto` / `url` / `launch`；`browser.endpoint` 只在 `url` 时使用；`browser.headless` 取 `auto` / `on` / `off`；`browser.focusTab` 默认 `false`，不会把选中的 tab 切到 Chrome 前台；
- 读取时对缺失、损坏、未知字段都会退回默认值；写入是原子的，并且每次保存前都会重新读取文件，同时开着多个 Pi 也不会互相覆盖对方的改动。

## 实现说明

- Wish 默认使用当前 Pi 会话的 `ctx.model`，固定模型后优先使用固定模型；调用 `ctx.modelRegistry.complete()`，模型来源与 Pi 自带的 `/model` 一致。
- 生成期间显示可取消的 loader；`Esc` / `Ctrl+C` 会中止请求。如果模型出错、被取消、或返回空内容，不会覆盖输入框。
- 结果浮窗使用 `ctx.ui.custom(..., { overlay: true })`，内含 Pi 的 `Editor` 组件，保留光标、IME、换行、滚动和补全行为；每行都铺满主题 `customMessageBg` 背景。
- `/yee-config` 是同一种浮窗：标签栏 + 每个功能自己的设置行，选模型 / 录快捷键 / 勾选工具时会替换成对应的子视图。
- 快捷键通过 `pi.registerShortcut()` 注册（Pi 没有“取消注册”，所以改键后要重载）。
- Browser 使用 `@earendil-works/pi-mcp` 的 `McpClient` + `StdioTransport` 直接拉起 chrome-devtools-mcp，不经过 `pi.registerMcpServer`：`$` 补全、`input` 钩子和命令都要拿 `list_pages` 的 pageId，而这些地方调不到 Pi 工具。MCP 子进程是进程级单例，按会话引用计数，最后一个会话退出后宽限 60 秒再关；退出 Pi 时同步杀掉。
- 连接参数由 `features/browser/args.ts` 生成：`auto` 先查对应渠道的 `DevToolsActivePort`，再试 `127.0.0.1:9222`，都不行就给出三种办法；`launch` 用独立 profile，`--executablePath` 与 `--channel` 不会同时传。
- 工具是 chrome-devtools-mcp 的转发层：`pageId` 可选（默认当前 tab），去掉写文件的参数，快照按 uid 做增量，只读工具标 `readOnlyHint`。
- 扩展不会修改 Pi 本身，也不会修改 Pi 的当前模型。

## 注意事项

- 如果快捷键被终端占用，可以直接用命令（`/wish`、`/ask`、`/browser`），或在 `/yee-config` 里换一个。
- Wish 的每次特化会产生一次额外的模型请求。
- `/yee-config`、Wish 浮窗和 `$` 补全需要 TUI 交互模式；`/ask` 在 TUI、RPC 和 print 模式下都能用。
- Browser 依赖 `chrome-devtools-mcp`（安装后约 18 MB），官方只保证支持 Chrome 和 Chrome for Testing。升级 `chrome-devtools-mcp` 时先跑 `npm test` 和 `npm run test:e2e`，再实际连一次浏览器。
- 上游重启或重连后 pageId 会变；会话里同时存 URL 和标题用于恢复。
- chrome-devtools-mcp 不会出现在 Pi 的 `/mcp` 面板里，用 `/browser status` 看连接状态。

## 开发

在仓库根目录执行（monorepo）：

```bash
npm install
npm test          # 构建共享包 + 全部单元测试（浏览器部分不需要 Chrome）
npm run test:e2e  # 真实 chrome-devtools-mcp + 无头 Chrome（没有 Chrome 就跳过）
npm run typecheck # 每个包的 tsc
pi -e ./packages/pi
```

目录结构（本包 `packages/pi`）：

```text
src/
├── index.ts               # 入口：注册各功能和 /yee-config
├── config-store.ts        # yee-stack.json 的读取、原子写入、旧配置导入（schema 在 @yee-stack/core）
├── shortcut.ts            # Pi 内置快捷键冲突检测（校验/显示在 @yee-stack/core）
├── features/
│   ├── wish/              # /wish、浮窗、模型调用、Wish 标签
│   ├── ask/               # /ask、工具集切换、提示词分区、Ask 标签
│   └── browser/           # /browser、$ 补全、MCP 引擎、browser_* 工具、Browser 标签
└── ui/                    # 配置页、模型选择、快捷键录入、勾选列表、文本输入
```

纯逻辑按功能拆在 `@yee-stack/{wish,ask,browser}`，两个宿主（Pi / DeepSeek Harness）共用；新增一个功能 = 在 `packages/features/` 下加一个包，再在两个宿主里各加一层适配。

## License

MIT

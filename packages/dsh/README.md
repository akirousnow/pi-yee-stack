# Yee Stack for DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 版的 Yee Stack：**一个 bundle，三个功能**。

| 功能 | 入口 | 一句话 |
|---|---|---|
| **Yee Stack 面板** | 侧栏「Yee Stack」 | 三件事都在一个页面里：许愿特化、Ask 开关、浏览器连接，设置也在这里改（即时生效） |
| **Wish** 许愿特化器 | `/wish [light\|standard\|heavy] <愿望>`、面板的「特化」 | 一次私有补全，把一句话愿望补成“方向性要求” |
| **Ask** 只读问答 | `/ask`、`/ask <问题>`、`/ask on\|off\|status`、面板的开关 | 只读工具集 + 单调 guard + 提示词分区，三层保证不改文件、不跑命令 |
| **Browser** 浏览器操控 | `/browser`、`browser_*`、`$t3`、面板的连接/tab 列表 | 自己拉起 chrome-devtools-mcp，选定 tab 后看快照、点击、填表 |
| **设置** | `/yee-config`、面板的「高级」 | 打印或编辑当前设置 |

Pi 版是**命令**（TUI 浮窗 + 斜杠命令）；dsh 版除了命令，还给 Web 一个**真正的界面**：一个 `main` 面板 + 侧栏入口，所有状态从 Host 读、所有动作走 Remote。

与 Pi 版共享 `yee-stack-core`、`yee-stack-{wish,ask,browser}`（仓库内 `private` 包）：提示词、工具策略、`$tN` 解析、快照 diff、chrome-devtools-mcp 连接规划都是同一份代码，**发布时由 `scripts/build-host.mjs` 内联进 `lib/index.js`**，所以本包对外只依赖 `chrome-devtools-mcp` 和宿主提供的 `@deepseek-ai/*`。

## 安装

从 npm 安装（`0.7.0`）：

```bash
dsh plugin --profile web add yee-stack-dsh@0.7.0
dsh --profile web --dump-config | grep -A 2 'yee-stack'
dsh web
```

本地开发时从 checkout 安装（`pnpm link` 整个目录，先构建）：

```bash
npm install && npm run build        # tsc → lib/*.d.ts；esbuild → lib/index.js 与 client.js
dsh plugin --profile web add ./packages/dsh
```

> 从 checkout 链接安装时，`@deepseek-ai/*` 由 dsh 运行时解析；`chrome-devtools-mcp` 需要在 `packages/dsh` 自己的 `node_modules` 里能找到（仓库根 `npm install` 已经装好）。

安装后多出一层：

```yaml
# == yee-stack-dsh
- id: yee-stack
  name: 'yee-stack-dsh'
```

## 面板

侧栏点「Yee Stack」进面板，面板分四块：

| 块 | 读什么 | 能做什么 |
|---|---|---|
| Wish | 档位、输出上限、当前会话的模型路由 | 写愿望 → 「特化」→ 结果**写进输入框**（不直接发） |
| Ask | 当前会话是否开启、放行/屏蔽的工具、配置里的额外放行 | 开关 Ask；改额外放行；展开看注入的提示词 |
| Browser | 连接状态、tab 列表、当前 tab、MCP 服务状态 | 连接 / 启动 Chrome / 断开 / 选 tab / 重启 MCP |
| 高级 | 全部设置 | 改档位、输出上限、连接方式、通道、无头、地址、Chrome 路径、三个开关 |

面板的每个值都来自 Host 的 `yeeStackPanel` Remote 命名空间（`snapshot` / `wish` / `ask` / `browser` / `restartMcp`），设置写入走 `settings.mutate` 落到 profile 的 `cordis.patch.yml`。

**为什么设置能即时生效**：`config` 的每个字段都标了 `.volatile()`，写入只更新运行中的引用并触发 `loader/volatile-update`，不会重载插件——所以改设置不会断浏览器连接、也不会清掉任何会话的 Ask 模式。

### 浏览器那一半怎么构建

`./client` 是手写的 lazy-CJS 工厂（`window.__ModuleLoader__.load({ id, factory(require) })`），由 `scripts/build-client.mjs` 用 esbuild 打包成这个形状：

- 入口是 `src/client/index.ts`，`react` / `react/jsx-runtime` 走 Web 的模块表（`dsh.client.external`），其余全部内联；
- `dsh.client.inject` 声明它对 layout / sidebar / conversation / settings / remotes / locale 的边；
- 构建产物是仓库根目录之外的 `packages/dsh/client.js`（跟着 `npm run build` 一起生成）。

## 配置

改面板的「高级」块最省事（即时生效）。也可以用 profile 自己的 `cordis.patch.yml`（或 home 级 `$DSH_HOME/cordis.patch.yml`），**整块替换** `config`：

```yaml
- id: yee-stack
  config:
    wish:
      tier: heavy          # light / standard / heavy
      maxTokens: 900
    ask:
      extraTools: [web_search]     # 额外放行的工具名
      section: |                   # 覆盖 Ask 模式注入的提示词
        This session is read-only Q&A.
    browser:
      connect: launch      # auto / url / launch
      channel: stable      # stable / beta / dev / canary
      endpoint: ''         # connect=url 时：http://host:9222 或 ws://…
      executable: ''       # connect=launch 时的 Chrome 路径
      headless: auto       # auto / on / off
      profileDir: ''       # connect=launch 时的用户数据目录
      allowEval: false     # 允许页面里执行 JavaScript
      allowRemoteUpload: false  # 允许向远程 Chrome 上传文件（绕过本机项目目录校验）
      listenOnStartup: false
```

用 patch 改完 `/reload`（HMR）或重启 dsh；用面板改则即时生效。`/yee-config` 会打印解析后的值。

## Wish

```text
/wish 做一个深色主页，卖手冲咖啡
/wish heavy 给我一个可操作的坦克模型展示页
```

- 走 `ctx.llm.prepareCall()` + `stream` + `BlockAssembler`（harness 没有 `llm.complete()`），用**当前会话的模型路由**，不额外登录、不改会话模型；
- 原话一个字不改，只补方向；结果作为命令文本返回，复制进输入框即可（也可以自己再改）；
- 输出上限由 `wish.maxTokens` 控制；模型报错、被取消、返回空内容时都不会产出半截结果。

## Ask

```text
/ask                     # 切换
/ask 这个项目的入口在哪？   # 开启并直接提问
/ask on / off / status
```

三层保证：

1. **工具集**：开启时在 agent 自己的作用域上调 `ctx.tools.restrict({ allow })`，只留 `read`、`read_image`、`glob`、`grep` 和 `ask.extraTools`；
2. **guard**：`ctx.tools.guard()` 在 pre-execute 之后单调否决，`bash` / `pwsh` / `write` / `edit` / `apply_patch` / `run_code` 永远不放行，后注册的插件也翻不了案；
3. **提示词**：`yee:ask` 分区只在模式开启时注入。

开关状态是 `yee/ask` 日志事件 + `yee-ask` 投影，**按会话保存**，resume / fork 后恢复。

## Browser

```text
/browser                # 未连接时连接，已连接时列 tab
/browser on http://127.0.0.1:9222
/browser launch         # 独立 profile 启动 Chrome（无显示器时无头，root 自动 --no-sandbox）
/browser off / status / tabs
/browser use $t3
```

15 个 `browser_*` 工具：`tabs`、`snapshot`、`screenshot`、`navigate`、`new_tab`、`close_tab`、`click`、`hover`、`fill`、`fill_form`、`type`、`press`、`wait`、`dialog`、`upload`。

- `page` 参数可省略，默认当前 tab；只有一个 tab 时直接用它；多个 tab 又没选时会报错并列出 tab；
- 发消息里带 `$t3` 会把那个 tab 设为当前（消息本身不改写，`yee:browser` 分区解释它是什么）；
- 操作类工具带 `includeSnapshot`，但只回传**新增或变化**的元素；导航后回整页；
- `browser_screenshot` 把图写到临时文件并在结果里给路径，用 `read_image` 查看（harness 的 image block 需要附件服务，这里不伪造）；
- 工具只在连接期间存在（`when` 条件），断开即消失。

浏览器实现自带一个小的 MCP stdio 客户端（`src/mcp.ts`）：harness 的 `dsh-mcp-client` 会把工具直接注册进 `ctx.tools`、但不给调用句柄，而 `/browser`、tab 列表和提示词分区都要在模型回合之外调 `list_pages`。

## 与 Pi 版的差异

| | Pi | DeepSeek Harness |
|---|---|---|
| 形态 | TUI 浮窗 + 斜杠命令 | **Web 面板** + 斜杠命令 |
| Wish 结果 | 浮窗里改完写回输入框 | 面板写进输入框；命令则作为文本返回，自己复制 |
| 快捷键 | `Ctrl+Alt+W` / `Ctrl+Alt+A` | 无（侧栏入口） |
| `$tN` 补全 | 输入框里 `$` 补全 | 无补全，直接写 `$t3` |
| 设置 | 多标签 TUI 页 | 面板「高级」块（即时生效）+ `/yee-config` |
| 只读工具名 | `read`/`grep`/`find`/`ls` | `read`/`read_image`/`glob`/`grep` |

## 开发

```bash
node scripts/link-dsh.mjs            # 类型检查用：软链本机 dsh 的 @deepseek-ai/*
npm run build -w yee-stack-dsh      # tsc（类型）+ esbuild（lib/index.js）+ esbuild（client.js）
npm run build:host -w yee-stack-dsh     # 只重建 lib/index.js
npm run build:client -w yee-stack-dsh   # 只重建 client.js
npm run test -w yee-stack-dsh       # ask / wish / browser / config / panel
```

验证一个 checkout 不装进 profile 也能组合：

```bash
dsh --profile <name> --patch ./packages/dsh/cordis.patch.yml --dump-config
```

## License

MIT

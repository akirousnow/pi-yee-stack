# Yee Stack

一套小扩展，**一个 monorepo，两个宿主**：给 [Pi](https://github.com/earendil-works/pi) 的 `pi-yee-stack`，和给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `yee-stack-dsh`。

| 功能 | Pi | DeepSeek Harness | 一句话 |
|---|---|---|---|
| **面板** | TUI 浮窗 | **Web 面板**（侧栏「Yee Stack」） | 三件事都在一个页面里操作，设置也在那里改 |
| **Wish** 许愿特化器 | `/wish`、`Ctrl+Alt+W` | `/wish`、面板「特化」 | 一句话愿望 → 补上工作模型真正需要的“方向性要求” |
| **Ask** 只读问答 | `/ask`、`Ctrl+Alt+A` | `/ask`、面板开关 | agent 只做问答：能读、搜、列文件，不能改文件、不能跑命令 |
| **Browser** 浏览器操控 | `/browser`、`$t3` | `/browser`、面板连接/tab | 连上真实 Chrome，选定 tab 后看快照、点击、填表 |
| **设置** | `/yee-config`（多标签页） | 面板「高级」+ `/yee-config` | 一处改完；dsh 侧写入即时生效 |

Pi 那侧是命令；dsh 那侧除了命令，还多一个真正的 Web 界面——见 [`packages/dsh/README.md`](packages/dsh/README.md#面板)。

## 包

**对外只发两个宿主包**；四个共享包是 `private`，被 `esbuild` 内联进宿主，不上 npm。

| 包 | 目录 | 发布 | 作用 |
|---|---|---|---|
| `pi-yee-stack` | `packages/pi` | ✅ | Pi 宿主：TUI 浮窗、命令、快捷键、`browser_*` 工具 |
| `yee-stack-dsh` | `packages/dsh` | ✅ | DeepSeek Harness 宿主：bundle patch、命令、工具、提示词分区、投影、Web 面板 |
| `yee-stack-core` | `packages/core` | ⛔ `private` | 配置 schema、快捷键、两个宿主共用的基础类型 |
| `yee-stack-wish` | `packages/features/wish` | ⛔ `private` | 档位、系统提示词、补充内容清理、命令参数解析 |
| `yee-stack-ask` | `packages/features/ask` | ⛔ `private` | 只读工具策略、Ask 提示词分区、拒绝理由 |
| `yee-stack-browser` | `packages/features/browser` | ⛔ `private` | `$tN` 引用、`list_pages` 解析、快照 diff、chrome-devtools-mcp 连接规划 |

源码里依赖方向只有一条：`features/*` → `core`，`pi`/`dsh` → `core` + `features/*`；发布时这条链被 `scripts/build-host.mjs` 折叠成一个文件：

```text
packages/pi/src/index.ts   ──esbuild──▶  packages/pi/dist/index.js   （pi.extensions 指向它）
packages/dsh/src/index.ts  ──esbuild──▶  packages/dsh/lib/index.js
packages/dsh/src/client/index.ts ─esbuild─▶ packages/dsh/client.js    （Web 那一半）
```

`@earendil-works/*`、`@deepseek-ai/*`、`chrome-devtools-mcp`、`typebox`、`node:*` 保持外部依赖，由宿主包自己的 `dependencies` / `peerDependencies` 解析；四个 `yee-stack-*` 全部内联。

```text
packages/
├── core/                 # yee-stack-core
├── features/
│   ├── wish/             # yee-stack-wish
│   ├── ask/              # yee-stack-ask
│   └── browser/          # yee-stack-browser
├── pi/                   # pi-yee-stack（Pi 扩展，发布 dist/index.js）
└── dsh/                  # yee-stack-dsh（dsh bundle，发布 lib/ + client.js）
```

## 安装

已发布到 npm（`0.7.0` 起只发两个包，自包含、无需额外依赖）：

| 包 | 用途 |
|---|---|
| `pi-yee-stack` | Pi 扩展（自带全部共享逻辑） |
| `yee-stack-dsh` | DeepSeek Harness bundle（自带全部共享逻辑） |

**Pi**：

```bash
pi install npm:pi-yee-stack@0.7.0
```

**DeepSeek Harness**：

```bash
dsh plugin --profile web add yee-stack-dsh
dsh --profile web --dump-config | grep yee-stack   # 确认层已组合
dsh web                                            # 重启后生效
```

本地开发（从源码加载，需要先构建）：

```bash
git clone https://github.com/akirousnow/pi-yee-stack.git
cd pi-yee-stack && npm install && npm run build
pi -e ./packages/pi/dist/index.js     # 打包产物；也可以 pi -e ./packages/pi/src/index.ts 直接跑源码
dsh plugin --profile web add ./packages/dsh
```

> `yee-stack-dsh` 以 `dsh.bundle.patch` 形式提供 `cordis.patch.yml`，插入一行 `id: yee-stack`。改配置就覆盖这一行的 `config`（patch 是整块替换，不深合并）。

## 开发

```bash
npm run build       # core → features → dsh（含 esbuild 打出的 Web 那一半）
npm run typecheck   # 每个包各跑一次 tsc（先 build，跨包类型才解析得到）
npm test            # 先 build，再跑所有包的单元测试
npm run test:e2e    # 真实 chrome-devtools-mcp + 无头 Chrome（没有 Chrome 就跳过）
npm run clean       # 删掉所有 lib/
```

DeepSeek Harness 的包不发布在 npm 的同一版本线上，`yee-stack-dsh` 的类型检查要对着**本机安装的 dsh** 做：

```bash
node scripts/link-dsh.mjs          # 把已安装 dsh 里的 @deepseek-ai/* 软链到本仓库 node_modules
node scripts/link-dsh.mjs /path/to/@deepseek-ai/dsh
```

链接只是给 `tsc` 用的；运行时 dsh 自己会解析这些 peer。

## 文档

- Pi 版：[`packages/pi/README.md`](packages/pi/README.md)
- DeepSeek Harness 版：[`packages/dsh/README.md`](packages/dsh/README.md)
- dsh 插件 API 摘要（对着本机安装的 0.2.2-rc.5 整理）：[`docs/dsh-api-digest.md`](docs/dsh-api-digest.md)
- 变更记录：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT

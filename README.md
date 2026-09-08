# 金刚琢 RingCode

<p align="center">
  <strong>以本地工作区为中心的 Windows 原生 AI 辅助开发工作台</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2B%20(x64)-0078D6.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-31-47848F.svg" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB.svg" alt="React">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
</p>

---

**金刚琢（RingCode）** 专为多 Agent 协作时代的开发者打造。将**本地文件管理器、Monaco 代码编辑器、ConPTY 深度定制终端**与 **Claude Code / Codex / OpenCode / Antigravity CLI / Hermes** 深度融合在同一个三栏驾驶舱窗口中。

告别在浏览器、多个 CMD/PowerShell 窗口以及独立编辑器之间频繁切屏复制粘贴；以后接入新的 CLI Agent 只需一行适配器，全部交互统一闭环。

---

## 📸 界面预览

### 深色驾驶舱（Dark Cockpit · 默认）
![深色驾驶舱](docs/images/screenshot-dark.png)

### 浅色模式（Light Theme）
![浅色模式](docs/images/screenshot-light.png)

---

## ✨ 核心特性

- 🤖 **多 Agent 原生聚合驱动**
  - 原生适配并深度集成主流 AI 编程 Agent：**Claude Code**、**Codex CLI**、**OpenCode**、**Antigravity CLI**、**Hermes**，并支持自定义扩充。
  - 多终端 Tab 自由切换与分屏管理，各会话独立维持生命周期。

- 💻 **深度定制的 ConPTY 原生终端**
  - **括号粘贴模式（Bracketed Paste Mode）**：无论是单行指令还是数百行复杂代码，插入/粘贴均作为原子块整体注入，**绝不会因中间换行意外触发回车发送**。
  - **智能拖拽与路径转义**：直接把工作区文件或外部文件拖拽至终端，自动转换为规范路径并完成安全 Shell 转义。
  - 深度支持快捷键穿透与 Windows 原生键盘交互。

- 📜 **会话历史双轨解析与恢复**
  - 无缝解析各 Agent 存放在本地磁盘的原生历史会话文件（如 Claude Code `history.jsonl`、Antigravity `transcript.jsonl`、Codex、OpenCode 等）。
  - 按项目工作区目录**智能分组归档**，支持一键检索历史对话并恢复 CLI 上下文。

- 📝 **开箱即用的 Monaco 编辑器**
  - 内置 VS Code 同款 Monaco Editor，支持数十种编程语言语法高亮、缩进与诊断。
  - **一键“插入所选” / “插入路径”**：在编辑器中选定任意代码段或文件路径，一键原子注入当前终端 AI 会话，辅助提问更顺手。
  - 支持 Markdown 实时渲染与分栏对照预览。

- 🔒 **本地优先与系统级安全沙箱**
  - **系统凭据安全托管**：API Key 等敏感凭据直接托付给 Windows 凭据管理器（Credential Manager），渲染层全程不接触明文密钥，不落日志、不进导出。
  - **进程隔离与路径受控**：开启 `contextIsolation`，关闭 `nodeIntegration`。文件读写、Git 操作、搜索及 PTY 当前路径受控在已登记的工作区白名单内。
  - 文件删除直达 Windows 系统回收站，保障代码资产安全。

- 🎨 **高精致度设计系统**
  - 专为长工时开发者定制的深色驾驶舱风格（Direction B），兼具浅色变体，支持跟随系统自动切换。

---

## 🚀 快速上手

### 1. 二进制免安装运行（推荐）

前往 [Releases](../../releases) 页面下载最新版发布包：
1. 下载 `金刚琢.zip`；
2. 解压至本地任意目录；
3. 双击运行 `金刚琢.exe` 即可使用。

### 2. 源码本地运行与开发

#### 环境要求
- Windows 10 / 11 (x64)
- Node.js >= 18.x
- C++ 构建工具（`better-sqlite3` 与 `node-pty` 原生模块依赖）

#### 启动开发
```bash
# 1. 克隆代码仓库
git clone https://github.com/your-username/RingCode.git
cd RingCode

# 2. 安装依赖
npm install

# 3. 启动桌面开发环境（Vite 5174 + Electron）
npm run electron:dev

# 仅启动 Web 模式（Mock Shell 兜底）
npm run dev
```

#### 检查与打包
```bash
# 执行类型检查与 150+ 项单元测试
npm run typecheck
npm test

# 生产环境打包（生成绿色便携版 release/金刚琢）
npm run electron:compile
npm run build
npx electron-builder --dir
```

---

## 🛠️ CLI Agent 环境推荐与配置

金刚琢会自动检测系统中已安装的 CLI 工具，您只需确保对应的命令在 Windows 系统 PATH 中可用：

| Agent | 推荐安装 / 获取方式 | 核心适配特性 |
| --- | --- | --- |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | 自动抓取 `history.jsonl`，支持会话恢复 |
| **OpenCode** | 参考官方 OpenCode CLI 安装文档 | 自动捕获会话历史 |
| **Antigravity CLI** | 安装 Google Antigravity 官方 CLI (`agy`) | 自动索引 `transcript.jsonl` |
| **Codex** | 接入 OpenAI Codex / 官方 CLI | 交互式代码生成 |
| **Hermes** | 接入 Hermes 自动化 Agent 终端 | 自动化调度 |

*注：您也可以在「设置 ⚙ -> 凭据管理」中配置 API Key，凭据安全存放在 Windows 凭据管理器中。*

---

## 📐 项目结构

```text
RingCode/
├── electron/              # Electron 主进程（Node 环境，负责系统级能力）
│   ├── main.ts            # 主窗口管理、受控 IPC 通信白名单
│   ├── ptyLifecycle.ts    # ConPTY 原生伪终端管理与进程生命周期
│   ├── cred.ts            # Windows Credential Manager 凭据安全托管
│   ├── pathSafe.ts        # 工作区路径白名单与受控安全沙箱
│   └── historyIndex.ts    # 磁盘历史会话双轨检索与恢复引擎
├── src/                   # React 渲染层（受控沙箱，无直接 Node 权限）
│   ├── components/        # 核心 UI：EditorPane, TerminalView, FileManager, GitView, SkillView...
│   ├── lib/agents.ts      # Agent 适配器定义与命令构建
│   ├── lib/terminalRegistry.ts # 终端实例注册与 Bracketed Paste 调度
│   ├── store/             # Zustand 全局状态管理
│   └── styles/tokens.css  # 核心设计系统 Token
├── docs/images/           # 界面预览截图
└── release/               # 生产打包产物
```

---

## 🤝 贡献与反馈

欢迎提出功能想法、提交 Issue 或发起 Pull Request！
如遇到使用问题，请在 [GitHub Issues](../../issues) 提交时附带必要复现步骤。

---

## 📄 开源许可证

本项目遵循 [MIT License](LICENSE) 开源协议。您可以自由使用、修改、分发与商业化，仅需在衍生版本中保留原始版权声明。

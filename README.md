# DeepSeekHarness桌面版（自用）

> 官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 Windows 桌面壳。
> 内置固定版本的 dsh 运行时，双击即用；壳层不碰官方代码，官方更新不影响壳层，壳层更新 = 换一个内置版本重打包。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 这是什么

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是一个"一切都是插件"的 agent 框架（TypeScript + Cordis），官方只发布 Web UI（`dsh web`，本地 127.0.0.1:3080）。本项目把它包装成 Windows 桌面软件：

- **单个 EXE 安装器**（可自选安装盘符）或 **便携单文件 EXE**（适合移动硬盘，数据随盘走）
- 内置 `node.exe` + 固定版本 `@deepseek-ai/dsh`，**免装 Node、离线可用**
- 壳层功能：4 套护眼主题 / 右下角作者频道角标 / 系统托盘 / 全局快捷键 / 开机自启 / 一键检查更新 / 运行日志

## 功能

| 功能 | 说明 |
|---|---|
| 内嵌官方 Web UI | `dsh web` 以 node 侧车进程运行，端口自动探测 3080~3090 |
| 4 套护眼主题 | 深海蓝(默认) / 深夜黑 / 护眼墨绿 / 暖纸色；作用于角标、选区高亮、滚动条 |
| 右下角角标 | 默认"▶ 作者 B站频道" → [space.bilibili.com/34234499](https://space.bilibili.com/34234499)，文字/链接可在设置页改，链接留空即隐藏 |
| 托盘常驻 | 关闭窗口=最小化到托盘；托盘菜单：显示/设置/数据目录/B站/官方仓库/重启/退出 |
| 全局快捷键 | `Ctrl+Shift+Space` 呼出/隐藏窗口 |
| 开机自启 | 设置页开关 |
| 检查更新 | 对比 npm 官方仓库最新 dsh 版本与内置版本 |
| 便携数据模式 | 数据目录跟随 exe（安装版可在设置页切换；便携版默认开启） |

## 安装与使用

**安装版**：双击 `DeepSeekHarness桌面版（自用） Setup 0.1.0.exe`，安装时可选任意盘符（D:、E:、移动硬盘均可）。

**便携版**：把 `DeepSeekHarness桌面版（自用） 0.1.0.exe` 拷到任意位置（含移动硬盘），双击即用，数据自动落在 exe 旁边的 `data\` 文件夹。

首次启动约需 1~2 分钟（dsh 首次初始化 profile，窗口有进度提示），之后启动只需几秒。进入界面后按引导填入 DeepSeek API Key 即可开始使用（Key 存在 dsh 自己的数据目录，不经过壳层）。

> 未做代码签名，首次运行可能见 SmartScreen 提示，点"仍要运行"即可。

## 从源码构建

```bash
# 1. 准备运行时 (下载 node.exe + 安装固定版 dsh)
bash scripts/prepare-runtime.sh

# 2. 安装构建依赖 (Electron + electron-builder)
npm install

# 3. 生成图标 (可选, 已有 icon/icon.png 可跳过)
./node_modules/.bin/electron scripts/make-icon.js

# 4. 打包 (NSIS 安装版 + 便携版)
./node_modules/.bin/electron-builder --win
# 产物在 dist/
```

开发模式：`./node_modules/electron/dist/electron.exe .`；加 `DSH_DESKTOP_DEBUG=1` 启动 8 秒后自动截图到数据目录 `debug.png`。

### 更新内置 dsh 版本

1. 改 `scripts/prepare-runtime.sh` 的 `DSH_VERSION`
2. 改 `main.js` 的 `DSH_VERSION`
3. `bash scripts/prepare-runtime.sh` → `electron-builder --win` → 分发新安装包（覆盖安装不影响数据）

## 项目结构

```
├── main.js                 # 主进程：侧车管理/托盘/主题/角标注入/便携/快捷键/自启/IPC
├── preload.js              # 安全 IPC 桥 (contextIsolation)
├── settings.html           # 设置页：主题/角标/自启/便携/更新/日志
├── loading.html            # 启动加载页
├── icon/icon.png           # 应用图标 (scripts/make-icon.js 生成)
├── scripts/
│   ├── prepare-runtime.sh  # 固化运行时: node.exe + 固定版 dsh + node-pty 链接 + 瘦身
│   └── make-icon.js        # 图标生成 (Electron 离屏 canvas)
├── runtime-bundle/runtime/ # 打包进安装包的运行时 (gitignore, 由脚本生成)
└── dist/                   # 产物 (gitignore)
```

## 已知踩坑（换机器构建必读）

1. **npm 12 拦截 install scripts**：项目内安装必须把包名写进 `package.json` 的 `allowScripts` 字段；命令行 `--allow-scripts` 会被拒。
2. **node-pty 原生模块**：npm 装完不会自动链接；真实路径嵌套在 `node_modules/@deepseek-ai/dsh-subprocess-local/node_modules/node-pty`，需手动把 `prebuilds/win32-x64/*` 拷进其 `build/Release/`（prepare-runtime.sh 已自动处理）。
3. **electron-builder 不拷 node_modules**：`extraResources` 拷贝源根目录下的 `node_modules` 会被硬编码过滤 → 必须套一层包装目录 `runtime-bundle/runtime/`。
4. **打包极慢/体积失控**：NSIS 默认开差分更新（blockmap）会无视 `compression` 配置强制 `-mx=9` 单线程极限压缩 → 必须设 `nsis.differentialPackage: false`；同时 `compression: "store"` 要放在 `win.compression`（build 根级不生效）。
5. **Bun 单文件编译不可行**：dsh 依赖 Node 22 专有 API `node:module.stripTypeScriptTypes`。
6. **首次启动超时**：profile 初始化约 60~90 秒，健康检查超时给了 120 秒。

## 免责声明

- 本项目为**自用**外壳，非 DeepSeek 官方出品；dsh 本体归 DeepSeek AI（MIT License）。
- dsh 处于 developer preview，接口随时可能破坏性变更；壳层通过固定内置版本隔离该风险。
- 角标/主题等壳层功能与 dsh 官方无关，链接指向作者 B站频道。

## License

[MIT](LICENSE) © 2026 满分虎 (manfenhu)

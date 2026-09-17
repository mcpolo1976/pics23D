# 图片生成3D模型

根据图片（或文字描述）生成 3D 模型的 Electron 桌面应用。v1 接入腾讯混元生 3D，预留 Meshy / Tripo / Hi3D 扩展位。

## 项目结构

- `src/main` — 主进程：Provider 抽象（`src/main/providers/`）、任务队列与状态机（`src/main/task/`）、凭据 safeStorage 加密（`src/main/services/`）
- `src/preload` — contextBridge 暴露 `window.api`
- `src/renderer` — React 三栏 UI：任务历史 / Three.js 预览 / 参数与积分确认
- `src/shared/types.ts` — Provider / Task / IPC 共享类型（唯一事实源）
- `tests/` — vitest 单测（计费、状态映射、队列、压缩决策、存储等）
- `scripts/` — CDP 冒烟测试（`cdp-smoke.mjs`、`cdp-smoke-m5.mjs`）与测试夹具

## 开发

```bash
$ npm install
$ npm run dev        # 开发模式（renderer 热更新；主进程改动需重启）
$ npm run test       # vitest 单测
$ npm run typecheck  # TS 类型检查
```

## 构建（Windows）

```bash
$ npm run build:win -- -c.electronDist=node_modules/electron/dist
```

产物：`dist/ImageTo3D-<version>-setup.exe`（NSIS x64，可选择安装目录，未签名 —— SmartScreen 提示属正常）；免安装版在 `dist/win-unpacked/`。

本机构建的两个注意点（electron-builder 26 + Windows）：

1. **electronDist 参数**：electron-builder 解压 Electron zip 后 rename 到 `dist/win-unpacked` 时可能因杀毒/索引服务占用句柄报 `EPERM: rename ... win-unpacked.tmp`。加 `-c.electronDist=node_modules/electron/dist` 改用"复制已解压 Electron"路径绕开。
2. **powershell.exe**：electron-builder 26 在 Windows 上通过 `powershell.exe -EncodedCommand` 调用 npm 收集依赖。若 shell 的 PATH 缺少 `C:\Windows\System32\WindowsPowerShell\v1.0`，会报 `spawn powershell.exe ENOENT`，把它加进 PATH 即可。

### 冒烟测试

```bash
# 打包版带调试端口启动
$ ./dist/win-unpacked/img-to-3d.exe --remote-debugging-port=9222 &
$ node scripts/cdp-smoke.mjs       # 通用冒烟（11 项：IPC/凭据/计费/鉴权错误路径）
$ node scripts/m5-fixture.mjs      # 应用停止时注入"已中断"夹具任务
$ node scripts/cdp-smoke-m5.mjs    # 恢复查询 → 取消 → 删除（5 项）
```

冒烟安全策略：已配置**有效密钥**时只读探测并跳过写入/提交类检查，防止误耗积分；未配置或密钥无效时使用内置假密钥走错误路径（不产生云端任务）。

## 数据位置

- userData：`%APPDATA%\img-to-3d\`（tasks.json、settings.json、credentials.json、models/、logs/）
- 开发版与打包版**共用**同一 userData（Electron 以 package.json `name` 为 app 名）；换机器安装后需重新录入密钥
- 密钥经 Windows DPAPI（safeStorage）加密，界面只显示掩码

## 接入新服务商

在 `src/main/providers/` 新建目录实现 Provider 接口（capabilities / estimateCost / validateCredentials / submitJob / pollJob），并在 `registry.ts` 注册一行即可；参考 `src/main/providers/stubs/` 的预留桩。

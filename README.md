# dsh-plugin-session-delete

v1.1.0

在左侧边栏**右键会话**→ 菜单里出现「删除会话」→ 二次确认后，把这个会话的全部持久化痕迹删干净，且不碰其它会话。

（同时也会挂进会话行「⋯」菜单，两条入口共用同一套确认与删除逻辑。）

## 变更记录

- **v1.1.0** —— 修掉「切到别的会话后仍然提示该会话已打开」。原来拿 `ctx.agents.get(id)` 当“是否正在打开”，但 DSH 的 Agent 注册表会把进程内打开过的会话一直持有到进程结束，切走也不释放。现在只拦“确实有活在跑”，并补上 stop 后等待清空、收尾复查（`residualPaths`）、删除后 `agent/pre-step` 墓碑拦门。返回值新增 `residualPaths` / `liveAgent`。
- v0.1.0 —— 初版：右键菜单、二次确认、会话目录 + 投影缓存 + 工作区记账三处清理。

## 删了什么

| 位置 | 内容 |
|---|---|
| `$DSH_HOME/sessions/<project>/<sessionId>/` | 整个会话目录（所有格式代际的 `session*.jsonl[.zstd]`），删空后顺带回收空掉的 project 目录 |
| `$DSH_HOME/storages/session_projcache/sessions/<sessionId>.json` | 投影缓存记录（先走 storageDomain 的内存表写链，再兜底删文件） |
| `$DSH_HOME/storages/workspace.json` | 该会话在 `sessionIds`、`pinnedSessionIds`、`archivedSessionIds` 里的全部引用 |

内容寻址的附件（`$DSH_HOME/attachments`）与派生图片缓存（`$DSH_HOME/cache`）是**多会话共享**的，故意不动 —— 删它们才会损坏其它会话。

## 安全边界

- 会话 id 先过 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（长度 ≤ 200），再映射成单个路径段；删除前还会断言目标确实是会话根目录下、以该编码 id 命名的一级目录，杜绝路径穿越与通配删除。
- **不以「运行时还持有这个 Agent」为拒绝条件。** DSH 的 Agent 注册表会把进程内打开过的每个会话一直持有着，用户切走也不释放——拿它当“是否正在打开”会误伤几乎所有会话（第一版就是这么错的）。真正该拦的是“有东西在跑”，那由 `workspace/session-activity` 报出来。
- 会话有在跑的工作（turn / job / subagent / schedule）：确认后走和「归档」同一条 `workspace/session-stop` 通道，然后轮询等它清空（默认最多 4s，可用 `settleMs` 调），停不干净就报 `session-active` 且不动任何文件。
- 删完等 400ms 再扫一遍会话目录；活着的 Agent 在 teardown 时若又落下一个文件，这一遍会清掉，并记进 `residualPaths`。
- 被删的 id 进一个进程内墓碑集合，并挂一条 `agent/pre-step` 拦门（形状同归档会话的 gate）：迟到的投递只会以 `blocked` 收场，不会把日志重新写出来。
- HTTP 接口只在 `127.0.0.1` 的 webServer 上注册一条 `exact` 路由，并要求：`POST` + `application/json` + `Origin` 与 `Host` 同源（无 `Origin` 的本地进程调用放行，跨站浏览器请求一律 403）。不设置任何 CORS 头。

## 接口

```
POST /dsh-session-delete
content-type: application/json
{ "sessionId": "session-...", "stop": true }

200 { "ok": true, "result": { sessionId, removedPaths, residualPaths, projectionCache,
                             detachedWorkspaces, activityStopped, liveAgent } }
409 { "ok": false, "code": "session-active", "message": "...", "activity": [...] }
400 / 403 / 405 / 415 / 500  其余校验失败
```

路由可用插件配置覆盖：`config: { route: '/my-delete' }`；`config: { storageRoot: '...' }` 可显式指定 storages 根目录（默认从会话根目录的父目录推导，再回退到 `$DSH_HOME/storages`）。

## 安装

插件包已经是一个可直接加载的 bundle（`package.json` 的 `dsh.bundle.patch` + `dsh.client`），Host 半边 `lib/index.js`、浏览器半边 `lib/client.js` 都是最终产物，无需构建。

从 GitHub 仓库装（`plugin_manager` 的 `install_bundle` 支持 git 地址，会先 `git ls-remote` 探一下再交给 pnpm）：

```
install_bundle  target = https://github.com/<你的用户名>/dsh-plugin-session-delete
```

本地目录装：target 填本目录的绝对路径：

```
install_bundle  target = <本目录绝对路径>
```

或者自己跑随包脚本（幂等，先 `--dry-run` 看一眼）：

```powershell
cd <本目录>
$node = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node .\install.mjs --dry-run
& $node .\install.mjs                 # 默认 desktop profile，可加 --profile <name>
```

脚本会：用运行时自带的 pnpm 把本目录作为 `file:` 依赖装进 profile → 把包名追加到 `dsh.profile.bundles` → 按哈希把包内容同步进安装目录 → 复查。它要写 profile 目录（在 DSH 工作区之外），所以只能由你自己执行。

手动等价操作：

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add file:<本目录绝对路径>
```

然后把包名加进 profile `package.json` 的 `dsh.profile.bundles`：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-plugin-session-delete"
    ]
  }
}
```

Live profile 会即时 recompose；否则重启应用。装好后**刷新一次页面**，浏览器半边才会进入模块表。

## 测试

```powershell
node test/delete.test.mjs
```

覆盖：只删目标会话（目录 + 缓存）而其它会话逐字节不变、工作区记账摘除、storageDomain 写链、**运行时仍持有 Agent 也照删**、收尾窗口里又被写回来的目录会被复查清掉、running 任务先停后删、停不干净就拒删、非法 id 全拒、HTTP 校验链与成功链路、浏览器半边 `apply()` 的插槽注册与右键捕获、客户端 bundle 可解析且只注册自己的模块 id。

## 改完代码要重启进程

Host 半边的模块由 Cordis Loader 按 URL 走 ESM 缓存，而 profile 的 `hmr.config.root` 默认是 `[]`（不监视任何模块目录）。所以：

- 改 `lib/index.js` / `lib/core.js` 后**必须重启 DeepSeek Harness**，运行中的进程不会换新代码（官方原话：Package replacements require restarting the process to load a fresh JavaScript module generation）。
- `lib/client.js` 同理：模块系统在组合时就把 bundle 字节快照进内存了，光刷新页面也不会换。
- 判断跑的是哪一版：`POST` 一个不存在的合法 id，看 `result` 里有没有 `residualPaths` / `liveAgent` 两个字段——有就是新版。

## 安装后的自检（2026-09-29 实测）

装进 `desktop` profile 后：

- `GET /dsh-session-delete` → `405 {"ok":false,"code":"method-not-allowed"}`：Host 半边已在运行中的进程里挂上路由。
- `POST /dsh-session-delete`（一个不存在的合法 id）→ `200`，返回完整 `result` 且 `removedPaths` 为空：整条管线在真实 DSH 实例里跑通。
- 客户端插槽树里能看到两个登记项：`shell.overlay` 的 `session-delete.overlay`，以及 `sidebar.workspaces.session.menu.item` 的 `delete-session`，都是 `active: true`。
- 实测确认没有文件句柄常驻：对最近写入的会话日志用 `FileShare.None` 独占打开全部成功，所以删一个空闲的、仍被 Agent 持有的会话不会撞 Windows 的占用锁。

注意安装方式的选择：`pnpm add file:` 会把包内容**物化**进 profile 的 `node_modules`（首次多半是硬链接，但之后任何一次「写临时文件再改名」的编辑都会换掉 inode、剪断链接），于是安装目录会停在旧字节。所以：**改完源码跑一次 `node install.mjs`**——脚本的第 3 步会按 SHA-256 逐个比对源码与安装目录，不一致就覆盖，并打印 `安装目录与源码逐文件一致`。pnpm 那一步失败（例如权限被拦）但目录已存在时也会继续同步，不会白跑。

## 实现约定（改代码前先读）

- 会话目录布局沿用 `dsh-session-persistence-jsonl` 的 `<root>/<projectKey>/<encodeSegment(id)>/`。`lib/core.js` 里的 `encodeSessionSegment` 是该实现的精确复刻；如果上游编码规则变了，这里要跟着改。
- 投影缓存路径沿用 `dsh-storage-json` 的 per-record 布局 `<storages>/<domain>/<table>/<key>.json`。
- 侧边栏会话行的 DOM 契约是 `[data-row-key="session:<id>"]`（ui-workspace 写入）。右键入口依赖它；「⋯」菜单入口依赖 `sidebar.workspaces.session.menu.item` 插槽。两条入口互为兜底。
- 删除后若被删的是当前主视图，浏览器半边直接 `location.reload()` 拿干净状态；否则调 `ctx.sessions.refresh()`。

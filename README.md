# file-cleanup

v1.3.0

左上角「编辑」右边多一个「文件清理」按钮 → 选清理哪里（**所有工作区** / **DSH_HOME**）→ 先扫一遍 → 弹窗写明**本次清理区域 + 风险提示 + 本次要删的完整清单** → 确认后才动手。

只删白名单里的垃圾，删除范围严格限定在你选中的目录内。

## 交互流程

1. 点左上角「文件清理」（Windows 桌面：接在 preload 的标题栏菜单条「编辑」右边）。
2. **选区域**：`所有工作区`（列出每个工作区路径）或 `DSH_HOME`（显示实际路径）。此步只调 `describe`，不读不删。
3. **扫描**：Host 侧遍历一遍，统计可清理项的数量与体积，并把**全部候选路径**一起带回来。此步**不删除任何东西**。
4. **确认弹窗**：写明本次清理区域（根目录绝对路径）、风险提示四条、将删除的文件/目录数量与预计释放体积，以及本次要删的清单（按体积降序）。
   - 清单**一次性全部渲染**进一个固定高度、可滚动的框里——条目多就自己滑动看，没有展开 / 收起这类二次交互。框的可视区固定为**五行半**（115px = 5 × 18px 行高 + 半行 + 上下 8px 内边距），露出的那半行就是「下面还有」的提示。整体也只列到 2000 条，超出时框下面会写明「只列出体积最大的 N 项」。
5. 点「开始清理」才真正删除——**删的就是第 4 步里那份清单**（浏览器半边把它原样回传，Host 只删这些、不会再自己重扫一遍）。结束后给出结果，并支持「复制清单」。
6. **扫完发现没有垃圾**：确认弹窗里不再出现「开始清理」，只留一个**绿色**的「完成」按钮把界面关掉；风险提示与清单也一并隐藏（没东西可删，列风险只是噪声）。

扫描与清理之间可以随便取消；取消只是关掉界面，不会留下半截状态。唯一例外是**点下「开始清理」之后**：删除已经交给 Host 跑起来了，这时标题栏按钮与弹窗的 × 都不再响应，直到结果回来——否则界面先散场，用户既不知道删了什么，也看不到失败项。

## 删了什么

| 类别 | 规则 |
|---|---|
| 临时文件 | `*.tmp`、`*.temp`、`*.part`、`*.partial`、`*.crdownload`、`*.download`、`*.swp`、`*.swo`、`*.swn`、`*.stackdump`、`*.$$$`、`foo.txt~`、`~$report.docx`、`hs_err_pid*.log` |
| 系统噪声 | `Thumbs.db`、`ehthumbs.db`、`desktop.ini`、`.DS_Store`、`._*`、`npm-debug.log*`、`yarn-error.log*`、`pnpm-debug.log*`、`*.orig`、`*.rej`、`core.<pid>`、`.eslintcache`、`.stylelintcache` |
| 可再生缓存目录 | `__pycache__`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.pytype`、`.hypothesis`、`.ipynb_checkpoints`、`.cache`、`.parcel-cache`、`.turbo`、`.sass-cache`、`.nyc_output`（整棵删） |
| 空目录 | **只回收「因为本次删除才变空」的目录**，从被删项往上收，碰到选中根就停。原本就存在的空目录不动。 |

范围差异：

- **所有工作区**：对每个已登记工作区的 `path` 递归清理。整棵跳过 `.git`、`.hg`、`.svn`、`node_modules`。
- **DSH_HOME**：额外把 `$DSH_HOME/cache`（派生图片缓存，可再生）的内容整体回收，但 `cache` 目录本身保留；`sessions`、`storages`、`profiles`、`attachments`、`dsh-runtimes`、`llm-deepseek` 整棵跳过，绝不进入。

**不在删除范围内的东西**：源码、文档、配置、构建产物（`dist` / `build` / `target` / `.next` 等）、附件、会话日志、工作区记账、`credentials`。

## 安全边界

- **范围围栏**：每个待删路径在删除前都断言「严格位于某个选中根目录之内」，且不等于根目录本身。三个粒度都查：`resolve()` 后的规范路径、`path.relative` 相对路径判定、Windows 大小写不敏感比较。
- **选中根先过 `realpath`**：目录联接 / 符号链接当根时，围栏落在**真实目标**上，而不是链接路径。DSH 自己注册工作区也是这么归一的，界面里显示的范围因此就是真正会被动的目录。
- **卷根拒收**：选中根不能是 `D:\` / `/` 这种卷根。`DSH_HOME` 区域下如果 HOME 退化成卷根，直接报 `no-dsh-home` 而不是返回一个空计划。
- **工作区与 DSH_HOME 不得重叠**：相等、工作区在 DSH_HOME 里面、工作区把 DSH_HOME 包住，三种都整条跳过并记警告（第三种会顺着遍历走进 DSH_HOME，删掉它自己的原子写中间文件）。
- **不跟随链接**：遍历时符号链接与目录联接一律跳过——既不进入它的内部，也不删链接本身。
- **白名单而非黑名单**：只有规则表命中的文件才进候选；没命中就永远不动。误判方向永远是「少删」。这条在删除时**独立复核**：浏览器回传的清单只被当成「申请」，每一条都要重新过一遍范围、白名单与 `lstat`，不合格的进 `failures` 而不是被执行。
- **确认的就是删除的**：清理只删确认框里出现过的那份清单。扫完之后才冒出来的文件不会被「顺手」带走。
- **二次确认**：前端有确认弹窗，Host 侧还要求请求体显式带 `confirm: true`（否则 428），防止误触发。
- **接口只对本机同源开放**：注册一条 `exact` 路由，要求 `POST` + `application/json`，且 `Host` 必须是回环地址（`localhost` / `127.x` / `::1`，挡 DNS rebinding）、`Sec-Fetch-Site` 不能是 `cross-site`、带 `Origin` 时必须与 `Host` 同源（无 `Origin` 的本地进程调用放行）。绑定到 0.0.0.0 之类的非回环地址时，浏览器请求会被这条挡掉——这是有意的。不设置任何 CORS 头。
- **单任务互斥**：同一时刻只跑一个清理任务，第二个请求拿 409。
- **删除不可逆**：不进回收站。被占用删不掉的文件会被跳过并计入 `failures`，在结果里列出来，不影响其余删除。
- **不写任何日志文件**：清理过程不会在选中范围之外落下任何东西。

## 接口

```
POST /file-cleanup
content-type: application/json

{ "action": "describe" }                                  → { dshHome, workspaces[], scopes[], busy }
{ "action": "scan",   "scope": "workspaces"|"dsh-home" }  → 预览（数量 / 体积 / 分类 / 完整清单 / 警告）
{ "action": "clean",  "scope": "...", "confirm": true,
  "items": [{ "path": "..." }] }                          → 实际删除结果（只删这批；省略 items 才回退为重扫）

200 { ok: true,  result: { ... } }
400 / 403 / 405 / 413 / 415 / 428 / 409 / 500 { ok: false, code, message, details? }
```

`scan` 的 `result` 形状：

```
{ scope, roots[], cacheRoots[], rootsLabel[],
  totals { files, dirs, bytes },
  categories { temp|noise|cache: { count, bytes } },
  items[≤2000] { path, kind: 'file'|'dir', category, bytes },   // 本次全部候选，按体积降序
  itemsTruncated,                                               // 超过 2000 条才为 true
  scanFailures[≤100], scanFailureCount,
  warnings[], visited, capped }
```

`clean` 的 `result` 形状：

```
{ scope, roots[], cacheRoots[], rootsLabel[],
  removedFiles[≤400], removedFileCount,
  removedDirs[≤400],  removedDirCount,
  removedEmptyDirs[≤400], removedEmptyDirCount,
  freedBytes,
  failures[≤100] { path, message }, failureCount,
  scanFailures[≤100], scanFailureCount,
  warnings[], visited, capped }
```

路由**固定**为 `/file-cleanup`，不能配置：浏览器半边拿不到 Host 的 `config`，允许改路由只会让两边各记一个路径、改完就是 404。

## 安装

插件包已经是一个可直接加载的 bundle（`package.json` 的 `dsh.bundle.patch` + `dsh.client`），Host 半边 `lib/index.js` / `lib/core.js`、浏览器半边 `lib/client.js` 都是最终产物，无需构建。

```powershell
cd D:\DSworkspace\plugins\file-cleanup
$node = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node .\install.mjs --dry-run
& $node .\install.mjs                 # 默认 desktop profile，可加 --profile <name>
```

脚本会：用运行时自带的 pnpm 把本目录作为 `file:` 依赖装进 profile → 把包名追加到 `dsh.profile.bundles` → 按 SHA-256 把包内容同步进安装目录 → 复查。它要写 profile 目录（在 DSH 工作区之外），所以得由你自己执行。

手动等价操作：

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add file:D:/DSworkspace/plugins/file-cleanup
```

然后把 `file-cleanup` 加进 profile `package.json` 的 `dsh.profile.bundles`。

装好后**刷新一次页面**，浏览器半边才会进入模块表。

## 测试

```powershell
& $node .\test\cleanup.test.mjs
```

覆盖：规则表的命中与不命中（源码 / 文档 / 配置 / `core.js` 都不能被误判）、`isWithin` 严格子路径语义、卷根与缺失路径被拒、工作区计划组装与警告、**完整扫描 + 删除后非垃圾文件逐字节不变、范围外的兄弟目录不受影响**、**只回收本次变空的目录**、**符号链接不跟随不删除**、`DSH_HOME` 下会话 / 存储 / profile / 附件 / 运行时 / `node_modules` 一律不动而 `cache` 内容被回收、`cache` 目录本身保留、HTTP 校验链（方法 / 回环 Host / 同源 / `Sec-Fetch-Site` / content-type / action / `confirm` / 413）、HTTP 全链路、**`scan` 回传的是全部候选而不是抽样**、浏览器半边可加载并注册 `shell.overlay` 与中英词典、**确认框的清单一次性全渲染且可滚动、空态绿色「完成」、黄色「风险提示」在源码里的结构约束**、**客户端引用的 ui-primitives 导出在 app.asar 里全部真实存在**，以及 v1.3.0 的这一批：**工作区与 DSH_HOME 相等 / 互相包含时整条跳过**、**选中根是目录联接时围栏落在真实目标上**、**清理只删确认过的清单（预览后新出现的垃圾留下）**、**回传清单被重新校验（白名单外与范围外都拒）**、**嵌套工作区不重复列**、**`..` 开头的目录名不再自相矛盾**、**`cache` 子树只算一次**、**DSH_HOME 是卷根时报错**、**`~` 展开**、**`apply()` 只挂固定路由**、**客户端回传清单 / 清理途中不自散 / 兜底不留观察器**。

> 注意：别用 `node --test test/cleanup.test.mjs`。测试跑器会以管道方式 spawn 子进程，在受限沙箱下会 `spawn EPERM`；直接 `node test/cleanup.test.mjs` 即可。

## 改完代码要重启进程

Host 半边的模块由 Cordis Loader 走 ESM 缓存，profile 的 `hmr.config.root` 默认不监视模块目录。所以：

- 改 `lib/index.js` / `lib/core.js` 后**必须重启 DeepSeek Harness**。
- 改 `lib/client.js` 后光刷新页面也不够（模块系统在组合时就把 bundle 字节快照进内存了）；重跑一次 `install.mjs`（它会按哈希同步）再重启。
- 判断跑的是哪一版：`POST { "action": "describe" }`，返回值里有 `cacheRoots`、`scopes`、`busy` 就是这一版。

## 实现约定（改代码前先读）

- 左上角菜单条是 Desktop preload 用 `div[data-windows-menu]` + `attachShadow({ mode: "open" })` 注入的，里面是 `[role=menubar]` 与两个 `button`（应用 / 编辑）。本插件直接往那个 bar 里 `append` 自己的按钮，因此排版、悬停样式、`-webkit-app-region: no-drag` 命中区域都跟「编辑」一致。preload 的 `update()` 只改它自己那两个按钮的 `textContent`，不会清掉外来节点。
- 上游若改了菜单条结构，`attach()` 找不到 bar 就退回固定落点的按钮（`FALLBACK_ANCHOR`），入口不会消失。
- 文件类别规则集中在 `lib/core.js` 顶部的四张表（`TEMP_FILE_PATTERNS` / `NOISE_FILE_NAMES` / `NOISE_FILE_PATTERNS` / `CACHE_DIR_NAMES`）与两张跳过表（`SKIP_DIR_NAMES` / `DSH_HOME_PROTECTED`）。要放宽或收紧口径，改表即可，其余代码不用动。
- 工作区列表优先问运行时的 `workspaceRegistry.list()`，拿不到就退回读 `$DSH_HOME/storages/workspace.json` 的 `tables.workspaces[*].path`。

## 变更记录

**v1.3.0** —— 缺陷修复与冗余清理。围栏与计划层：

- **工作区与 DSH_HOME 相等时不再漏网**。旧判定用的是 `isWithin`，而它对「相等」返回 false，于是「工作区 = DSH_HOME」这条既不跳过也不记警告，扫描会一路走进 `sessions` / `storages`，把 DSH 自己正在写的原子写中间文件（`*.tmp`，命中临时文件规则）删掉。现在相等、被包含、以及**包含** DSH_HOME 三种关系都整条跳过并记警告。
- **选中根先过 `realpathSync.native`**。目录联接当根时，旧代码拿链接路径做围栏、拿目标目录做删除，等于嘴上说一个范围、手里删另一个范围。Windows 上必须用 `.native`（JS 版 realpath 不解析联接）。
- **`DSH_HOME` 退化成卷根时直接报错**，而不是 `validateRoot(... ) ?? resolve(...)` 折回之后返回一个 `roots: []` 的空计划、让 `cacheRoots` 单独生效。
- **`isWithin` 不再把名字以 `..` 开头的目录判成外部**（`..weird` 是合法的一段）。以前扫描认它是候选、删除又拒绝它，清理结果里会冒出「拒绝删除选中范围之外的路径」这种自相矛盾的失败项。
- **嵌套工作区只留最外层**，同一条垃圾不再在预览里列两次、体积也不翻倍。

确认与执行：

- **清理只删确认框里那份清单**。旧实现 `clean()` 会自己重扫一遍，预览之后新冒出来的文件会被用户从没见过地删掉。现在浏览器半边把清单原样回传，Host 逐条**重新**校验（在范围内、名字仍属白名单、`lstat` 后不是链接）——清单只是申请，判定权仍在 Host，不在白名单里的一律进 `failures`。为装下这份清单（最多 2000 条），请求体上限从 16KB 提到 1MB，超过报 413。
- **清理途中界面不再自己散场**。点下「开始清理」后，标题栏按钮与弹窗的 × 都不再响应，直到结果回来；以前它们会把这一轮 invalidate 掉，删除照跑、结果被丢，用户什么也看不到。
- **`DSH_HOME` 区域不再把 `cache` 子树算两遍**（缓存根内容与主遍历各走一遍，清单里出现两条互相包含的路径、体积翻倍）。现在主遍历跳过缓存根。
- **`measureTree` 纳入条目预算**：以前每次测量缓存目录都是无上限遍历，一个巨大的 `.cache` 就能把「最多访问 500000 个条目」的承诺吃掉。
- **`$DSH_HOME` 里的 `~` 会展开**，与 `dsh-home-paths` 的解读一致（以前 `DSH_HOME=~/x` 会被解析成相对路径下的 `~\x`）。

接口：

- **路由固定**为 `/file-cleanup`：Host 侧原来支持 `config: { route }`，而浏览器半边是预构建产物、地址写死，配置一改功能直接不可用。
- **Host 必须是回环地址**（`localhost` / `127.x` / `::1`）。只比 `Origin == Host` 挡不住 DNS rebinding——攻击者页面把域名解析到 127.0.0.1 时两者会一起变成同一个非回环域名。
- 意外错误回 500 时只给一句通用话术，内部细节只进 Host 日志。
- 浏览器半边退到兜底按钮时断开 `MutationObserver`（以前它会一直挂着，每次 DOM 变动都白跑一遍 `querySelector`）。

冗余清理：跳过表不再在「计划」和「遍历」里各存一份（遍历统一走 `isSkippedDirName` + 本范围额外表）；候选对象里没人读的 `entries` 字段去掉；`revalidateClaims` 里没人读的 `categories` 统计去掉。测试 21 → 32 条。

**v1.2.0**

- 去掉 v1.1.0 加的「展开 / 收起」按钮：确认框里的清单改成**一次性全部渲染**，靠清单框自身的固定高度 + `overflow:auto` 滑动查看。展开前后看到的东西其实一样（都在同一个滚动框里），等于白点一下，所以整个交互和 `COLLAPSED_SHOWN` 常量、`.file-cleanup-expand` 样式、中英两条文案一起去掉。
- 清单框的可视高度从 220px 收到 115px，正好露五行半（半行提示还能往下滑）。
- 超过 2000 条的截断提示保留（那时才需要说明「只列出体积最大的 N 项」）。

**v1.1.0**

- `scan` 不再只回传「体积最大的 80 项抽样」，改为回传**本次全部候选**（`items`，按体积降序，上限 2000 条并在 `itemsTruncated` 里标明）。原来的 `samples` 字段去掉。
- 确认框里原来那行「仅列出体积最大的 N 项」换成一个「展开 / 收起」按钮（v1.2.0 已去掉，见上）。
- 扫完没有垃圾时，确认框不再给「开始清理」，改为一个绿色的「完成」按钮；风险提示与清单一并隐藏。
- 「风险提示」标题改为黄色（`--dsw-alias-state-warn-primary`），跟下面的正文区分开。
- 顺手把插件自己的 css 里写错的告警色变量名（`--dsw-alias-state-warn-label`，主题里没有这个 token，一直在吃 fallback）改成真实存在的 `--dsw-alias-state-warn-primary`。
- README 的安装示例路径跟着插件目录搬家更新为 `D:\DSworkspace\plugins\file-cleanup`。

**v1.0.0**

- 首版：`describe` / `scan` / `clean` 三段式，白名单 + 范围围栏 + 符号链接跳过 + DSH_HOME 保护目录。

# Edge 通道操作手册

只走本机 Edge 的已登录会话，不装额外运行时。

> **2026-11-16 起主力通道改为 CDP**（见第七节）。原因：browser-mcp 通道点不开 beast/Ant Select 下拉、也没有给 `<input type=file>` 塞文件的能力，而申诉表单这两样都必须用。`edge.cjs` 保留作兜底与只读用途。

## 一、两条通道，任选其一

| 通道 | 何时用 | 说明 |
|---|---|---|
| 会话内 `mcp__browser__*` 工具 | 新会话里工具已注入 | 直接用，参数见工具描述 |
| `scripts/edge.cjs` | 工具没注入（常见） | 直接跟同一个 browser-mcp 服务说 MCP 协议，能力完全一致 |

`edge.cjs` 会自动找 `browser-mcp.exe`（`~\.workbuddy\native-runtimes\browser-use\browser-use\bin\`，或 `~\.workbuddy\mcp.json` 里的配置）。找不到时设 `BROWSER_MCP_EXE` 指向它。

## 二、能力边界（别绕，绕不过去）

- **没有 `evaluate`**：这套工具不能执行页面 JS，`edge.cjs eval` 会直接告诉你这一点。
- **DOM 快照只覆盖顶层文档**：iframe 里的内容（申诉详情页的退款申请单、聚水潭 `order/list.aspx` 的订单表格）抓不到，只能截图读。
- 实测分工（2026-11-16，订单申诉列表页）：
  | 想读的东西 | 能不能从快照拿 | 做法 |
  |---|---|---|
  | 页签与各页签数量 | ✅ 一行文本里 | `dom` 直接 grep |
  | 订单号 | ✅ 每行一个 `<a>` | `dom` + 正则 `\d{6}-\d+` |
  | 「发起申诉/售后详情/暂不申诉」按钮 | ✅ 有 node_id | `click` 直接点 |
  | 商品规格、退款金额、退款时间、倒计时 | ❌ 不在快照 | 进详情页截图 |
  | 详情页的退款申请单、商品、售后状态 | ❌ 在 iframe | `shot` + `crop.ps1` + `view_image` |
  | 申诉弹窗的文本字段 | ✅ 在顶层 DOM | `dom` 读 node_id，`click` 聚焦 + `type` 填写 |
  | 申诉弹窗的**下拉框** | ⚠️ 能看到 input，但**点不开** | 必须 `focus` 后用 `tap` 坐标点 |

  所以：**填文本用 DOM，展开下拉和点 iframe 里的按钮必须坐标点击**。这不是多余的一步，是通道差异。

## 二之二、坐标点击的前提（2026-11-16 踩了一天）

程序化点击（`dom_cua_click`）只对 `<button>`、`<a>` 生效；对 Ant Design 的 Select（readonly input）无效，因为它监听 `mousedown`，而程序化 `click()` 不产生 mousedown。

坐标点击（`cua_click` / `tap`）**必须先让窗口在前台**，否则点击静默失败、页面毫无反应：

```powershell
node $E focus "订单申诉"                       # 先激活标签页
node $E tap   "订单申诉" --at 982,386          # 再坐标点击（单位是 CSS 像素）
```

判定坐标对不对：`focus` 之后 `tap` 一次，如果页面没变化，八成是坐标偏了或窗口没激活，不要连续瞎点。

## 三、命令

```powershell
$E = "F:\WorkBuddyData\.workbuddy\skills\pdd-appeal\scripts\edge.cjs"

node $E list                                  # 列浏览器和标签页（先跑这个）
node $E find   "订单申诉"                      # 确认目标页
node $E dom    "订单申诉" --out run\dom.txt     # 顶层文档快照
node $E shot   "订单申诉" --out run\shot.png    # 整页截图（PNG 宽高会打印出来）
node $E click  "订单申诉" "售后详情#1" --out run\a1   # 点含该文字的节点，第1个
node $E click  "订单申诉" 123                  # 直接点 node_id
node $E type   "订单申诉" --text "ORD-XXXX-XXXXXX"
node $E key    "订单申诉" --keys ctrl,a
node $E key    "订单申诉" --keys Enter
node $E goto   "@new" --url "https://mms.pinduoduo.com/orders/appeals/aftersale/order?from=list"
node $E hover  "聚水潭" --at 1660,150 --out run\hover.png
node $E close  "拼多多 商家后台"                # 关详情页（关完会核对真的没了）

# 2026-11-16 新增
node $E focus    "订单申诉"                     # 把标签页拉到前台（坐标点击前必做）
node $E tap      "订单申诉" --at 982,386 --out run\a.png   # 坐标单击
node $E dblclick "订单申诉" 104                 # 快照节点双击
node $E scroll   "订单申诉" --at 500,300 --dy 800 --out run\b.png   # 在指定点滚轮
node $E fullpage "订单申诉" --out run\full.png  # 整页截图（含滚动区，一次读全）
node $E key      "订单申诉" --keys Tab --page   # 页面级按键（可移动焦点）
```

`<tab>` 参数支持：标题/URL 关键字、`@active`（当前选中页）、`@0`（第 0 个）。
**注意标签页顺序每次查询可能不同**，`@0/@1` 不稳定；用标题关键字最稳，现场指代当前页用 `@active`。

## 四、读表格文字的标准做法

> ⚠️ **2026-11-16 起 `crop.ps1` 在本机不可用**：脚本内部用 `Add-Type -AssemblyName System.Drawing`，被安全策略拦（`Add-Type compiles and loads .NET code at runtime`，退出码 -1）。Pillow 也装不上（pip 无网络）。所以裁剪放大这条路暂时断了，改为**整页截图 + 直接读**：`view_image` 对 1897×901 的整页图读 10 行表格、读窄栏聊天都能读准，只是偶尔要换问法多问一次。
>
> 若要恢复裁剪：让 `crop.ps1` 改走 `System.Drawing.Common` 的已加载程序集，或用浏览器 `fullpage` 截图后靠 `view_image` 分段提问。

```
1) node $E shot "<tab>" --out run\<页>.png          # 记下 PNG 宽高
2) view_image run\<页>.png                          # 整页读，问得越具体越准
3) 同一张图重复问会被判定为 identical image        # 换一张新截图或改问法
```

- **不要用 `shot --clip` 猜坐标**：实测 clip 的坐标系与截图不一致（给的 (525,215) 拿到的是 (525,130) 附近的内容），裁出来永远偏。要么整页读，要么用 `fullpage`。
- 一次只问一类信息：先问「有哪几列」，再问「第2到第5行的卖家备注」。
- 读到的数字（包数、件数、片数）要能和另一处独立信息对上再采信。

## 五、实操坑（都踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `没找到含...的标签页` | 标题含换行/空格 | 用更短的关键字，先 `list` 看真实标题 |
| 跨进程操作报错或点错页 | **tab_id 只在同一进程内有效** | 每条 `edge.cjs` 命令自己完成认领+操作，不要拆成两次调用 |
| `@0/@1` 指到了别的页 | 标签页顺序每次查询可能不同 | 改用标题关键字或 `@active` |
| 点弹窗按钮没反应 | 弹窗按钮用 node_id 直点常无效 | 改用文本点击：`click "@active" "取消#1"` |
| 详情页 title 还是「拼多多 商家后台」 | SPA 路由只换内容不换 title | 靠 URL 或页面快照里的订单号确认是哪一单 |
| 快照里找不到退款金额/商品 | 内容在 iframe | 改截图 + crop |
| 点击后页面没变化 | 点到了容器节点 | 快照里看该行的 `node_id` 与文本，换成带文字的那个节点 |
| 截图是 2000×2000 空白 | 用了 `--clip 0,0,4000,4000` 这类越界值 | 直接 `shot`（返回真实视口，实测 1897×901），裁剪交给 `crop.ps1` |
| 中文 JSON 读不进来 | PowerShell 5.1 的 `Set-Content -Encoding UTF8` 写 BOM | 用 `node` 写文件，或 `[IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($false))`；`run.cjs` 已容错 BOM |
| 终端输出中文变乱码 | PowerShell 管道按 GBK 解码 node 的 UTF-8 输出 | 让 `edge.cjs` 写文件，再从文件读；或 `chcp 65001` |
| **坐标 `tap` 点了像没点** | 窗口没在前台，CUA 静默失败 | 先 `node $E focus "<tab>"`，再 tap |
| **下拉框点了不展开** | Ant Select 要 mousedown，`dom_cua_click` 是程序化 click | 用 `focus` + `tap` 坐标点开 |
| `crop.ps1` 退出码 -1、无输出 | `Add-Type` 被安全策略拦 | 放弃裁剪，整页截图直接读 |
| 同一张图第二次 `view_image` 报 identical image | 工具做了图片去重 | 重新 `shot` 一张新文件再问 |
| `click <node_id>` 没反应 | node_id 是快照作用域，换进程/换弹窗就失效 | 一律用文本模式（`"发起申诉#1"`、`"售后详情#1"`） |

## 六、操作边界

- **只操作当前已登录的会话**，不登录、不收验证码、不过滑块；遇到验证码由用户本人在 Edge 里完成。
- 列表页翻页、打开详情、读聊天、截图：直接做。
- 填表：可以自动填，填完必须截图核对（原因、金额、正文、附件数）。
- **点「提交」：需要用户本批授权数量**（`run.cjs init --quota N`），且先 `begin` 再点，点完立刻 `finish`。没有明确出现「申诉提交成功」就记 `unknown` 并停下。
- 不后台挂机、不多店铺并发、不批量狂点。

---

## 六之二、多店独立实例（2026-11-17，用户定的长期方案）

一家店一个独立 Edge 实例，互不干扰。**每店一个 `--user-data-dir`（登录态隔离）+ 一个 `--remote-debugging-port`（控制通道隔离）**。优点：多店登录态并存、不用反复退出重登；每店都能走 CDP 快通道。免费，2–5 店够用。

快捷方式目标模板（换了目录名和端口即可复制一份）：
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir="F:\edge-shops\店B" --remote-debugging-port=9223 --no-first-run --no-default-browser-check
```

- 端口从 9222 起顺延，各实例不可重复（现有兔小贝 = `F:\edge-cdp-profile` + 9222）。
- 新目录是空的，首次要本人手登一次该店账号，cookie 之后留在目录里。
- 工具已全部支持用环境变量切端口：`$env:CDP_PORT=9223` 后跑任意脚本即控制对应店（cdp/close/grab/submit/fill/probe/focus-window/reasons/review 均已改）。默认仍是 9222。
- 系统在默认 profile 的店（无端口）只能走 browser-mcp 兜底通道，慢且读不到 iframe 文本；建议逐步迁到独立实例。

## 六之三、工位移动 / U 盘便携方案（2026-11-17 用户最终采用）

用户工位会移动、每天登录的店会变、**登录态无所谓**，且工位自带浏览器只登聚水潭、没有拼多多。结论：不做多店并存，改为**一个便携 Edge 实例跟着 U 盘走，每天手登当天的店**。

关键事实（已核实）：
- 用户整套 AI 环境本来就在 U 盘：`F:` 是**可移动磁盘**（DriveType=2，28.7G）。`WorkBuddy.exe` 在 `F:\ai\WorkBuddy\`，skill 在 `F:\WorkBuddyData\.workbuddy\skills\`，工作文件在 `F:\减负\`、`F:\2026-*`。
- **CDP 是 Edge 内核自带能力，不依赖任何浏览器插件**：只要便携 Edge 带 `--remote-debugging-port` 启动，`cdp.cjs` 连 `127.0.0.1:<端口>` 即可，与工位电脑是否装过扩展无关。
- 唯一在 C 盘的 browser-mcp 插件只服务"默认 profile 登聚水潭"的兜底通道，拼多多流程已弃用，不跟着 U 盘走也不影响。

便携方案落地：
- 启动脚本 `F:\start-pdd-edge.bat`（U 盘根目录，纯英文避免 bat 编码乱码）。用 `%~d0` 自动取脚本所在盘符 → 换工位/换盘符不用改；Edge 程序用工位电脑自带的（`%ProgramFiles(x86)%`），profile 固定 `<U盘盘符>\edge-cdp-profile`，端口 `9222`，启动前检测端口占用。
- 每天流程：插 U 盘 → 双击 bat → 本人手登当天店铺 → 让 AI 开跑（AI 自动连 9222）。登录态无所谓，可随时删 profile 目录重来。
- 同一 profile 可同时登聚水潭和拼多多（不同域 cookie 隔离），不冲突。

注意：脚本不写死盘符是核心；以后无论 U 盘变成哪个盘符，双击同一个 bat 即可。

## 六之四、多浏览器便携启动器（2026-11-17 用户要求：其他浏览器也搞成跟 Edge 一样）

用户后续会把不同店登在不同浏览器里。启动器统一放在 **`F:\浏览器`**（U 盘上，跟着走），一个浏览器一个独立 profile + 一个 CDP 端口，可同时开多家店：

| 启动脚本 | 浏览器 | 端口 | profile |
|---|---|---|---|
| `start-edge.bat` | Edge | 9222 | `F:\edge-cdp-profile`（沿用原登录态） |
| `start-chrome.bat` | Chrome | 9223 | `F:\浏览器\profiles\chrome` |
| `start-qqbrowser.bat` | QQ 浏览器 | 9224 | `F:\浏览器\profiles\qqbrowser` |
| `start-sogou.bat` | 搜狗高速 | 9225 | `F:\浏览器\profiles\sogou` |

- 当前工位实装：Edge / Chrome / QQ 浏览器 / 搜狗（360、2345 只有残留目录无主程序，Firefox 不支持 CDP）。
- 脚本用 `%~dp0` / `%~d0` 自动取所在目录和盘符，换工位/换盘符不用改；启动前查端口占用，冲突会提示。
- **AI 怎么控制**：用户会说明「用 9223 跑这台店」，此时把 `$env:CDP_PORT=9223` 再跑 cdp/grab/fill 等脚本；不说明就默认 9222。所有脚本已支持 `CDP_PORT` 覆盖。
- 加新浏览器：复制 `F:\浏览器\_模板-其它浏览器.bat`，改端口(9226+)、profile 名、exe 路径；仅 Chromium 内核可用。详见 `F:\浏览器\使用说明.md`。

## 七、CDP 通道（2026-11-16 起主力）

Edge 以 `--remote-debugging-port=9222 --user-data-dir=<独立目录>` 启动后，`scripts/cdp.cjs` 直连原生调试协议，是内核级真实事件，能点开一切下拉、能直接塞文件。端口可用 `$env:CDP_PORT` 覆盖（见六之二）。

### 7.1 基础命令

```powershell
$C = "<技能目录>\scripts\cdp.cjs"

node $C tabs                                  # 列页面（先跑这个）
node $C eval  0 "document.body.innerText"     # 跑 JS（唯一能读取页面数据的方式）
node $C nav   0 "https://..."                 # 导航
node $C shot  0 --out a.png [--full]          # 截图（--full 整页）
node $C mouse 0 690 162                       # 真实鼠标点击（视口坐标）
node $C click 0 "css选择器"                    # 程序化点击（合成事件，下拉别用）
node $C upload 0 "input[type=file]" a.png     # 塞文件（DOM.setFileInputFiles）
node $C frames 0                              # 列 iframe
```

`<target>`：序号（0/1）、标题/URL 关键字、`@active`。

### 7.2 批量业务脚本（本技能自带）

| 脚本 | 作用 |
|---|---|
| `probe.cjs <订单号...>` | 逐单打开申诉弹窗，读「最多可申诉」金额后取消。批量摸底金额用 |
| `grab.cjs <输出目录> <订单号...>` | 逐单点「售后详情」，抓正文 + 整页截图 + 关键字段，自动关页 |
| `fill.cjs --task t.json` | 填一单（原因/金额/描述/凭证），默认**不提交** |
| `submit.cjs [--shot x.png]` | 点「提交申诉」并判结果（SUCCESS/UNKNOWN/FAILED） |
| `close.cjs` | 关掉当前弹窗（点右上角 X） |

`fill.cjs` 的 task 文件（UTF-8，避免中文走命令行参数）：

```json
{
  "order": "ORD-XXXX-XXXXXX",
  "amount": "1.40",
  "desc": "申诉正文……",
  "evidence": ["F:\\...\\ev\\ORD-XXXX-XXXXXX.png"],
  "shot": "F:\\...\\shots\\fill-xxx.png",
  "submit": false
}
```

### 7.3 申诉表单实测结构（2026-11-16，维权申诉→运费申诉）

- 字段：**申诉订单号**（只读）/ **申诉项** / **申诉原因**（级联，必选）/ **申诉金额**（必填）/ **申诉描述**（必填）/ **必填凭证** / 选填凭证。
- **「申诉原因」是两级级联**：一级「退货运费 / 其他」→ 二级四项：
  1. `消费者无理由退货，退货运费不应商家承担` ← **运费申诉固定选这条**
  2. `消费者退货寄到付件`
  3. `平台扣除退货运费金额过高`
  4. `消费者体验提升计划（原退货包运费服务）失效导致额外被扣运费`
- **申诉金额有硬上限**，字段下方显示「最多可申诉 X 元」，填超了会被拦。这个数字**远小于**详情页显示的「已补偿运费金额」（例：已补偿 8.74，实际只能申诉 0.12）。**必须逐单 probe，不要按详情页金额填。**
- **必填凭证区在选完申诉原因后才出现**（图片 ≤3、视频 ≤2）。不传图能点提交，但页面提示「无凭证将会导致申诉失败」，所以默认传 1 张详情页截图。
- 同一订单可能同时有**货款申诉 + 运费申诉**：此时「申诉项」是**两个复选框**，两个区块各自有原因/金额/上限。只做运费时**必须先取消货款勾选**，否则会连货款一起提交（`fill.cjs` 已自动处理并校验）。
- 提交后无二次确认，直接出「申诉提交成功」结果弹窗（含「继续申诉 / 查看申诉记录」）。

### 7.4 详情页

- URL：`https://mms.pinduoduo.com/aftersales-ssr/detail?id=<售后编码>&orderSn=<订单号>`，**SSR 渲染、无 iframe**，`document.body.innerText` 能一次读全（退款申请单、订单、退货包运费、协商详情、聊天记录）。
- 但**聊天记录是异步加载的**，页面刚打开时是「加载中...」，见下方坑表。

### 7.5 CDP 专属坑（2026-11-16 踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| **误判「无聊天记录」** | 详情页刚开、聊天区还是「加载中...」就抓了 innerText，拿到「暂无售后聊天记录」 | 等待条件必须是「含售后编码 **且** 不含『加载中』**且** 文本连续 3 次不变」；抓前先滚到底触发懒加载。`grab.cjs` 已按此实现 |
| 中文参数传给 node 变乱码 | PowerShell 5.1 用 ANSI(GBK) 编码命令行参数 | 中文一律**写进 UTF-8 文件**由脚本读；非要在命令行写就用 `\uXXXX` 转义（如 `'\u53d1\u8d77\u7533\u8bc9'`） |
| `DOM.getDocument` 超时 | `depth:-1, pierce:true` 取全树，页面太大 | 改 `depth:0`，`DOM.querySelector` 仍能全树查找 |
| 点操作列没反应 | 右上角「消息」面板自动弹出，盖住操作列和分页 | 点击前先点 `ImportantList_close` 关掉面板；`fill.cjs` 已内置 |
| 点页码没反应 | 分页在视口外（rect.y > 视口高），坐标点击落空 | 点之前 `scrollIntoView({block:'center'})`，再取 rect |
| 翻页后找不到行 | 表格异步渲染，1.8 秒不够 | 翻页后轮询 `FIND_ROW` 最多 4 秒 |
| 提交成功却判 UNKNOWN | 结果弹窗不是 toast，选择器没匹配到 | 用 `body.innerText` 匹配「申诉提交成功」判定 |
| 已经提交的单还在列表里 | 列表有缓存，不随提交实时刷新 | 以**申诉记录页**为准核对 |
| 列表里把已提交当未提交 | 运费项提交后该行消失，货款+运费双项的单只提交运费后仍在列表 | 核对走「申诉记录」按订单号搜索 |



## 八、申诉复议（2026-11-17 新增）

### 8.1 入口与表单
- 入口：申诉记录页，失败行的操作列有「详情 / 发起复议」。列头可勾「仅查看复议订单」。
- 表单字段：申诉订单号（只读）/ 申诉项 / 申诉失败原因（+查看详情）/ **复议原因（两级级联，必选）** / **复议金额（必填，有上限「最多可申诉 X 元」）** / **必填凭证** / 选填凭证 / **复议描述（必填，200 字上限）**。
- 复议原因二级选项（与申诉同一套）：
  1. 消费者无理由退货，退货运费不应商家承担
  2. 消费者退货寄到付件
  3. 平台扣除退货运费金额过高
  4. 消费者体验提升计划（原退货包运费服务）失效导致额外被扣运费
- 凭证区**选完原因才出现**，共 4 个 `input[type=file]`：
  - `[0]` 必填图片（≤3，accept .jpg,.jpeg,.png）
  - `[1]` 必填视频（≤2）
  - `[2]` 选填图片（≤3）
  - `[3]` 选填视频（≤2）
  - 必填位标题是「1、退货运费非商家责任的相关凭证」；选填位是「1、消费者误解商品存在问题或举证存在问题的相关凭证」。
- 提交成功提示是 **「已发起复议，请耐心等待」**（不是「提交成功」），**判定词必须包含「已发起复议」**，否则会误判 UNKNOWN。

### 8.2 级联下拉的正确点法
点开 select 后二级不会自己出来：**必须先 click 一级「退货运费」**（只展开不选中），等 900ms，再 click 二级项。只 hover 不点，二级永远不出现。

### 8.3 后台标签页是 hidden（本轮最大的坑）
窗口被遮挡或不在前台时，`document.visibilityState === 'hidden'`：
- 页面渲染停摆（`body.innerText` 只有导航，表格不出来）
- 坐标点击不生效（点了没反应）
- 弹窗会被页面自己关掉，看起来像「提交后被关掉」

处理：每条 CDP 会话建立后立即
```js
await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await s.send('Page.setWebLifecycleState', { state: 'active' });
```
`cdp.cjs` 已在 `Page.enable` 之后默认加上，`review.cjs` 也加了。这是**会话级**开关，每次新连接都要重设。另外可用 `focus-window.cjs` 把窗口 `Browser.setWindowBounds` 恢复成 normal 并 `Target.activateTarget`。

### 8.4 被浮层盖住时改用事件派发
右上角「新消息」浮层和「消息盒子」会盖住操作列，坐标点击会点到浮层上（表现为点了没反应、或打开消息盒子）。元素自身派发事件可以绕开遮挡：
```js
['mouseover','mousedown','mouseup','click'].forEach(tp=>
  el.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,button:0})));
```
对 `<a>` 类操作链接（详情 / 发起复议 / 页签）实测有效；对 beast 下拉、`input[type=file]` 仍必须走 CDP 真实事件。

### 8.5 已知结论（重要）
2026-11-17 实测：7 单运费申诉被驳（两类模板「商品存在问题/商家承诺运费」「不符合申诉通过条件」），对其中 2 单发起复议并补交第三方检测报告，**均在 5 分钟内被判「复议失败」**，理由「经核实，此单不满足申诉通过条件，不支持本次申诉」+「消费者近期反馈相似问题」。说明复议环节对「商品质量认定」不做实质复核，同一条原因重复提交转化率极低。复议前应先确认权益余额（页面「本月申诉复议权益 x/9」）。

## 九、负向体验 3 元扣款申诉（2026-11-17 首次跑通）

入口：`https://mms.pinduoduo.com/aftersales/customer_complain_appeal?from=list`（顾客投诉/消费者负向体验补偿明细）。**不在**售后订单申诉页（维权/订单赔偿/极速退款/极速换货四个页签里没有）。左侧菜单没有直达链接，功能搜索"负向"也只出帮助文档；让用户直接给 URL 最快。

列表：每行 = 订单号/商品/问题类型(商品问题 or 服务问题)/补偿金额(3元)/创建时间/处理状态。状态有「可申诉（带倒计时）」「申诉未通过已处罚」「申诉通过」。只有「可申诉」能提。

详情：列表点「查看详情」→ **开新标签** `aftersales/customer_complain_appeal/detail?ticketSn=MPxxx`。详情正文**异步加载**，必须等到出现「我要申诉」按钮 + 订单号才读到具体用户反馈（骨架阶段只有"补偿原因/相关订单"空标签）。用户反馈有两种模板：
- 模板A：`商品问题\n用户反馈...\n其他用户也曾反馈过类似问题`
- 模板B：`本单商品有较多消费者反馈商品问题，且反馈比例显著高于同类商品` + `相关描述：xxx`
- **共性提示判定**：A 的"其他用户也曾反馈"、B 的"反馈比例显著高于同类"都算有共性。用户标准"只提无共性提示的"时，B 类必须排除（脚本正则要同时覆盖两种措辞）。

**ticketSn 抓取**：行 HTML 里没有 ticketSn（点击时 JS 动态拼），必须逐单点「查看详情」→ 从新标签 URL 用 `ticketSn=(MP\d+)` 提取。注意登录/会话切换后 URL 里的 ticketSn 才出现。

**申诉表单**（点详情「我要申诉」→ 新标签 `orders/appeals/negativeExperience?orderSn=...&ticketSn=...`）：
- **关键坑：选申诉原因前，表单只有原因下拉 + 提交/取消，没有描述框、没有 file input。选完原因后才动态展开：`*申诉凭证`（上传图片 0/3、上传视频 0/1，2 个 input[type=file]）+ `*申诉描述`（textarea，必填）。** 别的类型申诉不要照搬这个"先选后展开"结构，也不要在选原因前就断言"表单很简单没有上传"。
- **申诉原因是必选下拉，5 个固定选项**：① 商品无问题，消费者误解 ② 商品有问题，但已与消费者达成一致其他售后方案 ③ 商品有问题，但消费者主动表示无需处理 ④ 消费者未表达商品问题（含售后详情内未描述问题等）⑤ 其他。注意：运费/货款话术里的"无凭证/肤质差异"等**没有对应选项**，只能选这 5 个之一；用户不确定时选「其他」。
- 申诉金额固定 = 补偿金额（3.00 元），不可改。
- 用户常用话术（选"其他"时填描述）：「我方已与消费者达成一致，进行了售后处理，完成了退款。希望平台审核清楚，还给我们一个清白，恳请撤销处罚。」；已退款完成的单可附对应品牌质检报告。
- **报告选错事故（2026-11-17）**：3 单【兔小贝】山茶花被错传 `A MOODO BABY 山茶花` 报告（品牌不同）。报告必须按**商品标题的品牌 + 品类**双匹配，精确映射见 `evidence.md` 二之二：**兔小贝山茶花→`A 山茶花 兔小贝`**；MOODO BABY 山茶花→`A MOODO BABY 山茶花`；TUTUBABY 蚕丝精灵→`A TUTUBABY 蚕丝精灵`。只凭「山茶花」字面取图会张冠李戴，开图核对「样品名称」。
- 填表脚本：批次目录里的 `fill-neg.cjs`（`node fill-neg.cjs tasks.json <idx> [--submit]`），默认只填不提交；task 含 order/ticketSn/reason/description/evidence。
- **提交成功判定**：页面出现「提交申诉成功」或 URL 跳到 `negativeExperience/detail?orderSn=...&appealSubId=...`（详情页有申诉时间/原因/金额/描述/凭证）。列表刷新后该单状态变「已申诉」= 最终确认。
- 2026-11-17 实测：兔小贝店 14 条负向扣款，12 条可申诉、5 条无共性提示的已提交（选"其他"+用户话术+质检报告），全部显示「已申诉」。

**2026-11-18 SHOP-XXXX店更新（用户确定，优先）**：
- 话术统一口径：所有负向 3 元申诉描述正文统一写「**已妥善处理售后退款 + 商品质检合格 + 无服务违规，恳请撤销扣款**」，不再按反馈类型（漏尿/尺码/发错货/过敏）分型。原因仍选「其他」。
- 报告品牌映射修正：SHOP-XXXX店商品标题写「TUTUBABY山茶花 / TUTUbaby正品山茶系列」，实际产品是**山茶花兔小贝**，报告必须用 `C:\Users\Administrator\Desktop\B 检测报告\A 山茶花 兔小贝\`（拉拉裤.jpg / 纸尿裤.jpg，按品类选，样品名称「兔小贝山茶花婴儿…」、委托单位福建省百顺）。**禁止**用 `A TUTUBABY 蚕丝精灵` 报告（另一条产品线）。映射已在 `report-map.json` 修正并同步三份。
- 事故记录：本批 23 单曾全部错传蚕丝精灵报告 + 笼统话术并已提交（平台不允许修改/重提），用户决定本批不再动，仅更新规则防再犯。

# 拼多多售后申诉 · AI 对接工具包

本目录是把做过的**运费申诉、极速退款、负向体验3元扣款**等流程用到的 skill、脚本、话术、凭证素材统一整理出来的工具包。目标是：**每个 AI 各管一个浏览器里的一个拼多多店铺**，互不串台。

整理时间：2026-11-17（2026-11-21 补：业务分类索引 + 仅退款/负向/暂不申诉三份实战总结）

---

## 第 0 步（必做）：先按业务分类查规则，不要直接动手

任何申诉任务开工前，先打开 **`话术库\00-业务分类索引.md`**，按业务类型找到对应文件再读：

| 业务 | 看哪份 |
|---|---|
| 仅退款 / 货款申诉 / 极速退款少退货 | `话术库\仅退款申诉话术思路参考.md` |
| 运费申诉 | `话术库\运费申诉话术库-2026-11-19.md` |
| 负向体验 3 元补偿 | `话术库\负向体验申诉-实战总结-2026-11-21.md` |
| 暂不申诉（三要素核对） | `话术库\暂不申诉判定与总结.md` |
| 赔付单 / 纠纷退款率 | `话术库\00-业务分类索引.md` 第四节 |
| 历史案例检索 | `话术库\申诉案例库-2026-11-21.json` |

三类申诉的话术**不能互串**：负向体验打"买家未沟通未举证"，仅退款打"举证不足 + 商家自证"，运费打"个人原因退货运费不应商家承担"。

---

## 一、目录结构

```
F:\ai对接\
├── README.md                     ← 本文件，先看这里
├── pdd-appeal-skill\             ← 完整 skill（唯一权威副本，开跑必读 SKILL.md）
│   ├── SKILL.md                  ← 工作流总纲 + 五条铁律
│   ├── references\
│   │   ├── edge.md               ← 浏览器/CDP 通道手册（含多浏览器启动 六之四）
│   │   ├── evidence.md           ← 凭证清单 + 检测报告品牌映射（二之二，必读）
│   │   ├── report-map.json       ← 检测报告「品牌+品类」自动匹配配置
│   │   ├── judge.md / types.md   ← 判定口径 / 四类申诉入口与话术映射
│   │   ├── reply-library.json    ← 91 条话术（结构化，脚本读这个）
│   │   ├── _source-product-lines.json ← 产品线原始资料
│   │   ├── library.md            ← 话术检索与改写规则
│   │   └── report-template.md    ← 报告模板（含极速退款暂不申诉清单）
│   └── scripts\                  ← 通用脚本（见下「三、脚本速查」）
├── 话术库\
│   ├── reply-library.json        ← 与 skill 内同源，方便单独取用
│   ├── _source-product-lines.json
│   └── 客服售前售后话术整理-丽丽.xls ← 原始话术表（人工查阅用）
├── 报告素材\
│   ├── B 检测报告\               ← 按品牌分目录的质检报告（拉拉裤/纸尿裤…）
│   └── 甲酰胺检测报告\           ← 甲酰胺舆情用，按品牌分
├── 浏览器启动器\
│   ├── start-edge.bat            ← Edge,  端口 9222
│   ├── start-chrome.bat          ← Chrome,端口 9223
│   ├── start-qqbrowser.bat       ← QQ浏览器, 端口 9224
│   ├── start-sogou.bat           ← 搜狗高速, 端口 9225
│   ├── _模板-其它浏览器.bat       ← 新增浏览器照此改
│   └── 使用说明.md
├── 历史脚本\                     ← 实战中验证过的批次脚本（当模板参考，含写死的路径/端口，用前改）
│   ├── 运费申诉\                 ← scan-express / grab-reasons / grab-notes / build-tasks / run-all
│   ├── 极速退款\                 ← drop / verify / mktodo
│   └── 负向体验\                 ← grab-neg / get-tickets / fill-neg / _analyze / _pick
└── 批次工作区\                   ← 空目录，每次任务在此下建日期批次
```

---

## 二、每个 AI 管一个店铺 —— 工作方式

约定：**一个浏览器 = 一个店铺 = 一个 CDP 端口**。多个浏览器可同时开着，各登各的店。

### 启动（人来做）
1. 插 U 盘，双击 `浏览器启动器\start-*.bat` 里对应浏览器的脚本（显示端口，如 `Port : 9223`）。
2. 在该窗口本人手动登录当天要管的店铺。
3. 告诉负责这个店的 AI：**「你用 9223 端口，店是 XX」**。

### AI 开跑前（必做，防串台）
```powershell
$env:CDP_PORT = 9223
node "F:\ai对接\pdd-appeal-skill\scripts\which-shop.cjs" --expect 店名关键字
```
确认输出 `ok:true`、`loggedInToMms:true`、`expectOk:true` 再动手。`expectOk:false` 或端口连不上 → 停下核实，**绝不带着错端口操作**（否则 A 店的 AI 会点到 B 店的店）。

> 所有脚本都读 `CDP_PORT` 环境变量，设一次即对该端口生效；不设默认 9222（Edge/兔小贝）。

### 跑任务
按 `pdd-appeal-skill\SKILL.md` 的工作流：建批次 → 扫列表 → 取证 → 判定 → 写文案（话术/报告） → 填表 →（用户授权后）提交 → 记账 → 汇报。批次建在 `批次工作区\` 下。

---

## 三、脚本速查（都在 pdd-appeal-skill\scripts\）

| 脚本 | 作用 | 典型用法 |
|---|---|---|
| `which-shop.cjs` | **开跑前自检**：确认端口连的哪家店、是否登录 | `node which-shop.cjs --expect 兔小贝` |
| `cdp.cjs` | CDP 主力通道：eval/nav/shot/鼠标/上传 | `node cdp.cjs tabs`、`node cdp.cjs eval 0 "document.title"` |
| `pick-report.cjs` | **按商品标题自动选对检测报告**（品牌+品类双匹配，防今天的错配） | `node pick-report.cjs "【兔小贝】山茶花拉拉裤"` |
| `reply.cjs` | 话术库检索：按类型/关键词/id | `node reply.cjs --type 运费`、`node reply.cjs --kw 漏尿` |
| `gen-report.cjs` | 生成报告，末尾自动附暂不申诉清单 | `node gen-report.cjs --batch <批次目录> --shop 店名` |
| `run.cjs` | 批次账本：额度/去重/防重复/unknown 阻断 | `node run.cjs init --run <dir> --quota 0` |
| `grab.cjs` / `probe.cjs` | 批量抓详情 / 探申诉金额上限 | 见 SKILL.md |
| `fill.cjs` / `submit.cjs` | 填表（默认不提交）/ 点提交判结果 | 见 SKILL.md |
| `review.cjs` | 复议填表 | 见 edge.md 第八节 |
| `fill-neg.cjs` | 负向体验3元填表 | `node fill-neg.cjs tasks.json 0 [--submit]` |
| `reasons.cjs` / `focus-window.cjs` | 批量读驳回理由 / 恢复窗口 | 见 edge.md |
| `edge.cjs` | 兜底通道（browser-mcp，慢，读不到 iframe） | CDP 不可用时 |

`历史脚本\` 里是实战时写的一次性脚本，路径和端口写死了，**只作模板参考**，复用前把路径/端口改成当前店和批次。

---

## 四、话术怎么用

- 91 条话术的结构化数据在 `话术库\reply-library.json`（也是 skill 内同源文件），字段：`id / appealType / scene / text / evidence / source`。
- 优先用 `reply.cjs` 检索，例如 `node reply.cjs --type 负向体验3元`、`node reply.cjs --kw 过敏`。
- `客服售前售后话术整理-丽丽.xls` 是原始表，人工查语境用；改写规则见 `references/library.md`。
- **四类是四类的话术，别串**：运费固定原因走级联「退货运费 / 消费者无理由退货…」，禁止选「其他」；负向3元不确定原因才选「其他」并填用户指定话术。

## 五、检测报告素材怎么用（重要，今天踩过坑）

`报告素材\B 检测报告\` 下按品牌分目录。**品牌和品类都要对上**，只凭「山茶花」三个字会选错（【兔小贝】山茶花 ≠ MOODO BABY 山茶花，是两份不同报告）。

- 自动选：`node pick-report.cjs "<订单商品标题>"`，输出报告绝对路径 + 应核对的样品名称。识别不了会返回 `ok:false` 让你人工确认，**不会乱猜**。
- 报告根目录已写成盘符自适应（`{DRIVE}`），U 盘换盘符也能自动找到本包的 `报告素材\`；找不到才退回 C 盘桌面素材。
- 精确映射表在 `references\report-map.json`，新品牌/新品类往里加。
- 手动核对规则见 `references\evidence.md` 二之二。上传前一定开图看「样品名称」与商品标题品牌一致。

## 六、汇报规范（用户要求，从下次执行）

- 通用：成功/跳过/待补查/失败各多少，订单号、金额、实际原因文本；待审核 ≠ 审核通过。
- **极速退款「暂不申诉」任务**：最终报告**末尾必须附「已点暂不申诉订单清单」**（逐单订单号+判定理由，全列），放最后供用户核对。模板见 `references\report-template.md`，可用 `gen-report.cjs` 自动生成。

## 七、备份与同步

- skill 权威副本在 `F:\ai对接\pdd-appeal-skill\`；另在 `F:\WorkBuddyData\.workbuddy\skills\pdd-appeal\` 和 `C:\Users\Administrator\.workbuddy\skills\pdd-appeal\` 各有一份（WorkBuddy 加载用）。三份内容一致，改动后要同步。
- 浏览器启动器同时存在于 `F:\浏览器\`（U盘根目录，方便双击）和本包 `浏览器启动器\`（备份）。

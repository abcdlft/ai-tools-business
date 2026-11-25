---
name: pdd-appeal
description: 拼多多售后申诉工作台（本机 Edge 已登录会话，零额外运行时）。覆盖运费申诉、货款/仅退款、负向体验3元扣款、服务违规四类：分页扫描申诉列表，批量开详情取证并截图留存，按「固定原因是否仍有可如实陈述的争议空间」逐单判定，从 91 条话术库选文并填表，经用户授权数量后提交，全程账本防重复与超额度。当用户提到拼多多售后申诉、运费申诉、货款申诉、仅退款申诉、扣款申诉、负向体验、申诉台、跑申诉、批量申诉时使用。不处理评价举报与商品下架申诉。
version: 1.0.0
user-invocable: true
---

# 拼多多售后申诉工作台

用本机 Edge 里**已登录**的商家后台完成申诉：扫列表 → 取证 → 判定 → 写文案 → 填表 →（授权后）提交 → 记账。

不依赖 Kimi WebBridge、不装 Python 包、不走 CDP、不动键鼠和剪贴板。浏览器通道见 `references/edge.md`。

## 六条铁律

1. **原因按事实选，「其他」可选**：运费申诉优先走 `退货运费 / 消费者无理由退货，退货运费不应商家承担`，但事实不符时**可以选「其他 / 非以上申诉原因」**并在描述写清。**唯一禁用的是带「商品有问题」字样的选项**（见第 6 条，四类申诉通用）。
2. **门槛是「有争议空间就提」**：不要求先证明商家无责，不设高把握门槛，不编造成功率。判定细则见 `references/judge.md`。
3. **没看清不等于不存在**：「申请单未附图」只说明当前材料未见该图，不能写成「商品没有质量问题」。
4. **默认只填不提交**：用户给出数量（"这次提 3 条"）才算授权；没有授权就填好表、截图给用户，**停在提交按钮前，由用户点**。
5. **结果不明就停**：点了提交但没看到「申诉提交成功」，记 `unknown`，先去平台申诉记录核对，**不重试、不连点**。
6. **不得承认商品有问题（四类通用）**：任何申诉的原因都**可以选「其他」**（事实撑不起具体项时），把理由写进描述；**唯一禁选的是带「商品有问题」字样的选项**。运费/货款/极速退款/负向体验都适用。

## 工作流

> 下面 `$S` 指本技能目录下的 `scripts`（用技能所在目录拼，不要写死盘符）。

### 0. 开跑前自检（多店防串台，必做）

用户后续每个 AI 各管一个浏览器店铺，各浏览器用不同 `CDP_PORT`（见 `references/edge.md` 六之四）。**动手前先确认自己连的是哪家店**：

```powershell
$env:CDP_PORT = <端口>                   # 端口不固定，由用户启动时提供；9223 是乐言专用口，别用
node "$S\which-shop.cjs" --expect 店名关键字
```

看 `ok` / `loggedInToMms` / `expectOk`：端口连不上、没登录、或 `expectOk=false` 就停下核实，**不要带着错的端口开始操作**。

### 1. 建批次

```powershell
$S = "<本技能目录>\scripts"
node "$S\run.cjs" init --run .\appeal\2026-11-16-运费 --quota 0 --note "运费申诉 第一批"
```

`--quota 0` = 只扫不提。用户给了数量再 `init --quota N`（新批次新建目录，别改老目录的 quota）。

### 2. 扫列表

打开申诉列表 `https://mms.pinduoduo.com/orders/appeals/aftersale/order?from=list`。默认在「可申诉订单 → 维权申诉」页签。

走 CDP 时一次 `eval` 就能读全表格（每行 `td` 依次是：订单号 / 订单信息 / 发货状态 / 实收金额 / 退款金额 / 退款时间 / 申诉项 / 申诉倒计时 / 操作按钮）：

```powershell
$js = @'
(function(){
  const rows=[];
  document.querySelectorAll('tr').forEach(tr=>{
    const t=Array.from(tr.querySelectorAll('td')).map(td=>td.innerText.replace(/\s+/g,' ').trim());
    if(t.length>3) rows.push(JSON.stringify({order:t[1],refund:t[5],rt:t[6],item:t[7],cd:t[8]}));
  });
  return rows.join('\n');
})()
'@
node "$S\cdp.cjs" eval 0 $js
```

分页在底部 `[data-testid="beast-core-pagination"]`，页码 li 按文字点；**点之前必须 `scrollIntoView`**，否则坐标在视口外点不到。每次翻页后轮询等渲染，别只 sleep 一次。

把每页读到的东西整理成数组写进 `records.json`：

```json
[{"order":"ORD-XXXX-XXXXXX","product":"全包臀拉拉裤3XL","refund":"99.5","refund_time":"2026-11-15 10:20","appeal":"运费","countdown":"23小时","page":1}]
```

```powershell
node "$S\run.cjs" records --run <dir> --file .\records.json
node "$S\run.cjs" list    --run <dir>
```

按 `订单号|退款时间|申诉项` 去重 —— 同一订单可以有多次独立退款事件，别只按订单号去重。有售后编号时优先用售后编号做区分。

**第一次跑某一类申诉时**：先确认入口页签真实存在（实测列表页只有维权/订单赔偿/极速退款/极速换货四类），再把「申诉原因」下拉点开截图，让用户确认选项文案后再选。不要凭历史经验直接选。

### 3. 取证（一次一组，通常 5 单）

逐单：点「售后详情」→ 读商品规格、件数、退款金额、售后编号 → 截聊天/申请单 → 关详情回列表。

- 详情页会开新标签，操作后先 `edge.cjs list` 看 `CURRENT`，再在那页上读和截。
- 聊天超过 6 张图或区块过长，记 `needs_review`，先收集同组其他单，再回来补截关键区间。
- **必须 `view_image` 看过图**再下结论。`images_reviewed: true` 不是盖章。

### 4. 判定

读 `references/judge.md`，按类型核对 `references/types.md`，逐单给结论：

- 提：写 `decision.json`（见下）
- 跳过：`node "$S\run.cjs" skip --run <dir> --key <key> --note "为何已无争议空间"`
- 待补查：`... skip --pending --note "哪份材料没看清"`

商品与已知问题（同款投诉、抽检、整改）的关系写进 `merchant_issue_check`，三种状态如实填，**不许为了好过而填 `clear`**。

### 5. 写文案

从 `references/reply-library.json` 按 `appealType` + `scene` 检索，改写规则见 `references/library.md`。凭证从 `references/evidence.md` 的素材库取，重量图按文件名匹配规格，不猜。

### 6. 决策文件

```json
{
  "order": "ORD-XXXX-XXXXXX",
  "supports_no_reason": true,
  "basis": "退款原因选7天无理由，买家自述不喜欢；聊天全程未提质量或破损，我方商品完好发出",
  "merchant_issue_check": {
    "status": "clear",
    "source": "本单聊天 + 退款申请单 + 店铺近30天同款投诉记录",
    "finding": "未见同款质量投诉；本单无破损描述",
    "dispute_basis": ""
  },
  "images_reviewed": true,
  "reason": "退货运费 / 消费者无理由退货，退货运费不应商家承担",
  "amount": "6",
  "evidence": ["绝对路径\\chat.png", "绝对路径\\C 重量图\\4XL拉拉裤 2包.jpg"],
  "description": "订单为个人原因7天无理由退货，商品不存在任何质量问题。根据平台规则，无理由退货运费应由消费者自行承担，平台极速退款时连带运费一并退回商家不认可，请求平台核实，返还商家运费损失。"
}
```

```powershell
node "$S\run.cjs" decide --run <dir> --file .\decision.json
```

`decide` 会拒掉：`supports_no_reason` 不为 true、`basis` 是空话、没看过图、`merchant_issue_check` 缺字段、已知冲突没写 `dispute_basis`、正文含「其他」。

### 7. 填表

**先 probe 再填**：逐单打开弹窗读「最多可申诉 X 元」，这个上限**远小于**详情页的「已补偿运费金额」（实测已补偿 8.74，只能申诉 0.12）。不要按详情页金额填。

实测「维权申诉 → 运费申诉」弹窗字段：**申诉订单号**（只读）/ **申诉项** / **申诉原因**（两级级联，必选）/ **申诉金额**（必填，受上限约束）/ **申诉描述**（必填）/ **必填凭证**（图片 ≤3）。

- 原因优先走：一级 `退货运费` → 二级 `消费者无理由退货，退货运费不应商家承担`；事实不符时**可选「其他 / 非以上申诉原因」**并在描述写清。带「商品有问题」字样的选项一律不选。
- 必填凭证区在**选完原因后才出现**，页面提示「无凭证将会导致申诉失败」，默认传 1 张本单详情页截图。
- 同一订单同时有货款+运费两项时，「申诉项」是**两个复选框**，两个区块各有独立的原因/金额/上限；只做运费必须先取消货款勾选。
- 命令：`node "$S\fill.cjs" --task <task.json>`（默认只填不提交），字段见 `references/edge.md` 7.2。

填完截图核对：原因文本、金额是否等于上限内、描述全文、附件张数。**核对通过前不点提交。**

### 8. 提交（仅在有授权额度时）

```powershell
node "$S\run.cjs" begin  --run <dir> --key <key>     # guard：有 unknown 或额度用完会拒
# 点提交，看到「申诉提交成功」
node "$S\run.cjs" finish --run <dir> --key <key> --result submitted --amount 6
```

没看到成功提示 → `--result unknown`，停。平台记录核对后 `resolve`。

### 9. 汇报

给出：成功 / 跳过 / 待补查 / 失败各多少单，订单号、金额合计、实际提交的原因文本。扫描总数标注扫描时点；提交后没重新扫描，就不要说「还剩多少单」。待审核 != 审核通过。

**极速退款「暂不申诉」任务专用**：最终报告**末尾必须附「已点暂不申诉订单清单」**（用户 2026-11-17 要求，从下次执行起生效），方便用户核对。清单要求：

- 放在报告**最后**，不影响前面「留存申诉 / 待人工核实 / 结果统计」的结构。
- 逐单列出：订单号、实收、退款、点「暂不申诉」的判定理由（如「到货包数=下单包数」「买2退1且退款约一包钱」）。
- 数量要与执行结果一致，并标注「共 N 单，0 失败 / 0 误点」（若有失败如实写）。
- 数据取自本批次的 `drop-result.json` / ledger；清单过长时可折叠成表格，但订单号必须全列，不能只写数量。
- 模板见 `references/report-template.md`。

## 中断与异常

- 用同一个 `--run` 目录恢复，不要新建、不要清日志。
- 有 `submitting` / `unknown` 时 `begin` 会被拒，这是设计如此：先去平台核对再 `resolve`。
- 详情页打不开、身份对不上、截图失败 → 保存已有进度，停下报告，不要盲点坐标或换条路重试。
- 页面改版（找不到「售后详情」按钮、原因选项变了）→ 停下，把当前页面截图给用户，确认后再调定位。

## 资源

| 文件 | 用途 | 何时读 |
|---|---|---|
| `references/judge.md` | 判定口径、门槛、basis 写法、三态核查 | 第 4 步，必读 |
| `references/types.md` | 四类申诉的入口、固定原因、情形→话术映射 | 第 2、4 步 |
| `references/reply-library.json` | 91 条话术（平台 56 + 产品 35） | 第 5 步 |
| `references/library.md` | 话术检索与改写规则、写作禁忌 | 第 5 步 |
| `references/evidence.md` | 凭证清单、桌面素材库、上传规则 | 第 5、7 步 |
| `references/edge.md` | 浏览器通道命令、表单结构、踩坑表 | 任何浏览器操作前 |
| `references/report-template.md` | 极速退款暂不申诉清单 / 通用申诉报告模板 | 第 9 步汇报 |
| `scripts/cdp.cjs` | **主力通道**：CDP 直连（eval/截图/真实鼠标/上传文件） | 全程 |
| `scripts/grab.cjs` | 批量取证：逐单开详情抓正文+截图 | 第 3 步 |
| `scripts/probe.cjs` | 批量探「最多可申诉」金额与申诉项 | 第 2、7 步 |
| `scripts/fill.cjs` | 填一单（原因/金额/描述/凭证），默认不提交 | 第 7 步 |
| `scripts/submit.cjs` | 点提交并判结果 | 第 8 步 |
| `scripts/close.cjs` | 关弹窗 | 全程 |
| `scripts/edge.cjs` | 兜底通道（browser-mcp，只读为主） | CDP 不可用时 |
| `scripts/run.cjs` | 批次账本：额度、去重、防重复、unknown 阻断 | 全程 |
| `scripts/which-shop.cjs` | **开跑前必跑**：确认当前 CDP 端口连的是哪家店、是否已登录（多店防串台） | 任何操作前 |
| `scripts/pick-report.cjs` | 按商品标题的品牌+品类自动选对检测报告（防错配） | 第 5 步选凭证 |
| `scripts/reply.cjs` | 话术库检索：按申诉类型/关键词/id 查 91 条话术 | 第 5 步 |
| `scripts/gen-report.cjs` | 从批次数据生成报告，末尾自动附暂不申诉清单 | 第 9 步 |

## 风险提示

模拟登录态操作商家后台可能触发平台风控。默认节奏是「一组 5 单、串行、每单留证」，不挂机、不多店铺并发。高频长期处理建议走拼多多开放平台 API。

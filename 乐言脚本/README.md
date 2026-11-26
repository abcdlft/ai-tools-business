# 乐言客服脚本包（中文）

> 用途：把乐言「智能助理 Nova」接待中枢的消息**读出来、分流、把可自动处理的会话标已读**，其余留在面板交人工。
> 纯 CDP（Electron 调试口）方案，无 npm 依赖，`node` 直跑。**不替客服对外发言**。

---

## 一、业务目标（先读这个）

乐言在线客服消息里，大量是平台卡片/固定话术，不需要人逐条点已读。这套脚本做的事：

1. **读**：从接待中枢拿消息快照（每条会话最后一句 + 角色 + 已读状态）；
2. **分流**：按 `ly-rules.cjs` 的规则给每条会话分类（见下）；
3. **标已读**：只把"机器人夜间话术 + 用户已点掉""已解决类"等**确定无需人工**的会话置为已读（面板上的 √√）；
4. **留人工**：售后、待回复、图片类、拿不准的**一律不动**，留在面板上等人看。

**边界（硬约束）**：
- 只置已读，**不删对话、不移出面板**；人工随时能复查，看完点「清除已读」可还原。
- **不发消息**。逆向确认过乐言有 `SendMessages` mutation，但以客服身份对外发言风险高，这套脚本不做。
- **9223 是乐言专用调试口**，任何浏览器都不能占（会撞车导致守护连不上）。

---

## 二、运行前提

1. 乐言客户端从**带调试参数的快捷方式**启动（桌面「智能助理 Nova」，参数含 `--remote-debugging-port=9223`）；
2. 端口探活：`curl -s http://127.0.0.1:9223/json/version` 返回即通；
3. 接待中枢窗口存在：CDP `/json/list` 里能看到 `reception-hub` 页面；
4. 调试口只能在**启动时**加载——如果乐言开着但没带参数，必须完全退出（含托盘）再从这个快捷方式重启。

> 启动/自检 Windows 脚本：`fix_leyan_lnk_v2.ps1`（修快捷方式参数）、`verify_leyan_debug.ps1`（重启后验证）、`parse_leyan_lnk_v2.ps1`（读快捷方式参数）。

---

## 三、启动顺序（怎么用）

### 常驻守护（推荐）
```
双击 D:\log\开启守护.vbs        # 启动守护，每 5 分钟一轮
双击 D:\log\关闭守护.vbs        # 停止
双击 D:\log\仅检测模式.vbs      # 只输出判定、不标已读（试运行/调规则用）
```
> 这三个 VBS 放在 `D:\log`（工位 2 的启停入口），脚本本体在 `D:\log\scripts\`。
> 本目录是**原型/备份**：改规则先改这里的 `ly-rules.cjs`，单测通过后同步到 `D:\log\scripts\`。

### 手动单次
```bash
node ly-hub.cjs snap                    # 读一次当前快照（JSON）
node ly-hub.cjs snap --tag NOT_REPLY    # 只看无人回复的会话
node ly-daemon.cjs --once               # 跑一轮守护（读→分流→标已读）
```

---

## 四、脚本职责

| 脚本 | 作用 |
|---|---|
| `ly-rules.cjs` | **分流规则（纯函数、无 IO）**：把每条消息判为 AFTERSALE / NOT_REPLY / RESOLVED / DONE 等。改分类逻辑改这里。 |
| `test-rules.cjs` | 规则单测：`node test-rules.cjs`，改完规则先跑它。 |
| `ly-hub.cjs` | 接待中枢消息流读取器；订阅 `PlatformMessagesEvent`，页面端按 `sellerId\|buyerId` 累积历史（上限 30 句、24h 清理），`snap` 导出快照。 |
| `ly-daemon.cjs` | 守护主循环：定时读快照 → 调 `ly-rules` 分流 → 对 DONE 类标已读 → 回读校验。间隔取 `daemon.config.json`（默认 300 秒）。 |
| `ly-start.cjs` | 以脱离方式启动守护（父进程退出后仍存活）。 |
| `ly-inject.cjs` | 页面加载前注入 RPC 监听（占位/调试用）。 |
| `ly-ws.cjs` | CDP WebSocket 客户端封装（被其他脚本引用）。 |
| `ly-nav.cjs` / `ly-reload.cjs` | 按 URL 关键字找目标页 / 刷新目标页。 |
| `ly-net.cjs` / `ly-trace.cjs` | 抓页面 XHR/Fetch、抓加载全过程网络流量（逆向用）。 |
| `asar-extract.cjs` | 最小 asar 解包器：`node asar-extract.cjs <app.asar> <outDir> [--list]`。 |
| `pdd-*.cjs` | 拼多多商家后台只读辅助（执行 JS、开页读文本、探接口），与乐言主线无强依赖。 |
| `daemon.config.json` | 守护配置：间隔、`markRead` / `showReadStatus` 开关。 |
| `ly-todo.json` / `batch-check.json` | 守护输出的待办快照 / 批量核对结果（运行时生成）。 |

---

## 五、分流类别（ly-rules.cjs）

| 类别 | 含义 | 动作 |
|---|---|---|
| `AFTERSALE` | 售后类（退货/换货/补偿） | **人工**，绝不自动已读 |
| `WAIT_REPLY` | 买家在等回复 | **人工** |
| `RESOLVED` | 已解决（地址改成功等 9 类） | DONE，可标已读 |
| `DONE` | 无需人工（含夜间话术+已点掉） | 标已读 |
| 图片类/拿不准 | 买家发图、语义不明 | **人工** |

> 原则：宁可留人工，不要误标。规则口径以 `ly-rules.cjs` 内的常量和注释为准。

---

## 六、历史坑（别再踩）

1. **钩子热升级必须同时换全局对象名 + 订阅 ID**（如 `__HUB_V4`/`__DAEMON_HUB_V4` + `lyhub3`/`lydaemon3`），否则旧匿名监听器先设 `sig`，新监听器被跳过、history 恒空。
2. **24h 清理**：每轮推送前 `while (ca.length && Date.parse(ca[0].at) < cutoff) ca.shift()`，空 key 删除。
3. **乐言重启常忘带调试参数**：重启后 9223 没监听，守护每轮报 `connect ECONNREFUSED`；从带参数快捷方式重启即恢复。
4. **同一批 jst-*.cjs 在多个目录有副本**，改一处要全同步（用 SHA1 核对，别信文件大小/旧缓存）。

---

_整理日期：2026-11-26 · 来源：`E:\减负\_tools` 原型 + `D:\log\scripts` 运行版_

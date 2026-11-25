// 乐言消息分流规则（纯函数，无 IO，方便单测）
//
// 分类：
//   AFTERSALE      售后类 —— 必须人工处理，绝不自动标记已读
//   MIX            混搭需求 —— 要改单/备注，人工
//   WAIT_REPLY     买家提问待回复 —— 最后一条是买家，没人答，不能标已读
//   PENDING_ROBOT  机器人敷衍抢答 —— 表面已回，实际没解决，要看
//   CONSULT        普通咨询 —— 已有人答/可自动应付，可标已读
//   UNSURE         判不准 —— 交 AI
//   DONE           人工已回复/终态 —— 可标已读
//
// 设计原则：
// 1. 拿不准一律 UNSURE，宁可多给 AI 一次，不可漏售后
// 2. 「换」「退」这种单字必须配对象词才算售后，避免误判
// 3. 平台系统卡片优先级最高
//
// 【可放掉清单】（2026-11-23 整理，DONE / 可标已读）
//   1. 终态通知：退款成功 / 交易完成 / 售后关闭            → TERMINAL
//   2. 已解决卡片：收货地址修改成功 / 商家同意退货退款      → RESOLVED
//   3. 退货已签收、等统一入库（用户定的，不算即时待办）      → INBOUND
//   4. 人工已回复：ASSISTANT_REPLY 或 role=ASSISTANT        → DONE
//   5. 机器人给了实质信息：尺码 / 厚度 / 发货时效等          → CONSULT
//   6. 机器人发了图片/视频（尺码表、产品图）                → CONSULT
//   7. 机器人引导走售后流程（给明确出路）                   → CONSULT
//   8. 夜间托管话术 + 人工已点过已读（人看过没问题）         → DONE
//   9. 历史里有已解决卡片且之后买家没新诉求                 → DONE（classifyHistory）
//
// 【必须留人工】售后 / 改地址 / 混搭 / 买家在等回复 / 机器人敷衍抢答 / 判不准
// 【注意】乐言接口每条会话只给末句，长对话要靠 __HUB_V3.history 在页面端累积；
//        「收货地址修改成功」这类卡片不在消息流里，只有进历史才能被识别。

// 平台侧动作（买家已在平台发起，权重最高）
const PLATFORM_AFTERSALE = [
  '申请售后', '申请退款', '申请换货', '申请退货', '售后申请',
  '平台介入', '小二介入', '平台处理', '官方介入', '平台判定',
  '已提交换货', '已提交退货', '已提交退款',
  '责任澄清', '需要您进一步澄清', '举证', '分歧',
  '投诉', '维权', '纠纷', '举报',
  '虚假发货', '超时未发货', '未按约定时间发货',
  '仅退款',
];

// 退货已到仓 —— 等统一入库，不是即时待办（可点掉，仅留档）
const INBOUND = [
  '退货商品已签收', '已签收，请您尽快处理', '退货已签收',
  '退货入库', '退回商品已收到', '请您尽快处理售后',
];

// 混搭需求 —— 必须转人工（改单/备注）
// 买家不一定说"备注"，可能直接说两个尺码或两种裤型
const MIX_WORDS = ['混搭', '混着', '混发', '各一', '各来', '各半', '一半', '搭配', '都要', '各买', '一起发'];
const PANTS_TYPES = ['拉拉裤', '纸尿裤', '一体裤', '学步裤'];
// 尺码：NB ~ 5XL。长的写前面，正则优先匹配长的
const SIZE_PATTERN = /(5XL|4XL|3XL|2XL|XXXXL|XXXL|XXL|XL|NB|S|M|L)/g;

// 终态通知 —— 已经结束，可以点掉
const TERMINAL = [
  '退款成功', '退款已到账', '退款完成', '交易完成', '售后已关闭', '售后关闭',
];

// 已解决卡片 —— 平台/系统明确告知办妥了，后续只是机器人问候，可点掉
// 注意：只认「成功/完成」这种确定措辞，不认「申请已提交」「请等待审核」这类未办妥的
const RESOLVED = [
  '收货地址修改成功', '地址修改成功', '修改地址成功', '编辑地址成功',
  '换货成功', '退货成功', '退款申请已通过', '退货申请已通过',
  '商家同意退货退款', '商家同意退款', '商家同意换货',
  '投诉已处理', '投诉处理完成',
];

// 明确售后动作（买家自己说的）
const AFTERSALE_STRONG = [
  '换货', '退货', '退款', '补发', '少发', '多发', '发错', '错发', '漏发',
  '缺件', '少件', '少包', '少片', '少了', '缺了', '不够数', '数量不对',
  '怎么换', '怎么退', '如何换', '如何退', '换一下', '退一下', '想换', '想退', '要换', '要退',
  '坏了', '坏掉', '破损', '破了', '漏了', '漏尿', '渗漏', '渗', '漏水',
  '脏了', '有污', '发霉', '异味', '臭',
  '过敏', '红屁屁', '红屁股', '起疹', '痒',
  '质量不过关', '质量有问题', '质量问题', '质量太差', '质量差', '品质差',
  '假货', '三无', '过期',
  '赔', '运费', '差价', '补偿',
  '差评', '投诉你们', '找平台',
];

// 弱售后词 —— 必须和对象词同时出现才算
const AFTERSALE_WEAK = ['换', '退', '坏', '漏', '破', '脏', '错'];
const OBJECT_WORDS = ['货', '单', '包', '码', '件', '片', '箱', '款', '钱', '费', '地址'];

// 机器人敷衍模板 —— 给了承诺但没给信息
const ROBOT_BRUSH_OFF = [
  '您先别着急', '您别着急', '别着急',
  '马上给您处理', '马上帮您处理', '我这边马上', '马上为您',
  '我立刻帮您', '立刻帮您对接', '加急催件', '盯着物流', '紧盯物流',
  '优先为您核查', '优先为您', '去帮您核实',
  '正在加急', '加急处理', '正在为您查询', '马上查询',
  '请您放心', '您放心', '稍等一下', '稍等片刻', '请稍等',
  '欢迎光临', '亲亲欢迎',
  '已经帮您反馈', '帮您催促', '已经催促',
  // 纯打招呼 / 无信息回复 —— 买家问题还在，机器人说一句「我在的」不算解决
  '我在的', '我一直在', '有啥问题都可以问我',
  // 纯问候开场（话术里没有任何商品信息），整句命中才算，避免误伤「尺码+请问有什么可以帮您」
  '在的哦，关于这件商品', '关于这件商品，有什么可以帮',
];

// 咨询类
const CONSULT = [
  '多大', '尺码', '尺寸', '型号', '哪款', '推荐', '怎么选', '适合',
  '什么时候发', '几天到', '多久到', '发货了吗', '什么时候到', '几天能到', '多久能到',
  '送到', '能不能到', '到货', '发货地', '指定快递', '发货时间',
  '包邮', '运费多少', '有货', '库存', '在吗', '你好', '在不在',
  '怎么用', '怎么穿', '使用方法', '正品', '保质期',
  '斤', '穿多大', '穿什么码', '多大码', '尺码表', '码数', '身高体重',
  // 厚度 / 手感 / 材质 —— 机器人有标准话术，答了就算解决
  '厚', '薄', '厚度', '透气', '吸量', '吸水', '柔软', '亲肤', '试用', '拆包',
];

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 从文本里抽出尺码（NB ~ 5XL）。先剔掉链接，否则 URL 里的字母会被当成尺码 */
function extractSizes(raw) {
  const clean = String(raw || '')
    .replace(/https?:\/\/\S+/gi, '')       // 整条 URL
    .replace(/\b[\w-]+\.(com|cn|html?)\S*/gi, '') // 域名/页面
    .replace(/[A-Za-z0-9_-]{16,}/g, '');   // 长 ID /  Tracking 码
  const up = clean.toUpperCase();
  const found = [];
  SIZE_PATTERN.lastIndex = 0;
  let m;
  while ((m = SIZE_PATTERN.exec(up)) !== null) found.push(m[1]);
  return [...new Set(found)];
}

/** 从文本里抽出裤型 */
function extractPants(raw) {
  const t = String(raw || '');
  return PANTS_TYPES.filter((p) => t.includes(p));
}

function hasAny(text, list) {
  for (const k of list) if (text.includes(k)) return k;
  return null;
}

function countAny(text, list) {
  let n = 0; const hit = [];
  for (const k of list) if (text.includes(k)) { n++; hit.push(k); }
  return { n, hit };
}

/**
 * 回扫历史：最后一小时里买家说过的话里有没有被机器人话术盖掉的混搭/售后需求。
 * 只在当前这条判为「可放过」时才调用，绝不推翻已有的 AfterSale/MIX 判定。
 * @param {Array<{text:string,role:string,at:string}>} history 该会话此前的话（旧→新）
 * @returns {{kind:string, reason:string, hits:string[]}|null}
 */
function classifyHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
  const cutoff = Date.now() - 60 * 60 * 1000; // 只看最近 1 小时
  const recentAll = history.filter((h) => {
    const t = Date.parse(h.at);
    return !t || t >= cutoff;
  }).slice(-8); // 最多回看 8 句，避免陈年需求反复触发

  // 先看有没有系统/平台已解决卡片。只要末句之后买家没再提新需求，就判 DONE。
  // 截图那单：历史里「收货地址修改成功」，末句是机器人夜间问候 → 应放掉。
  for (const h of recentAll) {
    const ht = norm(h.text);
    const solved = hasAny(ht, RESOLVED);
    if (solved) {
      const after = recentAll.slice(recentAll.indexOf(h) + 1);
      const newNeed = after.find((x) => (x.role || '') === 'BUYER' && norm(x.text).length >= 3);
      if (!newNeed) return { kind: 'DONE', reason: '历史已解决·' + solved, hits: [h.text.slice(0, 40)] };
    }
  }

  const recent = recentAll.filter((h) => (h.role || '') === 'BUYER'); // 只认买家说的话，机器人话术里的尺码表不算
  for (const h of recent) {
    const ht = norm(h.text);
    if (ht.length < 3) continue;
    // 问「纸尿裤和拉拉裤什么区别」是咨询，不是要各来一包
    if (hasAny(ht, ['区别', '差别', '不同', '哪个好', '哪种好'])) continue;

    const sizes = extractSizes(ht);
    const pants = extractPants(ht);
    const mixWord = hasAny(ht, MIX_WORDS);
    if (sizes.length >= 2 || pants.length >= 2 || mixWord) {
      const why = sizes.length >= 2 ? '多尺码(' + sizes.join('/') + ')'
        : pants.length >= 2 ? '多裤型(' + pants.join('/') + ')' : '混搭词(' + mixWord + ')';
      return { kind: 'MIX', reason: '历史买家需求·' + why, hits: [h.text.slice(0, 40)] };
    }
    const strong = hasAny(ht, AFTERSALE_STRONG);
    if (strong) {
      return { kind: 'AFTERSALE', reason: '历史买家售后·' + strong, hits: [h.text.slice(0, 40)] };
    }
    if (ht.includes('地址')) {
      const act = hasAny(ht, ['改', '修改', '换', '写错', '错', '不对', '更新', '重填', '换成']);
      if (act) return { kind: 'AFTERSALE', reason: '历史买家改地址', hits: [h.text.slice(0, 40)] };
    }
  }
  return null;
}

/**
 * @param {{text:string, role:string, tags:string[], fmt:string, history?:Array, at?:string}} m
 * @returns {{kind:string, reason:string, hits:string[]}}
 */
function classifyLast(m) {
  const text = norm(m.text);
  const tags = m.tags || [];
  const role = m.role || '';
  const fmt = m.fmt || '';

  // 1. 终态通知 —— 已经结束，可以点掉（优先级最高，避免"退款成功"被当成待办）
  const term = hasAny(text, TERMINAL);
  if (term) {
    return { kind: 'DONE', reason: '终态通知', hits: [term] };
  }

  // 1.5 已解决卡片 —— 平台已明确办妥（如「收货地址修改成功」）
  const solved = hasAny(text, RESOLVED);
  if (solved) {
    return { kind: 'DONE', reason: '已解决·' + solved, hits: [solved] };
  }

  // 2. 退货已到仓 —— 等统一入库时一起安排，直接可点掉
  //    例外：带「换货时限 / 未发出需补偿」的是平台派的单，漏了要赔钱，必须人工
  const inb = hasAny(text, INBOUND);
  if (inb) {
    const urgent = hasAny(text, ['换货商品', '发出换货', '若未发出', '需补偿', '前发出', '小时内发出', '天内发出']);
    if (urgent) {
      return { kind: 'AFTERSALE', reason: '换货时限·需人工处理', hits: [inb, urgent] };
    }
    return { kind: 'DONE', reason: '退货已签收·等统一入库', hits: [inb] };
  }

  // 2.5 改地址 —— 需要人工改单，不能点掉
  if (text.includes('地址')) {
    const act = hasAny(text, ['改', '修改', '换', '写错', '错', '不对', '更新', '重填', '换成']);
    if (act) {
      return { kind: 'AFTERSALE', reason: '改地址', hits: [act] };
    }
  }

  // 3. 平台售后卡片（机器人不会发这类，排除 ROBOT）
  if (role !== 'ROBOT') {
    const plat = hasAny(text, PLATFORM_AFTERSALE);
    if (plat) {
      return { kind: 'AFTERSALE', reason: '平台售后动作', hits: [plat] };
    }
  }

  // 4. 人工已回复 —— 已处理（标签或角色任一命中即可）
  if (tags.includes('ASSISTANT_REPLY') || role === 'ASSISTANT') {
    return { kind: 'DONE', reason: '人工已回复', hits: [] };
  }

  // 5. 机器人最后说话 —— 先分流，避免机器人话术里的「退货退款」被误判成售后
  if (role === 'ROBOT' || tags.includes('ONLY_ROBOT_REPLY')) {
    // 5.0 下班托管话术 —— 机器人只是叫买家早上再来，问题没解决，白班还要接着回
    //     例外：人工已经点过已读（read=true）说明人看过没问题，放掉
    const night = hasAny(text, ['客服已经下班', '客服已下班', '机器人小助理无法处理', '早上8点', '早上8：00', '早上 8 点']);
    if (night) {
      if (m.read === true) return { kind: 'DONE', reason: '夜间托管·人工已点掉', hits: [night] };
      return { kind: 'WAIT_REPLY', reason: '夜间机器人托管·白班需跟进', hits: [night] };
    }
    // 5.1 机器人发的图片/视频 —— 尺码表、产品图、物流截图，属于已答，不是"判不准"
    if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'AUDIO' || fmt === 'FILE') {
      return { kind: 'CONSULT', reason: '机器人发了' + fmt, hits: [fmt] };
    }
    const brush = hasAny(text, ROBOT_BRUSH_OFF);
    const consultHit = hasAny(text, CONSULT);
    // 引导买家走售后流程的话术，说明机器人给了明确出路
    const guide = hasAny(text, ['请您申请', '申请退货', '申请退款', '申请换货', '原因选择', '退款说明']);
    if (guide) {
      return { kind: 'CONSULT', reason: '机器人给出售后操作指引', hits: [guide] };
    }
    if (brush && !consultHit) {
      return { kind: 'PENDING_ROBOT', reason: '机器人敷衍抢答', hits: [brush] };
    }
    if (consultHit) {
      return { kind: 'CONSULT', reason: '机器人给出实质信息', hits: [consultHit] };
    }
    return { kind: 'CONSULT', reason: '机器人非模板回复', hits: [] };
  }

  // 6. 买家发来的图片/视频 —— 判不准，要人看
  if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'AUDIO' || fmt === 'FILE') {
    return { kind: 'UNSURE', reason: '买家发来' + fmt, hits: [fmt] };
  }

  // 7. 混搭需求 —— 买家要两种尺码或两种裤型，必须人工改单/备注
  //    机器人话术里的尺码表（S/M/L/XL/XXL 全列一遍）不会走到这里，上面 ROBOT 分支已拦
  if (role !== 'ROBOT') {
    // 问「纸尿裤和拉拉裤什么区别」是咨询，不是要各来一包
    if (hasAny(text, ['区别', '差别', '不同', '哪个好', '哪种好'])) {
      return { kind: 'WAIT_REPLY', reason: '咨询两种产品区别', hits: [] };
    }
    const sizes = extractSizes(text);
    const pants = extractPants(text);
    const mixWord = hasAny(text, MIX_WORDS);
    const sizeMix = sizes.length >= 2;
    const pantsMix = pants.length >= 2;
    if (sizeMix || pantsMix || mixWord) {
      const reason = sizeMix
        ? `混搭·多尺码(${sizes.join('/')})`
        : pantsMix
          ? `混搭·多裤型(${pants.join('/')})`
          : `混搭·${mixWord}`;
      return { kind: 'MIX', reason, hits: sizes.concat(pants) };
    }
  }

  // 8. 明确售后词
  const strong = hasAny(text, AFTERSALE_STRONG);
  if (strong) {
    return { kind: 'AFTERSALE', reason: '明确售后词', hits: [strong] };
  }

  // 6. 弱售后词 + 对象词
  const weak = hasAny(text, AFTERSALE_WEAK);
  if (weak) {
    const obj = hasAny(text, OBJECT_WORDS);
    if (obj) return { kind: 'AFTERSALE', reason: '弱售后词+对象词', hits: [weak, obj] };
  }

  // 8. 咨询类
  const consult = hasAny(text, CONSULT);
  if (consult) {
    // 买家自己发问、最后一条还没人答 —— 机器人可能没答（套餐用完/暂停接待），
    // 标已读就等于漏掉，必须留给人工
    if (role === 'BUYER') {
      return { kind: 'WAIT_REPLY', reason: '买家提问待回复', hits: [consult] };
    }
    return { kind: 'CONSULT', reason: '咨询类', hits: [consult] };
  }

  // 8. 买家道谢/ending —— 没新诉求，可点掉（客服已处理完）
  const thanks = hasAny(text, ['真贴心', '太贴心', '谢谢啦', '谢谢你', '感谢', '好的呢', '好嘞', '辛苦了', '点赞']);
  if (thanks && (role === 'BUYER' || role === 'ASSISTANT')) {
    return { kind: 'DONE', reason: '买家道谢·无新诉求', hits: [thanks] };
  }

  // 8.5 买家催进度/问进度 —— 等人回，不能点掉
  if (role === 'BUYER') {
    const chase = hasAny(text, ['好了吗', '弄好了吗', '处理好了吗', '多久', '还要多久', '怎么还没', '越买越贵', '涨价', '贵了']);
    if (chase) return { kind: 'WAIT_REPLY', reason: '买家催进度·待回复', hits: [chase] };
    // 好评返现咨询 —— 待人工答
    const cashback = hasAny(text, ['好评返现', '返现', '好评返', '评价返']);
    if (cashback) return { kind: 'WAIT_REPLY', reason: '买家问返现·待回复', hits: [cashback] };
    // 买家只补月龄/体重（问尺码的上下文），末句过短但没人答 —— 待人工
    // 例：买家问「多大的可以用拉拉裤」→ 机器人只发图 → 买家补「五个月了」
    if (/^\d+(个)?月(龄|了|大)?$/.test(text) || /^\d+(\.\d+)?(斤|公斤|kg|KG)$/i.test(text)
        || /^(五|六|七|八|九|十|半)个月(了|大)?$/.test(text)) {
      return { kind: 'WAIT_REPLY', reason: '买家补月龄/体重·待回复', hits: [text] };
    }
  }

  // 8.6 纯订单号 / 纯短句 / 判不准
  //     订单号可能是 ORD-XXXX-XXXXXX 这种带横杠的，整串去掉才算「仅订单号」
  const noOrder = text
    .replace(/订单编号[:：]?[\d-]+/g, '')
    .replace(/\d{6,}[-]?\d*/g, '')
    .replace(/^[\d-]+$/, '');
  if (noOrder.length === 0) {
    return { kind: 'UNSURE', reason: '仅订单号', hits: [] };
  }
  if (text.length <= 4) {
    return { kind: 'UNSURE', reason: '过短', hits: [text] };
  }

  return { kind: 'UNSURE', reason: '规则未覆盖', hits: [] };
}

/**
 * 末句 + 历史两段式判定。
 * - 末句本来就要人工（售后/混搭/敷衍/待回复）→ 直接采纳，历史不影响。
 * - 末句是终态(DONE) 或 人工已回复 → 直接采纳，不翻案，否则历史里的陈年需求会把已结案的全翻出来。
 * - 末句是可放过但偏弱（UNSURE 过短/未覆盖，或 CONSULT 机器人实答）→ 回扫历史，
 *   找出被机器人话术盖住的买家需求（漏判那单就属于这里）。
 */
function classify(m) {
  const last = classifyLast(m);
  if (!['UNSURE', 'CONSULT', 'WAIT_REPLY'].includes(last.kind)) return last;
  // 机器人给了实质信息且在 1 小时内有人工跟进，就不翻案（已解决卡片除外，下面会先看历史）
  if (last.kind === 'CONSULT' && (m.tags || []).includes('ASSISTANT_REPLY')) return last;
  // 末句是机器人「有实质内容的实答」（不是纯打招呼），说明已经回应过，不再用历史翻案
  // 截图那单末句是纯问候「我在的」→ classifyLast 已判 PENDING_ROBOT，不走这里
  if (last.kind === 'CONSULT' && m.role === 'ROBOT' && last.reason !== '机器人非模板回复') return last;
  const hist = classifyHistory(m.history);
  return hist || last;
}

module.exports = { classify, classifyLast, classifyHistory, norm, extractSizes, extractPants, PLATFORM_AFTERSALE, AFTERSALE_STRONG, ROBOT_BRUSH_OFF, INBOUND, TERMINAL, RESOLVED, MIX_WORDS, PANTS_TYPES };

// 规则单测：node test-rules.cjs
const { classify } = require('./ly-rules.cjs');

const cases = [
  // [文本, role, fmt, 期望, 说明]
  ['消费者申请售后，建议先与消费者友好协商', 'BUYER', 'TEXT', 'AFTERSALE', '平台卡片'],
  ['消费者已提交换货申请信息，请处理', 'BUYER', 'TEXT', 'AFTERSALE', '平台卡片-换货'],
  ['我都打开了，怎么换？', 'BUYER', 'TEXT', 'AFTERSALE', '买家说怎么换'],
  ['这个能退货吗', 'BUYER', 'TEXT', 'AFTERSALE', '退货'],
  ['少了一包', 'BUYER', 'TEXT', 'AFTERSALE', '少发'],
  ['拆开就破了', 'BUYER', 'TEXT', 'AFTERSALE', '破损'],
  ['宝宝用了红屁屁', 'BUYER', 'TEXT', 'AFTERSALE', '过敏'],
  ['Nb穿多大', 'BUYER', 'TEXT', 'WAIT_REPLY', '尺码咨询-买家在等'],
  ['什么时候发货', 'BUYER', 'TEXT', 'WAIT_REPLY', '物流咨询-买家在等'],
  ['你好', 'BUYER', 'TEXT', 'WAIT_REPLY', '打招呼-没人答'],
  ['订单编号:ORD-XXXX-XXXXXX', 'BUYER', 'TEXT', 'UNSURE', '仅订单号'],
  ['[图片]', 'BUYER', 'IMAGE', 'UNSURE', '仅图片'],
  ['62的', 'BUYER', 'TEXT', 'UNSURE', '过短'],
  ['能便宜点吗', 'BUYER', 'TEXT', 'UNSURE', '未覆盖'],
  ['亲亲欢迎光临，您先别着急，我这边马上给您处理，您放心。', 'ROBOT', 'TEXT', 'PENDING_ROBOT', '机器人敷衍'],
  ['亲亲，稍等一下，马上为您查询', 'ROBOT', 'TEXT', 'PENDING_ROBOT', '机器人敷衍2'],
  ['"亲亲，请您申请退货退款呢~ 原因选择：协商一致或者不想要"', 'ROBOT', 'TEXT', 'CONSULT', '机器人给指引-不能算售后'],
  ['纸尿裤尺码推荐：S 8斤内，M 9-14斤，L 14-18斤', 'ROBOT', 'TEXT', 'CONSULT', '机器人实答'],
  ['亲亲您好，商品已经发出啦，请问有什么可以帮您呢~', 'ROBOT', 'TEXT', 'CONSULT', '机器人实答2'],
  // 厚度 / 发货：机器人有标准话术，答了就算解决，可标已读
  ['是厚的吗', 'BUYER', 'TEXT', 'WAIT_REPLY', '问厚度-买家在等'],
  ['亲亲，咱们尽量以现在新工艺技术做到薄，透气，吸量高。超薄厚度0.2，既能满足大吸量同时又不会有重量负担哈，您可以试试看，支持拆包试用5片哦，不满意可退换哦~', 'ROBOT', 'TEXT', 'CONSULT', '问厚度-机器人实答'],
  ['今天能不能送到呀？加急一下', 'BUYER', 'TEXT', 'WAIT_REPLY', '催发货-买家在等'],
  ['亲亲，多仓发货福建江西，以仓库发出为准，不支持指定发货地哦！一般均3-5天左右到达，较偏远地区等可能到货时间延迟，感谢理解包容哦~', 'ROBOT', 'TEXT', 'CONSULT', '催发货-机器人实答'],
  ['亲非常理解您想快点收到宝贝的心情～我们已经在加急安排打包发货啦，仓库正在全力处理，发出后第一时间同步单号', 'ROBOT', 'TEXT', 'CONSULT', '催发货-机器人实答2'],
  ['亲亲，不客气的呢，您满意就是对我们最好的认可呢~', 'ASSISTANT', 'TEXT', 'DONE', '客服收尾'],

  // 混搭
  ['XL码和XXL码各一包', 'BUYER', 'TEXT', 'MIX', '两个尺码'],
  ['我要NB码和S码', 'BUYER', 'TEXT', 'MIX', '两个尺码2'],
  ['拉拉裤和纸尿裤各一半', 'BUYER', 'TEXT', 'MIX', '两种裤型'],
  ['XL的还有XXL的都要', 'BUYER', 'TEXT', 'MIX', '两个尺码+都要'],
  ['可以混搭吗', 'BUYER', 'TEXT', 'MIX', '混搭关键词'],
  ['我要5XL的', 'BUYER', 'TEXT', 'UNSURE', '单尺码不算混搭'],
  ['XL码有货吗', 'BUYER', 'TEXT', 'WAIT_REPLY', '单尺码咨询-买家在等'],

  // 入库签收 —— 等统一入库，可点掉
  ['退货商品已签收，请您尽快处理售后', 'BUYER', 'TEXT', 'DONE', '签收通知-可点掉'],
  ['买家申请修改为新地址', 'BUYER', 'TEXT', 'AFTERSALE', '改地址-平台标签'],
  ['地址写错了能改吗', 'BUYER', 'TEXT', 'AFTERSALE', '改地址'],
  ['换成这个地址', 'BUYER', 'TEXT', 'AFTERSALE', '改地址2'],
  ['退款成功通知', 'BUYER', 'TEXT', 'DONE', '终态'],

  // 历史回扫 —— 截图漏判那单：买家说了两个尺码，机器人发尺码表，买家最后补一句「在」
  [{
    text: '在', role: 'BUYER', fmt: 'TEXT', tags: ['NOT_REPLY'],
    history: [
      { role: 'BUYER', text: '这个规格是两包，我拍下了你给我nb码发一包，s码发一包', at: new Date().toISOString() },
      { role: 'ROBOT', text: '亲亲，可以参考下尺码表哦', at: new Date().toISOString() },
      { role: 'BUYER', text: '我要一样一包', at: new Date().toISOString() },
    ],
  }, 'MIX', '历史回扫-两个尺码被末句「在」盖住'],
  [{
    text: '在', role: 'BUYER', fmt: 'TEXT', tags: ['NOT_REPLY'],
    history: [
      { role: 'BUYER', text: '地址写错了能改吗', at: new Date().toISOString() },
      { role: 'ROBOT', text: '亲亲，我们不支持修改地址哦', at: new Date().toISOString() },
    ],
  }, 'AFTERSALE', '历史回扫-改地址被机器人话术盖住'],
  // 终态/人工已回复不翻案
  [{
    text: '退款成功通知', role: 'BUYER', fmt: 'TEXT', tags: [],
    history: [{ role: 'BUYER', text: 'XL和XXL各一包', at: new Date().toISOString() }],
  }, 'DONE', '终态不被历史翻案'],
  [{
    text: '亲亲，不客气的呢', role: 'ASSISTANT', fmt: 'TEXT', tags: ['ASSISTANT_REPLY'],
    history: [{ role: 'BUYER', text: '少了一包', at: new Date().toISOString() }],
  }, 'DONE', '人工已回复不被历史翻案'],

  // 已解决卡片 —— 截图那单：地址改成功了，末句是机器人夜间话术，可放掉
  ['收货地址修改成功', 'BUYER', 'TEXT', 'DONE', '地址修改成功卡片'],
  ['商家同意退货退款', 'BUYER', 'TEXT', 'DONE', '同意退款卡片'],
  [{
    text: '【亲爱的，目前咱们的客服已经下班了，您的问题机器人小助理无法处理呢。您可以等早上8点后过来联系处理呢。】',
    role: 'ROBOT', fmt: 'TEXT', tags: ['ONLY_ROBOT_REPLY'],
    history: [
      { role: 'SYSTEM', text: '收货地址修改成功', at: new Date(Date.now() - 60000).toISOString() },
      { role: 'ROBOT', text: '欢迎光临SHOP-XXXX', at: new Date(Date.now() - 30000).toISOString() },
    ],
  }, 'DONE', '已解决卡片+夜间话术-可放掉'],
  // 解决后有新需求，不能翻成 DONE
  [{
    text: '【亲爱的，目前咱们的客服已经下班了，您的问题机器人小助理无法处理呢】',
    role: 'ROBOT', fmt: 'TEXT', tags: ['ONLY_ROBOT_REPLY'],
    history: [
      { role: 'SYSTEM', text: '收货地址修改成功', at: new Date(Date.now() - ID-XXXX).toISOString() },
      { role: 'BUYER', text: 'XL和XXL各一包', at: new Date(Date.now() - 30000).toISOString() },
    ],
  }, 'MIX', '已解决后又提混搭-不能放掉'],

  // 历史回扫误判修复
  ['https://mobile.yangkeduo.com/goods.html?goods_id=ID-XXXX&_oak_rcto=YWK2H1NV', 'BUYER', 'TEXT', 'UNSURE', '商品链接里的字母不算尺码'],
  ['请问纸尿裤跟拉拉裤是什么区别呀？', 'BUYER', 'TEXT', 'WAIT_REPLY', '问区别不是混搭'],
  [{
    text: '亲，下单收到货后，尿不湿正装拆包可试用5片，不满意可退货退款!',
    role: 'ROBOT', fmt: 'TEXT', tags: ['ONLY_ROBOT_REPLY'],
    history: [{ role: 'BUYER', text: 'XL和XXL各一包', at: new Date().toISOString() }],
  }, 'CONSULT', '机器人实答不被历史翻案'],

  // 12:00 那轮发现的问题
  ['退货已签收，请在11月25日11:24前发出换货商品，若未发出需补偿消费者', 'BUYER', 'TEXT', 'AFTERSALE', '换货时限-漏了要赔钱'],
  ['好的 真贴心[点赞]', 'BUYER', 'TEXT', 'DONE', '买家道谢可放掉'],
  ['好了吗？', 'BUYER', 'TEXT', 'WAIT_REPLY', '买家问进度'],
  ['怎么，越买越贵了', 'BUYER', 'TEXT', 'WAIT_REPLY', '买家问涨价'],
  ['订单编号:ORD-XXXX-XXXXXX', 'BUYER', 'TEXT', 'UNSURE', '带横杠订单号'],
  ['在的哦，关于这件商品，有什么可以帮到您的呢？', 'ROBOT', 'TEXT', 'PENDING_ROBOT', '机器人纯问候'],
  ['亲亲您好，商品已经发出啦，请问有什么可以帮您呢~', 'ROBOT', 'TEXT', 'CONSULT', '机器人实答带问候不误伤'],
  // 14:30 那轮发现的问题
  ['质量不过关', 'BUYER', 'TEXT', 'AFTERSALE', '质量问题投诉-转人工'],
  ['好评返现不', 'BUYER', 'TEXT', 'WAIT_REPLY', '买家问返现'],
  ['五个月了', 'BUYER', 'TEXT', 'WAIT_REPLY', '买家补月龄-问尺码待回复'],
  ['25斤', 'BUYER', 'TEXT', 'WAIT_REPLY', '买家补体重-待回复'],
];

let pass = 0, fail = 0;
for (const c of cases) {
  // 旧格式：['文本','ROLE','FMT','期望','说明']（5 项字符串）
  // 新格式：[{text,role,...,history}, '期望', '说明']（3 项，首项为对象）
  const isOld = typeof (c[0]) === 'string';
  const text = isOld ? c[0] : c[0].text;
  const expect = c[isOld ? 3 : 1];
  const note = c[isOld ? 4 : 2];
  const m = isOld
    ? { text: c[0], role: c[1], fmt: c[2], tags: [] }
    : c[0];
  const r = classify(m);
  const ok = r.kind === expect;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expect.padEnd(14)} got=${r.kind.padEnd(14)} ${note}  「${text.slice(0, 28)}」  ←${r.reason}`);
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

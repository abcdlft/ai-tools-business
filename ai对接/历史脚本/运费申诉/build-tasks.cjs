#!/usr/bin/env node
/**
 * build-tasks.cjs —— 生成 7 单运费复议的任务文件，并校验描述字数（上限 200）
 */
const fs = require('fs');
const path = require('path');

const EV = 'F:\\减负\\auto\\appeal\\2026-11-16-运费\\ev';
const RPT = 'C:\\Users\\Administrator\\Desktop\\B 检测报告';
const JXA = 'C:\\Users\\Administrator\\Desktop\\甲酰胺检测报告\\TUTUBABA纸尿裤.jpg';
const OUT = 'F:\\减负\\auto\\appeal\\2026-11-17-运费复议';

const silk = RPT + '\\A TUTUBABY 蚕丝精灵\\拉拉裤.jpg';
const camellia = RPT + '\\A 山茶花 兔小贝\\拉拉裤.jpg';

const items = [
  {
    order: 'ORD-XXXX-XXXXXX', amount: 5.04,
    opt: JXA,
    desc: '买家退款原因为「不想要了」，聊天中自述「只能退一包，另一包在亲戚家」，实际仅退回部分商品，全程未提质量问题，商家亦未承诺运费。同款产品经第三方检测甲酰胺未检出（附件）。平台按整单扣运费5.04元，与退回件数不符，请按实际退回件数核定，或要求买家退回剩余商品。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 1.40,
    opt: silk,
    desc: '买家退款原因「不想要了」，聊天仅述「快递全湿了」「里面有点潮」，指外包装受潮，未主张质量缺陷，也未提出质量索赔。商品按L码蚕丝拉拉裤两包76片完好发出，同款经CMA/CNAS机构检测，致病菌等六项合格（附件）。平台仅以「不符合申诉通过条件」驳回，未说明具体条件，请求复核运费责任归属。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 1.20,
    opt: silk,
    desc: '买家以「使用后过敏、红屁股」申请，全程无聊天沟通，申请单未上传患处与商品同框照片，亦无就诊记录，过敏主张无实证。同款产品经CMA/CNAS机构检测，菌落总数、真菌、大肠菌群等六项均合格（附件）。平台仅回复「不符合申诉通过条件」，未说明依据。请求复核质量认定。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 0.35,
    opt: JXA,
    desc: '本单为协商一致退货，商家已通过退货包运费服务补偿买家13.30元，运费已承担一次。平台极速退款时又从商家账户另扣0.35元，同一笔退货产生两次运费支出。买家主张过敏但未提供就诊或实物凭证，同款产品检测合格（附件）。请复核该笔0.35元是否属重复扣款。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 0.24,
    opt: JXA,
    desc: '本单为换货售后，买家称收到尺码不符并附6张图片，商家已要求提供完整拆箱视频，买家至今未提供。订单备注规格为DKL-XXXXL40共2件，与买家所述不符，发错货事实未核实。平台已补偿运费10.04元后又另扣0.24元。请求复核发错货认定依据及该笔重复扣款的依据。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 0.18,
    opt: camellia,
    desc: '买家以「不想要了」申请，说明称「晚上用了一片，孩子尿了一次就漏了」。全程未与商家沟通排查尺码是否合适、穿戴是否正确，未上传漏尿或商品异常照片。同款产品经CMA/CNAS检测，致病菌等六项合格（附件）。仅凭单次使用即认定商品问题依据不足，请求复核运费责任。',
  },
  {
    order: 'ORD-XXXX-XXXXXX', amount: 0.12,
    opt: camellia,
    desc: '买家以「有点红屁股」申请退款，全程未与商家沟通，申请单未上传患处与商品同框照片，亦无就诊记录，过敏主张无实证。同款产品经CMA/CNAS机构检测，细菌菌落、真菌、大肠菌群等六项均合格（附件）。平台以「商品存在问题」驳回，缺少买家举证环节，请求复核质量认定。',
  },
];

let bad = 0;
for (const it of items) {
  const task = {
    order: it.order,
    amount: it.amount,
    reason2: '消费者无理由退货，退货运费不应商家承担',
    desc: it.desc,
    evidenceRequired: [path.join(EV, it.order + '.png')],
    evidenceOptional: [it.opt],
    shot: path.join(OUT, 'shots', 'review-' + it.order + '.png'),
  };
  const miss = [...task.evidenceRequired, ...task.evidenceOptional].filter((f) => !fs.existsSync(f));
  const n = [...it.desc].length;
  if (n > 200) bad++;
  console.log(it.order + '  desc=' + n + '字  ' + (miss.length ? 'MISSING=' + miss.join(',') : '凭证OK'));
  fs.writeFileSync(path.join(OUT, 't-' + it.order + '.json'), JSON.stringify(task, null, 2), 'utf8');
}
console.log('OVER200=' + bad + ' TOTAL=' + items.length);

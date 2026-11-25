const fs=require('fs');
const j=JSON.parse(fs.readFileSync('F:\\减负\\auto\\appeal\\2026-11-17-负向体验3元\\neg-detail.json','utf8'));
console.log('===== 负向体验3元 14单详情汇总 =====\n');
j.forEach((r,i)=>{
  let fb=(r.feedback||'').replace(/\s+/g,' ').trim();
  // 第9单错位修正：从正文找"用户反馈"
  const t=r.detailText||'';
  const k=t.indexOf('用户反馈');
  if(!/^用户反馈/.test(fb) && k>=0){
    const end=t.indexOf('其他用户也曾反馈',k)>=0?t.indexOf('其他用户也曾反馈',k):(t.indexOf('相关问题基于',k)>=0?t.indexOf('相关问题基于',k):t.indexOf('上述问题基于',k));
    fb=t.slice(k,end>0?end:k+400).replace(/\s+/g,' ').trim();
  }
  console.log('['+(i+1)+'] '+r.order+' | '+r.status+(r.skippedReason?' ('+r.skippedReason+')':''));
  console.log('    商品: '+r.product);
  console.log('    共性提示: '+(r.common?'有(其他用户也曾反馈)':'无'));
  console.log('    用户反馈: '+fb.slice(0,220));
  console.log('');
});

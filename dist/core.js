export const LIMITS = { messages: 300, text: 2000, total: 80000 };
export function parseTranscript(raw) {
 const text = raw.trim();
 if (!text) throw new Error('先粘贴一段聊天，再开始整理。');
 if (text.length > LIMITS.total) throw new Error('这段聊天超过 80,000 字，请分段导入。');
 if (text.startsWith('{')) {
  let value;try{value=JSON.parse(text);}catch{}
  if(value&&['xianwai-library','xianwai-contact'].includes(value.format))throw new Error('这是联系人资料库导出文件，包含历史分析，不能作为聊天文本导入。请保留完整原文件；普通聊天 JSON 应使用消息数组。');
  if(value&&Array.isArray(value.messages))return validateMessages(value.messages);
 }
 if (text.startsWith('[')) {
  let rows;
  try { rows = JSON.parse(text); } catch { throw new Error('JSON 格式不正确，请检查括号和引号。'); }
  return validateMessages(rows);
 }
 const rows = []; let unknown = 0;
 for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = line.match(/^\s*(我|自己|me|对方|她|他|女友|老婆|伴侣|partner)\s*[:：]\s*(.*)$/i);
  if (match) rows.push({ role: /^(我|自己|me)$/i.test(match[1]) ? 'me' : 'partner', text: match[2].trim() });
  else if (rows.length && /^\s+/.test(line)) rows.at(-1).text += '\n' + line.trim();
  else { rows.push({ role: 'partner', text: line.trim(), uncertain: true }); unknown++; }
 }
 const valid = validateMessages(rows);
 return valid.map((m,i) => ({...m, uncertain: !!rows[i].uncertain}));
}
export function validateMessages(rows) {
 if (!Array.isArray(rows) || !rows.length) throw new Error('至少需要一条聊天消息。');
 if (rows.length > LIMITS.messages) throw new Error('每次最多导入 300 条消息，请分段整理。');
 let total = 0;
 const result = rows.map((row,i) => {
  if (!row || !['me','partner'].includes(row.role) || typeof row.text !== 'string' || !row.text.trim()) throw new Error(`第 ${i+1} 条消息需要选择发送者并填写文字。`);
  const text = row.text.trim(); total += text.length;
  if (text.length > LIMITS.text) throw new Error(`第 ${i+1} 条超过 2,000 字，请拆成多条消息。`);
  return {role:row.role, text};
 });
 if (total > LIMITS.total) throw new Error('聊天总字数不能超过 80,000 字。');
 return result;
}
export function contextFor(messages, targetIndex) {
 const rows = validateMessages(messages);
 if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= rows.length) throw new Error('请选择一条有效的消息。');
 return rows.slice(0,targetIndex+1).map((m,i)=>({id:i+1,...m}));
}
export function localAnalysis(messages, targetIndex, tone = 'warm') {
 const context = contextFor(messages,targetIndex), target=context.at(-1), t=target.text;
 const prior=context.slice(0,-1), previous=prior.filter(m=>m.role==='me').at(-1);
 const gap=prior.some(m=>m.role==='partner'&&/等你|我等|等着|还没吃/.test(m.text))&&prior.some(m=>m.role==='me'&&/忙|开会|加班|晚|工作|临时.*会/.test(m.text));
 let kind=/算了|随便|你忙|没事|不用|哦|嗯|好吧/.test(t) ? 'distance' : /累|难受|烦|委屈|压力|崩溃/.test(t) ? 'tired' : /总是|每次|答应|忘|从来|失望/.test(t) ? 'promise' : /想你|喜欢|爱你|开心|谢谢/.test(t) ? 'affection' : 'open';
 if(target.role==='me') kind='self';
 if(/别再联系|不要再联系|不想聊|别烦|别找我|别来找|不要来找/.test(t))kind='boundary';
 if(/打死|杀了|掐死|揍你|威胁|伤害自己|不想活|自杀/.test(t))kind='safety';
 const profiles={
  boundary:{title:'先尊重清楚表达的边界',feeling:'消息里明确表达了暂停沟通或不被联系的意愿',need:'尊重这一请求，停止追问和反复联系',other:'具体原因仍不确定，但不需要先弄清原因才尊重边界。',ask:'这时不必继续追问。',avoid:'不要换账号、找朋友代问或用连续消息试图说服对方。',replies:['明白，我会尊重你的意思，先不打扰了。','收到，我会停下来。','好，我尊重你的决定。']},
  safety:{title:'先确认安全，暂停争执',feeling:'这句话可能涉及人身安全或强烈的痛苦，需要认真对待',need:'先确认当下是否安全，必要时联系当地紧急服务或身边可信赖的人',other:'单条消息不足以判断具体风险或动机，不宜用普通恋爱话术处理。',ask:'你现在安全吗？身边有可以陪你的人吗？',avoid:'不要承诺独自保密或靠继续争辩解决；若有危险，优先现实中的支持。',replies:['我们先暂停争执。眼下最重要的是安全。','你现在安全吗？身边有可以陪你的人吗？','现在先联系一个能在现实中提供帮助的人，好吗？']},
  distance:{title:'先确认感受，再解释事情',feeling:'可能有些失落，也可能只是想结束这轮聊天',need:'确认她是否想被陪伴，也给她不继续聊的空间',other:'她也可能真的希望你先忙完；短消息本身不能证明生气。',ask:'你是想先休息一下，还是希望我陪你聊一会儿？',avoid:'别急着反问“你又怎么了”，也别用连续追问逼对方表态。', replies: gap ? ['我先确认一下，刚才让你等着，是不是有点失落？你想让我陪你聊会儿，还是先休息一下？','我刚才没说清楚，让你一直等着了。你现在想聊聊吗？我在。','好，我先把手上的事收尾。你想聊的时候告诉我；如果刚才让你不舒服，也可以直接跟我说。'] : ['我有点拿不准你的意思。你是想先安静一会儿，还是希望我再听你说说？','我在。你愿意的话，可以跟我说说刚才的感受。','好，你先按自己舒服的节奏来。想聊的时候我在。']},
  tired:{title:'先陪她待在情绪里',feeling:'表达了疲惫或烦闷，但原因和程度还不清楚',need:'先被倾听，再确认是否需要一起想办法',other:'她可能只是分享近况，并不期待你立刻解决问题。',ask:'你想让我听你说说，还是一起想个办法？',avoid:'先别说“想开点”或马上列解决方案。',replies:['听起来今天挺难熬的。想跟我说说发生什么了吗？我先听你说。','今天辛苦了。我在，你慢慢说；不想说也没关系。','要不要先歇一会儿？你希望我陪你聊聊，还是帮你做点什么？']},
  promise:{title:'把回应落到具体的事情上',feeling:'可能对某个约定或重复发生的事情感到失望',need:'确认具体影响，并商量你能兑现的下一步',other:'这也可能是对一件具体事情的提醒，需要问清楚，不能推断整段关系。',ask:'这件事里最让你难受的是哪一部分？',avoid:'别用“我都道歉了”结束话题；别承诺自己做不到的事。',replies:['我想认真听听，这件事里最让你难受的是哪一部分？我先听完，再跟你商量怎么改。','你说的这件事，我想弄清楚。是我没有做到之前约好的事吗？','我们把之前怎么约的、这次哪里没做到一起说清楚吧。我想和你商量一个能落实的办法。']},
  affection:{title:'接住这份靠近',feeling:'文字中有主动表达亲近或感谢的线索',need:'自然回应你的真实感受，不必刻意升温',other:'这是当下的表达，不能据此推断关系一定稳定或对方有更多期待。',ask:'想不想跟我讲讲今天？',avoid:'不必照搬自己平时不会用的称呼或夸张承诺。',replies:['看到你这么说，我也很开心。想听你再多说一点。','收到啦，看到这条消息心情都变好了。','我也很珍惜我们这样聊天的时刻。今天过得怎么样？']},
  open:{title:'先听明白，再往下聊',feeling:'目前没有足够线索判断明确的情绪',need:'围绕她说的具体事情接话，用开放问题补充语境',other:'她可能是在陈述事实、开玩笑或开启话题；还需要更多上下文。',ask:'你说这件事的时候，最在意的是什么？',avoid:'不要把每一句普通消息都解读成试探或考验。',replies:['我想再听你说说，这件事里你最在意的是什么？','我在听，后来呢？','你希望我先听你说，还是一起想想接下来怎么办？']},
  self:{title:'让自己的意思更容易被听见',feeling:'这是你发出的消息，不能用它确定对方的感受',need:'确认自己的表达有没有把事实、感受和请求说清楚',other:'要理解对方，最好选择她的原话，并结合之前的交流。',ask:'我刚才的表达，你听起来是什么感觉？',avoid:'避免替对方定义情绪，或要求她马上接受你的解释。',replies:['我想把刚才的意思说清楚，也想听听你是怎么理解的。','刚才我可能说得太简略了。你愿意告诉我你的感受吗？','我先把自己的情况说清楚，再听听你的想法，好吗？']}
 };
 const p=profiles[kind];
 const short={distance:gap?['我在。你想聊一会儿，还是先休息？','刚才让你等了，抱歉。现在想聊聊吗？','好，你先按自己的节奏来。']:['我在。你想聊一会儿，还是先休息？','我有点拿不准，你是想先歇会儿吗？','好，你先按自己的节奏来。'],tired:['今天辛苦了。想说说吗？我听着。','我在，慢慢说。','你想让我陪着，还是帮点忙？'],promise:['我想听清楚：哪一部分让你最难受？','是我没做到之前约好的事吗？','我们一起商量个能落实的办法吧。'],affection:['看到这条消息，我也很开心。','收到啦，我很珍惜。','我也想听你说说今天。'],open:['我在听，后来呢？','这件事你最在意什么？','你想聊聊，还是一起想办法？'],self:['我想说清楚，也想听听你的理解。','刚才说得简略了，你是什么感受？','我先说情况，再听你的想法，好吗？']};
 const variants=[p.replies[1],p.replies[0],short[kind]?.[2]||p.replies[2]];
 return {mode:'local',title:p.title,feeling:p.feeling,need:p.need,hypotheses:[{text:p.feeling,evidence:[target.id]},{text:p.other,evidence:[target.id]}],facts:[{text:`${target.role==='me'?'你':'对方'}说：“${t}”`,evidence:[target.id]},...(previous?[{text:`此前你说：“${previous.text}”`,evidence:[previous.id]}]:[])],question:p.ask,avoid:p.avoid,replies:variants.map((text,i)=>({tone:['warm','honest','brief'][i],label:['温柔一点','坦诚一点','简短一点'][i],text,reason:'结合自己的真实情况调整后，再复制发送。'})),contextCount:context.length};
}

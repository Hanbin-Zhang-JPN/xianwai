import {validateMessages,LIMITS} from './core.js';

export const TONES = [
  {id: 'warm', label: '温柔一点'},
  {id: 'honest', label: '坦诚一点'},
  {id: 'brief', label: '简短一点'}
];

// Only compare screenshot boundaries. Repeated text inside a screenshot is kept.
export function boundaryOverlap(previous, incoming) {
  const max=Math.min(previous.length,incoming.length);if(max<2)return 0;
  const key=row=>JSON.stringify([row.role,row.text.trim()]),pattern=incoming.slice(0,max).map(key),prefix=new Array(max).fill(0),chars=[0];
  for(let i=0;i<max;i++){chars.push(chars.at(-1)+incoming[i].text.trim().length);if(!i)continue;let j=prefix[i-1];while(j&&pattern[i]!==pattern[j])j=prefix[j-1];if(pattern[i]===pattern[j])j++;prefix[i]=j;}
  let matched=0;for(const row of previous.slice(-max)){const value=key(row);while(matched&&(matched===max||pattern[matched]!==value))matched=prefix[matched-1];if(pattern[matched]===value)matched++;}
  while(matched>=2){if(chars[matched]>=10)return matched;matched=prefix[matched-1];}return 0;
}

export function combineScreenshotBatches(batches, removeOverlap = true, limits=LIMITS) {
  let messages = [], overlapCount = 0;
  for (const batch of batches) {
    validateMessages(batch,limits);
    const overlap = boundaryOverlap(messages, batch);
    overlapCount += overlap;
    messages = messages.concat(batch.slice(removeOverlap ? overlap : 0));
  }
  validateMessages(messages,limits);
  return {messages, overlapCount};
}

export function planImport(existing, incoming, {append = true, removeOverlap = true} = {}) {
  validateMessages(incoming);
  const overlap = append ? boundaryOverlap(existing, incoming) : 0;
  const messages = validateMessages([...(append ? existing : []), ...incoming.slice(removeOverlap ? overlap : 0)]);
  return {messages, overlapCount: overlap, removed: removeOverlap ? overlap : 0};
}

export function prepareImport(existing, rows, options = {}) {
  const batches = [];
  for (const row of rows) {
    const batch = row.batch ?? 0;
    if (!batches.length || batches.at(-1).id !== batch) batches.push({id: batch, rows: []});
    batches.at(-1).rows.push(row);
  }
  const combined = combineScreenshotBatches(batches.map(batch => batch.rows), options.removeOverlap !== false);
  const plan = planImport(existing, combined.messages, options);
  return {...plan, screenshotOverlap: combined.overlapCount, totalOverlap: combined.overlapCount + plan.overlapCount};
}

export function latestPartnerIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'partner') return index;
  return -1;
}

export function addQuickMessage(messages, text, role = 'partner') {
  const value = String(text).trim();
  const last = messages.at(-1);
  if (last?.role === role && last.text === value) return {messages: validateMessages(messages), reused: true};
  return {messages: validateMessages([...messages, {role, text: value}]), reused: false};
}

export function replyForTone(analysis, tone) {
  const index = TONES.findIndex(item => item.id === tone);
  return analysis.replies.find(reply => reply.tone === tone) || analysis.replies[Math.max(0, index)] || analysis.replies[0];
}

export function canUndoRecord(record,chat){return !!record&&record.chatId===chat.id&&record.snapshot===JSON.stringify(chat.messages);}

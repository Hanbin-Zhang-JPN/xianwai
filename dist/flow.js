import {validateMessages} from './core.js';

export const TONES = [
  {id: 'warm', label: '温柔一点'},
  {id: 'honest', label: '坦诚一点'},
  {id: 'brief', label: '简短一点'}
];

// Only compare screenshot boundaries. Repeated text inside a screenshot is kept.
export function boundaryOverlap(previous, incoming) {
  const max = Math.min(previous.length, incoming.length);
  for (let length = max; length >= 2; length--) {
    const tail = previous.slice(-length), head = incoming.slice(0, length);
    if (tail.reduce((sum, row) => sum + row.text.trim().length, 0) < 10) continue;
    if (tail.every((row, index) => row.role === head[index].role && row.text.trim() === head[index].text.trim())) return length;
  }
  return 0;
}

export function combineScreenshotBatches(batches, removeOverlap = true) {
  let messages = [], overlapCount = 0;
  for (const batch of batches) {
    validateMessages(batch);
    const overlap = boundaryOverlap(messages, batch);
    overlapCount += overlap;
    messages = messages.concat(batch.slice(removeOverlap ? overlap : 0));
  }
  validateMessages(messages);
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

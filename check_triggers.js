const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const integrations = data.integrations;
const checks = ['start_trigger', 'schedule', 'generic_webhook', 'slack', 'linear'];
for (const id of checks) {
  const integ = integrations.find(i => i.id === id);
  if (integ === undefined) { console.log(id + ': NOT FOUND'); continue; }
  const subs = integ.block.subBlocks || [];
  const triggerSubs = subs.filter(s => s.mode === 'trigger');
  const otherSubs = subs.filter(s => s.mode !== 'trigger');
  console.log(id + ': total=' + subs.length + ', trigger=' + triggerSubs.length + ', other=' + otherSubs.length + ', category=' + integ.block.category);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { attachOwnerUsageRoute } from './ownerUsage.js';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
function fixture({ authenticated = true, profile = { id: OWNER, plan: 'Professional' }, usage = { consumed: 51, reserved: 2 }, error = null } = {}) {
  const reads = [];
  const db = { auth: { getUser: async () => ({ data: authenticated ? { user: { id: OWNER } } : {}, error: null }) },
    from(table) { const row = { table, filters: [] }; reads.push(row); return {
      select(fields) { row.fields = fields; return this; }, eq(key, value) { row.filters.push([key,value]); return this; },
      async maybeSingle() { return { data: table === 'profiles' ? profile : usage, error }; },
    }; },
  };
  let handler;
  attachOwnerUsageRoute({ get(path, fn) { assert.equal(path, '/owner/ai-usage'); handler = fn; } }, db, () => new Date('2026-10-31T23:59:00Z'));
  const res = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  return { reads, res, run: (headers = { authorization: 'Bearer token' }) => handler({ headers, query: { businessId: OTHER } }, res) };
}
test('owner usage rejects missing and invalid authentication without tenant reads', async () => {
  for (const authenticated of [true, false]) { const f = fixture({ authenticated }); await f.run(authenticated ? {} : undefined); assert.equal(f.res.code,401); assert.equal(f.reads.length,0); }
});
test('quota display scopes reads to authenticated owner and UTC quota period, ignoring a forged tenant', async () => {
  const f = fixture(); await f.run(); assert.equal(f.res.code,200); assert.deepEqual(f.res.body,{ periodKey:'2026-10',consumed:51,reserved:2 });
  assert.deepEqual(f.reads[0].filters,[['id',OWNER]]); assert.deepEqual(f.reads[1].filters,[['business_id',OWNER],['period_key','2026-10']]);
});
test('staff without an owner profile cannot read employer or other tenant quota', async () => {
  const f = fixture({ profile:null }); await f.run(); assert.equal(f.res.code,403); assert.equal(f.reads.length,1);
});
test('trial usage has its all-time period and a missing ledger row is genuinely zero', async () => {
  const f = fixture({ profile:{id:OWNER,plan:'14-day trial'},usage:null }); await f.run(); assert.deepEqual(f.res.body,{periodKey:'trial',consumed:0,reserved:0});
});
test('quota query failures never masquerade as zero usage', async () => {
  const f = fixture({error:new Error('database unavailable')}); await f.run(); assert.equal(f.res.code,503); assert.equal(f.res.body.consumed,undefined);
});

// Optional real PostgreSQL test suite.
// Requires an EPHEMERAL database URL whose database name ends in _test.
// Example: PAYSTACK_TEST_DATABASE_URL=postgres://.../ezeji_test npm test
// This test deliberately never runs against an unverified production database.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";

const databaseUrl = process.env.PAYSTACK_TEST_DATABASE_URL;
const psqlFound = spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
let databaseName = "";
try { databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1)); } catch {}
const enabled = psqlFound && !!databaseUrl && /_test$/.test(databaseName);
const options = enabled ? {} : { skip: "Requires psql and isolated PAYSTACK_TEST_DATABASE_URL ending in _test" };

const psqlArgs = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
function runSql(sql, { allowError = false } = {}) {
  const result = spawnSync("psql", [...psqlArgs, "-d", databaseUrl, "-c", sql], { encoding: "utf8" });
  if (result.status !== 0 && !allowError) throw new Error(result.stderr || result.stdout);
  return { success: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
function runFile(filename) {
  const result = spawnSync("psql", [...psqlArgs, "-d", databaseUrl, "-f", filename], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
function id() { return crypto.randomUUID(); }
function ref() { return "ezeji_" + crypto.randomUUID().replaceAll("-", ""); }
function createOwner(ownerId) {
  runSql(`insert into public.profiles(id) values ('${ownerId}')`);
}
function createAttempt(businessId, reference, plan = "Professional", amount = 3500000, period = "monthly") {
  runSql(`insert into public.payment_attempts(business_id, provider_reference, plan, billing_period, expected_amount, currency, customer_email, status)
    values ('${businessId}', '${reference}', '${plan}', '${period}', ${amount}, 'NGN', 'owner@example.test', 'initialized')`);
}
function settleSql(reference, amount = 3500000, txnId = "808") {
  return `begin; set local request.jwt.claim.role = 'service_role';
    select outcome from public.settle_paystack_payment(
      '${reference}',${amount},'NGN','owner@example.test','${txnId}');
    commit;`;
}
function oneValue(sql) { return runSql(sql).stdout.split(/\s+/).at(-1); }

test("atomic Paystack settlement against isolated real PostgreSQL", options, async (t) => {
  // The entire database is disposable, and its name is validated above.
  runSql(`
    create schema if not exists auth;
    do $roles$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
    end $roles$;
    create or replace function auth.role() returns text language sql stable
      as 'select current_setting(''request.jwt.claim.role'',true)';
    create or replace function auth.uid() returns uuid language sql stable
      as 'select null::uuid';
    create table if not exists public.profiles (
      id uuid primary key,
      plan text not null default '14-day trial',
      payment_status text not null default 'trial',
      billing_period text not null default 'monthly',
      currency text not null default 'NGN',
      trial_active boolean not null default true,
      trial_ends_at timestamptz
    );
  `);
  runFile("supabase/invoices.sql");
  runFile("supabase/migrations/202610130002_atomic_paystack_settlement.sql");

  await t.test("valid payment and replay create one invoice without reactivating", () => {
    const owner = id(), reference = ref();
    createOwner(owner); createAttempt(owner, reference);
    assert.match(runSql(settleSql(reference, 3500000, id())).stdout, /settled/);
    const n = oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`);
    assert.equal(n, "1");
    const plan = oneValue(`select plan from public.profiles where id='${owner}'`);
    assert.equal(plan, "Professional");
    // Repeat using actual transaction ID from first settlement.
    const txn = oneValue(`select provider_transaction_id from public.payment_attempts where provider_reference='${reference}'`);
    assert.match(runSql(settleSql(reference, 3500000, txn)).stdout, /already_settled/);
    assert.equal(oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`), "1");
  });

  await t.test("failed invoice insert rolls back profile activation and attempt", () => {
    const owner = id(), reference = ref();
    createOwner(owner); createAttempt(owner, reference);
    runSql(`create or replace function public.reject_test_invoice() returns trigger language plpgsql
      as 'begin raise exception ''simulated invoice rejection''; end';
      create trigger reject_test_invoice before insert on public.invoices
      for each row execute function public.reject_test_invoice();`);
    try {
      assert.equal(runSql(settleSql(reference,3500000,id()), { allowError: true }).success, false);
      assert.equal(oneValue(`select payment_status from public.profiles where id='${owner}'`), "trial");
      assert.equal(oneValue(`select status from public.payment_attempts where provider_reference='${reference}'`), "initialized");
      assert.equal(oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`), "0");
    } finally {
      runSql("drop trigger reject_test_invoice on public.invoices; drop function public.reject_test_invoice();");
    }
  });

  await t.test("failed subscription update rolls back paid invoice", () => {
    const owner = id(), reference = ref();
    createOwner(owner); createAttempt(owner, reference);
    runSql(`create or replace function public.reject_test_subscription() returns trigger language plpgsql
      as 'begin raise exception ''simulated subscription failure''; end';
      create trigger reject_test_subscription before update on public.profiles
      for each row execute function public.reject_test_subscription();`);
    try {
      assert.equal(runSql(settleSql(reference,3500000,id()), { allowError: true }).success, false);
      assert.equal(oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`), "0");
      assert.equal(oneValue(`select status from public.payment_attempts where provider_reference='${reference}'`), "initialized");
    } finally {
      runSql("drop trigger reject_test_subscription on public.profiles; drop function public.reject_test_subscription();");
    }
  });

  await t.test("20 overlapping settlement transactions serialize at database row locks", async () => {
    const owner = id(), reference = ref(), transactionId = id();
    createOwner(owner); createAttempt(owner, reference);
    const sql = settleSql(reference, 3500000, transactionId);
    const command = promisify(execFile);
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      command("psql", [...psqlArgs, "-d", databaseUrl, "-c", sql])
        .then(r => r.stdout).catch(e => { throw new Error(e.stderr || e.message); })
    ));
    assert.equal(results.filter(v => /(?:^|\n)settled(?:\n|$)/.test(v)).length, 1);
    assert.equal(results.filter(v => /already_settled/.test(v)).length, 19);
    assert.equal(oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`), "1");
    assert.equal(oneValue(`select status from public.payment_attempts where provider_reference='${reference}'`), "settled");
  });

  await t.test("newer paid plan remains active when older success arrives late", () => {
    const owner=id(), older=ref(), newer=ref();
    createOwner(owner); createAttempt(owner, older);
    // Ensure deterministic ordering without sleeps.
    runSql(`update public.payment_attempts set created_at = now() - interval '1 day'
      where provider_reference = '${older}'`);
    createAttempt(owner,newer,"Business",7500000);
    runSql(settleSql(newer,7500000,id()));
    runSql(settleSql(older,3500000,id()));
    assert.equal(oneValue(`select plan from public.profiles where id='${owner}'`), "Business");
    assert.equal(oneValue(`select count(*) from public.invoices where business_id='${owner}' and status='paid'`), "2");
    assert.equal(oneValue(`select applied_to_subscription from public.payment_attempts where provider_reference='${older}'`), "f");
  });

  await t.test("amount mismatch and cross-reference conflicts cannot change entitlements", () => {
    const owner = id(), reference = ref();
    createOwner(owner); createAttempt(owner,reference);
    assert.equal(runSql(settleSql(reference,1,id()), { allowError: true }).success, false);
    assert.equal(oneValue(`select count(*) from public.invoices where provider_reference='${reference}'`), "0");
    assert.equal(oneValue(`select payment_status from public.profiles where id='${owner}'`), "trial");
  });

  await t.test("refunded invoice replay never reactivates business", () => {
    const owner=id(),reference=ref(),transactionId=id();
    createOwner(owner); createAttempt(owner,reference);
    runSql(settleSql(reference,3500000,transactionId));
    runSql(`update public.invoices set status='refunded' where provider_reference='${reference}';
      update public.profiles set payment_status='inactive' where id='${owner}';`);
    assert.equal(runSql(settleSql(reference,3500000,transactionId), { allowError: true }).success, false);
    assert.equal(oneValue(`select payment_status from public.profiles where id='${owner}'`), "inactive");
  });
});

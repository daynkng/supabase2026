import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { db, get, rows, useTestPool } from "../lib/db";
import { testPool } from "./pglite-pool";
import { seed } from "../lib/seed";
import { OWNER, NAPA, budget } from "../lib/domain";
import {
  seal,
  unseal,
  newOAuthState,
  authorizationUrl,
  verifyOAuthState,
  oauthCookie,
  requireWalletAccess,
  sessionValue,
  walletCookie,
} from "../lib/wallet-auth";
import {
  requestWalletPayment,
  refreshWalletPayment,
  cancelWalletPayment,
  walletCredential,
  applyWalletResult,
  publicWalletResult,
} from "../lib/wallet";
import { getAccessToken, disconnectWallet } from "../lib/wallet-tokens";
import { POST as walletRoute } from "../app/api/wallet/route";
import { snapshot } from "../lib/service";
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "embedded-wallet-test",
  LINK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  LINK_OPERATOR_TOKEN: "wallet-operator-test-token-at-least-32-characters",
  LINK_CLIENT_ID: "client_fixture",
  LINK_CLIENT_SECRET: "secret_fixture",
  LINK_PUBLISHABLE_KEY: "pk_test_fixture",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
});
const remotes = new Map<string, any>();
const creates: any[] = [];
let loseCreateResponse = false;
let refreshCount = 0;
let revoked = false;
before(async () => {
  useTestPool(await testPool());
  await db().query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint)",
  );
  for (const file of ["001_initial.sql", "002_link_wallet.sql"])
    await db().query(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (const [table, records] of Object.entries(seed()))
    for (const r of records)
      await db().query(
        `INSERT INTO ${table}(id,user_id,project_id,data) VALUES($1,$2,$3,$4)`,
        [r.id, OWNER, r.project_id, JSON.stringify(r.data)],
      );
  await db().query(
    "INSERT INTO wallet_connections(user_id,encrypted_tokens) VALUES($1,$2)",
    [
      OWNER,
      seal(
        {
          access_token: "access_fixture",
          refresh_token: "refresh_fixture",
          expires: Date.now() + 3600000,
          scope: "payment_methods.agentic",
        },
        "link-tokens",
      ),
    ],
  );
  mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/token") {
      refreshCount++;
      return Response.json({
        access_token: "new_access",
        refresh_token: "rotated_refresh",
        expires_in: 3600,
        scope: "payment_methods.agentic",
      });
    }
    if (url.pathname === "/auth/revoke") {
      revoked = true;
      return new Response(null, { status: 200 });
    }
    assert.equal(url.hostname, "api.link.com");
    if (url.pathname === "/spend_requests" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      creates.push(body);
      assert.equal(body.test, true);
      assert.equal(body.request_approval, true);
      assert.equal(body.approve, undefined);
      let remote = [...remotes.values()].find(
        (r) => r.key === body.idempotency_key,
      );
      if (!remote) {
        const id = `lsrq_${remotes.size}`;
        remote = {
          ...body,
          id,
          key: body.idempotency_key,
          status: "pending_approval",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approval_url: `https://app.link.com/approve/${id}`,
        };
        remotes.set(id, remote);
      }
      if (loseCreateResponse) {
        loseCreateResponse = false;
        throw new Error("lost response");
      }
      return Response.json(remote);
    }
    const id = url.pathname.split("/")[2];
    const remote = remotes.get(id);
    assert(remote, `Unexpected request ${url.pathname}`);
    if (url.pathname.endsWith("/cancel")) remote.status = "canceled";
    return Response.json({
      ...remote,
      ...(url.searchParams.get("include") === "card"
        ? {
            card: {
              number: "4000009990001984",
              cvc: "123",
              exp_month: 12,
              exp_year: 2030,
            },
          }
        : {}),
    });
  });
});
after(async () => {
  mock.restoreAll();
  await db().end();
});
const input = (request_id: string, amount_cents = 41000) => ({
  project_id: NAPA,
  request_id,
  amount_cents,
  category: "Hotel",
  merchant_name: "Synthetic hotel",
  merchant_url: "https://example.com",
  description:
    "Reserve a synthetic hotel for our Napa weekend demo. This is a test purchase requested by the user to demonstrate shared agent budget and approval tracking.",
});
test("OAuth uses PKCE, rejects wrong/expired state and encrypts purpose-bound tokens", () => {
  const pending = newOAuthState();
  const url = new URL(authorizationUrl(pending));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "payment_methods.agentic");
  const encrypted = seal(pending, oauthCookie);
  assert(!encrypted.includes(pending.verifier));
  const request = new Request(
    `http://localhost:3000/api/wallet/callback?state=${pending.state}`,
    { headers: { cookie: `${oauthCookie}=${encrypted}` } },
  );
  assert.equal(verifyOAuthState(request).verifier, pending.verifier);
  assert.throws(
    () =>
      verifyOAuthState(
        new Request("http://localhost:3000/api/wallet/callback?state=wrong", {
          headers: request.headers,
        }),
      ),
    /OAuth state/,
  );
  assert.throws(() => unseal(encrypted, "link-tokens"), /Invalid/);
  const expired = seal({ ...pending, expires: 0 }, oauthCookie);
  assert.throws(
    () =>
      verifyOAuthState(
        new Request(request.url, {
          headers: { cookie: `${oauthCookie}=${expired}` },
        }),
      ),
    /expired/,
  );
});
test("wallet routes reject public access, cross-origin unlock, and cookie credential retrieval", async () => {
  const call = (action: string, headers: Record<string, string> = {}) =>
    walletRoute(
      new Request("http://localhost:3000/api/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
          ...headers,
        },
        body: JSON.stringify({
          action,
          input: { token: process.env.LINK_OPERATOR_TOKEN },
        }),
      }),
    );
  assert.equal((await call("refresh")).status, 401);
  assert.equal(
    (await call("unlock", { origin: "https://attacker.example" })).status,
    403,
  );
  const unlock = await call("unlock");
  assert.equal(unlock.status, 200);
  assert(unlock.headers.get("set-cookie")?.includes("HttpOnly"));
  const cookie = `${walletCookie}=${sessionValue()}`;
  requireWalletAccess(
    new Request("http://localhost:3000/api/wallet", { headers: { cookie } }),
  );
  assert.equal((await call("credential", { cookie })).status, 401);
});
test("Link test approval reserves budget but only provider success completes the task", async () => {
  const first = await requestWalletPayment(input("hotel-wallet"));
  assert.equal(first.transaction.data.status, "wallet_pending");
  assert.equal(
    budget(await get("projects", NAPA), await rows("transactions", NAPA))
      .reserved_cents,
    41000,
  );
  const remote = remotes.get(first.transaction.data.link_spend_request_id);
  remote.status = "approved";
  await refreshWalletPayment(first.transaction.id);
  assert.equal(
    budget(await get("projects", NAPA), await rows("transactions", NAPA))
      .spent_cents,
    0,
  );
  assert.equal(
    (await rows("tasks", NAPA)).find((t) => t.data.title === "Hotel")!.data
      .status,
    "pending",
  );
  const credential = await walletCredential(first.transaction.id);
  assert(credential.card.number);
  const state = JSON.stringify(await snapshot());
  assert(!state.includes(credential.card.number));
  assert(!state.includes("access_fixture"));
  assert(
    !JSON.stringify(
      publicWalletResult({ ...remote, card: credential.card }),
    ).includes(credential.card.number),
  );
  remote.status = "succeeded";
  await refreshWalletPayment(first.transaction.id);
  const paidAt = (await get("transactions", first.transaction.id)).data.paid_at;
  remote.status = "expired";
  await refreshWalletPayment(first.transaction.id);
  const paid = await get("transactions", first.transaction.id);
  assert.equal(paid.data.status, "succeeded");
  assert.equal(paid.data.paid_at, paidAt);
  assert.equal(
    (await rows("tasks", NAPA)).find((t) => t.data.title === "Hotel")!.data
      .status,
    "completed",
  );
  await assert.rejects(walletCredential(first.transaction.id), /credential/);
});
test("lost create response reserves once and recovers with stable idempotency", async () => {
  loseCreateResponse = true;
  await assert.rejects(
    requestWalletPayment(input("lost-response", 6200)),
    /remains reserved/,
  );
  const before = creates.at(-1);
  const result = await requestWalletPayment(input("lost-response", 6200));
  assert.deepEqual(creates.at(-1), before);
  assert.equal(
    (await rows("transactions", NAPA)).filter(
      (t) => t.data.request_id === "lost-response",
    ).length,
    1,
  );
  await assert.rejects(
    requestWalletPayment(input("lost-response", 6201)),
    /different inputs/,
  );
  await assert.rejects(disconnectWallet(), /Resolve pending/);
  await cancelWalletPayment(result.transaction.id);
  assert.equal(
    (await get("transactions", result.transaction.id)).data.status,
    "failed",
  );
  assert.equal(
    budget(await get("projects", NAPA), await rows("transactions", NAPA))
      .reserved_cents,
    0,
  );
});
test("wallet reservations prevent overspending and provider amount mismatch cannot commit", async () => {
  const results = await Promise.allSettled([
    requestWalletPayment(input("concurrent-a", 30000)),
    requestWalletPayment(input("concurrent-b", 30000)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const result = (
    results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>
  ).value;
  const remote = remotes.get(result.transaction.data.link_spend_request_id);
  await assert.rejects(
    applyWalletResult(result.transaction.id, {
      ...remote,
      amount: 1,
      status: "succeeded",
    }),
    /amount/,
  );
  await cancelWalletPayment(result.transaction.id);
});
test("concurrent token refresh rotates once, then disconnect revokes and deletes tokens", async () => {
  await db().query("UPDATE wallet_connections SET encrypted_tokens=$1", [
    seal(
      {
        access_token: "old",
        refresh_token: "old-refresh",
        expires: 0,
        scope: "payment_methods.agentic",
      },
      "link-tokens",
    ),
  ]);
  const tokens = await Promise.all([getAccessToken(), getAccessToken()]);
  assert.deepEqual(tokens, ["new_access", "new_access"]);
  assert.equal(refreshCount, 1);
  const stored = (
    await db().query("SELECT encrypted_tokens FROM wallet_connections")
  ).rows[0].encrypted_tokens;
  assert(!stored.includes("rotated_refresh"));
  assert.equal(
    (unseal(stored, "link-tokens") as any).refresh_token,
    "rotated_refresh",
  );
  await disconnectWallet();
  assert(revoked);
  assert.equal(
    (await db().query("SELECT * FROM wallet_connections")).rows.length,
    0,
  );
});

test("public MCP cannot invoke protected wallet tools", async () => {
  process.env.DEMO_PUBLIC = "true";
  const { POST } = await import("../app/mcp/route");
  const response = await POST(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "request_wallet_payment",
          arguments: input("public-attack"),
        },
      }),
    }),
  );
  const result = await response.json();
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /operator token/);
  assert(
    !(await rows("transactions", NAPA)).some(
      (t) => t.data.request_id === "public-attack",
    ),
  );
});

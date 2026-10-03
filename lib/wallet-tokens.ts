import { z } from "zod";
import { db, transaction } from "./db";
import { OWNER, AppError } from "./domain";
import { oauthConfig, seal, unseal } from "./wallet-auth";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires: number;
  scope: string;
};
async function tokenRequest(params: Record<string, string>, priorScope = "") {
  const config = oauthConfig();
  const response = await fetch("https://login.link.com/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.publishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new AppError(
      "Link authorization failed. Reconnect your wallet.",
      502,
    );
  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new AppError("Link returned an invalid authorization response", 502);
  const token = parsed.data;
  const scope = token.scope ?? priorScope;
  if (!scope.split(/[ ,]+/).includes("payment_methods.agentic"))
    throw new AppError("Link payment permission was not granted", 403);
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    scope,
  };
}
export async function connectWallet(code: string, verifier: string) {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "link-wallet-tokens",
    ]);
    const existing = await c.query(
      "SELECT user_id FROM wallet_connections WHERE user_id=$1",
      [OWNER],
    );
    if (existing.rows.length)
      throw new AppError(
        "Disconnect the existing wallet before connecting another",
        409,
      );
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: oauthConfig().redirectUri,
    });
    await c.query(
      "INSERT INTO wallet_connections(user_id, encrypted_tokens) VALUES($1,$2)",
      [OWNER, seal(tokens, "link-tokens")],
    );
  });
}
export async function walletConnectionStatus() {
  const result = await db().query(
    "SELECT updated_at FROM wallet_connections WHERE user_id=$1",
    [OWNER],
  );
  return { connected: !!result.rows.length, test_mode: true };
}
export async function getAccessToken() {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "link-wallet-tokens",
    ]);
    const result = await c.query(
      "SELECT encrypted_tokens FROM wallet_connections WHERE user_id=$1",
      [OWNER],
    );
    if (!result.rows.length)
      throw new AppError("Connect Link Agent Wallet first", 409);
    let tokens = unseal<Tokens>(result.rows[0].encrypted_tokens, "link-tokens");
    if (tokens.expires <= Date.now() + 60000) {
      tokens = await tokenRequest(
        { grant_type: "refresh_token", refresh_token: tokens.refresh_token },
        tokens.scope,
      );
      await c.query(
        "UPDATE wallet_connections SET encrypted_tokens=$2, updated_at=now() WHERE user_id=$1",
        [OWNER, seal(tokens, "link-tokens")],
      );
    }
    return tokens.access_token;
  });
}
export async function disconnectWallet() {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "link-wallet-tokens",
    ]);
    const pending = await c.query(
      "SELECT id FROM transactions WHERE user_id=$1 AND data->>'provider'='link' AND data->>'status' IN ('wallet_pending','wallet_approved','wallet_submitted') LIMIT 1",
      [OWNER],
    );
    if (pending.rows.length)
      throw new AppError(
        "Resolve pending wallet requests before disconnecting",
        409,
      );
    const result = await c.query(
      "SELECT encrypted_tokens FROM wallet_connections WHERE user_id=$1",
      [OWNER],
    );
    if (!result.rows.length) return { disconnected: true };
    const tokens = unseal<Tokens>(
      result.rows[0].encrypted_tokens,
      "link-tokens",
    );
    const config = oauthConfig();
    const response = await fetch("https://login.link.com/auth/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        token: tokens.refresh_token,
        token_type_hint: "refresh_token",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new AppError(
        "Link could not revoke access. Please retry disconnecting.",
        502,
      );
    await c.query("DELETE FROM wallet_connections WHERE user_id=$1", [OWNER]);
    return { disconnected: true };
  });
}

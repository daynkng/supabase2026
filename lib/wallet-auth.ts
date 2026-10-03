import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./domain";

export const walletCookie = "wallet_session";
export const oauthCookie = "wallet_oauth";
function encryptionKey() {
  const key = Buffer.from(process.env.LINK_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32)
    throw new AppError(
      "Configure LINK_ENCRYPTION_KEY with a base64-encoded 32-byte key",
      503,
    );
  return key;
}
export function seal(value: unknown, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function unseal<T>(value: string, purpose: string): T {
  try {
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      bytes.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  } catch {
    throw new AppError("Invalid or expired wallet session", 401);
  }
}
export function validOperatorToken(candidate: string) {
  const expected = process.env.LINK_OPERATOR_TOKEN;
  if (!expected || expected.length < 32) return false;
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
export function cookieValue(req: Request, name: string) {
  return (
    (req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
export function requireWalletAccess(req: Request, bearerOnly = false) {
  if (
    validOperatorToken(
      (req.headers.get("authorization") || "").replace(/^Bearer /, ""),
    )
  )
    return;
  if (!bearerOnly) {
    const cookie = cookieValue(req, walletCookie);
    if (cookie) {
      const session = unseal<{ expires: number; tokenHash: string }>(
        cookie,
        walletCookie,
      );
      const hash = createHash("sha256")
        .update(process.env.LINK_OPERATOR_TOKEN || "")
        .digest("hex");
      if (
        session.expires > Date.now() &&
        session.tokenHash === hash &&
        (process.env.LINK_OPERATOR_TOKEN?.length || 0) >= 32
      )
        return;
    }
  }
  throw new AppError("Unlock the wallet with the operator token first", 401);
}
export function sessionValue() {
  return seal(
    {
      expires: Date.now() + 3600000,
      tokenHash: createHash("sha256")
        .update(process.env.LINK_OPERATOR_TOKEN!)
        .digest("hex"),
    },
    walletCookie,
  );
}
export function cookieHeader(name: string, value: string, seconds: number) {
  const secure = walletOrigin().startsWith("https:") ? "; Secure" : "";
  return `${name}=${value}; Path=/api/wallet; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;
}
export function walletOrigin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new AppError("Wallet requires HTTPS outside localhost", 503);
  return url.origin;
}
export function requireWalletOrigin(req: Request) {
  if (req.headers.get("origin") !== walletOrigin())
    throw new AppError("Same-origin wallet request required", 403);
}
export function oauthConfig() {
  const clientId = process.env.LINK_CLIENT_ID;
  const clientSecret = process.env.LINK_CLIENT_SECRET;
  const publishableKey = process.env.LINK_PUBLISHABLE_KEY;
  if (!clientId || !clientSecret || !publishableKey?.startsWith("pk_"))
    throw new AppError(
      "Configure the Link OAuth client and Stripe publishable key",
      503,
    );
  encryptionKey();
  return {
    clientId,
    clientSecret,
    publishableKey,
    redirectUri: `${walletOrigin()}/api/wallet/callback`,
  };
}
export function newOAuthState() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  return { state, verifier, expires: Date.now() + 600000 };
}
export function authorizationUrl(state: ReturnType<typeof newOAuthState>) {
  const config = oauthConfig();
  const url = new URL("https://login.link.com/auth");
  url.search = new URLSearchParams({
    key: config.publishableKey,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "payment_methods.agentic",
    state: state.state,
    code_challenge: createHash("sha256")
      .update(state.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export function verifyOAuthState(req: Request) {
  const pending = unseal<ReturnType<typeof newOAuthState>>(
    cookieValue(req, oauthCookie),
    oauthCookie,
  );
  if (
    pending.expires <= Date.now() ||
    new URL(req.url).searchParams.get("state") !== pending.state
  )
    throw new AppError("Invalid or expired OAuth state", 400);
  return pending;
}

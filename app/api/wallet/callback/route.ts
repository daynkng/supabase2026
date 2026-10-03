import {
  requireWalletAccess,
  verifyOAuthState,
  oauthCookie,
  cookieHeader,
  walletOrigin,
} from "@/lib/wallet-auth";
import { connectWallet } from "@/lib/wallet-tokens";
export const runtime = "nodejs";
export async function GET(req: Request) {
  let outcome = "error";
  try {
    requireWalletAccess(req);
    const pending = verifyOAuthState(req);
    const url = new URL(req.url);
    if (url.searchParams.has("error")) outcome = "declined";
    else {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Missing code");
      await connectWallet(code, pending.verifier);
      outcome = "connected";
    }
  } catch {
    /* Do not put codes or provider errors into a URL or log. */
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${walletOrigin()}/?wallet=${outcome}`,
      "Set-Cookie": cookieHeader(oauthCookie, "", 0),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

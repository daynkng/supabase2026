import { AppError } from "@/lib/domain";
import {
  requireWalletAccess,
  requireWalletOrigin,
  newOAuthState,
  authorizationUrl,
  seal,
  oauthCookie,
  cookieHeader,
} from "@/lib/wallet-auth";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    requireWalletOrigin(req);
    requireWalletAccess(req);
    const pending = newOAuthState();
    return Response.json(
      { url: authorizationUrl(pending) },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": cookieHeader(
            oauthCookie,
            seal(pending, oauthCookie),
            600,
          ),
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "Could not start wallet authorization",
      },
      {
        status: error instanceof AppError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

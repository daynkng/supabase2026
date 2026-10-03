import { AppError } from "@/lib/domain";
import { ZodError, z } from "zod";
import {
  requireWalletAccess,
  requireWalletOrigin,
  validOperatorToken,
  sessionValue,
  walletCookie,
  cookieHeader,
} from "@/lib/wallet-auth";
import { walletConnectionStatus, disconnectWallet } from "@/lib/wallet-tokens";
import {
  requestWalletPayment,
  refreshWalletPayment,
  cancelWalletPayment,
  walletCredential,
} from "@/lib/wallet";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  try {
    requireWalletAccess(req);
    return Response.json(await walletConnectionStatus(), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    const bearer = req.headers.has("authorization");
    if (!bearer) requireWalletOrigin(req);
    const { action, input = {} } = await req.json();
    if (action === "unlock") {
      requireWalletOrigin(req);
      if (!validOperatorToken(z.string().parse(input.token)))
        throw new AppError("Invalid operator token", 401);
      return Response.json(
        { unlocked: true },
        {
          headers: {
            ...headers,
            "Set-Cookie": cookieHeader(walletCookie, sessionValue(), 3600),
          },
        },
      );
    }
    requireWalletAccess(req, bearer);
    let result;
    switch (action) {
      case "lock":
        return Response.json(
          { locked: true },
          {
            headers: {
              ...headers,
              "Set-Cookie": cookieHeader(walletCookie, "", 0),
            },
          },
        );
      case "disconnect":
        result = await disconnectWallet();
        break;
      case "request":
        result = await requestWalletPayment(input);
        break;
      case "refresh":
        result = await refreshWalletPayment(input.id);
        break;
      case "cancel":
        result = await cancelWalletPayment(z.string().uuid().parse(input.id));
        break;
      case "credential":
        requireWalletAccess(req, true);
        result = await walletCredential(input.id);
        break;
      default:
        throw new AppError("Unknown wallet action");
    }
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof ZodError
        ? 400
        : 502;
  // Never expose provider response bodies or tokens through error serialization.
  return Response.json(
    {
      error:
        error instanceof AppError
          ? error.message
          : error instanceof ZodError
            ? "Invalid wallet request"
            : "Wallet provider unavailable. Retry or reconnect.",
    },
    { status, headers },
  );
}

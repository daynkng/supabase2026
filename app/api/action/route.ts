import { execute } from "@/lib/service";
import { AppError } from "@/lib/domain";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  try {
    return Response.json(await execute("snapshot", {}, true));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unavailable" },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  try {
    if (process.env.DEMO_PUBLIC !== "true")
      throw new AppError(
        "Set DEMO_PUBLIC=true only for a disposable synthetic workspace",
        503,
      );
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin)
      throw new AppError("Same-origin UI request required", 403);
    const { action, input } = await req.json();
    const result = await execute(action, input ?? {}, true, "Human");
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Request failed" },
      {
        status:
          e instanceof AppError ? e.status : e instanceof ZodError ? 400 : 500,
      },
    );
  }
}

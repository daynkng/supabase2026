import { stripe, processStripeEvent } from "@/lib/payments";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    return Response.json({ error: "Webhook not configured" }, { status: 503 });
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      await req.text(),
      req.headers.get("stripe-signature") || "",
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }
  try {
    return Response.json(await processStripeEvent(event));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Webhook processing failed" },
      { status: 500 },
    );
  }
}

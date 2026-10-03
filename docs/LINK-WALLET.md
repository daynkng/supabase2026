# Link Agent Wallet integration

The application supports Link Agent Wallet **test purchases** alongside Stripe test Checkout. It creates a spend request, returns the customer's Link approval URL, retrieves provider status, and updates the shared budget. Approval alone never counts as spending.

## Configure

1. Obtain a confidential OAuth client from Stripe using the registration instructions at https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/oauth. Register the exact redirect URI `https://YOUR-APP/api/wallet/callback` (and any localhost callback you need).
2. Configure `LINK_CLIENT_ID`, `LINK_CLIENT_SECRET`, and `LINK_PUBLISHABLE_KEY`. The publishable key is the Stripe key used by the Link OAuth flow, not a Supabase key. Follow the key/environment requirements provided for your registered client.
3. Set `LINK_OPERATOR_TOKEN` to a random value with at least 32 characters. Set `LINK_ENCRYPTION_KEY` to a base64-encoded random 32-byte encryption key. The local workspace already has generated values in its ignored `.env.local`. Keep the same encryption key across server instances and redeploys; losing it makes stored wallet tokens unreadable.
4. Set `NEXT_PUBLIC_APP_URL` to the exact application origin. HTTPS is required except for localhost. Configure `DATABASE_URL`, then run `npm run db:setup`; it now runs both ordered migrations. Configure all variables separately in Vercel as well.
5. Open Connections, unlock wallet controls with the operator token, then select **Connect Link wallet**. The user completes Link authorization. Only the `payment_methods.agentic` scope is requested.

Tokens are encrypted with AES-256-GCM in a separate RLS-enabled `wallet_connections` table, excluded from snapshots, context packs, and MCP results. PKCE and state protect the callback. Refresh token rotation is serialized through a database advisory lock. Disconnect revokes the provider grant before deleting the encrypted local tokens; resolve pending requests first.

## Request and approve a test purchase

Open Napa Weekend → Budget → Link Agent Wallet. Enter the synthetic merchant, HTTPS merchant URL, total USD amount, category, and a purchase explanation of at least 100 characters. Open the returned Link approval link and review it. Return to the app and select **Refresh / retry** to fetch the provider's state.

- Pending, approved, submitted, and action-required requests reserve their full amount.
- Only provider `succeeded` increases spending and completes the associated simulated task.
- Denied, failed, canceled, and expired requests release the reservation.
- Lost or ambiguous provider responses preserve the reservation. Retry the same transaction to recover the original spend request with a stable idempotency key.
- Cancellation first recovers the provider request, then confirms cancellation with Link. A local UI action cannot mark a purchase paid.
- Unknown provider statuses remain reserved. Amount or currency discrepancies fail closed for operator investigation.

The app deliberately forces `test: true` and `request_approval: true`; callers cannot override either. Test credentials do not charge the underlying funding method and must be used with merchant test checkouts. This does not create a real hotel or winery booking.

## Agent tools and payment execution

The existing eight public context/Checkout tools remain available. Two new MCP tools require `Authorization: Bearer <LINK_OPERATOR_TOKEN>` on the HTTP request:

- `request_wallet_payment(project_id, request_id, amount_cents, category, description, merchant_name, merchant_url)`
- `get_wallet_payment(id)` — takes the local transaction UUID returned by the request tool; refreshes from Link.

Do not put the bearer token in prompts or tool arguments. Configure it as a connection authorization header only where the MCP client supports it. This application does not yet implement MCP OAuth discovery; clients that cannot send a configured bearer header can use the public context tools but cannot use the protected wallet tools.

Payment credentials are never returned by MCP. An authorized local purchase runner can retrieve an approved **test card** directly to an exclusive `0600` file:

```sh
npm run wallet:credential -- TRANSACTION_UUID /absolute/private/path/link-test-card.json
```

The runner authenticates to the app with the operator token from its environment. The response is not printed. A trusted browser/payment executor can consume that file for a specific merchant test checkout; remove it afterward. This integration provides the credential handoff, not a general-purpose automated merchant browser. It does not yet implement Link Pay Token execution, shared payment tokens/MPP, shipping-address access, or real purchases.

After the executor submits the merchant test checkout, call `get_wallet_payment` or refresh in the UI. Do not claim success based on approval, credential issuance, or a browser redirect.

## Verification

`npm run test:integration` includes the real SDK with mocked provider HTTP responses and embedded PostgreSQL. Coverage includes OAuth state/PKCE, encryption, access control, credential isolation, approval versus payment, idempotent recovery, reservation concurrency, scope/amount validation, token rotation, and grant revocation. It does not prove live Link connectivity.

Live acceptance still requires a registered OAuth client, configured database, actual user authorization, a merchant test checkout, and a verified Link success status. Cloud multi-connection concurrency remains a separate acceptance step because the embedded test adapter serializes connections.

The surrounding workspace is public and synthetic. Wallet management is protected, but synthetic transaction descriptions and amounts remain visible in shared context. Do not connect real financial data or use this as a production wallet service.

References: [Link Agent Wallet](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet), [OAuth](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/oauth), [spend requests](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/use-link-wallet-pay-online).

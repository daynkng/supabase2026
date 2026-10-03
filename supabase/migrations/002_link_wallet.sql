-- Wallet secrets are deliberately outside the shared-state tables and snapshots.
CREATE TABLE IF NOT EXISTS public.wallet_connections (
  user_id uuid PRIMARY KEY,
  encrypted_tokens text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_connections ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS link_spend_request_id ON transactions ((data->>'link_spend_request_id')) WHERE data->>'link_spend_request_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS artifact_commit_request_id ON artifacts(user_id,(data->>'commit_request_id')) WHERE data->>'commit_request_id' IS NOT NULL;

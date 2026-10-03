CREATE EXTENSION IF NOT EXISTS vector;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['users','projects','context_items','sources','tasks','artifacts','artifact_chunks','activities','ingestion_runs','context_retrievals','transactions','processed_stripe_events'] LOOP
EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, project_id uuid, data jsonb NOT NULL DEFAULT ''{}'', revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), embedding vector(768))',t);
EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(user_id,project_id)',t||'_scope',t);
END LOOP; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_request_id ON ingestion_runs(user_id,(data->>'request_id')) WHERE data->>'request_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_id ON transactions(user_id,(data->>'request_id'));
CREATE UNIQUE INDEX IF NOT EXISTS stripe_event_id ON processed_stripe_events((data->>'event_id'));
CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_id ON transactions((data->>'stripe_payment_id')) WHERE data->>'stripe_payment_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stripe_session_id ON transactions((data->>'stripe_session_id')) WHERE data->>'stripe_session_id' IS NOT NULL;
CREATE INDEX IF NOT EXISTS context_vector ON context_items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunk_vector ON artifact_chunks USING hnsw (embedding vector_cosine_ops);
ALTER TABLE context_items DROP CONSTRAINT IF EXISTS context_scope;
ALTER TABLE context_items ADD CONSTRAINT context_scope CHECK ((data->>'scope'='personal' AND project_id IS NULL) OR (data->>'scope'='project' AND project_id IS NOT NULL));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS positive_amount;
ALTER TABLE transactions ADD CONSTRAINT positive_amount CHECK ((data->>'amount_cents')::bigint > 0 AND data->>'currency'='USD');
-- No anonymous table policies: all access is mediated by the server.
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('artifacts','artifacts',false,10485760) ON CONFLICT(id) DO NOTHING;

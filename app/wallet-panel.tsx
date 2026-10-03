"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Row } from "@/lib/domain";

type Result = {
  approval_url?: string | null;
  next_action?: { message: string; url?: string | null } | null;
};
export default function WalletPanel({
  projectId,
  transactions = [],
  onChange,
}: {
  projectId?: string;
  transactions?: Row[];
  onChange: () => Promise<void>;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    const response = await fetch("/api/wallet", { cache: "no-store" });
    if (response.status === 401) {
      setUnlocked(false);
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setUnlocked(true);
    setConnected(data.connected);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function call(action: string, input: unknown = {}) {
    const response = await fetch("/api/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) setUnlocked(false);
      throw new Error(data.error);
    }
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet request failed");
    } finally {
      await onChange();
      setBusy(false);
    }
  }
  return (
    <section className="panel wallet-panel">
      <div className="panel-head">
        <h2>Link Agent Wallet</h2>
        <span className="badge">Test purchases only</span>
      </div>
      <div className="padded">
        <p>
          Let an agent request a purchase, approve it in Link, and share its
          payment status with your other agents. Approval reserves budget; only
          confirmed payment counts as spent.
        </p>
        {!unlocked ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const token = String(new FormData(form).get("token") || "");
              form.reset();
              run(async () => {
                await call("unlock", { token });
              });
            }}
          >
            <label>
              Wallet operator token
              <input
                type="password"
                name="token"
                required
                autoComplete="off"
                placeholder="Enter the token from your local configuration"
              />
            </label>
            <p className="secondary">
              Wallet controls are protected separately from the public synthetic
              workspace.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "Unlocking…" : "Unlock wallet controls"}
            </button>
          </form>
        ) : (
          <>
            <div className="row spread">
              <strong>
                {connected ? "Wallet connected" : "Wallet not connected"}
              </strong>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await call("lock");
                    setUnlocked(false);
                  })
                }
              >
                Lock controls
              </button>
            </div>
            {!connected ? (
              <>
                <p>
                  Connect your Link account to approve test purchases. Setup
                  requires registered Link OAuth credentials on the server.
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const response = await fetch("/api/wallet/authorize", {
                        method: "POST",
                      });
                      const data = await response.json();
                      if (!response.ok) throw new Error(data.error);
                      window.location.assign(data.url);
                    })
                  }
                >
                  Connect Link wallet
                </button>
              </>
            ) : (
              <>
                {!projectId && (
                  <p>
                    Open a project’s Budget tab to request a purchase. Each
                    purchase requires approval in Link.
                  </p>
                )}
                {projectId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const fields = new FormData(form);
                      run(async () => {
                        const data = await call("request", {
                          project_id: projectId,
                          request_id: requestId.current,
                          amount_cents: Math.round(
                            Number(fields.get("amount")) * 100,
                          ),
                          category: String(fields.get("category")),
                          description: String(fields.get("description")),
                          merchant_name: String(fields.get("merchant_name")),
                          merchant_url: String(fields.get("merchant_url")),
                        });
                        setResult(data);
                        requestId.current = crypto.randomUUID();
                        form.reset();
                      });
                    }}
                  >
                    <h3>Request a test purchase</h3>
                    <label>
                      Merchant name
                      <input
                        name="merchant_name"
                        required
                        maxLength={200}
                        placeholder="Demo hotel"
                      />
                    </label>
                    <label>
                      Merchant website
                      <input
                        name="merchant_url"
                        type="url"
                        required
                        placeholder="https://example.com"
                      />
                    </label>
                    <label>
                      Purchase details
                      <textarea
                        name="description"
                        required
                        minLength={100}
                        maxLength={2000}
                        placeholder="Describe what the agent should buy, who it is for, and why. Link needs at least 100 characters for informed approval."
                      />
                    </label>
                    <label>
                      Category
                      <select name="category">
                        <option>Hotel</option>
                        <option>Winery</option>
                        <option>Dinner</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label>
                      Total including taxes and fees (USD)
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        max="100000"
                        step="0.01"
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      {busy ? "Requesting…" : "Request Link approval"}
                    </button>
                    <p className="secondary">
                      Test credentials do not charge your underlying payment
                      method. They must be used with a merchant test checkout.
                      No real booking is made.
                    </p>
                  </form>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await call("disconnect");
                      setConnected(false);
                    })
                  }
                >
                  Disconnect and revoke wallet access
                </button>
              </>
            )}
            {projectId &&
              transactions
                .filter((t) => t.data.provider === "link")
                .map((t) => (
                  <div className="prompt-card" key={t.id}>
                    <strong>
                      {t.data.merchant_name} · $
                      {(t.data.amount_cents / 100).toFixed(2)}
                    </strong>
                    <p>
                      {t.data.link_status === "not_created"
                        ? "Needs retry"
                        : t.data.link_status?.replaceAll("_", " ")}
                    </p>
                    {t.data.link_status === "approved" && (
                      <p>
                        Approved. The agent’s secure purchase runner can now
                        retrieve the test credential and complete the merchant’s
                        test checkout.
                      </p>
                    )}
                    {t.data.sync_error && (
                      <p role="alert">{t.data.sync_error}</p>
                    )}
                    <div className="row">
                      <button
                        disabled={busy || !connected}
                        onClick={() =>
                          run(async () => {
                            setResult(await call("refresh", { id: t.id }));
                          })
                        }
                      >
                        Refresh / retry
                      </button>
                      {!["succeeded", "failed", "expired"].includes(
                        t.data.status,
                      ) && (
                        <button
                          disabled={busy || !connected}
                          onClick={() =>
                            run(async () => {
                              setResult(await call("cancel", { id: t.id }));
                            })
                          }
                        >
                          Cancel request
                        </button>
                      )}
                    </div>
                  </div>
                ))}
          </>
        )}
        {result?.approval_url && (
          <p>
            <a
              className="primary"
              href={result.approval_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review and approve in Link ↗
            </a>
            <span className="secondary">
              {" "}
              Return here and refresh the request after approving.
            </span>
          </p>
        )}
        {result?.next_action && (
          <p role="status">
            {result.next_action.message}{" "}
            {result.next_action.url && (
              <a
                href={result.next_action.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue in Link ↗
              </a>
            )}
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { open } from "node:fs/promises";
loadEnvConfig(process.cwd());
const [id, output] = process.argv.slice(2);
if (!id || !output)
  throw new Error(
    "Usage: npm run wallet:credential -- TRANSACTION_ID /absolute/private/output.json",
  );
if (!output.startsWith("/")) throw new Error("Use an absolute output path");
if (!process.env.LINK_OPERATOR_TOKEN)
  throw new Error("LINK_OPERATOR_TOKEN is required");
const url = new URL(
  "/api/wallet",
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("HTTPS is required");
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.LINK_OPERATOR_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "credential", input: { id } }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok)
  throw new Error(
    `Credential retrieval failed (${response.status}). Check approval in the wallet UI.`,
  );
const credential = await response.json();
if (credential.test_mode !== true || !credential.card)
  throw new Error("Expected a test credential");
const file = await open(output, "wx", 0o600);
try {
  await file.writeFile(JSON.stringify(credential));
} finally {
  await file.close();
}
console.log(
  "Test credential saved to the requested private file. No credentials were printed. Use only with a merchant test checkout; delete the file afterward.",
);

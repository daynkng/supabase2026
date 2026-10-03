import { createClient } from "@supabase/supabase-js";
import { AppError } from "./domain";
export function storage() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !key)
    throw new AppError("Supabase Storage is not configured", 503);
  return createClient(process.env.SUPABASE_URL, key, {
    auth: { persistSession: false },
  }).storage.from("artifacts");
}
export async function signedDownload(path: string) {
  const { data, error } = await storage().createSignedUrl(path, 900);
  if (error) throw error;
  return data.signedUrl;
}

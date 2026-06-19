import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SUPABASE_ANON_KEY"];

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL environment variable is required");
}
if (!supabaseKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable is required");
}

// Supabase Realtime needs a WebSocket constructor at client init time. Node 22+
// has it natively; Node 20 (and earlier) does not. We always pass `ws` so the
// app boots on either Node version. Realtime itself isn't used by this app —
// no .channel() subscriptions — so the transport is only here to satisfy the
// client constructor.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
});

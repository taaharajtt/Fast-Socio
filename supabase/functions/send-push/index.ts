// FAST SOCIO — send-push Edge Function (Phase 10).
// Called by the notifications-insert DB trigger (via pg_net) with a shared
// secret. Fans out a Web Push to all of the recipient's stored subscriptions
// and prunes any that are gone (404/410).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@fastsocio.app";
const PUSH_SECRET = Deno.env.get("PUSH_DISPATCH_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { user_id, title, body, url, tag } = await req.json();
  if (!user_id) return new Response("missing user_id", { status: 400 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", user_id);

  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;

  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
  }

  return Response.json({ sent });
});

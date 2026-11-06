// ============================================================
// API للتطبيق المصغر: تحقق initData ثم بيانات الطفل (SDD قسم 3 و 4)
// الأسرار: TELEGRAM_BOT_TOKEN
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// تحقق التشفير من initData: HMAC-SHA256 بمفتاح WebAppData
async function verifyInitData(initData: string): Promise<any | null> {
  const sp = new URLSearchParams(initData);
  const hash = sp.get("hash");
  if (!hash) return null;
  sp.delete("hash");
  sp.delete("signature");
  const dataCheckString = [...sp.entries()]
    .map(([k, v]) => `${k}=${v}`).sort().join("\n");

  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(TOKEN));
  const checkKey = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const calc = await crypto.subtle.sign("HMAC", checkKey, enc.encode(dataCheckString));
  const calcHex = [...new Uint8Array(calc)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (calcHex !== hash) return null;
  try { return JSON.parse(sp.get("user") ?? "null"); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: CORS });

  const body = await req.json().catch(() => ({}));
  const user = await verifyInitData(body.initData ?? "");
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });

  const { data: parent } = await db.from("parents").select("*").eq("telegram_user_id", user.id).maybeSingle();
  if (!parent) return new Response(JSON.stringify({ error: "no_parent" }), { status: 404, headers: CORS });

  const { data: children } = await db.from("children").select("*").eq("parent_id", parent.id).order("created_at");
  const out: any = { parent: { subscription_status: parent.subscription_status, subscription_expires_at: parent.subscription_expires_at }, children: [] };

  for (const ch of children ?? []) {
    const { data: mastery } = await db
      .from("child_mastery_tracker")
      .select("skill_id, mastery_level, attempts_count, last_practiced_at, parent_notes, curriculum_skills(display_name, subject)")
      .eq("child_id", ch.id);

    const week = await (async () => {
      const egypt = new Date(Date.now() + 2 * 3600000);
      const back = (egypt.getUTCDay() + 7) % 7;
      const ws = new Date(egypt.getTime() - back * 86400000).toISOString().slice(0, 10);
      const { data: plan } = await db.from("weekly_plans_and_activities")
        .select("day_number, activity_title, activity_instructions, status, extracted_targets_json")
        .eq("child_id", ch.id).eq("week_start_date", ws).order("day_number");
      return { week_start_date: ws, days: plan ?? [] };
    })();

    const targets = (mastery ?? []).map((m: any) => ({
      skill: m.skill_id, level: m.mastery_level, name: m.curriculum_skills?.display_name ?? m.skill_id,
      subject: m.curriculum_skills?.subject ?? null, notes: m.parent_notes, last: m.last_practiced_at,
    }));

    out.children.push({
      id: ch.id, name: ch.name, stage: ch.stage, stars: ch.stars_count, streak: ch.current_streak_days,
      mastery: targets, week,
    });
  }
  return new Response(JSON.stringify(out), { headers: { ...CORS, "Content-Type": "application/json" } });
});

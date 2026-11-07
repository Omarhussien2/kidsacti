// ============================================================
// الكرون اليومي: إرسال نشاط الـ 10 دقايق للكل في الساعة المفضلة
// بتتصل كل ساعة من pg_cron / Dashboard Scheduler، وتشتغل بس لما الساعة الحالية
// في القاهرة تساوي preferred_reminder_hour لكل أم.
// الأسرار: CRON_SECRET (+ نفس أسرار البوت)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// re-export شغّال من نفس منطق البوت (نسخة مبسطة مستقلة)
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "";

const WEEKDAY_MAP = [1, 2, 3, 4, 5, 5, 5];

async function tg(method: string, body: unknown) {
  return (await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json();
}

function cairoHour(): number {
  return new Date(Date.now() + 2 * 3600000).getUTCHours();
}
function weekStartDate(): string {
  const egypt = new Date(Date.now() + 2 * 3600000);
  const back = (egypt.getUTCDay() + 7) % 7;
  return new Date(egypt.getTime() - back * 86400000).toISOString().slice(0, 10);
}

async function generateActivityText(child: any, todaySkill: string, weakSkill: string | null): Promise<string> {
  let weakName = "مفيش";
  if (weakSkill) {
    const { data: sk } = await db.from("curriculum_skills").select("display_name").eq("id", weakSkill).maybeSingle();
    weakName = sk?.display_name ?? "مفيش";
  }
  const prompt = `أنت «رفيق المذاكرة» للأم المصرية على تليجرام. تخاطب الأم فقط، وتساعدها تذاكر لطفلها (${child.name}، في مرحلة ${child.stage}) هدف اليوم: (${todaySkill}) مع دمج مراجعة سريعة لنقطة ضعفه السابقة: (${weakName}).
مبادئ النشاط: أقل من 10 دقايق، خامات بيتية مصرية عادية فقط (ممنوع شراء أدوات)، عامية مصرية ودودة، مقسمة 3 نقاط: 🎯 اللعبة في 5 دقايق، ✍️ تثبيت سريع في دقيقتين، 💬 جملة تشجيعية تقولها الأم. اختم بطلب صورة أو تقييم من الزرار.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("\n").trim();
}

Deno.serve(async (req) => {
  if ((req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const hour = cairoHour();
  const dayNum = WEEKDAY_MAP[new Date(Date.now() + 2 * 3600000).getUTCDay()];
  const week = weekStartDate();

  const { data: parents } = await db.from("parents").select("*").eq("preferred_reminder_hour", hour);
  let sent = 0;
  for (const p of parents ?? []) {
    const { data: kids } = await db.from("children").select("*").eq("parent_id", p.id);
    for (const ch of kids ?? []) {
      const { data: row } = await db.from("weekly_plans_and_activities")
        .select("*").eq("child_id", ch.id).eq("week_start_date", week).eq("day_number", dayNum).maybeSingle();
      if (row && row.status !== "pending" && row.status !== "sent") continue;
      let title = row?.activity_title ?? "نشاط اليوم";
      let instructions = row?.activity_instructions ?? "";
      if (!instructions) {
        const { data: wk } = await db.from("child_mastery_tracker").select("skill_id")
          .eq("child_id", ch.id).eq("mastery_level", "needs_review_red").limit(1).maybeSingle();
        instructions = await generateActivityText(ch, title, (wk as any)?.skill_id ?? null);
        if (row) await db.from("weekly_plans_and_activities").update({ activity_instructions: instructions, status: "sent" }).eq("id", row.id);
        else await db.from("weekly_plans_and_activities").insert({
          child_id: ch.id, week_start_date: week, day_number: dayNum, activity_title: title, activity_instructions: instructions, status: "sent",
        });
      } else {
        await db.from("weekly_plans_and_activities").update({ status: "sent" }).eq("id", row.id);
      }
      await tg("sendMessage", {
        chat_id: p.telegram_user_id,
        text: `☀️ نشاط اليوم لـ ${ch.name} (${title})\n\n${instructions}\n\nخلصنا؟ قوليلي النتيجة تحت ⬇️`,
        reply_markup: { inline_keyboard: [
          [{ text: "سهل ومتقنه 🟢", callback_data: "fb:easy_green" }, { text: "محتاج شوية مساعدة 🟡", callback_data: "fb:medium_yellow" }],
          [{ text: "لسه بيتلخبط فيه 🔴", callback_data: "fb:hard_red" }, { text: "🎮 نشاط بديل", callback_data: "fb:alt" }],
          [{ text: "📊 ملف المتابعة", web_app: { url: MINIAPP_URL } }],
        ] },
      });
      sent++;
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});

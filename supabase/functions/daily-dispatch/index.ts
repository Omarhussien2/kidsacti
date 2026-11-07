// ============================================================
// الكرون اليومي المطور (الإصدار 2.0): إرسال نشاط الـ 10 دقايق + البطاقة البصرية + الروابط
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const NVIDIA_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "https://omar-x-art.github.io/kidsacti/";

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

async function generateActivityText(child: any, todaySkill: string, words: string[], weakSkill: string | null): Promise<string> {
  let weakName = "لا يوجد";
  if (weakSkill) {
    const { data: sk } = await db.from("curriculum_skills").select("display_name").eq("id", weakSkill).maybeSingle();
    weakName = sk?.display_name ?? "لا يوجد";
  }
  const wordsInfo = words.length ? `كلمات الواجب المطلوبة: (${words.join("، ")})` : "";
  const prompt = `أنت «رفيق المذاكرة» للأم المصرية على تليجرام. ساعدها تذاكر لطفلها (${child.name}، مرحلة ${child.stage}) هدف اليوم: (${todaySkill}). ${wordsInfo}. مراجعة نقطة ضعف سابقة: (${weakName}).
اكتب النشاط في 3 نقاط بالعامية المصرية الدافئة: 🎯 لعبة حركة وحواس في 5 دقايق بخامات البيت، ✍️ تثبيت كتابي لكلمات الواجب في 3 دقايق من غير ملل، 💬 جملة تشجيعية لـ ${child.name}.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    });
    if (res.ok) {
      const data = await res.json();
      const txt = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("\n").trim();
      if (txt) return txt;
    }
  } catch { /* fallback to NVIDIA */ }

  if (NVIDIA_KEY) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_KEY}` },
        body: JSON.stringify({ model: "meta/llama-3.2-90b-vision-instruct", messages: [{ role: "user", content: prompt }], temperature: 0.4, max_tokens: 1000 }),
      });
      if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content?.trim() ?? "";
      }
    } catch { /* ignore */ }
  }
  return `🎯 العبي مع ${child.name} 5 دقايق لتشكيل ${todaySkill} بالصلصال أو المكرونة، وبعدها يكتب الكلمات مرتين بألوان جميلة!`;
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
      const { data: weekRows } = await db.from("weekly_plans_and_activities")
        .select("*")
        .eq("child_id", ch.id)
        .eq("week_start_date", week)
        .order("day_number");

      const row = (weekRows ?? []).find((r: any) => r.status === "pending")
        ?? (weekRows ?? []).find((r: any) => r.day_number === dayNum);

      if (row && row.status === "completed") continue;

      const targets = row?.extracted_targets_json ?? [];
      const primary = targets[0] ?? { code: "AR_LETTER_BAA", title: "حرف الباء (ب)", words: ["بطة", "برج"], video_url: "https://www.youtube.com/results?search_query=حرف+الباء+منهج+تواصل+كي+جي" };
      const skillId = row?.focus_skill_id ?? primary.code ?? "AR_LETTER_BAA";
      const words: string[] = Array.isArray(row?.homework_words_json) && row.homework_words_json.length ? row.homework_words_json : (primary.words ?? []);

      let title = row?.activity_title ?? `نشاط ${primary.title}`;
      let instructions = row?.activity_instructions ?? "";
      if (!instructions) {
        const { data: wk } = await db.from("child_mastery_tracker").select("skill_id")
          .eq("child_id", ch.id).eq("mastery_level", "needs_review_red").limit(1).maybeSingle();
        instructions = await generateActivityText(ch, title, words, (wk as any)?.skill_id ?? null);
        if (row) await db.from("weekly_plans_and_activities").update({ activity_instructions: instructions, status: "sent" }).eq("id", row.id);
        else await db.from("weekly_plans_and_activities").insert({
          child_id: ch.id, week_start_date: week, day_number: dayNum, activity_title: title, activity_instructions: instructions, status: "sent",
        });
      } else if (row) {
        await db.from("weekly_plans_and_activities").update({ status: "sent" }).eq("id", row.id);
      }

      const videoUrl = primary.video_url ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(primary.title + " للاطفال")}`;
      await tg("sendMessage", {
        chat_id: p.telegram_user_id,
        text: `☀️ *معادنا اليومي يا ماما! نشاط ${ch.name} (${title})*\n${words.length ? `📖 كلمات الواجب: (${words.join(" - ")})\n` : ""}\n${instructions}\n\nخلصتوا الـ 10 دقايق؟ سجلي النتيجة تحت عشان نحدث خريطة ${ch.name} ونبعتله رسالته الصوتية ⬇️`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "متقن وممتاز 🟢 (+3⭐)", callback_data: `fb:easy_green:${skillId}` }, { text: "احتاج مساعدة 🟡 (+2⭐)", callback_data: `fb:medium_yellow:${skillId}` }],
            [{ text: "لسه بيتلخبط 🔴 (+1⭐)", callback_data: `fb:hard_red:${skillId}` }, { text: "🔄 نشاط بديل", callback_data: `fb:alt:${skillId}` }],
            [{ text: "🎬 فيديو نطق الحرف", url: videoUrl }, { text: "📊 تطبيق المتابعة", web_app: { url: MINIAPP_URL } }],
          ],
        },
      });
      sent++;
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});

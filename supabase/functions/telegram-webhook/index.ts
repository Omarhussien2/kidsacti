// ============================================================
// بوت متابعة الطفل (تليجرام) - Supabase Edge Function
// المرجع: وثيقة SDD، قسم 1 و 4 و 5
// الأسرار المطلوبة (supabase secrets set):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, GEMINI_API_KEY,
//   MINIAPP_URL, PAYMOB_LINK_MONTHLY, PAYMOB_LINK_TERM, PAYMOB_LINK_ANNUAL, CRON_SECRET
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TG = "https://api.telegram.org";
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const WEEKDAY_MAP = [1, 2, 3, 4, 5, 5, 5]; // أحد..خميس=1..5، جمعة/سبت=5 (مراجعة)


const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------- أدوات تليجرام ----------
async function tg(method: string, body: unknown) {
  const r = await fetch(`${TG}/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}
const sendMessage = (chatId: number | string, text: string, reply_markup?: unknown) =>
  tg("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", reply_markup });

const webAppButton = (text: string) => ({
  inline_keyboard: [[{ text, web_app: { url: MINIAPP_URL } }]],
});

// ---------- أدوات Gemini ----------
async function geminiGenerate(model: string, parts: unknown[], extra: object = {}) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts }], ...extra }),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts ?? [];
    } catch (e) {
      lastErr = e as Error;
      // خطأ مؤقت (503 أو مهلة)؟ استنى 3 ثواني واعيد مرة واحدة
      const transient = /Gemini (429|5\d\d)|timed? ?out|aborted/i.test(String(e));
      if (!transient || attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr ?? new Error("Gemini failed");
}
function jsonFromGemini(parts: any[]): any {
  const raw = parts.map((p: any) => p.text ?? "").join("");
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// توليد رسالة صوتية للطفل (TTS) ورجوعها ملف WAV
async function geminiTts(text: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!part) return null;
    const pcm = base64ToBytes(part.inlineData.data); // L16 24000Hz mono
    return pcmToWav(pcm, 24000);
  } catch {
    return null;
  }
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0); out.set(pcm, 44);
  return out;
}

// ---------- أدوات قاعدة البيانات ----------
const supabaseAdmin = db; // service role: بيتجاوز RLS

async function upsertParent(tgUser: any) {
  const { data } = await supabaseAdmin
    .from("parents")
    .upsert({
      telegram_user_id: tgUser.id,
      telegram_first_name: tgUser.first_name ?? null,
      subscription_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }, { onConflict: "telegram_user_id" })
    .select("id, subscription_status, subscription_expires_at")
    .single();
  return data;
}
async function getParentByTg(tgId: number) {
  const { data } = await supabaseAdmin.from("parents").select("*").eq("telegram_user_id", tgId).single();
  return data;
}
async function getChildren(parentId: string) {
  const { data } = await supabaseAdmin.from("children").select("*").eq("parent_id", parentId).order("created_at");
  return data ?? [];
}
async function getState(tgId: number) {
  const { data } = await supabaseAdmin.from("bot_state").select("*").eq("telegram_user_id", tgId).maybeSingle();
  return data ?? { state: null, temp_json: {} };
}
async function setState(tgId: number, state: string | null, temp: object = {}) {
  await supabaseAdmin.from("bot_state").upsert(
    { telegram_user_id: tgId, state, temp_json: temp, updated_at: new Date().toISOString() },
    { onConflict: "telegram_user_id" });
}
async function subscriptionActive(p: any): Promise<boolean> {
  if (!p) return false;
  if (p.subscription_status === "trial") {
    return p.subscription_expires_at ? new Date(p.subscription_expires_at) > new Date() : true;
  }
  if (p.subscription_status === "expired") return false;
  return p.subscription_expires_at ? new Date(p.subscription_expires_at) > new Date() : true;
}
function weekdayNumberCairo(d = new Date()): number {
  // الأسبوع الدراسي: الأحد=1 ... الخميس=5، الجمعة/السبت = 5 (مراجعة)
  const wd = new Date(d.getTime() + 2 * 3600000).getUTCDay(); // 0=الأحد (توقيت القاهرة تقريبًا)
  return WEEKDAY_MAP[wd];
}
function weekStartDate(d = new Date()): string {
  const egypt = new Date(d.getTime() + 2 * 3600000);
  const day = egypt.getUTCDay(); // 0=الأحد
  const back = (day + 7 - 0) % 7; // الأحد القريب
  const s = new Date(egypt.getTime() - back * 86400000);
  return s.toISOString().slice(0, 10);
}

// ============================================================
// البرومبتات (من الوثيقة SDD قسم 5)
// ============================================================
const PROMPT_PARSER = `أنت خبير مناهج رياض أطفال (KG1 و KG2) في مصر. مهمتك قراءة صورة كراسة الواجب أو خطة الأسبوع (Weekly Plan) التي أرسلتها الأم، واستخراج المطلوب مذاكرته هذا الأسبوع بدقة.

قواعد العمل الصارمة:
1. استخرج فقط الحروف أو الأصوات أو الكلمات أو الأرقام الظاهرة في الصورة أو النص المرفق. لا تخمن مناهج غير موجودة في الصورة.
2. إذا كانت الصورة غير واضحة أو لا تحتوي على واجب دراسي، أرجع الحقل is_clear بقيمة false واكتب في Confirm_message_ar طلبًا لطيفًا باللهجة المصرية لتصوير الصفحة في إضاءة أوضح أو كتابة اسم الحرف.
3. قسّم المخرجات إلى خطة من 5 أيام (من الأحد إلى الخميس)، يركز كل يوم على هدف صغير واضح + مراجعة سريعة لأي مهارة موجودة في قائمة نقاط ضعف الطفل: {WEAK_SKILLS}.
4. أخرج النتيجة بصيغة JSON فقط مطابقة للمخطط:
{
 "is_clear": true,
 "Confirm_message_ar": "رسالة قصيرة ومشجعة بالعامية المصرية تؤكد للأم ما قرأته في الصورة واسم الطفل {CHILD_NAME} فيها",
 "extracted_skills": [{"subject": "english_phonics|arabic|math", "code": "EN_LETTER_M أو AR_LETTER_BAA أو MATH_NUM_5", "title": "اسم المهارة بالعربي"}],
 "five_day_plan": [{"day": 1, "focus_skill": "كود المهارة أو REVIEW_ALL", "activity_title": "عنصر اللعبة البيتية", "activity_instructions": "خطوات اللعب بالعامية المصرية وخامات البيت في 3 أسطر"}]
}`;

const PROMPT_ACTIVITY = `أنت «رفيق المذاكرة» للأم المصرية على تليجرام. أنت تخاطب الأم فقط (لا تخاطب الطفل مباشرة في النص المكتوب)، وتساعدها تذاكر لطفلها ({CHILD_NAME}، في مرحلة {CHILD_STAGE}) هدف اليوم: ({TODAY_SKILL}) مع دمج مراجعة سريعة لنقطة ضعفه السابقة: ({WEAK_SKILL}).

مبادئ تصميم النشاط:
1. المدة الإجمالية لا تتجاوز 10 دقائق.
2. الخامات من داخل أي بيت مصري عادي (ورقة وقلم، مكرونة، رز، طبق دقيق/ملح، مشابك غسيل، ألعاب الطفل، كوبايات بلاستيك) — ممنوع طلب شراء أي أدوات من المكتبة.
3. الأسلوب: عامية مصرية ودودة، عملية، مختصرة جدًا، ومقسمة إلى 3 نقاط فقط:
   🎯 اللعبة في 5 دقايق (حركة وحواس): خطوات اللعبة.
   ✍️ تثبيت سريع في دقيقتين: كتابة الحرف أو الكلمة مرتين أو ثلاث مرات فقط بطريقة ممتعة بدل عواميد الكتابة المملة.
   💬 قولي لـ {CHILD_NAME}: جملة تشجيعية تقولها الأم للطفل أثناء اللعب.
4. اختم الرسالة بجملة واحدة: «صوريلي {CHILD_NAME} وهو بيلعب، أو اضغطي على الزرار تحت عشان أبعتله رسالة صوتية باسمه ونزود نجومه!»
{VARIATION}`;

const PROMPT_FEEDBACK = `أنت تراجع نتيجة نشاط اليوم للطفل ({CHILD_NAME}) في مهارة ({TODAY_SKILL}).
مدخلات الأم: {PARENT_INPUT}

المطلوب إخراج JSON فقط بالشكل ده:
{
 "new_mastery_level": "mastered_green أو practicing_yellow أو needs_review_red (الأخضر لو أتقن بدون مساعدة، الأصفر لو احتاج مساعدة بسيطة، الأحمر لو واجه صعوبة أو خلط بين الحروف)",
 "stars_awarded": 1 أو 2 أو 3 (نجمة على المحاولة حتى لو أخطأ، و3 نجوم للإتقان),
 "parent_reply_text": "رد قصير يطمئن الأم بالعامية المصرية ويخبرها إن خريطة متابعة {CHILD_NAME} اتحدثت في تطبيق المتابعة",
 "child_voice_script_ar": "نص قصير ومبهج جدًا (20-30 كلمة بالعامية المصرية) يُقرأ صوتيًا للطفل باسمه {CHILD_NAME} ويذكر إنه كسب النجوم"
}`;


// ============================================================
// واجب الأسبوع: تحليل صورة + بناء الخطة
// ============================================================
async function handleHomeworkPhoto(chatId: number, tgId: number, parent: any, child: any, fileId: string) {
  // نزّل الصورة من تليجرام
  const fi = await tg("getFile", { file_id: fileId });
  const path = fi?.result?.file_path;
  if (!path) { await sendMessage(chatId, "مش قادر أوصل للصورة، جربي تبعتيها تاني."); return; }
  const img = await fetch(`${TG}/file/bot${TOKEN}/${path}`);
  const buf = new Uint8Array(await img.arrayBuffer());

  // نقاط الضعف الحالية
  const { data: weak } = await supabaseAdmin
    .from("child_mastery_tracker").select("skill_id")
    .eq("child_id", child.id).eq("mastery_level", "needs_review_red");
  const weakSkills = (weak ?? []).map((r: any) => r.skill_id).join(", ") || "مفيش";

  const parts: any[] = [
    { text: PROMPT_PARSER.replace("{WEAK_SKILLS}", weakSkills).replace("{CHILD_NAME}", child.name) },
    { inlineData: { mimeType: "image/jpeg", data: encodeBase64(buf) } },
  ];

  let out: any = null;
  try {
    out = jsonFromGemini(await geminiGenerate("gemini-flash-latest", parts, {
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }));
  } catch {
    await sendMessage(chatId, "حصلت مشكلة تقنية وصلت تحليل الصورة. ابعتيلي الصورة تاني بعد دقيقة، ولو تكررت هنتأكد من الإعداد.");
    return;
  }

  if (!out || out.is_clear === false) {
    const msg = out?.Confirm_message_ar ?? "الصورة مش واضحة كفاية يا ماما. صوري الصفحة في إضاءة أحسن أو اكتبيلي اسم الحرف وأنا أظبطها.";
    await sendMessage(chatId, msg);
    return;
  }

  // ارفع الصورة على Bucket خاص
  let imageUrl: string | null = null;
  try {
    const fn = `homework/${child.id}/${Date.now()}.jpg`;
    const { error } = await supabaseAdmin.storage.from("homework").upload(fn, buf, { contentType: "image/jpeg" });
    if (!error) imageUrl = fn;
  } catch { /* الصورة اختيارية */ }

  // احفظ الخطة 5 أيام
  const rows = (out.five_day_plan ?? []).slice(0, 5).map((p: any, i: number) => ({
    child_id: child.id,
    week_start_date: weekStartDate(),
    homework_image_url: imageUrl,
    extracted_targets_json: out.extracted_skills ?? [],
    day_number: p.day ?? i + 1,
    activity_title: p.activity_title ?? "نشاط اليوم",
    activity_instructions: p.activity_instructions ?? null,
    status: "pending",
  }));
  if (rows.length) {
    await supabaseAdmin.from("weekly_plans_and_activities").delete()
      .eq("child_id", child.id).eq("week_start_date", weekStartDate()).eq("status", "pending");
    await supabaseAdmin.from("weekly_plans_and_activities").insert(rows);
  }

  // حدّث خريطة الإتقان: المستخرجة = practicing_yellow
  for (const s of out.extracted_skills ?? []) {
    await supabaseAdmin.from("curriculum_skills").upsert(
      { id: s.code, subject: s.subject ?? "arabic", display_name: s.title ?? s.code },
      { onConflict: "id" });
    await supabaseAdmin.from("child_mastery_tracker").upsert(
      { child_id: child.id, skill_id: s.code, mastery_level: "practicing_yellow", last_practiced_at: new Date().toISOString() },
      { onConflict: "child_id,skill_id" });
  }

  await sendMessage(chatId, out.Confirm_message_ar ?? "تمام يا ماما! جهزتلك خطة 5 أيام، كل يوم 10 دقايق 🎯", {
    inline_keyboard: [
      [{ text: "📊 ملف متابعة طفلي", web_app: { url: MINIAPP_URL } }],
      [{ text: "🎮 ابعتي نشاط النهارده", callback_data: "act:today" }],
    ],
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ============================================================
// إرسال نشاط اليوم (من الكرون أو زرار)
// ============================================================
export async function sendDayActivity(parent: any, child: any, dayNumber: number, weekStart: string) {
  const chatId = parent.telegram_user_id;
  const { data: rows } = await supabaseAdmin
    .from("weekly_plans_and_activities")
    .select("*").eq("child_id", child.id).eq("week_start_date", weekStart)
    .eq("day_number", dayNumber).maybeSingle();

  let title = rows?.activity_title;
  let instructions = rows?.activity_instructions;

  if (!rows) {
    // مفيش خطة للأسبوع ده: أطلع نشاط عام على مهارة ضعيفة أو جديدة
    const { data: weakSkill } = await supabaseAdmin
      .from("child_mastery_tracker").select("skill_id, curriculum_skills(display_name)")
      .eq("child_id", child.id).in("mastery_level", ["needs_review_red", "practicing_yellow"])
      .order("last_practiced_at", { ascending: true }).limit(1).maybeSingle();
    const skillName = (weakSkill as any)?.curriculum_skills?.display_name ?? "حرف جديد من المنهج";
    const generated = await generateActivity(parent, child, skillName, weakSkill?.skill_id ?? null, false);
    title = generated.title; instructions = generated.text;
    await supabaseAdmin.from("weekly_plans_and_activities").insert({
      child_id: child.id, week_start_date: weekStart, day_number: dayNumber,
      activity_title: title, activity_instructions: instructions, status: "pending",
    });
  } else if (!instructions) {
    const { data: weakSkill } = await supabaseAdmin
      .from("child_mastery_tracker").select("skill_id, curriculum_skills(display_name)")
      .eq("child_id", child.id).in("mastery_level", ["needs_review_red"])
      .limit(1).maybeSingle();
    const generated = await generateActivity(parent, child, rows.activity_title, (weakSkill as any)?.skill_id ?? null, false);
    instructions = generated.text;
    await supabaseAdmin.from("weekly_plans_and_activities").update({ instructions: undefined as never, activity_instructions: instructions, status: "sent" })
      .eq("id", rows.id);
  } else {
    await supabaseAdmin.from("weekly_plans_and_activities").update({ status: "sent" }).eq("id", rows.id);
  }

  await sendMessage(chatId,
    `☀️ نشاط اليوم لـ ${child.name} (${title})\n\n${instructions}\n\nخلصنا؟ قوليلي النتيجة تحت ⬇️`,
    {
      inline_keyboard: [
        [{ text: "سهل ومتقنه 🟢", callback_data: "fb:easy_green" },
         { text: "محتاج شوية مساعدة 🟡", callback_data: "fb:medium_yellow" }],
        [{ text: "لسه بيتلخبط فيه 🔴", callback_data: "fb:hard_red" },
         { text: "🎮 نشاط بديل بخامات تانية", callback_data: "fb:alt" }],
      ],
    });
}

async function generateActivity(parent: any, child: any, todaySkill: string, weakSkillId: string | null, variation: boolean) {
  let weakName = "مفيش";
  if (weakSkillId) {
    const { data: sk } = await supabaseAdmin.from("curriculum_skills").select("display_name").eq("id", weakSkillId).maybeSingle();
    weakName = sk?.display_name ?? "مفيش";
  }
  const prompt = PROMPT_ACTIVITY
    .replaceAll("{CHILD_NAME}", child.name)
    .replaceAll("{CHILD_STAGE}", child.stage ?? "kg1")
    .replaceAll("{TODAY_SKILL}", todaySkill)
    .replaceAll("{WEAK_SKILL}", weakName)
    .replace("{VARIATION}", variation ? "\nمهم: اللعبة دي بديل لنشاط سابق، استخدم خامات بيتية مختلفة تمامًا عن المعتادة وخليها أكتر حركة." : "");

  const parts = await geminiGenerate("gemini-flash-lite-latest", [{ text: prompt }]);
  const text = parts.map((p: any) => p.text ?? "").join("\n").trim();
  return { title: todaySkill, text: text || `العبي مع ${child.name} 10 دقايق على ${todaySkill} بخامات البيت.` };
}

// ============================================================
// تقييم التنفيذ وتحديث الخريطة + الرسالة الصوتية
// ============================================================
const LEVEL_BY_FB: Record<string, string> = {
  "easy_green": "mastered_green", "medium_yellow": "practicing_yellow", "hard_red": "needs_review_red",
};
const STARS_BY_FB: Record<string, number> = { "easy_green": 3, "medium_yellow": 2, "hard_red": 1 };

async function handleFeedback(chatId: number, tgId: number, child: any, rating: string, note: string | null, completionPhotoUrl: string | null) {
  // مهارة اليوم الحالية
  const { data: todayRow } = await supabaseAdmin
    .from("weekly_plans_and_activities").select("id, activity_title")
    .eq("child_id", child.id).eq("week_start_date", weekStartDate())
    .eq("day_number", weekdayNumberCairo()).maybeSingle();

  const skillName = todayRow?.activity_title ?? "نشاط اليوم";
  const parts = await geminiGenerate("gemini-flash-lite-latest", [{
    text: PROMPT_FEEDBACK
      .replaceAll("{CHILD_NAME}", child.name)
      .replaceAll("{TODAY_SKILL}", skillName)
      .replace("{PARENT_INPUT}", `تقييم: ${rating}${note ? ` — ملاحظة الأم: ${note}` : ""}`),
  }], { generationConfig: { temperature: 0.3, responseMimeType: "application/json" } });

  const out = jsonFromGemini(parts);
  const level = LEVEL_BY_FB[rating];
  const stars = out?.stars_awarded ?? STARS_BY_FB[rating];

  // حدّث خريطة الإتقان على المهارة اللي في العنوان لو لقينا مطابقة
  if (skillName) {
    const { data: sk } = await supabaseAdmin.from("curriculum_skills").select("id").ilike("display_name", `%${skillName}%`).maybeSingle();
    const skillId = sk?.id;
    if (skillId) {
      await supabaseAdmin.from("child_mastery_tracker").upsert({
        child_id: child.id, skill_id: skillId, mastery_level: level,
        parent_notes: note, last_practiced_at: new Date().toISOString(),
        attempts_count: 1,
      }, { onConflict: "child_id,skill_id" });
    }
  }

  // نجوم + streak
  const todayStr = new Date(new Date().getTime() + 2 * 3600000).toISOString().slice(0, 10);
  const { data: cur } = await supabaseAdmin.from("children").select("stars_count, current_streak_days, last_active_date").eq("id", child.id).single();
  const streak = cur?.last_active_date === todayStr ? cur.current_streak_days
    : (isYesterday(cur?.last_active_date, todayStr) ? (cur?.current_streak_days ?? 0) + 1 : 1);
  await supabaseAdmin.from("children").update({
    stars_count: (cur?.stars_count ?? 0) + stars,
    current_streak_days: streak,
    last_active_date: todayStr,
  }).eq("id", child.id);
  if (todayRow) {
    await supabaseAdmin.from("weekly_plans_and_activities").update({
      status: "completed", feedback_rating: rating, completion_photo_url: completionPhotoUrl,
    }).eq("id", todayRow.id);
  }

  await sendMessage(chatId, out?.parent_reply_text ?? `تمام يا ماما! حدثت خريطة ${child.name} في تطبيق المتابعة وكسب ${stars} نجوم ⭐`);

  // الرسالة الصوتية للطفل
  if (out?.child_voice_script_ar) {
    const wav = await geminiTts(out.child_voice_script_ar);
    if (wav) {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("audio", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "for_child.wav");
      form.append("caption", `🎙️ رسالة صوتية لـ ${child.name}`);
      form.append("title", "بطل اليوم ⭐");
      await fetch(`${TG}/bot${TOKEN}/sendAudio`, { method: "POST", body: form });
    } else {
      await sendMessage(chatId, `🔊 لـ ${child.name}: «${out.child_voice_script_ar}»`);
    }
  }
}

function isYesterday(dateStr: string | null | undefined, todayStr: string): boolean {
  if (!dateStr) return false;
  const y = new Date(new Date(todayStr).getTime() - 86400000).toISOString().slice(0, 10);
  return dateStr === y;
}

// ============================================================
// نقطة الدخول: Webhook
// ============================================================
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // الحماية: توكن سري من معامل secret_token في setWebhook
  if ((req.headers.get("x-telegram-bot-api-secret-token") ?? "") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const update = await req.json();
    await routeUpdate(update);
  } catch (e) {
    console.error("webhook error", e);
  }
  return new Response("ok");
});

async function routeUpdate(u: any) {
  // --- أزرار الضغط ---
  if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = cb.message?.chat?.id ?? cb.from.id;
    const parent = await getParentByTg(cb.from.id);
    if (!parent) { await sendMessage(chatId, "ابدئي بالأمر /start الأول."); return; }
    const kids = await getChildren(parent.id);
    if (!kids.length) { await sendMessage(chatId, "محتاجين نضيف الطفل الأول. اكتبي اسمه."); await setState(cb.from.id, "awaiting_child_name"); return; }
    const child = kids[0]; // الباقة العادية: طفل واحد (السنوية: طفلين)
    const parts = (cb.data ?? "").split(":");

    if (parts[0] === "stage" && kids.length === 0) { /* handled in text flow */ }
    if (parts[0] === "stage") {
      const stage = parts[1];
      await supabaseAdmin.from("children").update({ stage }).eq("parent_id", parent.id).order("created_at", { ascending: false }).limit(1);
      await setState(cb.from.id, null);
      await sendMessage(chatId, "تمام! كده الطفل جاهز 🎉 ابعتيلي صورة كراسة الواجب أو خطة الأسبوع في أي وقت، وأنا أجهزلك 5 ألعاب بيتية كل يوم 10 دقايق.");
      return;
    }
    if (parts[0] === "act") {
      await sendDayActivity(parent, child, WEEKDAY_MAP[new Date(new Date().getTime() + 2 * 3600000).getUTCDay()], weekStartDate());
      return;
    }
    if (parts[0] === "fb") {
      if (parts[1] === "alt") {
        const { data: todayRow } = await supabaseAdmin
          .from("weekly_plans_and_activities").select("*")
          .eq("child_id", child.id).eq("week_start_date", weekStartDate())
          .eq("day_number", WEEKDAY_MAP[new Date(new Date().getTime() + 2 * 3600000).getUTCDay()]).maybeSingle();
        const gen = await generateActivity(parent, child, todayRow?.activity_title ?? "نشاط اليوم", null, true);
        await sendMessage(chatId, `🔄 بديل نشاط النهارده:\n\n${gen.text}`);
        return;
      }
      if (parts[1] === "hard_red") {
        // محتاجين ملاحظة الأم (السيناريو 2 في الوثيقة)
        await setState(cb.from.id, "awaiting_feedback_note", { rating: "hard_red", child_id: child.id });
        await sendMessage(chatId, "اكتيلي سطر واحد: بيتلخبط في إيه بالظبط؟ (مثال: بيتلخبط بينه وبين حرف d) وأنا أضيفها لخريطة المتابعة وأظبط نشاط بكرة على أساسها.");
        return;
      }
      await setState(cb.from.id, "awaiting_feedback_photo", { rating: parts[1], child_id: child.id });
      await sendMessage(chatId, "لو عايزة تبعتيلي صورة الكراسة ابعتيلها دلوقتي، ولو مش عايزة اضغطي «مباشرة».");
      await tg("sendMessage", { chat_id: chatId, text: "اضغطي هنا لو عايزة تسجلي التقييم من غير صورة:", reply_markup: { inline_keyboard: [[{ text: "مباشرة ✅", callback_data: `fbnow:${parts[1]}` }]] } });
      return;
    }
    if (parts[0] === "fbnow") {
      const kid = (await getChildren(parent.id)).find((k: any) => k.id === child.id) ?? child;
      await handleFeedback(chatId, cb.from.id, kid, parts[1], null, null);
      return;
    }
    if (parts[0] === "sub") {
      const links: Record<string, string> = {
        monthly: Deno.env.get("PAYMOB_LINK_MONTHLY") ?? "",
        term: Deno.env.get("PAYMOB_LINK_TERM") ?? "",
        annual: Deno.env.get("PAYMOB_LINK_ANNUAL") ?? "",
      };
      const label: Record<string, string> = { monthly: "الشهري 89 ج.م", term: "الترم 219 ج.م", annual: "السنوي مع هدية من سراج 649 ج.م" };
      const url = links[parts[1]];
      if (url) {
        await sendMessage(chatId, `اشتراك ${label[parts[1]]}:`, { inline_keyboard: [[{ text: "ادفعي هنا 🔗", url }]] });
      } else {
        await sendMessage(chatId, "رابط الدفع لسه مش متظبط. هنتواصل معاكي قريب.");
      }
      return;
    }
  }

  const msg = u.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const parent = await upsertParent(msg.from);

  // --- أوامر ونصوص ---
  if (msg.text?.startsWith("/start")) {
    const kids = await getChildren(parent.id);
    if (kids.length) {
      const k = kids[0];
      await sendMessage(chatId,
        `أهلاً تاني يا ماما ${msg.from.first_name ?? ""} 👋\n\nمتابعة ${k.name}: ⭐ ${k.stars_count} نجمة | 🔥 ${k.current_streak_days} يوم متتالي\n\nابعتيلي صورة كراسة الواجب أو خطة الأسبوع، وكل يوم هبعتلك نشاط 10 دقايق.`,
        { inline_keyboard: [[{ text: "📊 ملف متابعة طفلي", web_app: { url: MINIAPP_URL } }], [{ text: "🎮 ابعتي نشاط النهارده", callback_data: "act:today" }]] });
    } else {
      await setState(tgId, "awaiting_child_name");
      await sendMessage(chatId, "أهلاً بيكي في «رفيق المذاكرة» 🌟\n\nهنساعد بعض نذاكر الطفل بمنهج مدرسته، 10 دقايق يوميًا بخامات البيت، وتقدري تتابعي تقدمه على تطبيق المتابعة داخل تليجرام.\n\nنبدأ؟ اكتبي اسم الطفل:");
    }
    return;
  }
  if (msg.text?.startsWith("/menu")) {
    await sendMessage(chatId, "اختاري:", { inline_keyboard: [[{ text: "📊 ملف المتابعة", web_app: { url: MINIAPP_URL } }], [{ text: "🎮 نشاط النهارده", callback_data: "act:today" }], [{ text: "💳 الاشتراك", callback_data: "sub:menu" }]] });
    return;
  }

  const state = await getState(tgId);

  // onboarding: اسم الطفل
  if (state.state === "awaiting_child_name" && msg.text) {
    const { data: kid } = await supabaseAdmin.from("children")
      .insert({ parent_id: parent.id, name: msg.text.trim().slice(0, 40), stage: "kg1" }).select().single();
    await setState(tgId, "awaiting_child_stage", { child_id: kid.id });
    await sendMessage(chatId, `أهلاً بي ${kid.name} 🎉 الطفل في أنهي مرحلة؟`, {
      inline_keyboard: [
        [{ text: "Pre-KG", callback_data: "stage:pre_kg" }, { text: "KG1", callback_data: "stage:kg1" }],
        [{ text: "KG2", callback_data: "stage:kg2" }, { text: "Grade 1", callback_data: "stage:grade1" }],
      ],
    });
    return;
  }

  // ملاحظة التعثر
  if (state.state === "awaiting_feedback_note" && msg.text) {
    const kid = (await getChildren(parent.id))[0];
    await setState(tgId, null);
    await handleFeedback(chatId, tgId, kid, state.temp_json?.rating ?? "hard_red", msg.text.trim(), null);
    return;
  }

  // صورة كراسة الواجب
  const photo = msg.photo?.[msg.photo.length - 1]?.file_id;
  if (photo) {
    if (state.state === "awaiting_feedback_photo") {
      // صورة تنفيذ النشاط: نقيّمها كتنفيذ مع صورة
      const kid = (await getChildren(parent.id))[0];
      await setState(tgId, null);
      await handleFeedback(chatId, tgId, kid, state.temp_json?.rating ?? "medium_yellow", null, null);
      return;
    }
    if (!(await subscriptionActive(parent))) { await sendTrialOver(chatId); return; }
    const kid = (await getChildren(parent.id))[0];
    if (!kid) { await setState(tgId, "awaiting_child_name"); await sendMessage(chatId, "نضيف الطفل الأول: اكتبي اسمه 🙂"); return; }
    await sendMessage(chatId, "بقرا الواجب وأنظم الخطة... ثواني ⏳");
    await handleHomeworkPhoto(chatId, tgId, parent, kid, photo);
    return;
  }

  if (msg.text && !state.state) {
    await sendMessage(chatId, "ابعتيلي صورة كراسة الواجب أو خطة الأسبوع 📸، أو اضغطي /menu");
  }
}

async function sendTrialOver(chatId: number) {
  const buttons = [[{ text: "شهري 89 ج.م", callback_data: "sub:monthly" }, { text: "ترم 219 ج.م", callback_data: "sub:term" }], [{ text: "سنوي مع هدية سراج 649 ج.م ⭐", callback_data: "sub:annual" }]];
  await sendMessage(chatId, "خلصت الأسبوع التجريبي! 🎉\nشوف إنجاز الطفل في تطبيق المتابعة، وكمّل معانا باشتراك:", { inline_keyboard: buttons });
}

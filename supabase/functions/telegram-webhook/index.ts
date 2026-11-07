// ============================================================
// بوت متابعة الطفل الذكي (تليجرام) - الإصدار 2.0 المطور بالكامل
// يعالج:
// 1) ربط الأنشطة بكلمات وتفاصيل الواجب الفعلي (من صورة الكراسة أو النص أو الصوت)
// 2) تسجيل وتخزين دقيق لإتقان الطفل وعدد المحاولات والملاحظات في child_mastery_tracker
// 3) محادثة ذكية وسلسة مع الأم بالعامية المصرية مع حفظ ذاكرة الحوار (conversation_history)
// 4) إرسال بطاقة بصرية توضيحية (صورة) + روابط فيديوهات نطق الحروف والسبورة التفاعلية
// 5) استقبال أوامر التطبيق المصغر (web_app_data) وتحديث الخطة فورًا
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TG = "https://api.telegram.org";
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const NVIDIA_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "https://omar-x-art.github.io/kidsacti/";

const WEEKDAY_MAP = [1, 2, 3, 4, 5, 5, 5]; // الأحد=1..الخميس=5، الجمعة والسبت=مراجعة أو أول نشاط متاح

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const supabaseAdmin = db;

// ---------- أدوات تليجرام ----------
async function tg(method: string, body: unknown) {
  const r = await fetch(`${TG}/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

async function sendMessage(chatId: number | string, text: string, reply_markup?: unknown) {
  // محاولة الإرسال بـ Markdown أولاً، ولو فشل بسبب رموز خاصة نرسل نصًا عاديًا لضمان عدم الصمت أبدًا
  const res = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", reply_markup, disable_web_page_preview: false });
  if (!res?.ok) {
    return await tg("sendMessage", { chat_id: chatId, text: text.replace(/[*_`]/g, ""), reply_markup, disable_web_page_preview: false });
  }
  return res;
}

// ============================================================
// رسالة الانتظار الاحترافية: تأكيد فوري + نصيحة تربوية متغيرة
// ============================================================
const STUDY_TIPS = [
  "ابدأوا بجلسة قصيرة 10 دقايق.. الجلسة القصيرة اللي بتخلص أحسن من الطويلة اللي بتزهق.",
  "لو طفلك مش مركز، خليه يقف ويعمل حركة دقيقتين وبعدين ارجعوا للمذاكرة تاني.",
  "المدح بالتفصيل أقوى: «إنت حطيت النقطة تحت الباء صح» أحسن من «برافو» لوحدها.",
  "خلي المذاكرة لعبة مش عقاب.. صوت الحروف بالضحك بيثبت أسرع من الزعيق.",
  "متقارنش طفلك بحد غيره، قارنه بنفسه إمبارح.. ده اللي بيصنع الثقة.",
  "لو أخطأ قولي «قربنا جدًا جرب تاني».. كلمة «غلط» بتنسف الحماس.",
  "اقفلي التلفزيون وقت المذاكرة، والصوت العالي لصوت طفلك وهو بيتعلم أحسن.",
  "خليه هو اللي يقرا التعليمات بصوت عالي.. اللي بيتكلم بيتعلم أسرع.",
  "قبل ما تبدأوا: كوباية مياه ونفس عميق.. الجسم المرتاح بيتعلم أسرع.",
  "المكافأة مش لازم تبقى غالية: نجمة على ورقة أو 5 دقايق لعبة بيحبها كفاية.",
  "لو زهق بدل ما تتراجعي، غيّري طريقة المهمة: الحرف بمكعبات وبعدين بالقلم.",
  "ثبتوا الحرف بالحواس الخمس: يكتبه، يلونه، ينطقه، يمثله بإيده، ويلاقي كلمة فيه.",
  "لو طفلك قلق من المدرسة اسمعه الأول بدون تقييم.. الطفل المرتاح بيتعلم.",
  "أهم قاعدة: اخلصوا الجلسة على ملاحظة إيجابية.. آخر ذكرة هي اللي بتترسخ.",
  "التكرار اليومي القصير أقوى بكتير من جلسة طويلة قبل الامتحان بيوم واحد.",
];
const HOLDING_LABELS: Record<string, string> = {
  photo: "⏳ بشتغل على صورة الواجب دلوقتي وبجهز خطة الأسبوع يا ماما.. ثواني بس 🙏",
  voice: "⏳ بسمع رسالتك الصوتية وبفهمها كويس يا ماما.. واقفة على خطوة واحدة من الرد 🙏",
  question: "⏳ بتدور على أحسن إجابة ليك يا ماما.. لحظة واحدة 🙏",
  alt: "⏳ بجهزلك نشاط بديل سهل وممتع يا ماما.. ثواني 🙏",
  today: "⏳ بجهز نشاط النهارده بالكامل يا ماما.. ثواني 🙏",
};

function pickTip(): string {
  return STUDY_TIPS[Math.floor(Math.random() * STUDY_TIPS.length)];
}

async function sendHolding(chatId: number, context: string): Promise<number | null> {
  const label = HOLDING_LABELS[context] ?? HOLDING_LABELS.question;
  const res = await tg("sendMessage", {
    chat_id: chatId,
    text: `${label}\n\n💡 *نصيحة سريعة وأنتي بتستني:* ${pickTip()}`,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
  try { await tg("sendChatAction", { chat_id: chatId, action: "typing" }); } catch { /* اختياري */ }
  return res?.result?.message_id ?? null;
}

// تحويل رسالة الانتظار للرد النهائي (تعديل بدل رسالتين)، ولو فشل التحرير نحذفها ونرسل الرد
async function closeHolding(chatId: number, holdId: number | null, text: string, reply_markup?: unknown) {
  if (holdId) {
    const edited = await tg("editMessageText", {
      chat_id: chatId, message_id: holdId, text,
      parse_mode: "Markdown", reply_markup, disable_web_page_preview: false,
    });
    if (edited?.ok) return;
    try { await tg("deleteMessage", { chat_id: chatId, message_id: holdId }); } catch { /* اختياري */ }
  }
  await sendMessage(chatId, text, reply_markup);
}

// غلق رسالة الانتظار برسالة مختلفة (خطأ أو مسار خاص) بدون تعديل نصها
async function clearHolding(chatId: number, holdId: number | null) {
  if (!holdId) return;
  try { await tg("deleteMessage", { chat_id: chatId, message_id: holdId }); } catch { /* اختياري */ }
}

// تغيير نص رسالة الانتظار لمسار تاني بنفس الرسالة
async function retargetHolding(chatId: number, holdId: number | null, context: string) {
  if (!holdId) return;
  try {
    await tg("editMessageText", {
      chat_id: chatId, message_id: holdId,
      text: `${HOLDING_LABELS[context] ?? HOLDING_LABELS.question}\n\n💡 *نصيحة سريعة وأنتي بتستني:* ${pickTip()}`,
      parse_mode: "Markdown", disable_web_page_preview: true,
    });
  } catch { /* اختياري */ }
}

// إرسال بطاقة بصرية توضيحية للنشاط والحرف عبر sendPhoto مع بديل نصي مضمون
async function sendVisualActivityCard(
  chatId: number | string,
  childName: string,
  skillTitle: string,
  symbol: string,
  words: string[],
  materials: string[],
  caption: string,
  reply_markup?: unknown,
) {
  const wordsText = words.length ? `كلمات الواجب: ${words.slice(0, 4).join(" • ")}` : "تطبيق عملي باللعب والحركة";
  const matText = materials.length ? `خامات البيت: ${materials.slice(0, 4).join(" + ")}` : "ورقة وقلم + خامات من المطبخ";

  // بناء بطاقة توضيحية مرسومة عالية الوضوح عبر QuickChart / ChartJS Image API
  const chartConfig = {
    type: "doughnut",
    data: {
      labels: ["لعب وحركة (5 د)", "تثبيت كتابي (3 د)", "مراجعة وتشجيع (2 د)"],
      datasets: [{
        data: [5, 3, 2],
        backgroundColor: ["#10b981", "#f59e0b", "#6366f1"],
        borderWidth: 2,
      }],
    },
    options: {
      cutoutPercentage: 68,
      title: {
        display: true,
        text: [`بطاقة نشاط البطل: ${childName} 🌟`, `الهدف: ${skillTitle}`, wordsText, matText],
        fontSize: 16,
        fontColor: "#0f172a",
        padding: 12,
      },
      legend: { position: "bottom", labels: { fontSize: 13, fontColor: "#334155" } },
      plugins: {
        doughnutlabel: {
          labels: [
            { text: symbol || "🎯", font: { size: 44, weight: "bold" }, color: "#4f46e5" },
            { text: "10 دقائق", font: { size: 15, weight: "bold" }, color: "#0f172a" },
          ],
        },
      },
    },
  };

  const cardUrl = `https://quickchart.io/chart?w=680&h=440&bkg=%23f8fafc&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  try {
    const res = await tg("sendPhoto", {
      chat_id: chatId,
      photo: cardUrl,
      caption: caption.slice(0, 1020),
      parse_mode: "Markdown",
      reply_markup,
    });
    if (res?.ok) return res;
  } catch {
    // في حال تعذر تحميل الصورة نرسل الرسالة النصية الكاملة فوراً
  }
  return await sendMessage(chatId, caption, reply_markup);
}

// ---------- قواميس المطابقة الذكية للمهارات والروابط ----------
const ARABIC_CHAR_TO_CODE: Record<string, { code: string; name: string; examples: string }> = {
  "ا": { code: "AR_LETTER_ALEF", name: "حرف الألف (أ)", examples: "أرنب، أسد، إبرة" },
  "أ": { code: "AR_LETTER_ALEF", name: "حرف الألف (أ)", examples: "أرنب، أسد، إبرة" },
  "ب": { code: "AR_LETTER_BAA", name: "حرف الباء (ب)", examples: "بطة، برج، برتقال" },
  "ت": { code: "AR_LETTER_TAA", name: "حرف التاء (ت)", examples: "تفاح، تاج، تمر" },
  "ث": { code: "AR_LETTER_THAA", name: "حرف الثاء (ث)", examples: "ثعلب، ثوب، ثلج" },
  "ج": { code: "AR_LETTER_JEEM", name: "حرف الجيم (ج)", examples: "جمل، جزر، جرس" },
  "ح": { code: "AR_LETTER_HAA", name: "حرف الحاء (ح)", examples: "حصان، حمامة، حوت" },
  "خ": { code: "AR_LETTER_KHAA", name: "حرف الخاء (خ)", examples: "خروف، خبز، خيار" },
  "د": { code: "AR_LETTER_DAL", name: "حرف الدال (د)", examples: "دب، ديك، دراجة" },
  "ذ": { code: "AR_LETTER_DHAL", name: "حرف الذال (ذ)", examples: "ذرة، ذئب، ذيل" },
  "ر": { code: "AR_LETTER_RAA", name: "حرف الراء (ر)", examples: "رمان، ريشة، رمل" },
  "ز": { code: "AR_LETTER_ZAY", name: "حرف الزاي (ز)", examples: "زرافة، زهرة، زيتون" },
  "س": { code: "AR_LETTER_SEEN", name: "حرف السين (س)", examples: "سمكة، ساعة، سفينة" },
  "ش": { code: "AR_LETTER_SHEEN", name: "حرف الشين (ش)", examples: "شمس، شجرة، شمعة" },
  "ص": { code: "AR_LETTER_SAD", name: "حرف الصاد (ص)", examples: "صقر، صندوق، صاروخ" },
  "ض": { code: "AR_LETTER_DAD", name: "حرف الضاد (ض)", examples: "ضفدع، ضرس، ضابط" },
  "ط": { code: "AR_LETTER_TAA_SAD", name: "حرف الطاء (ط)", examples: "طائرة، طماطم، طفل" },
  "ظ": { code: "AR_LETTER_DHA", name: "حرف الظاء (ظ)", examples: "ظرف، ظبي، ظفر" },
  "ع": { code: "AR_LETTER_AIN", name: "حرف العين (ع)", examples: "عنب، عصفور، عين" },
  "غ": { code: "AR_LETTER_GHAIN", name: "حرف الغين (غ)", examples: "غزالة، غراب، غيمة" },
  "ف": { code: "AR_LETTER_FAA", name: "حرف الفاء (ف)", examples: "فيل، فراشة، فراولة" },
  "ق": { code: "AR_LETTER_QAF", name: "حرف القاف (ق)", examples: "قمر، قطة، قلم" },
  "ك": { code: "AR_LETTER_KAF", name: "حرف الكاف (ك)", examples: "كتاب، كلب، كرة" },
  "ل": { code: "AR_LETTER_LAM", name: "حرف اللام (ل)", examples: "ليمون، لبن، لعبة" },
  "م": { code: "AR_LETTER_MEEM", name: "حرف الميم (م)", examples: "موز، مركب، مفتاح" },
  "ن": { code: "AR_LETTER_NOON", name: "حرف النون (ن)", examples: "نحلة، نجمة، نمر" },
  "ه": { code: "AR_LETTER_HA", name: "حرف الهاء (هـ)", examples: "هرم، هدهد، هدية" },
  "و": { code: "AR_LETTER_WAW", name: "حرف الواو (و)", examples: "وردة، ولد، وسادة" },
  "ي": { code: "AR_LETTER_YA", name: "حرف الياء (ي)", examples: "يد، يمامة، يوسفي" },
};

// تطبيع أي كود مهارة يرجعه الذكاء الاصطناعي ليتطابق 100% مع جدول curriculum_skills
function normalizeSkillCode(rawCode: string, rawTitle: string, subject: string): { id: string; title: string; subject: string; symbol: string; videoUrl: string } {
  const clean = (rawCode || "").trim().toUpperCase();
  const title = (rawTitle || "").trim();

  // 1) لو كان الكود أصلاً مطابقاً لـ AR_LETTER_* أو EN_PHONICS_* أو MATH_NUM_*
  if (clean.startsWith("AR_LETTER_")) {
    const found = Object.entries(ARABIC_CHAR_TO_CODE).find(([, v]) => v.code === clean);
    const sym = found ? found[0] : (title.match(/[\u0621-\u064A]/)?.[0] ?? "أ");
    return {
      id: clean,
      title: found ? found[1].name : (title || clean),
      subject: "arabic",
      symbol: sym,
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent((found ? found[1].name : title) + " منهج تواصل كي جي")}`,
    };
  }
  if (clean.startsWith("EN_LETTER_") || clean.startsWith("EN_PHONICS_")) {
    const letter = clean.replace("EN_LETTER_", "").replace("EN_PHONICS_", "").slice(0, 2);
    return {
      id: `EN_PHONICS_${letter}`,
      title: title || `حرف ${letter} وصوته (Jolly Phonics)`,
      subject: "english_phonics",
      symbol: letter,
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`Jolly Phonics letter ${letter} song and action`)}`,
    };
  }
  if (clean.startsWith("MATH_NUM_")) {
    const num = clean.replace("MATH_NUM_", "");
    return {
      id: `MATH_NUM_${num}`,
      title: title || `الرقم ${num} والعد`,
      subject: "math",
      symbol: num,
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`تعليم رقم ${num} للاطفال كي جي`)}`,
    };
  }

  // 2) استنتاج الكود من النص أو العنوان إذا أرسل النموذج اسماً حراً
  const enMatch = (clean + " " + title).match(/\b([A-Za-z])\b/);
  if (enMatch && (subject?.includes("english") || /[A-Za-z]/.test(rawTitle))) {
    const l = enMatch[1].toUpperCase();
    return {
      id: `EN_PHONICS_${l}`,
      title: title || `حرف ${l} وصوته (Jolly Phonics)`,
      subject: "english_phonics",
      symbol: l,
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`Jolly Phonics letter ${l} song`)}`,
    };
  }
  const numMatch = (clean + " " + title).match(/\b([1-9]|1[0-9]|20)\b/);
  if (numMatch) {
    const n = numMatch[1];
    return {
      id: `MATH_NUM_${n}`,
      title: title || `الرقم ${n} والعد`,
      subject: "math",
      symbol: n,
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`تعليم رقم ${n} للاطفال`)}`,
    };
  }
  for (const [ch, info] of Object.entries(ARABIC_CHAR_TO_CODE)) {
    if (title.includes(`حرف ${ch}`) || title.includes(info.name.split(" ")[1]) || title === ch) {
      return {
        id: info.code,
        title: info.name,
        subject: "arabic",
        symbol: ch,
        videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(info.name + " منهج تواصل رياض اطفال")}`,
      };
    }
  }
  return {
    id: "AR_LETTER_BAA",
    title: title || "حرف الباء (ب)",
    subject: "arabic",
    symbol: "ب",
    videoUrl: "https://www.youtube.com/results?search_query=حرف+الباء+منهج+تواصل+رياض+اطفال",
  };
}

// ---------- أدوات الذكاء الاصطناعي (Gemini + NVIDIA Fallback) ----------
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
      const transient = /Gemini (429|5\d\d)|timed? ?out|aborted/i.test(String(e));
      if (!transient || attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw lastErr ?? new Error("Gemini failed");
}

const NVIDIA_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";
async function nvidiaGenerate(parts: unknown[], extra: object = {}) {
  if (!NVIDIA_KEY) throw new Error("NVIDIA key not set");
  const messages: any[] = [{
    role: "user",
    content: (parts as any[]).map((p: any) => {
      if (p.inlineData) {
        return { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
      }
      return { type: "text", text: String(p.text ?? "") };
    }),
  }];
  const gen = (extra as any)?.generationConfig ?? {};
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_KEY}` },
    body: JSON.stringify({
      model: NVIDIA_VISION_MODEL,
      messages,
      temperature: gen.temperature ?? 0.35,
      max_tokens: 2400,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("NVIDIA empty response");
  return [{ text: content }];
}

async function aiGenerate(parts: unknown[], extra: object = {}) {
  try {
    return await geminiGenerate("gemini-flash-latest", parts, extra);
  } catch (geminiErr) {
    try {
      return await nvidiaGenerate(parts, extra);
    } catch {
      throw geminiErr;
    }
  }
}

function jsonFromAi(parts: any[]): any {
  const raw = parts.map((p: any) => p.text ?? "").join("");
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// توليد رسالة صوتية للطفل (TTS)
async function geminiTts(text: string): Promise<Uint8Array | null> {
  const models = ["gemini-3.8-flash-tts", "gemini-flash-latest"];
  for (const m of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_KEY}`,
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
      if (!res.ok) continue;
      const data = await res.json();
      const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (!part) continue;
      const pcm = base64ToBytes(part.inlineData.data);
      return pcmToWav(pcm, 24000);
    } catch {
      continue;
    }
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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

// ---------- أدوات قاعدة البيانات والذاكرة ----------
async function upsertParent(tgUser: any) {
  const { data } = await supabaseAdmin
    .from("parents")
    .upsert({
      telegram_user_id: tgUser.id,
      telegram_first_name: tgUser.first_name ?? null,
      subscription_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }, { onConflict: "telegram_user_id" })
    .select("*")
    .single();
  return data;
}
async function getParentByTg(tgId: number) {
  const { data } = await supabaseAdmin.from("parents").select("*").eq("telegram_user_id", tgId).maybeSingle();
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
    { onConflict: "telegram_user_id" },
  );
}
async function saveConvMessage(parentId: string, childId: string | null, role: "user" | "assistant", text: string, intent?: string) {
  try {
    await supabaseAdmin.from("conversation_history").insert({
      parent_id: parentId,
      child_id: childId,
      role,
      message_text: text.slice(0, 2000),
      intent_detected: intent ?? null,
    });
  } catch { /* لو الجدول لم يُنشأ بعد لا نوقف البوت */ }
}
async function getRecentConv(parentId: string, limit = 6): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("conversation_history")
      .select("role, message_text")
      .eq("parent_id", parentId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || !data.length) return "لا توجد رسائل سابقة.";
    return data.reverse().map((r: any) => `${r.role === "user" ? "الأم" : "الوكيل"}: ${r.message_text}`).join("\n");
  } catch {
    return "لا توجد رسائل سابقة.";
  }
}

function weekStartDate(d = new Date()): string {
  const egypt = new Date(d.getTime() + 2 * 3600000);
  const day = egypt.getUTCDay(); // 0=الأحد
  const back = (day + 7) % 7;
  const s = new Date(egypt.getTime() - back * 86400000);
  return s.toISOString().slice(0, 10);
}

// ============================================================
// البرومبتات المطورة (الإصدار 2.0 - مرتبطة بكلمات الواجب الفعلي)
// ============================================================
const PROMPT_HOMEWORK_EXTRACTOR = `أنت خبير مناهج رياض أطفال (KG1 و KG2 و Grade 1) في مصر (منهج تواصل العربي، Connect & Connect Plus، Jolly Phonics، والرياضيات).
مهمتك قراءة صورة كراسة الواجب أو خطة الأسبوع (أو النص الذي كتبته الأم)، واستخراج كل تفصيلة مكتوبة في الواجب بدقة تامة لبناء أنشطة مرتبطة بواجب الطفل الفعلي 100%.

اسم الطفل: {CHILD_NAME} | المرحلة: {CHILD_STAGE}
نقاط الضعف السابقة المسجلة للطفل لدمجها في المراجعة: {WEAK_SKILLS}

قواعد صارمة جداً:
1. استخرج الحروف، الأصوات، الأرقام، والكلمات المكتوبة فعلياً في الصفحة (مثلاً لو الصفحة فيها حرف الباء وكلمات "بطة - برج - برتقال" أو حرف M وكلمات "Moon - Monkey"، لازم الأنشطة الخمسة تستخدم نفس الكلمات دي بالظبط مش كلمات عشوائية!).
2. لو الصورة غير واضحة تماماً أو ليست صفحة واجب/كتاب، اجعل is_clear=false واكتب رسالة ودودة للأم بالعامية المصرية.
3. استخدم أكواد المهارات القياسية التالية فقط في حقل code:
   - للعربي: AR_LETTER_ALEF, AR_LETTER_BAA, AR_LETTER_TAA, AR_LETTER_THAA, AR_LETTER_JEEM, AR_LETTER_HAA, AR_LETTER_KHAA, AR_LETTER_DAL, AR_LETTER_DHAL, AR_LETTER_RAA, AR_LETTER_ZAY, AR_LETTER_SEEN, AR_LETTER_SHEEN, AR_LETTER_SAD, AR_LETTER_DAD, AR_LETTER_TAA_SAD, AR_LETTER_DHA, AR_LETTER_AIN, AR_LETTER_GHAIN, AR_LETTER_FAA, AR_LETTER_QAF, AR_LETTER_KAF, AR_LETTER_LAM, AR_LETTER_MEEM, AR_LETTER_NOON, AR_LETTER_HA, AR_LETTER_WAW, AR_LETTER_YA
   - للإنجليزي: EN_PHONICS_A .. EN_PHONICS_Z (مثل EN_PHONICS_M, EN_PHONICS_S, EN_PHONICS_B)
   - للحساب: MATH_NUM_1 .. MATH_NUM_20
4. صمم خطة 5 أيام (الأحد إلى الخميس)، كل يوم نشاط عملي مدته 10 دقائق بخامات البيت المصري، ومقسّم إلى:
   - 🎯 لعبة الحركة والحواس (5 دقائق) على نفس كلمات الواجب.
   - ✍️ التثبيت الذكي للواجب (3 دقائق) لتنفيذ الواجب المطلوب بدون ملل العواميد.
   - 💬 جملة التشجيع التي تقولها الأم لـ {CHILD_NAME}.

أخرج JSON فقط بهذا الشكل الدقيق:
{
  "is_clear": true,
  "page_detected_summary": "وصف دقيق لما قرأته في صفحة الواجب (الحروف والكلمات والتمارين المطلوبة)",
  "Confirm_message_ar": "رسالة ترحيب وتأكيد للأم بالعامية المصرية تذكر الحروف والكلمات الفعلية التي استخرجتها من الواجب",
  "extracted_skills": [
    {
      "subject": "arabic|english_phonics|math",
      "code": "AR_LETTER_BAA",
      "title": "حرف الباء (ب)",
      "symbol": "ب",
      "homework_words": ["بطة", "برج", "باب"]
    }
  ],
  "five_day_plan": [
    {
      "day": 1,
      "focus_skill_code": "AR_LETTER_BAA",
      "activity_title": "عنوان اللعبة مرتبط بكلمات الواجب",
      "homework_words_used": ["بطة", "برج"],
      "materials": ["طبق دقيق أو ملح", "3 ورقات صغيرة", "قلم ألوان"],
      "activity_instructions": "🎯 **لعبة الحركة والحواس (5 دقايق):** ...\n✍️ **تثبيت الواجب من غير زعيق (3 دقايق):** ...\n💬 **قولي لـ {CHILD_NAME}:** ..."
    }
  ]
}`;

const PROMPT_SMART_MOM_ASSISTANT = `أنت «رفيق المذاكرة» — المساعد التربوي الذكي للأم المصرية على تليجرام.
بيانات الطفل الحالية:
- الاسم: {CHILD_NAME} | المرحلة: {CHILD_STAGE} | النجوم: {STARS} ⭐ | الانتظام: {STREAK} يوم 🔥
- واجب الأسبوع الحالي: {CURRENT_WEEK_SUMMARY}
- نشاط اليوم الحالي: {TODAY_ACTIVITY}
- المهارات المتقنة 🟢: {MASTERED_LIST}
- المهارات قيد التدريب 🟡: {PRACTICING_LIST}
- نقاط الضعف التي تحتاج مراجعة 🔴: {WEAK_LIST}

سجل آخر المحادثات مع الأم:
{RECENT_HISTORY}

رسالة الأم الجديدة الآن:
"{MOM_MESSAGE}"

مهمتك تحليل قصد الأم والرد عليها بذكاء وسلاسة وود بالعامية المصرية، مع تنفيذ ما تطلبه تلقائياً:
1. لو الأم بتكتب واجب جديد نصياً (مثال: "الأسبوع ده عندنا حرف السين والتاء" أو "عايزة خطة لحرف M ورقم 5"): اجعل intent="set_homework_by_text" واستخرج المهارات وخطة الـ 5 أيام في new_homework_plan.
2. لو الأم بتطلب تغيير خامات نشاط النهارده أو نشاط بديل (مثال: "معنديش صلصال" أو "عايزة لعبة تانية"): اجعل intent="modify_today_activity" واكتب النشاط البديل الكامل في updated_today_instructions.
3. لو الأم بتبلغك بمستوى الطفل في حرف معين (مثال: "يونس اتقن حرف الباء خلاص" أو "لسه بيتلخبط بين b و d"): اجعل intent="log_skill_status" وحدد skill_code و mastery_level ("mastered_green" أو "practicing_yellow" أو "needs_review_red") و note.
4. لو الأم بتسأل سؤال تربوي أو بتشتكي من مشكلة مذاكرة (مثال: "بيزهق بسرعة"، "مش عارف يمسك القلم"، "اشرحيلي صوت حرف S"): اجعل intent="coaching_advice" ورد عليها بخطوات عملية مخصصة لـ {CHILD_NAME} مع اقتراح رابط فيديو أو نشاط فوري.

أخرج JSON فقط بهذا المخطط:
{
  "intent": "coaching_advice | set_homework_by_text | modify_today_activity | log_skill_status",
  "reply_ar": "ردك الكامل والسلس والذكي على الأم بالعامية المصرية (مقسم بنقاط واضحة وإيموجي مبهج)",
  "suggested_video_query": "عنوان بحث يوتيوب مفيد لو طلبت شرح أو نطق حرف (أو null)",
  "skill_update": {
    "skill_code": "كود المهارة القياسي مثل AR_LETTER_BAA أو EN_PHONICS_B أو null",
    "mastery_level": "mastered_green | practicing_yellow | needs_review_red | null",
    "note": "ملاحظة الأم"
  },
  "updated_today_instructions": "نص النشاط البديل لو طلبت تعديل نشاط اليوم أو null",
  "new_homework_skills": ["قائمة الحروف أو المهارات لو طلبت إنشاء خطة واجب جديدة بالنص"]
}`;

// ============================================================
// بناء وحفظ خطة الأسبوع (من صورة أو من نص) + تحديث خريطة الإتقان
// ============================================================
async function buildAndSaveWeeklyPlan(
  chatId: number,
  child: any,
  inputParts: any[],
  imageUrl: string | null = null,
  holdId: number | null = null,
) {
  let out: any = null;
  try {
    const rawParts = await aiGenerate(inputParts, {
      generationConfig: { temperature: 0.25, responseMimeType: "application/json" },
    });
    out = jsonFromAi(rawParts);
  } catch (e) {
    console.error("Plan generation error:", e);
    await clearHolding(chatId, holdId);
    await sendMessage(chatId, "حصل ضغط بسيط وأنا بقرأ الواجب يا ماما 🙏 ابعتيه تاني أو اكتبيلي اسم الحرف أو الكلمات في رسالة وهجهزلك الخطة حالاً!");
    return;
  }

  if (!out || out.is_clear === false) {
    const msg = out?.Confirm_message_ar ?? "الصورة مش واضحة كفاية يا ماما 📸 صوري الصفحة في إضاءة أوضح، أو اكتبيلي في رسالة: «واجبنا حرف كذا وكلمات كذا» وهظبطلك خطة الأسبوع فوراً!";
    await clearHolding(chatId, holdId);
    await sendMessage(chatId, msg);
    return;
  }

  const ws = weekStartDate();
  const normalizedSkills = (out.extracted_skills ?? []).map((s: any) => {
    const norm = normalizeSkillCode(s.code ?? "", s.title ?? "", s.subject ?? "");
    return {
      ...norm,
      homework_words: Array.isArray(s.homework_words) ? s.homework_words : [],
    };
  });

  // تأكد من وجود كل مهارة في جدول curriculum_skills وتحديث خريطة الطفل إلى practicing_yellow (إذا لم تكن متقنة سابقاً)
  for (const sk of normalizedSkills) {
    await supabaseAdmin.from("curriculum_skills").upsert({
      id: sk.id,
      subject: sk.subject,
      display_name: sk.title,
    }, { onConflict: "id" });

    const { data: existing } = await supabaseAdmin
      .from("child_mastery_tracker")
      .select("mastery_level, attempts_count")
      .eq("child_id", child.id)
      .eq("skill_id", sk.id)
      .maybeSingle();

    const nextLevel = existing?.mastery_level === "mastered_green"
      ? "mastered_green"
      : (existing?.mastery_level === "needs_review_red" ? "needs_review_red" : "practicing_yellow");

    await supabaseAdmin.from("child_mastery_tracker").upsert({
      child_id: child.id,
      skill_id: sk.id,
      mastery_level: nextLevel,
      attempts_count: existing?.attempts_count ?? 0,
      last_practiced_at: new Date().toISOString(),
    }, { onConflict: "child_id,skill_id" });
  }

  // بناء صفوف الأيام الخمسة مع ربط كل يوم بـ focus_skill_id وكلمات الواجب والروابط
  const defaultSkill = normalizedSkills[0] ?? normalizeSkillCode("AR_LETTER_BAA", "حرف الباء", "arabic");
  const rows = (out.five_day_plan ?? []).slice(0, 5).map((p: any, i: number) => {
    const matchedSkill = normalizedSkills.find((s: any) => s.id === p.focus_skill_code || p.focus_skill_code?.includes(s.symbol))
      ?? normalizedSkills[i % Math.max(normalizedSkills.length, 1)]
      ?? defaultSkill;
    const wordsUsed = Array.isArray(p.homework_words_used) && p.homework_words_used.length
      ? p.homework_words_used
      : matchedSkill.homework_words;
    const materials = Array.isArray(p.materials) && p.materials.length
      ? p.materials
      : ["ورقة وقلم ألوان", "طبق ملح أو دقيق", "ألعاب من البيت"];

    const baseRow: Record<string, any> = {
      child_id: child.id,
      week_start_date: ws,
      homework_image_url: imageUrl,
      extracted_targets_json: normalizedSkills.map((s: any) => ({
        code: s.id,
        title: s.title,
        symbol: s.symbol,
        subject: s.subject,
        words: s.homework_words,
        video_url: s.videoUrl,
      })),
      day_number: p.day ?? i + 1,
      activity_title: p.activity_title ? `${p.activity_title} (${matchedSkill.title})` : `نشاط ${matchedSkill.title}`,
      activity_instructions: p.activity_instructions ?? null,
      status: "pending",
    };
    return { baseRow, extraCols: {
      focus_skill_id: matchedSkill.id,
      homework_words_json: wordsUsed,
      materials_json: materials,
      resource_links_json: [
        { label: `🎬 فيديو شرح ${matchedSkill.title}`, url: matchedSkill.videoUrl },
        { label: "🎨 سبورة تتبع الحرف والتلوين", url: `${MINIAPP_URL}?tab=board&skill=${encodeURIComponent(matchedSkill.id)}` },
      ],
    }};
  });

  if (rows.length) {
    await supabaseAdmin.from("weekly_plans_and_activities")
      .delete()
      .eq("child_id", child.id)
      .eq("week_start_date", ws)
      .eq("status", "pending");

    // محاولة الإدخال مع الأعمدة الجديدة، ولو لم تكن الهجرة 0002 منفذة بعد ندخل الأعمدة الأساسية بدون خطأ
    const fullInsert = rows.map((r: any) => ({ ...r.baseRow, ...r.extraCols }));
    const { error: errFull } = await supabaseAdmin.from("weekly_plans_and_activities").insert(fullInsert);
    if (errFull) {
      await supabaseAdmin.from("weekly_plans_and_activities").insert(rows.map((r: any) => r.baseRow));
    }
  }

  const skillsSummary = normalizedSkills.map((s: any) =>
    `• *${s.title}*${s.homework_words?.length ? ` (كلمات الواجب: ${s.homework_words.join("، ")})` : ""}`
  ).join("\n");

  const replyText =
    `✅ *قرأت الواجب وجهزت خطة الأسبوع لـ ${child.name}!*\n\n` +
    `${out.Confirm_message_ar ?? ""}\n\n` +
    `📌 *المهارات والكلمات المستخرجة من الواجب:*\n${skillsSummary || "• مهارات الأسبوع الأساسية"}\n\n` +
    `🗓️ *خطة الـ 5 أيام جاهزة في تطبيق المتابعة!* تحبي نبدأ أول نشاط دلوقتي؟`;

  const videoButtons = normalizedSkills.slice(0, 2).map((s: any) => ({
    text: `🎬 فيديو ${s.title}`,
    url: s.videoUrl,
  }));

  await closeHolding(chatId, holdId, replyText, {
    inline_keyboard: [
      [{ text: "🎮 ابعتي نشاط النهارده بالصورة التوضيحية", callback_data: "act:today" }],
      videoButtons.length ? videoButtons : [{ text: "🎨 السبورة التفاعلية للحرف", web_app: { url: `${MINIAPP_URL}?tab=board` } }],
      [{ text: "📊 افتحي تطبيق متابعة طفلي وخريطة الحروف", web_app: { url: MINIAPP_URL } }],
    ],
  });
}

async function handleHomeworkPhoto(chatId: number, _tgId: number, _parent: any, child: any, fileId: string, captionText?: string, holdId: number | null = null) {
  const fi = await tg("getFile", { file_id: fileId });
  const path = fi?.result?.file_path;
  if (!path) {
    await clearHolding(chatId, holdId);
    await sendMessage(chatId, "مش قادر أوصل للصورة يا ماما، جربي تبعتيها تاني أو اكتبيلي اسم الحرف في رسالة.");
    return;
  }
  const img = await fetch(`${TG}/file/bot${TOKEN}/${path}`);
  const buf = new Uint8Array(await img.arrayBuffer());

  // رفع الصورة في Bucket خاص
  let imageUrl: string | null = null;
  try {
    const fn = `homework/${child.id}/${Date.now()}.jpg`;
    const { error } = await supabaseAdmin.storage.from("homework").upload(fn, buf, { contentType: "image/jpeg" });
    if (!error) imageUrl = fn;
  } catch { /* اختياري */ }

  const { data: weak } = await supabaseAdmin
    .from("child_mastery_tracker")
    .select("skill_id, curriculum_skills(display_name)")
    .eq("child_id", child.id)
    .eq("mastery_level", "needs_review_red");
  const weakSkills = (weak ?? []).map((r: any) => r.curriculum_skills?.display_name ?? r.skill_id).join("، ") || "لا يوجد";

  const promptText = PROMPT_HOMEWORK_EXTRACTOR
    .replaceAll("{CHILD_NAME}", child.name)
    .replaceAll("{CHILD_STAGE}", child.stage ?? "kg2")
    .replaceAll("{WEAK_SKILLS}", weakSkills) +
    (captionText ? `\nملاحظة الأم المرفقة مع الصورة: "${captionText}"` : "");

  await buildAndSaveWeeklyPlan(chatId, child, [
    { text: promptText },
    { inlineData: { mimeType: "image/jpeg", data: encodeBase64(buf) } },
  ], imageUrl, holdId);
}

// ============================================================
// إرسال نشاط اليوم (مع البطاقة البصرية التوضيحية + كلمات الواجب + الروابط)
// ============================================================
export async function sendDayActivity(parent: any, child: any, requestedDayNumber?: number, weekStart?: string, withHolding = false) {
  const chatId = parent.telegram_user_id;
  const holdId = withHolding ? await sendHolding(chatId, "today") : null;
  const ws = weekStart ?? weekStartDate();

  // جلب كل أنشطة الأسبوع الحالي لاختيار أول نشاط غير مكتمل (أو اليوم المحدد)
  const { data: weekRows } = await supabaseAdmin
    .from("weekly_plans_and_activities")
    .select("*")
    .eq("child_id", child.id)
    .eq("week_start_date", ws)
    .order("day_number", { ascending: true });

  let targetRow: any = null;
  if (weekRows && weekRows.length > 0) {
    // الأولوية: أول نشاط في خطة الواجب لم يكتمل بعد، حتى لا تضيع أنشطة بداية الأسبوع
    targetRow = weekRows.find((r: any) => r.status === "pending" || r.status === "sent")
      ?? weekRows.find((r: any) => r.day_number === (requestedDayNumber ?? 1))
      ?? weekRows[0];
  }

  // استخراج المهارة المستهدفة وكلمات الواجب الفعلية
  const targetsList = targetRow?.extracted_targets_json ?? [];
  const primaryTarget = targetsList[0] ?? { code: "AR_LETTER_BAA", title: "حرف الباء (ب)", symbol: "ب", words: ["بطة", "برج", "باب"], video_url: "https://www.youtube.com/results?search_query=حرف+الباء+منهج+تواصل+كي+جي" };
  const focusSkillId = targetRow?.focus_skill_id ?? primaryTarget.code ?? "AR_LETTER_BAA";
  const homeworkWords: string[] = Array.isArray(targetRow?.homework_words_json) && targetRow.homework_words_json.length
    ? targetRow.homework_words_json
    : (Array.isArray(primaryTarget.words) ? primaryTarget.words : []);
  const materials: string[] = Array.isArray(targetRow?.materials_json) && targetRow.materials_json.length
    ? targetRow.materials_json
    : ["ورقة وقلم ألوان", "طبق دقيق أو ملح", "أدوات من البيت"];

  let title = targetRow?.activity_title ?? `نشاط ${primaryTarget.title}`;
  let instructions = targetRow?.activity_instructions;

  if (!instructions) {
    const generated = await generateDetailedActivity(child, title, primaryTarget.title, homeworkWords, false);
    instructions = generated;
    if (targetRow) {
      await supabaseAdmin.from("weekly_plans_and_activities")
        .update({ activity_instructions: instructions, status: "sent" })
        .eq("id", targetRow.id);
    } else {
      const { data: inserted } = await supabaseAdmin.from("weekly_plans_and_activities")
        .insert({
          child_id: child.id,
          week_start_date: ws,
          day_number: requestedDayNumber ?? 1,
          activity_title: title,
          activity_instructions: instructions,
          extracted_targets_json: [primaryTarget],
          status: "sent",
        })
        .select("*")
        .maybeSingle();
      targetRow = inserted;
    }
  } else if (targetRow) {
    await supabaseAdmin.from("weekly_plans_and_activities").update({ status: "sent" }).eq("id", targetRow.id);
  }

  // حفظ معرف النشاط والمهارة الحالية في bot_state لضمان تسجيل التقييم على نفس المهارة 100%
  await setState(parent.telegram_user_id, null, {
    active_activity_id: targetRow?.id ?? null,
    active_skill_id: focusSkillId,
    active_skill_title: primaryTarget.title ?? title,
  });

  const videoUrl = primaryTarget.video_url ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(primaryTarget.title + " للاطفال كي جي")}`;
  const wordsLine = homeworkWords.length ? `\n📖 *كلمات الواجب المستهدفة:* (${homeworkWords.join(" - ")})` : "";
  const matLine = `\n🧺 *الخامات المطلوبة من البيت:* (${materials.join(" + ")})`;

  const caption =
    `🌟 *نشاط اليوم لـ ${child.name} (اليوم ${targetRow?.day_number ?? 1} من خطة الواجب)*\n` +
    `📌 *الهدف:* ${title}${wordsLine}${matLine}\n\n` +
    `${instructions}\n\n` +
    `👇 *بعد ما تخلصوا الـ 10 دقايق، اضغطي على تقييم ${child.name} عشان أسجل النتيجة في خريطته وأبعتله رسالة صوتية باسمه:*`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "متقن وممتاز 🟢 (+3⭐)", callback_data: `fb:easy_green:${focusSkillId}` },
        { text: "احتاج مساعدة 🟡 (+2⭐)", callback_data: `fb:medium_yellow:${focusSkillId}` },
      ],
      [
        { text: "لسه بيتلخبط 🔴 (+1⭐)", callback_data: `fb:hard_red:${focusSkillId}` },
        { text: "🔄 نشاط بديل بخامات تانية", callback_data: `fb:alt:${focusSkillId}` },
      ],
      [
        { text: "🎬 فيديو نطق الحرف والكتابة", url: videoUrl },
        { text: "🎨 السبورة والخريطة", web_app: { url: MINIAPP_URL } },
      ],
    ],
  };

  await clearHolding(chatId, holdId);
  await sendVisualActivityCard(
    chatId,
    child.name,
    primaryTarget.title ?? title,
    primaryTarget.symbol ?? "أ",
    homeworkWords,
    materials,
    caption,
    replyMarkup,
  );
}

async function generateDetailedActivity(child: any, activityTitle: string, skillTitle: string, homeworkWords: string[], isAlternative: boolean): Promise<string> {
  const { data: weakRows } = await supabaseAdmin
    .from("child_mastery_tracker")
    .select("skill_id, parent_notes, curriculum_skills(display_name)")
    .eq("child_id", child.id)
    .eq("mastery_level", "needs_review_red")
    .limit(2);

  const weakText = (weakRows ?? []).map((w: any) => `${w.curriculum_skills?.display_name ?? w.skill_id}${w.parent_notes ? ` (${w.parent_notes})` : ""}`).join("، ") || "لا يوجد";
  const wordsPrompt = homeworkWords.length ? `كلمات الواجب المطلوبة بالظبط: (${homeworkWords.join("، ")})` : "استخدمي 3 كلمات بسيطة من منهج KG المصري";

  const prompt = `أنت «رفيق المذاكرة» للأم المصرية. صمم نشاطاً منزلياً عملياً مدته 10 دقائق للطفل (${child.name}، مرحلة ${child.stage}) لتثبيت (${skillTitle} - ${activityTitle}).
${wordsPrompt}.
نقاط ضعف سابقة لدمجها في سؤال سريع: (${weakText}).
${isAlternative ? "مهم جداً: الأم طلبت نشاطاً بديلاً لأن الخامات المعتادة غير متوفرة، استخدمي لعبة حركية أو ورقية بدون صلصال أو دقيق!" : ""}

اكتبي الرد بالعامية المصرية الدافئة والمشجعة للأم في 3 نقاط محددة:
🎯 *1. لعبة الحركة والحواس (5 دقايق):* (خطوات عملية ممتعة تستخدم نفس كلمات الواجب).
✍️ *2. تثبيت الواجب من غير ملل (3 دقايق):* (إزاي يكتب الحرف أو الكلمات في الكراسة بطريقة سهلة من غير عواميد مرهقة).
💬 *3. قولي لـ ${child.name}:* (جملة تشجيعية ترفع ثقته بنفسه).`;

  try {
    const parts = await aiGenerate([{ text: prompt }]);
    return parts.map((p: any) => p.text ?? "").join("\n").trim();
  } catch {
    return `🎯 *1. لعبة الحركة والحواس (5 دقايق):* اكتبي الحرف كبير على ورقة وخلي ${child.name} يمشي عليه بصابعه أو يرص عليه حبات مكرونة وهو بينطق صوته في كلمات (${homeworkWords.join("، ") || skillTitle}).\n✍️ *2. تثبيت الواجب (3 دقايق):* يكتب الحرف 3 مرات بس بألوان مختلفة في كراسة الواجب.\n💬 *3. قولي لـ ${child.name}:* «إنت بطل وشاطر وعينك جابت الحرف صح!»`;
  }
}

// ============================================================
// تسجيل التقييم وتحديث خريطة الطفل بدقة 100% + الرسالة الصوتية
// ============================================================
const LEVEL_BY_FB: Record<string, string> = {
  easy_green: "mastered_green",
  medium_yellow: "practicing_yellow",
  hard_red: "needs_review_red",
};
const LEVEL_LABEL_AR: Record<string, string> = {
  mastered_green: "متقن تماماً 🟢",
  practicing_yellow: "قيد التدريب والتثبيت 🟡",
  needs_review_red: "يحتاج مراجعة وتكرار 🔴",
};
const STARS_BY_FB: Record<string, number> = { easy_green: 3, medium_yellow: 2, hard_red: 1 };

async function handleFeedback(
  chatId: number,
  tgId: number,
  child: any,
  rating: string,
  explicitSkillId: string | null,
  note: string | null,
  completionPhotoUrl: string | null,
) {
  const st = await getState(tgId);
  const ws = weekStartDate();

  // جلب نشاط اليوم الحالي أو آخر نشاط مرسل
  const { data: weekRows } = await supabaseAdmin
    .from("weekly_plans_and_activities")
    .select("*")
    .eq("child_id", child.id)
    .eq("week_start_date", ws)
    .order("day_number", { ascending: true });

  const todayRow = (weekRows ?? []).find((r: any) => r.id === st.temp_json?.active_activity_id)
    ?? (weekRows ?? []).find((r: any) => r.status === "sent")
    ?? (weekRows ?? []).find((r: any) => r.status === "pending")
    ?? (weekRows ?? [])[0];

  // تحديد كود المهارة القياسي بدقة تامة (بدون الاعتماد على تطابق نصي عشوائي)
  const targets = todayRow?.extracted_targets_json ?? [];
  const rawSkillCode = explicitSkillId
    || todayRow?.focus_skill_id
    || st.temp_json?.active_skill_id
    || targets[0]?.code
    || "AR_LETTER_BAA";

  const normSkill = normalizeSkillCode(rawSkillCode, todayRow?.activity_title ?? "", "");
  const skillId = normSkill.id;
  const level = LEVEL_BY_FB[rating] ?? "practicing_yellow";
  const stars = STARS_BY_FB[rating] ?? 2;

  // تأكد من وجود المهارة في قاموس المهارات أولاً
  await supabaseAdmin.from("curriculum_skills").upsert({
    id: skillId,
    subject: normSkill.subject,
    display_name: normSkill.title,
  }, { onConflict: "id" });

  // قراءة السجل الحالي لزيادة عدد المحاولات وتراكم الملاحظات
  const { data: existingMastery } = await supabaseAdmin
    .from("child_mastery_tracker")
    .select("attempts_count, parent_notes")
    .eq("child_id", child.id)
    .eq("skill_id", skillId)
    .maybeSingle();

  const newAttempts = (existingMastery?.attempts_count ?? 0) + 1;
  const dateTag = new Date().toISOString().slice(0, 10);
  const combinedNotes = note
    ? (existingMastery?.parent_notes ? `${existingMastery.parent_notes}\n[${dateTag}] ${note}` : `[${dateTag}] ${note}`)
    : (existingMastery?.parent_notes ?? null);

  await supabaseAdmin.from("child_mastery_tracker").upsert({
    child_id: child.id,
    skill_id: skillId,
    mastery_level: level,
    attempts_count: newAttempts,
    last_practiced_at: new Date().toISOString(),
    parent_notes: combinedNotes,
  }, { onConflict: "child_id,skill_id" });

  // تحديث نجوم الطفل والـ Streak
  const todayStr = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
  const { data: cur } = await supabaseAdmin
    .from("children")
    .select("stars_count, current_streak_days, last_active_date")
    .eq("id", child.id)
    .single();

  const streak = cur?.last_active_date === todayStr
    ? (cur?.current_streak_days || 1)
    : (isYesterday(cur?.last_active_date, todayStr) ? (cur?.current_streak_days ?? 0) + 1 : 1);
  const newStarsTotal = (cur?.stars_count ?? 0) + stars;

  await supabaseAdmin.from("children").update({
    stars_count: newStarsTotal,
    current_streak_days: streak,
    last_active_date: todayStr,
  }).eq("id", child.id);

  if (todayRow) {
    await supabaseAdmin.from("weekly_plans_and_activities").update({
      status: "completed",
      feedback_rating: rating,
      completion_photo_url: completionPhotoUrl,
    }).eq("id", todayRow.id);
  }

  // جلب إحصائيات الإتقان المحدثة لعرضها للأم كدليل ملموس على حفظ المتابعة
  const { data: allMastery } = await supabaseAdmin
    .from("child_mastery_tracker")
    .select("mastery_level")
    .eq("child_id", child.id);
  const greenCount = (allMastery ?? []).filter((m: any) => m.mastery_level === "mastered_green").length;
  const yellowCount = (allMastery ?? []).filter((m: any) => m.mastery_level === "practicing_yellow").length;
  const redCount = (allMastery ?? []).filter((m: any) => m.mastery_level === "needs_review_red").length;

  await sendMessage(
    chatId,
    `✅ *تم حفظ متابعة ${child.name} في السجل بنجاح!*\n\n` +
    `📌 *المهارة المسجلة:* ${normSkill.title}\n` +
    `📊 *المستوى الجديد:* ${LEVEL_LABEL_AR[level]} (المحاولة رقم ${newAttempts})\n` +
    `${note ? `📝 *ملاحظتك المسجلة:* «${note}» (هدمجها تلقائياً في نشاط بكرة)\n` : ""}` +
    `⭐ *رصيد النجوم:* ${newStarsTotal} نجمة (+${stars} اليوم) | 🔥 *الانتظام:* ${streak} يوم\n` +
    `🗺️ *خريطة ${child.name} الآن:* ${greenCount} متقن 🟢 | ${yellowCount} يتدرب 🟡 | ${redCount} للمراجعة 🔴`,
    {
      inline_keyboard: [
        [{ text: "📊 افتحي خريطة متابعة طفلي المحدثة", web_app: { url: MINIAPP_URL } }],
        [{ text: "🎮 هاتي النشاط اللي بعده", callback_data: "act:today" }],
      ],
    },
  );

  // توليد وإرسال الرسالة الصوتية باسم الطفل
  const voiceScript = rating === "easy_green"
    ? `يا بطل الأبطال يا ${child.name}! ماما قالتلي إنك كنت ممتاز النهارده في ${normSkill.title}! كسبت تلات نجوم منورين وبقيت عندك ${newStarsTotal} نجمة في لوحة الأبطال! فخور بيك أوي!`
    : rating === "medium_yellow"
    ? `برافو عليك يا ${child.name} يا شاطر! محاولتك جميلة جداً النهارده في ${normSkill.title} وكسبت نجمتين حلوين! المرة الجاية هتجيبها أسرع كمان يا بطل!`
    : `حبيبي البطل ${child.name}! شاطر إنك حاولت ولعبت مع ماما النهارده وكسبت نجمة المحاولة الشجاعة! بكرة هنلعب لعبة أسهل وأحلى سوا!`;

  const wav = await geminiTts(voiceScript);
  if (wav) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("audio", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "bravo_hero.wav");
    form.append("caption", `🎙️ شغّلي الرسالة الصوتية دي لـ ${child.name} 🌟`);
    form.append("title", `تشجيع البطل ${child.name} ⭐`);
    await fetch(`${TG}/bot${TOKEN}/sendAudio`, { method: "POST", body: form });
  } else {
    await sendMessage(chatId, `🔊 *رسالة تشجيع قوليها أو سمعيها لـ ${child.name}:*\n«${voiceScript}»`);
  }
}

function isYesterday(dateStr: string | null | undefined, todayStr: string): boolean {
  if (!dateStr) return false;
  const y = new Date(new Date(todayStr).getTime() - 86400000).toISOString().slice(0, 10);
  return dateStr === y;
}

// ============================================================
// المحادثة الذكية السلسة مع الأم (ترد على أي سؤال أو طلب تعديل أو إدخال واجب نصي)
// ============================================================
async function handleSmartMomConversation(chatId: number, parent: any, child: any, momText: string, holdId: number | null = null) {
  await saveConvMessage(parent.id, child.id, "user", momText);

  const ws = weekStartDate();
  const [{ data: masteryRows }, { data: planRows }, recentHistory] = await Promise.all([
    supabaseAdmin
      .from("child_mastery_tracker")
      .select("skill_id, mastery_level, parent_notes, curriculum_skills(display_name)")
      .eq("child_id", child.id),
    supabaseAdmin
      .from("weekly_plans_and_activities")
      .select("*")
      .eq("child_id", child.id)
      .eq("week_start_date", ws)
      .order("day_number"),
    getRecentConv(parent.id, 6),
  ]);

  const mastered = (masteryRows ?? []).filter((m: any) => m.mastery_level === "mastered_green").map((m: any) => m.curriculum_skills?.display_name ?? m.skill_id).join("، ") || "لا يوجد بعد";
  const practicing = (masteryRows ?? []).filter((m: any) => m.mastery_level === "practicing_yellow").map((m: any) => m.curriculum_skills?.display_name ?? m.skill_id).join("، ") || "لا يوجد بعد";
  const weak = (masteryRows ?? []).filter((m: any) => m.mastery_level === "needs_review_red").map((m: any) => `${m.curriculum_skills?.display_name ?? m.skill_id}${m.parent_notes ? ` (${m.parent_notes})` : ""}`).join("، ") || "لا يوجد بعد";

  const currentTargets = planRows?.[0]?.extracted_targets_json ?? [];
  const weekSummary = currentTargets.length
    ? currentTargets.map((t: any) => `${t.title}${t.words?.length ? ` [${t.words.join("، ")}]` : ""}`).join(" + ")
    : "لم يتم رفع واجب هذا الأسبوع بعد";
  const todayRow = (planRows ?? []).find((r: any) => r.status === "sent" || r.status === "pending") ?? planRows?.[0];
  const todayActivitySummary = todayRow ? `${todayRow.activity_title}: ${todayRow.activity_instructions ?? ""}` : "لا يوجد نشاط مفتوح";

  const prompt = PROMPT_SMART_MOM_ASSISTANT
    .replaceAll("{CHILD_NAME}", child.name)
    .replaceAll("{CHILD_STAGE}", child.stage ?? "kg2")
    .replaceAll("{STARS}", String(child.stars_count ?? 0))
    .replaceAll("{STREAK}", String(child.current_streak_days ?? 0))
    .replaceAll("{CURRENT_WEEK_SUMMARY}", weekSummary)
    .replaceAll("{TODAY_ACTIVITY}", todayActivitySummary)
    .replaceAll("{MASTERED_LIST}", mastered)
    .replaceAll("{PRACTICING_LIST}", practicing)
    .replaceAll("{WEAK_LIST}", weak)
    .replace("{RECENT_HISTORY}", recentHistory)
    .replace("{MOM_MESSAGE}", momText);

  let parsed: any = null;
  try {
    const parts = await aiGenerate([{ text: prompt }], {
      generationConfig: { temperature: 0.35, responseMimeType: "application/json" },
    });
    parsed = jsonFromAi(parts);
  } catch (e) {
    console.error("Smart chat error:", e);
  }

  // لو الأم طلبت تسجيل واجب جديد بالنص، نبني خطة الـ 5 أيام فوراً!
  if (parsed?.intent === "set_homework_by_text") {
    if (holdId) { try { await tg("editMessageText", { chat_id: chatId, message_id: holdId, text: `⏳ من عيوني يا ماما! بجهزلك خطة الـ 5 أيام لـ ${child.name} على أساس الواجب اللي كتبتيه حالاً.. ثواني 🙏`, disable_web_page_preview: true }); } catch { /* اختياري */ } }
    const textPlanPrompt = PROMPT_HOMEWORK_EXTRACTOR
      .replaceAll("{CHILD_NAME}", child.name)
      .replaceAll("{CHILD_STAGE}", child.stage ?? "kg2")
      .replaceAll("{WEAK_SKILLS}", weak) +
      `\n\nالأم أرسلت وصف الواجب نصياً كالتالي: "${momText}"\nاستخرج الحروف والكلمات المذكورة وصمم خطة الـ 5 أيام.`;
    await buildAndSaveWeeklyPlan(chatId, child, [{ text: textPlanPrompt }], null, holdId);
    return;
  }

  // لو الأم أبلغت عن إتقان أو تعثر الطفل في حرف معين داخل الكلام العادي، نسجله فوراً في القاعدة!
  if (parsed?.skill_update?.skill_code && parsed?.skill_update?.mastery_level) {
    const norm = normalizeSkillCode(parsed.skill_update.skill_code, "", "");
    const { data: ex } = await supabaseAdmin
      .from("child_mastery_tracker")
      .select("attempts_count")
      .eq("child_id", child.id)
      .eq("skill_id", norm.id)
      .maybeSingle();

    await supabaseAdmin.from("curriculum_skills").upsert({
      id: norm.id,
      subject: norm.subject,
      display_name: norm.title,
    }, { onConflict: "id" });

    await supabaseAdmin.from("child_mastery_tracker").upsert({
      child_id: child.id,
      skill_id: norm.id,
      mastery_level: parsed.skill_update.mastery_level,
      attempts_count: (ex?.attempts_count ?? 0) + 1,
      last_practiced_at: new Date().toISOString(),
      parent_notes: parsed.skill_update.note ?? momText,
    }, { onConflict: "child_id,skill_id" });
  }

  // لو الأم طلبت تعديل نشاط اليوم لعدم توفر الخامات
  if (parsed?.intent === "modify_today_activity" && parsed?.updated_today_instructions && todayRow) {
    await supabaseAdmin.from("weekly_plans_and_activities")
      .update({ activity_instructions: parsed.updated_today_instructions })
      .eq("id", todayRow.id);
  }

  const replyText = parsed?.reply_ar
    ?? `أهلاً بيكي يا ماما ${child.name} 🌸 أنا معاكي في أي سؤال يخص مذاكرة ${child.name}! تقدري تقولي لي واجب الأسبوع في رسالة (مثلاً: «عندنا حرف الباء وكلمة بطة وحرف M») أو تصوري صفحة الواجب، أو تسأليني عن أي حرف بيتلخبط فيه وهبعتلك لعبة فورية وفيديو توضيحي!`;

  await saveConvMessage(parent.id, child.id, "assistant", replyText, parsed?.intent ?? "chat");

  const buttons: any[][] = [];
  if (parsed?.suggested_video_query) {
    buttons.push([{
      text: `🎬 فيديو توضيحي: ${parsed.suggested_video_query.slice(0, 28)}`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(parsed.suggested_video_query)}`,
    }]);
  }
  buttons.push([
    { text: "🎮 نشاط النهارده", callback_data: "act:today" },
    { text: "🔄 نشاط بديل", callback_data: "fb:alt" },
  ]);
  buttons.push([{ text: "📊 افتحي تطبيق متابعة طفلي والسبورة", web_app: { url: MINIAPP_URL } }]);

  await closeHolding(chatId, holdId, replyText, { inline_keyboard: buttons });
}

// ============================================================
// نقطة الدخول: Webhook
// ============================================================
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

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
  // --- 1. التعامل مع أزرار الضغط (Callback Queries) ---
  if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = cb.message?.chat?.id ?? cb.from.id;
    await tg("answerCallbackQuery", { callback_query_id: cb.id });

    const parent = await getParentByTg(cb.from.id);
    if (!parent) {
      await sendMessage(chatId, "ابدئي بالأمر /start الأول يا ماما 🌸");
      return;
    }
    const kids = await getChildren(parent.id);
    if (!kids.length) {
      await sendMessage(chatId, "محتاجين نضيف اسم بطلنا الأول! اكتبي اسم طفلك:");
      await setState(cb.from.id, "awaiting_child_name");
      return;
    }
    const child = kids[0];
    const parts = (cb.data ?? "").split(":");

    if (parts[0] === "stage") {
      const stage = parts[1];
      await supabaseAdmin.from("children").update({ stage }).eq("id", child.id);
      await setState(cb.from.id, null);
      await sendMessage(
        chatId,
        `تم تسجيل ${child.name} في مرحلة *${stage.toUpperCase()}* بنجاح 🎉\n\nدلوقتي تقدري تختاري أسهل طريقة ليكي:\n📸 *صوري صفحة الواجب* من الكراسة أو شيت المدرسة\n✍️ *أو اكتبيلي في رسالة عادية:* «واجبنا الأسبوع ده حرف الباء وحرف M»\n💬 *أو اسأليني أي سؤال* عن مذاكرة ${child.name}!`,
        {
          inline_keyboard: [
            [{ text: "📊 افتحي تطبيق متابعة طفلي والسبورة", web_app: { url: MINIAPP_URL } }],
            [{ text: "🎮 جربي نشاط تأسيسي سريع الآن", callback_data: "act:today" }],
          ],
        },
      );
      return;
    }

    if (parts[0] === "act") {
      await sendDayActivity(parent, child, WEEKDAY_MAP[new Date(Date.now() + 2 * 3600000).getUTCDay()], weekStartDate(), true);
      return;
    }

    if (parts[0] === "fb") {
      const ratingOrAlt = parts[1];
      const skillIdFromBtn = parts[2] ?? null;

      if (ratingOrAlt === "alt") {
        const ws = weekStartDate();
        const { data: todayRow } = await supabaseAdmin
          .from("weekly_plans_and_activities")
          .select("*")
          .eq("child_id", child.id)
          .eq("week_start_date", ws)
          .order("day_number")
          .limit(1)
          .maybeSingle();

        const targets = todayRow?.extracted_targets_json ?? [];
        const primary = targets[0] ?? { title: "حرف الباء (ب)", words: ["بطة", "برج"] };
        const holdId = await sendHolding(chatId, "alt");
        const altText = await generateDetailedActivity(child, todayRow?.activity_title ?? "نشاط بديل", primary.title, primary.words ?? [], true);
        if (todayRow) {
          await supabaseAdmin.from("weekly_plans_and_activities").update({ activity_instructions: altText }).eq("id", todayRow.id);
        }
        await closeHolding(chatId, holdId, `🔄 *ولا يهمك يا ماما! ده نشاط بديل لـ ${child.name} بخامات أسهل وحركة أكتر:*\n\n${altText}`, {
          inline_keyboard: [
            [
              { text: "متقن وممتاز 🟢", callback_data: `fb:easy_green:${skillIdFromBtn ?? ""}` },
              { text: "احتاج مساعدة 🟡", callback_data: `fb:medium_yellow:${skillIdFromBtn ?? ""}` },
            ],
            [{ text: "لسه بيتلخبط 🔴", callback_data: `fb:hard_red:${skillIdFromBtn ?? ""}` }],
          ],
        });
        return;
      }

      if (ratingOrAlt === "hard_red") {
        await setState(cb.from.id, "awaiting_feedback_note", {
          rating: "hard_red",
          child_id: child.id,
          skill_id: skillIdFromBtn,
        });
        await sendMessage(
          chatId,
          `ولا يقلقك يا ماما، التكرار بيعلم الشطار 💪\nاكتبيلي في سطر واحد: *${child.name} اتلخبط في إيه بالظبط؟* (مثلاً: «بيتلخبط بين نقطة الباء والتاء» أو «بينطق الحرف بس مش عارف يكتبه»)، أو اضغطي الزرار تحت لو تحبي تسجليها فوراً:`,
          {
            inline_keyboard: [[{ text: "تسجيل للمراجعة بدون ملاحظة إضافية ✅", callback_data: `fbnow:hard_red:${skillIdFromBtn ?? ""}` }]],
          },
        );
        return;
      }

      // في حالة الأخضر أو الأصفر نسجل التقييم فوراً بدون خطوات معقدة تعطل الأم!
      await handleFeedback(chatId, cb.from.id, child, ratingOrAlt, skillIdFromBtn, null, null);
      return;
    }

    if (parts[0] === "fbnow") {
      await setState(cb.from.id, null);
      await handleFeedback(chatId, cb.from.id, child, parts[1], parts[2] || null, null, null);
      return;
    }

    if (parts[0] === "sub") {
      const links: Record<string, string> = {
        monthly: Deno.env.get("PAYMOB_LINK_MONTHLY") ?? "",
        term: Deno.env.get("PAYMOB_LINK_TERM") ?? "",
        annual: Deno.env.get("PAYMOB_LINK_ANNUAL") ?? "",
      };
      const label: Record<string, string> = {
        monthly: "الباقة الشهرية (89 ج.م)",
        term: "باقة الترم الدراسي 3 شهور (219 ج.م)",
        annual: "الباقة السنوية العائلية + قصة هدية من متجر سراج (649 ج.م)",
      };
      const plan = parts[1];
      if (plan === "menu") {
        await sendTrialOver(chatId);
        return;
      }
      const url = links[plan];
      if (url) {
        await sendMessage(chatId, `💳 *تفاصيل ${label[plan] ?? "الاشتراك"}:*\nاضغطي على الرابط الآمن بالأسفل لإتمام الاشتراك وتفعيل الحساب فوراً:`, {
          inline_keyboard: [[{ text: "🔗 الدفع وتفعيل الباقة الآن", url }]],
        });
      } else {
        await sendMessage(chatId, `✨ تم تسجيل طلبك لـ *${label[plan] ?? "الباقة"}*!\nتقدري تفعليها فوراً عبر InstaPay أو المحفظة الإلكترونية، أو افتحي شاشة الاشتراك داخل التطبيق المصغر.`, {
          inline_keyboard: [[{ text: "📊 فتح شاشة الاشتراك في التطبيق", web_app: { url: `${MINIAPP_URL}?tab=sub` } }]],
        });
      }
      return;
    }
  }

  const msg = u.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const parent = await upsertParent(msg.from);
  const kids = await getChildren(parent.id);
  const child = kids[0] ?? null;

  // --- 2. استقبال أوامر مباشرة من تطبيق المتابعة المصغر (Telegram Mini App sendData) ---
  if (msg.web_app_data?.data && child) {
    try {
      const payload = JSON.parse(msg.web_app_data.data);
      if (payload.action === "focus_tomorrow" && payload.skill) {
        const norm = normalizeSkillCode(payload.skill, payload.skillName ?? "", "");
        await supabaseAdmin.from("child_mastery_tracker").upsert({
          child_id: child.id,
          skill_id: norm.id,
          mastery_level: "needs_review_red",
          last_practiced_at: new Date().toISOString(),
        }, { onConflict: "child_id,skill_id" });
        await sendMessage(chatId, `📌 تم تثبيت *${norm.title}* كأولوية في خطة ${child.name}! تحبي أبعتلك نشاط علاجي ليه دلوقتي؟`, {
          inline_keyboard: [[{ text: "🎮 ابعتي النشاط الآن", callback_data: "act:today" }]],
        });
        return;
      }
      if (payload.action === "alt_activity") {
        await sendDayActivity(parent, child, undefined, undefined, true);
        return;
      }
    } catch (e) {
      console.error("web_app_data parse error", e);
    }
  }

  // --- 3. الأوامر الأساسية (/start و /menu) ---
  if (msg.text?.startsWith("/start")) {
    if (child) {
      await sendMessage(
        chatId,
        `أهلاً بيكي يا ماما ${msg.from.first_name ?? ""} في «رفيق المذاكرة» 🌟\n\n` +
        `👦 *البطل:* ${child.name} (${(child.stage ?? "kg2").toUpperCase()})\n` +
        `⭐ *النجوم:* ${child.stars_count} نجمة | 🔥 *الانتظام:* ${child.current_streak_days} يوم متتالي\n\n` +
        `تقدري في أي وقت:\n` +
        `📸 *تصوري صفحة الواجب* أو خطة الأسبوع\n` +
        `✍️ *تكتبيلي الواجب في رسالة* (مثلاً: «واجبنا حرف الباء وكلمة بطة وحرف M»)\n` +
        `💬 *تسأليني أي سؤال* عن مذاكرة ${child.name} أو تفتحي تطبيق المتابعة والسبورة بالأسفل:`,
        {
          inline_keyboard: [
            [{ text: "📊 افتحي تطبيق متابعة طفلي والسبورة", web_app: { url: MINIAPP_URL } }],
            [
              { text: "🎮 نشاط النهارده بالصورة", callback_data: "act:today" },
              { text: "💳 باقات الاشتراك", callback_data: "sub:menu" },
            ],
          ],
        },
      );
    } else {
      await setState(tgId, "awaiting_child_name");
      await sendMessage(
        chatId,
        "أهلاً بيكي في «رفيق المذاكرة» 🌟\n\nمرافقك الذكي عشان تذاكري لطفلك واجب المدرسة في 10 دقايق باللعب وخامات البيت، مع تطبيق متابعة كامل لخريطة الحروف والسبورة التفاعلية!\n\nنبدأ؟ *اكتبي اسم طفلك البطل:*",
      );
    }
    return;
  }

  if (msg.text?.startsWith("/menu")) {
    await sendMessage(chatId, "اختاري اللي تحبيه يا ماما 👇", {
      inline_keyboard: [
        [{ text: "📊 تطبيق متابعة طفلي وخريطة الحروف", web_app: { url: MINIAPP_URL } }],
        [{ text: "🎮 ابعتي نشاط النهارده بالصورة", callback_data: "act:today" }],
        [{ text: "💳 الباقات والاشتراك", callback_data: "sub:menu" }],
      ],
    });
    return;
  }

  const state = await getState(tgId);

  // --- 4. خطوة تسجيل اسم الطفل الجديد ---
  if ((state.state === "awaiting_child_name" || !child) && msg.text) {
    const childName = msg.text.trim().slice(0, 40);
    const { data: newKid } = await supabaseAdmin
      .from("children")
      .insert({ parent_id: parent.id, name: childName, stage: "kg2" })
      .select()
      .single();
    await setState(tgId, "awaiting_child_stage", { child_id: newKid.id });
    await sendMessage(chatId, `عاشت الأسامي يا ماما! أهلاً بالبطل *${newKid.name}* 🌟\nاختاري مرحلة ${newKid.name} الدراسية:`, {
      inline_keyboard: [
        [{ text: "Pre-KG (تمهيدي)", callback_data: "stage:pre_kg" }, { text: "KG 1", callback_data: "stage:kg1" }],
        [{ text: "KG 2", callback_data: "stage:kg2" }, { text: "Grade 1 (أولى ابتدائي)", callback_data: "stage:grade1" }],
      ],
    });
    return;
  }

  // --- 5. خطوة استلام ملاحظة التعثر بعد الضغط على الزر الأحمر ---
  if (state.state === "awaiting_feedback_note" && msg.text && child) {
    const skillId = state.temp_json?.skill_id ?? null;
    await setState(tgId, null);
    await handleFeedback(chatId, tgId, child, "hard_red", skillId, msg.text.trim(), null);
    return;
  }

  // --- 6. التعامل مع الصور المرسلة (صورة كراسة الواجب أو صورة تنفيذ الطفل) ---
  const photo = msg.photo?.[msg.photo.length - 1]?.file_id;
  if (photo && child) {
    const holdId = await sendHolding(chatId, "photo");
    await handleHomeworkPhoto(chatId, tgId, parent, child, photo, msg.caption ?? "", holdId);
    return;
  }

  // --- 7. التعامل مع الرسائل الصوتية من الأم (Voice Notes) ---
  if (msg.voice?.file_id && child) {
    const holdId = await sendHolding(chatId, "voice");
    try {
      const fi = await tg("getFile", { file_id: msg.voice.file_id });
      const path = fi?.result?.file_path;
      if (path) {
        const audioRes = await fetch(`${TG}/file/bot${TOKEN}/${path}`);
        const audioBuf = new Uint8Array(await audioRes.arrayBuffer());
        const voiceParts = await geminiGenerate("gemini-flash-latest", [
          { text: "فرّغ هذه الرسالة الصوتية من الأم المصرية إلى نص عربي دقيق كما قالتها بالضبط بدون أي إضافات:" },
          { inlineData: { mimeType: "audio/ogg", data: encodeBase64(audioBuf) } },
        ]);
        const transcribed = voiceParts.map((p: any) => p.text ?? "").join(" ").trim();
        if (transcribed) {
          await handleSmartMomConversation(chatId, parent, child, transcribed, holdId);
          return;
        }
      }
    } catch (e) {
      console.error("voice transcription error:", e);
    }
    await clearHolding(chatId, holdId);
    await sendMessage(chatId, "سمعتك يا ماما بس الصوت كان واطي شوية، اكتبيلي اللي تحبيه في رسالة أو صوري صفحة الواجب وهرد عليكي فوراً 🌸");
    return;
  }

  // --- 8. المحادثة الذكية السلسة مع الأم لأي رسالة نصية ---
  if (msg.text && child) {
    const holdId = await sendHolding(chatId, "question");
    await handleSmartMomConversation(chatId, parent, child, msg.text.trim(), holdId);
  }
}

async function sendTrialOver(chatId: number) {
  const buttons = [
    [{ text: "الباقة الشهرية (89 ج.م) 🌟", callback_data: "sub:monthly" }],
    [{ text: "باقة الترم الدراسي 3 شهور (219 ج.م) 🔥", callback_data: "sub:term" }],
    [{ text: "الباقة السنوية لطفلين + قصة هدية من سراج (649 ج.م) 🎁", callback_data: "sub:annual" }],
  ];
  await sendMessage(
    chatId,
    "📚 *باقات الاشتراك في «رفيق المذاكرة»:*\n\nاختاري الباقة المناسبة ليكي عشان تكملي متابعة طفلك طول السنة مع خريطة الإتقان والسبورة التفاعلية والتشجيع الصوتي اليومي:",
    { inline_keyboard: buttons },
  );
}

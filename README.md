# نظام متابعة الطفل وبوت تليجرام (رفيق المذاكرة)

تنفيذ كامل لوثيقة SDD: بوت تليجرام + Mini App + Supabase + Gemini.

## المكونات
- `supabase/migrations/0001_init.sql` — كل الجداول الخمسة + جدول حالة المحادثة + Bucket خاص + بذرة المهارات (28 حرف عربي + 20 صوت Jolly Phonics + أرقام 1-20)
- `supabase/functions/telegram-webhook/` — البوت كله: /start وتسجيل الأم والطفل، تحليل صورة الواجب (Gemini 2.5 Flash) وخطة 5 أيام، نشاط اليوم (Flash-Lite)، أزرار التقييم الثلاثة، ملاحظة التعثر، النشاط البديل، رسالة صوتية للطفل (Gemini TTS)، نجوم وstreak، شاشة انتهاء التجربة وأزرار الاشتراك
- `supabase/functions/miniapp-api/` — تحقق initData بتوقيع HMAC-SHA256 وبيانات الطفل للـ Mini App
- `supabase/functions/daily-dispatch/` — الكرون الساعي اللي بيبعت نشاط اليوم في الساعة المفضلة لكل أم
- `miniapp/index.html` — التطبيق المصغر بالشاشات الأربعة (واجب الأسبوع، خريطة الحروف الملونة، لوحة البطل + شهادة Canvas، الاشتراك وقصص سراج)
- `cron.sql` — جدولة الإرسال اليومي

## خطوات التشغيل (من حد عنده المفاتيح)
1. **Supabase**: مشروع جديد → SQL Editor → نفّذ محتوى `0001_init.sql` كله.
2. **المفاتيح**: `supabase secrets set` لكل متغير في `.env.example` (المطلوب: توكن البوت من @BotFather، مفتاح Gemini من Google AI Studio، وSupabase URL + Service Role Key).
3. **نشر الدوال**: `supabase functions deploy telegram-webhook miniapp-api daily-dispatch` (محتاج `supabase login` أو ACCESS_TOKEN).
4. **الميني آب**: ارفع `miniapp/index.html` على Vercel/Cloudflare Pages بعد تعويض `__API_URL__` برابط دالة `miniapp-api`، وحط رابط الموقع في secret باسم `MINIAPP_URL`.
5. **الربط**: `setWebhook` على رابط دالة `telegram-webhook` مع `secret_token`، وحدد زرار Menu في BotFather على رابط الميني آب.
6. **الكرون**: نفّذ `cron.sql` بعد تعويض `PROJECT_REF` و `CRON_SECRET`.

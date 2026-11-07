-- ============================================================
-- الترقية الشاملة لنظام «رفيق المذاكرة» (الإصدار 2.0 - الوكيل الذكي)
-- تعالج: ربط الأنشطة بكلمات الواجب الفعلية، حفظ سجل الإتقان بدقة،
-- ذاكرة الحوار مع الأم، البطاقات التوضيحية والروابط التعليمية
-- ============================================================

-- 1) إضافة أعمدة الربط الدقيق بالمهارات وكلمات الواجب والروابط لجدول خطط الأسبوع
alter table public.weekly_plans_and_activities
  add column if not exists focus_skill_id text references public.curriculum_skills(id),
  add column if not exists homework_words_json jsonb default '[]'::jsonb,
  add column if not exists materials_json jsonb default '[]'::jsonb,
  add column if not exists visual_steps_json jsonb default '[]'::jsonb,
  add column if not exists resource_links_json jsonb default '[]'::jsonb,
  add column if not exists parent_feedback_note text;

-- 2) إضافة روابط تعليمية وأمثلة كلمات وتمثيل بصري لقاموس المهارات
alter table public.curriculum_skills
  add column if not exists example_words text,
  add column if not exists stroke_hint text,
  add column if not exists video_url text;

-- 3) جدول ذاكرة المحادثة الذكية مع الأم (لتفادي الردود الجامدة وفهم سياق الحوار)
create table if not exists public.conversation_history (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  message_text text not null,
  intent_detected text,
  created_at timestamptz not null default now()
);
create index if not exists idx_conv_parent_time on public.conversation_history(parent_id, created_at desc);
alter table public.conversation_history enable row level security;

-- 4) دالة ذرية (Atomic Function) لتحديث إتقان الطفل وزيادة عدد المحاولات وتراكم الملاحظات
create or replace function public.upsert_child_skill_mastery(
  p_child_id uuid,
  p_skill_id text,
  p_level text,
  p_note text default null
) returns void language plpgsql security definer as $$
begin
  insert into public.child_mastery_tracker (child_id, skill_id, mastery_level, attempts_count, last_practiced_at, parent_notes)
  values (
    p_child_id,
    p_skill_id,
    p_level,
    1,
    now(),
    case when p_note is not null and length(trim(p_note)) > 0
         then '[' || to_char(now(), 'YYYY-MM-DD') || '] ' || trim(p_note)
         else null end
  )
  on conflict (child_id, skill_id) do update set
    mastery_level = excluded.mastery_level,
    attempts_count = public.child_mastery_tracker.attempts_count + 1,
    last_practiced_at = now(),
    parent_notes = case
      when p_note is not null and length(trim(p_note)) > 0 then
        coalesce(public.child_mastery_tracker.parent_notes || E'\n', '') || '[' || to_char(now(), 'YYYY-MM-DD') || '] ' || trim(p_note)
      else public.child_mastery_tracker.parent_notes
    end;
end;
$$;

-- 5) تحديث بيانات المهارات بأمثلة كلمات المنهج المصري وتلميحات الكتابة والروابط
update public.curriculum_skills set
  example_words = case id
    when 'AR_LETTER_ALEF' then 'أرنب، أسد، إبرة، أذن'
    when 'AR_LETTER_BAA' then 'بطة، برج، برتقال، باب'
    when 'AR_LETTER_TAA' then 'تفاح، تاج، تمر، تمساح'
    when 'AR_LETTER_THAA' then 'ثعلب، ثوب، ثلج، ثعبان'
    when 'AR_LETTER_JEEM' then 'جمل، جزر، جرس، جبل'
    when 'AR_LETTER_HAA' then 'حصان، حمامة، حوت، حليب'
    when 'AR_LETTER_KHAA' then 'خروف، خبز، خيار، خاتم'
    when 'AR_LETTER_DAL' then 'دب، ديك، دلو، دراجة'
    when 'AR_LETTER_DHAL' then 'ذرة، ذئب، ذيل، ذهب'
    when 'AR_LETTER_RAA' then 'رمان، ريشة، رجل، رمل'
    when 'AR_LETTER_ZAY' then 'زرافة، زهرة، زيتون، زر'
    when 'AR_LETTER_SEEN' then 'سمكة، ساعة، سحب، سفينة'
    when 'AR_LETTER_SHEEN' then 'شمس، شجرة، شباك، شمعة'
    when 'AR_LETTER_MEEM' then 'موز، مركب، مفتاح، معلمة'
    when 'AR_LETTER_NOON' then 'نحلة، نجمة، نمر، نهر'
    else 'كلمات من كتاب تواصل KG'
  end,
  stroke_hint = case
    when subject = 'arabic' then 'من الأعلى للأسفل ومن اليمين لليسار على السطر'
    when subject = 'english_phonics' then 'من الأعلى للأسفل (Top-to-Bottom) من اليسار لليمين'
    else 'تتبع النقاط بالترتيب مع العد بصوت مسموع'
  end,
  video_url = case
    when subject = 'arabic' then 'https://www.youtube.com/results?search_query=' || replace(display_name, ' ', '+') || '+منهج+تواصل+رياض+اطفال'
    when subject = 'english_phonics' then 'https://www.youtube.com/results?search_query=Jolly+Phonics+letter+' || lower(replace(id, 'EN_PHONICS_', '')) || '+song+action'
    else 'https://www.youtube.com/results?search_query=تعليم+' || replace(display_name, ' ', '+') || '+للاطفال'
  end;

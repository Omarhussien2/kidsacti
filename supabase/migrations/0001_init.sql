-- ============================================================
-- نظام متابعة الطفل - المخطط الأولي (SDD)
-- يُنفَّذ من Supabase Dashboard > SQL Editor
-- ============================================================
create extension if not exists pgcrypto;

-- 1) أولياء الأمور والاشتراكات
create table if not exists public.parents (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  telegram_first_name text,
  whatsapp_phone text,
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial','active_monthly','active_term','active_annual','expired')),
  subscription_expires_at timestamptz,
  preferred_reminder_hour int not null default 17,
  created_at timestamptz not null default now()
);

-- 2) ملفات الأطفال
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  name text not null,
  stage text not null default 'kg1'
    check (stage in ('pre_kg','kg1','kg2','grade1')),
  school_type text not null default 'arabic_governmental'
    check (school_type in ('arabic_governmental','experimental_languages','private_international')),
  stars_count int not null default 0,
  current_streak_days int not null default 0,
  last_active_date date,
  created_at timestamptz not null default now()
);
create index if not exists idx_children_parent on public.children(parent_id);

-- 3) قاموس المهارات القياسي
create table if not exists public.curriculum_skills (
  id text primary key,
  subject text not null check (subject in ('arabic','english_phonics','math','discover')),
  display_name text not null,
  common_mistakes text
);

-- 4) خريطة إتقان الطفل
create table if not exists public.child_mastery_tracker (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  skill_id text not null references public.curriculum_skills(id),
  mastery_level text not null default 'not_started'
    check (mastery_level in ('not_started','needs_review_red','practicing_yellow','mastered_green')),
  attempts_count int not null default 0,
  last_practiced_at timestamptz,
  parent_notes text,
  unique (child_id, skill_id)
);
create index if not exists idx_mastery_child on public.child_mastery_tracker(child_id);

-- 5) خطط الأسبوع والأنشطة اليومية
create table if not exists public.weekly_plans_and_activities (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  week_start_date date not null,
  homework_image_url text,
  extracted_targets_json jsonb,
  day_number int not null check (day_number between 1 and 5),
  activity_title text not null,
  activity_instructions text,
  status text not null default 'pending'
    check (status in ('pending','sent','completed','skipped')),
  completion_photo_url text,
  feedback_rating text check (feedback_rating in ('easy_green','medium_yellow','hard_red')),
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_child_week on public.weekly_plans_and_activities(child_id, week_start_date);

-- 6) حالة المحادثة للبوت (onboarding + سياق رسالة)
create table if not exists public.bot_state (
  telegram_user_id bigint primary key,
  state text,
  temp_json jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS: كل الوصول بيتم من دوال Edge بحساب service_role (بتتجاوز RLS)،
-- وMini App بيكلم دالة التحقق مش قاعدة البيانات مباشرة. فمفيش أي سياسة عامة.
-- ============================================================
alter table public.parents enable row level security;
alter table public.children enable row level security;
alter table public.curriculum_skills enable row level security;
alter table public.child_mastery_tracker enable row level security;
alter table public.weekly_plans_and_activities enable row level security;
alter table public.bot_state enable row level security;

-- ============================================================
-- Storage: Bucket خاص لصور الواجبات (روابط موقعة مؤقتة فقط)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('homework', 'homework', false, 10485760)
on conflict (id) do nothing;

-- ============================================================
-- بذرة المهارات القياسية: العربي (28 حرف)، فونكس إنجليزي، أرقام
-- ============================================================
insert into public.curriculum_skills (id, subject, display_name, common_mistakes)
select 'AR_LETTER_' || c.code, 'arabic', 'حرف ' || c.name || ' (' || c.symbol || ') - أصواته وأشكاله', c.mistakes
from unnest(array[
  ['ALEF','الألف','ا','نسي النقط فوق الألف المتطرفة (ى)'],
  ['BAA','الباء','ب','الخلط بين النقطة تحت الباء وفوق التاء'],
  ['TAA','التاء','ت','الخلط بين التاء والباء'],
  ['THAA','الثاء','ث','نسي النقط الثلاث'],
  ['JEEM','الجيم','ج','نطق الجيم جيم مصرية أو جيم فارسية'],
  ['HAA','الحاء','ح','الخلط بين الحاء والهاء والخاء'],
  ['KHAA','الخاء','خ','الخلط بين الخاء والحاء'],
  ['DAL','الدال','د','الخلط بين الدال والذال'],
  ['DHAL','الذال','ذ','نسي نقطة الذال'],
  ['RAA','الراء','ر','نطق الراء غناءً'],
  ['ZAY','الزاي','ز','الخلط بين الزاي والراء والذال'],
  ['SEEN','السين','س','الخلط بين السين والشين'],
  ['SHEEN','الشين','ش','نسي النقاط الثلاث فوق الشين'],
  ['SAD','الصاد','ص','الخلط بين الصاد والسين'],
  ['DAD','الضاد','ض','الخلط بين الضاد والدال'],
  ['TAA_SAD','الطاء','ط','الخلط بين الطاء والتاء'],
  ['DHA','الظاء','ظ','الخلط بين الظاء والزاي'],
  ['AIN','العين','ع','نطق العين خفيفة'],
  ['GHAIN','الغين','غ','الخلط بين الغين والعين'],
  ['FAA','الفاء','ف','الخلط بين الفاء والقاف'],
  ['QAF','القاف','ق','نطق القاف ألفًا (مصري)'],
  ['KAF','الكاف','ك','شكل الكاف النهائية'],
  ['LAM','اللام','ل','اللام القمرية والشمسية'],
  ['MEEM','الميم','م','دائرة الميم وسط الكلمة'],
  ['NOON','النون','ن','النقطة فوق النون'],
  ['HA','الهاء','ه','شكل الهاء في آخر الكلمة'],
  ['WAW','الواو','و','الواو حرف ساكن وحرف مد'],
  ['YA','الياء','ي','نقاط الياء والياء المكسورة (ى)']
] as t(code text, name text, symbol text, mistakes text))
on conflict (id) do nothing;

insert into public.curriculum_skills (id, subject, display_name, common_mistakes)
select 'EN_PHONICS_' || upper(c.code), 'english_phonics', 'صوت حرف ' || upper(c.code) || ' - Jolly Phonics (' || c.sound || ')', c.mistakes
from unnest(array[
  ['s','sss like a snake','ممد الصوت زي الأفعى'],
  ['a','a like in ant','الخلط بين a و e'],
  ['t','t like tennis','مش متأكد اتجاه القلم'],
  ['i','i like in insect','الخلط بين i و l'],
  ['p','p like puff','الخلط بين p و q'],
  ['n','n like in net','الخلط بين n و u'],
  ['m','m like rubbing tummy','الخلط بين m و n و w'],
  ['d','d like drum','الخلط الشهير بين b و d'],
  ['g','g like water glug','الخلط بين g و q'],
  ['o','o like Opera','رسمها كأنها صفر'],
  ['c','c like castanets','الخلط بين c و s'],
  ['k','k like kite','الخلط بين k و c و q'],
  ['e','e like egg','الخلط بين e و i'],
  ['u','u like umbrella','الخلط بين u و n'],
  ['r','r like army rat','نطق الراء العربية مكانها'],
  ['h','h like breath','مشدودة زي الحاء العربية'],
  ['b','b like bat','الخلط الشهير بين b و d'],
  ['f','f like wind','الخلط بين f و v'],
  ['l','l like lullaby','نسي الذيل للأسفل'],
  ['j','j like jellyfish','الخلط بين j و g']
] as t(code text, sound text, mistakes text))
on conflict (id) do nothing;

insert into public.curriculum_skills (id, subject, display_name)
select 'MATH_NUM_' || n, 'math', 'الرقم ' || n || ' - التعرف عليه والعد'
from generate_series(1, 20) as n
on conflict (id) do nothing;

-- عرض بسيط للأمام في SQL Editor
create or replace view public.v_child_summary as
select ch.id as child_id, ch.name, ch.stars_count, ch.current_streak_days,
       count(m.id) filter (where m.mastery_level = 'mastered_green') as mastered,
       count(m.id) filter (where m.mastery_level = 'practicing_yellow') as practicing,
       count(m.id) filter (where m.mastery_level = 'needs_review_red') as needs_review
from public.children ch
left join public.child_mastery_tracker m on m.child_id = ch.id
group by ch.id;

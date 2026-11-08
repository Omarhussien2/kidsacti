-- منع تكرار معالجة تحديثات تليجرام: تليجرام بيعيد إرسال نفس التحديث لو الـ webhook اتأخر في الرد،
-- وده كان بيسبب لوب رسائل الانتظار (نصيحة + انتظار) كل شوية.
create table if not exists public.processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

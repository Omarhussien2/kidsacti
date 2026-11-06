-- كرون إرسال الأنشطة اليومية: يشتغل كل ساعة، وبيرد بس للأمه اللي ساعتها المفضلة دلوقتي
-- استبدل PROJECT_REF و CRON_SECRET قبل التنفيذ
select cron.schedule(
  'child-tracker-daily-dispatch',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/daily-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CRON_SECRET')
  )::int
  $$
);

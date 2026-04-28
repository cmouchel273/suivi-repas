-- Run this in the Supabase SQL Editor.
-- Replace <REMINDER_FUNCTION_SECRET> with the same secret used by the Edge Function.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-web-push-reminders')
where exists (
  select 1
  from cron.job
  where jobname = 'send-web-push-reminders'
);

select cron.schedule(
  'send-web-push-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://swyndvvqxlnhjwmdnhzd.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <REMINDER_FUNCTION_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

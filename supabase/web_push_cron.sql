-- Optional helper for Supabase SQL Editor.
-- Replace <project-ref> and <REMINDER_FUNCTION_SECRET>, then run this after enabling
-- the pg_cron and pg_net extensions in Supabase.

select cron.schedule(
  'send-web-push-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <REMINDER_FUNCTION_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

import { createClient } from 'npm:@supabase/supabase-js@2.104.1';
import webpush from 'npm:web-push@3.6.7';

type Reminder = {
  id: string;
  title: string;
  body: string;
  hour: number;
  minute: number;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type RequestBody = {
  force?: boolean;
  reminderId?: string;
};

const DEFAULT_NOTIFICATION_REMINDERS: Reminder[] = [
  {
    id: 'weight-morning',
    title: 'Rappel pes\u00e9e',
    body: 'Pense \u00e0 enregistrer ton poids.',
    hour: 8,
    minute: 0,
  },
  {
    id: 'meal-lunch',
    title: 'Rappel repas',
    body: 'Pense \u00e0 entrer ton repas du midi.',
    hour: 13,
    minute: 0,
  },
  {
    id: 'meal-evening',
    title: 'Rappel repas',
    body: 'Pense \u00e0 entrer ton repas du soir.',
    hour: 20,
    minute: 30,
  },
];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const REMINDER_WINDOW_MINUTES = 5;
const TIME_ZONE = 'Europe/Paris';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json',
    },
  });

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

const getParisDateTime = (date: Date) => {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
};

const getDueReminders = (now: Date) => {
  const parisNow = getParisDateTime(now);
  const minuteOfDay = parisNow.hour * 60 + parisNow.minute;
  const reminders = DEFAULT_NOTIFICATION_REMINDERS.filter((reminder) => {
    const reminderMinuteOfDay = reminder.hour * 60 + reminder.minute;
    const delta = minuteOfDay - reminderMinuteOfDay;

    return delta >= 0 && delta < REMINDER_WINDOW_MINUTES;
  });

  return {
    ...parisNow,
    reminders,
  };
};

const isGoneSubscriptionError = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return false;
  }

  const statusCode = Number(error.statusCode);

  return statusCode === 404 || statusCode === 410;
};

const readRequestBody = async (request: Request): Promise<RequestBody> => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const functionSecret = Deno.env.get('REMINDER_FUNCTION_SECRET');

    if (functionSecret && request.headers.get('authorization') !== `Bearer ${functionSecret}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const requestBody = await readRequestBody(request);
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublicKey = getRequiredEnv('WEB_PUSH_VAPID_PUBLIC_KEY');
    const vapidPrivateKey = getRequiredEnv('WEB_PUSH_VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT') ?? 'mailto:admin@suivi-repas.local';
    const due = getDueReminders(new Date());
    const remindersToSend = requestBody.force
      ? DEFAULT_NOTIFICATION_REMINDERS.filter(
          (reminder) => !requestBody.reminderId || reminder.id === requestBody.reminderId
        )
      : due.reminders;

    if (remindersToSend.length === 0) {
      return json({
        ok: true,
        forced: Boolean(requestBody.force),
        localDate: due.localDate,
        hour: due.hour,
        minute: due.minute,
        dueReminders: [],
        sent: 0,
      });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const { data: subscriptions, error } = await supabase
      .from('web_push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth');

    if (error) {
      throw error;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let removed = 0;

    for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
      for (const reminder of remindersToSend) {
        if (!requestBody.force) {
          const { error: deliveryError } = await supabase
            .from('web_push_reminder_deliveries')
            .insert({
              subscription_id: subscription.id,
              user_id: subscription.user_id,
              reminder_id: reminder.id,
              local_date: due.localDate,
            });

          if (deliveryError) {
            if (deliveryError.code === '23505') {
              skipped += 1;
              continue;
            }

            failed += 1;
            console.log('delivery insert failed', deliveryError);
            continue;
          }
        }

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: reminder.title,
              body: reminder.body,
              url: '/',
              tag: `suivi-repas-${reminder.id}`,
              reminderId: reminder.id,
            })
          );

          sent += 1;
        } catch (sendError) {
          failed += 1;
          console.log('web push send failed', sendError);

          if (isGoneSubscriptionError(sendError)) {
            await supabase
              .from('web_push_subscriptions')
              .delete()
              .eq('id', subscription.id);
            removed += 1;
          }
        }
      }
    }

    return json({
      ok: true,
      forced: Boolean(requestBody.force),
      localDate: due.localDate,
      hour: due.hour,
      minute: due.minute,
      dueReminders: remindersToSend.map((reminder) => reminder.id),
      subscriptions: subscriptions?.length ?? 0,
      sent,
      skipped,
      failed,
      removed,
    });
  } catch (error) {
    console.log('send reminders failed', error);

    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500
    );
  }
});

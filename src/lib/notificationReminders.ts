import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { supabase } from '@/src/lib/supabase';

export type DefaultNotificationReminder = {
  id: string;
  kind: 'weight' | 'meal';
  title: string;
  body: string;
  hour: number;
  minute: number;
};

export type NotificationPermissionState = {
  supported: boolean;
  granted: boolean;
  canAskAgain: boolean;
};

type ScheduledDefaultReminders = {
  signature: string;
  notificationIds: string[];
};

const NOTIFICATION_LOG_PREFIX = '[notifications]';
const WEB_PUSH_SERVICE_WORKER_PATH = '/service-worker.js';
const WEB_PUSH_VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

export const DEFAULT_NOTIFICATION_REMINDERS: DefaultNotificationReminder[] = [
  {
    id: 'weight-morning',
    kind: 'weight',
    title: 'Rappel ou rat pelle',
    body: 'Pense à secher mon pote.',
    hour: 22,
    minute: 55,
  },
];

const SCHEDULED_REMINDERS_STORAGE_KEY = 'suivi-repas:default-notification-reminders:v1';
const REMINDER_CHANNEL_ID = 'suivi-repas-reminders';
const DEFAULT_REMINDERS_SIGNATURE = DEFAULT_NOTIFICATION_REMINDERS.map(
  (reminder) =>
    `${reminder.id}:${reminder.title}:${reminder.body}:${reminder.hour}:${reminder.minute}`
).join('|');

let hasConfiguredNotificationHandler = false;

const isNativeNotificationsSupported = () => Platform.OS === 'android' || Platform.OS === 'ios';

const isWebPushSupported = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

export const isNotificationsSupported = () =>
  isNativeNotificationsSupported() || isWebPushSupported();

export const configureNotificationHandler = () => {
  if (Platform.OS === 'web') {
    console.log(`${NOTIFICATION_LOG_PREFIX} handler web service worker`, {
      supported: isWebPushSupported(),
    });
    return;
  }

  if (hasConfiguredNotificationHandler || !isNativeNotificationsSupported()) {
    console.log(`${NOTIFICATION_LOG_PREFIX} handler ignore`, {
      alreadyConfigured: hasConfiguredNotificationHandler,
      platform: Platform.OS,
      supported: isNativeNotificationsSupported(),
    });
    return;
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} handler configure`, { platform: Platform.OS });

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  hasConfiguredNotificationHandler = true;
};

export const setupNotificationChannelAsync = async () => {
  if (Platform.OS !== 'android') {
    console.log(`${NOTIFICATION_LOG_PREFIX} channel skip`, { platform: Platform.OS });
    return;
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} channel setup start`, {
    channelId: REMINDER_CHANNEL_ID,
  });

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Rappels Suivi Repas',
    description: 'Rappels pour enregistrer les repas et le poids.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: AppTheme.primary,
    sound: 'default',
  });

  console.log(`${NOTIFICATION_LOG_PREFIX} channel setup done`, {
    channelId: REMINDER_CHANNEL_ID,
  });
};

const getWebNotificationPermissionState = (): NotificationPermissionState => {
  if (!isWebPushSupported()) {
    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  return {
    supported: true,
    granted: window.Notification.permission === 'granted',
    canAskAgain: window.Notification.permission !== 'denied',
  };
};

const registerWebServiceWorkerAsync = async () => {
  if (!isWebPushSupported()) {
    throw new Error('Les notifications PWA ne sont pas supportées par ce navigateur.');
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} web service worker register start`, {
    path: WEB_PUSH_SERVICE_WORKER_PATH,
  });

  const registration = await navigator.serviceWorker.register(WEB_PUSH_SERVICE_WORKER_PATH);
  const readyRegistration = await navigator.serviceWorker.ready;

  console.log(`${NOTIFICATION_LOG_PREFIX} web service worker ready`, {
    scope: readyRegistration.scope,
  });

  return readyRegistration ?? registration;
};

const urlBase64ToUint8Array = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
};

const getOrCreateWebPushSubscriptionAsync = async (
  registration: ServiceWorkerRegistration
) => {
  const existingSubscription = await registration.pushManager.getSubscription();

  if (existingSubscription) {
    console.log(`${NOTIFICATION_LOG_PREFIX} web push subscription existing`, {
      endpoint: existingSubscription.endpoint,
    });
    return existingSubscription;
  }

  if (!WEB_PUSH_VAPID_PUBLIC_KEY) {
    throw new Error(
      'La clé EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY manque dans .env. Redémarre Expo après l’avoir ajoutée.'
    );
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} web push subscribe start`);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY),
  });

  console.log(`${NOTIFICATION_LOG_PREFIX} web push subscribe done`, {
    endpoint: subscription.endpoint,
  });

  return subscription;
};

const saveWebPushSubscriptionAsync = async (subscription: PushSubscription) => {
  const subscriptionJson = subscription.toJSON();
  const p256dh = subscriptionJson.keys?.p256dh;
  const auth = subscriptionJson.keys?.auth;

  if (!subscription.endpoint || !p256dh || !auth) {
    throw new Error("L'abonnement push du navigateur est incomplet.");
  }

  const { data, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!data.user) {
    throw new Error("Reconnecte-toi avant d'activer les notifications.");
  }

  const payload = {
    user_id: data.user.id,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    expiration_time: subscription.expirationTime
      ? new Date(subscription.expirationTime).toISOString()
      : null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    updated_at: new Date().toISOString(),
  };

  console.log(`${NOTIFICATION_LOG_PREFIX} web push subscription save start`, {
    userId: payload.user_id,
    endpoint: payload.endpoint,
  });

  const { error } = await supabase
    .from('web_push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error) {
    throw error;
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} web push subscription save done`, {
    userId: payload.user_id,
    endpoint: payload.endpoint,
  });
};

const getWebPushSubscriptionStateAsync = async (): Promise<NotificationPermissionState> => {
  const baseState = getWebNotificationPermissionState();

  console.log(`${NOTIFICATION_LOG_PREFIX} web permission state`, baseState);

  if (!baseState.supported || window.Notification.permission !== 'granted') {
    return baseState;
  }

  try {
    const registration = await registerWebServiceWorkerAsync();
    const subscription = await getOrCreateWebPushSubscriptionAsync(registration);
    await saveWebPushSubscriptionAsync(subscription);
  } catch (error) {
    console.log(`${NOTIFICATION_LOG_PREFIX} web push subscription state error`, error);
  }

  return {
    ...baseState,
    granted: true,
    canAskAgain: true,
  };
};

const requestWebPushPermissionAsync = async (): Promise<NotificationPermissionState> => {
  if (!isWebPushSupported()) {
    console.log(`${NOTIFICATION_LOG_PREFIX} web request unsupported`, {
      platform: Platform.OS,
    });

    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} web permission request start`);

  const permission = await window.Notification.requestPermission();

  console.log(`${NOTIFICATION_LOG_PREFIX} web permission request result`, {
    permission,
  });

  if (permission !== 'granted') {
    return {
      supported: true,
      granted: false,
      canAskAgain: permission !== 'denied',
    };
  }

  try {
    const registration = await registerWebServiceWorkerAsync();
    const subscription = await getOrCreateWebPushSubscriptionAsync(registration);
    await saveWebPushSubscriptionAsync(subscription);
  } catch (error) {
    console.log(`${NOTIFICATION_LOG_PREFIX} web push subscription request error`, error);
  }

  return {
    supported: true,
    granted: true,
    canAskAgain: true,
  };
};

const ensureWebPushSubscriptionStoredAsync = async () => {
  if (!isWebPushSupported() || window.Notification.permission !== 'granted') {
    console.log(`${NOTIFICATION_LOG_PREFIX} web schedule skip`, {
      supported: isWebPushSupported(),
      permission: isWebPushSupported() ? window.Notification.permission : null,
    });
    return;
  }

  try {
    const registration = await registerWebServiceWorkerAsync();
    const subscription = await getOrCreateWebPushSubscriptionAsync(registration);
    await saveWebPushSubscriptionAsync(subscription);
  } catch (error) {
    console.log(`${NOTIFICATION_LOG_PREFIX} web schedule subscription error`, error);
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} web schedule server-driven`, {
    reminders: DEFAULT_NOTIFICATION_REMINDERS.map((reminder) => ({
      id: reminder.id,
      at: formatReminderTime(reminder.hour, reminder.minute),
    })),
  });
};

const arePermissionsGranted = (
  permissions: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>
) =>
  permissions.granted ||
  permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

export const getNotificationPermissionStateAsync = async (): Promise<NotificationPermissionState> => {
  if (Platform.OS === 'web') {
    return getWebPushSubscriptionStateAsync();
  }

  if (!isNotificationsSupported()) {
    console.log(`${NOTIFICATION_LOG_PREFIX} get permissions unsupported`, {
      platform: Platform.OS,
    });

    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  console.log(`${NOTIFICATION_LOG_PREFIX} get permissions start`);

  const permissions = await Notifications.getPermissionsAsync();
  const state = {
    supported: true,
    granted: arePermissionsGranted(permissions),
    canAskAgain: permissions.canAskAgain,
  };

  console.log(`${NOTIFICATION_LOG_PREFIX} get permissions result`, {
    permissions,
    state,
  });

  return state;
};

export const requestNotificationPermissionAsync = async (): Promise<NotificationPermissionState> => {
  if (Platform.OS === 'web') {
    return requestWebPushPermissionAsync();
  }

  if (!isNotificationsSupported()) {
    console.log(`${NOTIFICATION_LOG_PREFIX} request permissions unsupported`, {
      platform: Platform.OS,
    });

    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  console.log(`${NOTIFICATION_LOG_PREFIX} request permissions start`);

  const permissions = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  const state = {
    supported: true,
    granted: arePermissionsGranted(permissions),
    canAskAgain: permissions.canAskAgain,
  };

  console.log(`${NOTIFICATION_LOG_PREFIX} request permissions result`, {
    permissions,
    state,
  });

  return state;
};

export const formatReminderTime = (hour: number, minute: number) =>
  `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

export const scheduleDefaultRemindersAsync = async () => {
  if (Platform.OS === 'web') {
    await ensureWebPushSubscriptionStoredAsync();
    return;
  }

  if (!isNotificationsSupported()) {
    console.log(`${NOTIFICATION_LOG_PREFIX} schedule unsupported`, { platform: Platform.OS });
    return;
  }

  console.log(`${NOTIFICATION_LOG_PREFIX} schedule start`, {
    reminders: DEFAULT_NOTIFICATION_REMINDERS.map((reminder) => ({
      id: reminder.id,
      at: formatReminderTime(reminder.hour, reminder.minute),
    })),
  });

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  const scheduledReminders = await loadScheduledDefaultRemindersAsync();
  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledNotificationIds = new Set(
    scheduledNotifications.map((notification) => notification.identifier)
  );

  console.log(`${NOTIFICATION_LOG_PREFIX} schedule current state`, {
    stored: scheduledReminders,
    scheduledCount: scheduledNotifications.length,
  });

  if (
    scheduledReminders?.signature === DEFAULT_REMINDERS_SIGNATURE &&
    scheduledReminders.notificationIds.length === DEFAULT_NOTIFICATION_REMINDERS.length &&
    scheduledReminders.notificationIds.every((notificationId) =>
      scheduledNotificationIds.has(notificationId)
    )
  ) {
    console.log(`${NOTIFICATION_LOG_PREFIX} schedule already up to date`, {
      notificationIds: scheduledReminders.notificationIds,
    });
    return;
  }

  if (scheduledReminders) {
    console.log(`${NOTIFICATION_LOG_PREFIX} schedule cancel old reminders`, {
      notificationIds: scheduledReminders.notificationIds,
    });

    await Promise.all(
      scheduledReminders.notificationIds.map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId)
      )
    );
  }

  const notificationIds = await Promise.all(
    DEFAULT_NOTIFICATION_REMINDERS.map((reminder) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title,
          body: reminder.body,
          sound: true,
          data: {
            reminderId: reminder.id,
            reminderKind: reminder.kind,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          channelId: REMINDER_CHANNEL_ID,
          hour: reminder.hour,
          minute: reminder.minute,
        },
      })
    )
  );

  console.log(`${NOTIFICATION_LOG_PREFIX} schedule created`, { notificationIds });

  await AsyncStorage.setItem(
    SCHEDULED_REMINDERS_STORAGE_KEY,
    JSON.stringify({
      signature: DEFAULT_REMINDERS_SIGNATURE,
      notificationIds,
    })
  );

  console.log(`${NOTIFICATION_LOG_PREFIX} schedule stored`, {
    signature: DEFAULT_REMINDERS_SIGNATURE,
    notificationIds,
  });
};

const loadScheduledDefaultRemindersAsync = async () => {
  const stored = await AsyncStorage.getItem(SCHEDULED_REMINDERS_STORAGE_KEY);

  if (!stored) {
    console.log(`${NOTIFICATION_LOG_PREFIX} stored reminders empty`);
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ScheduledDefaultReminders>;

    if (
      typeof parsed.signature !== 'string' ||
      !Array.isArray(parsed.notificationIds) ||
      parsed.notificationIds.some((notificationId) => typeof notificationId !== 'string')
    ) {
      console.log(`${NOTIFICATION_LOG_PREFIX} stored reminders invalid`, parsed);
      return null;
    }

    console.log(`${NOTIFICATION_LOG_PREFIX} stored reminders loaded`, parsed);

    return {
      signature: parsed.signature,
      notificationIds: parsed.notificationIds,
    };
  } catch (error) {
    console.log('Erreur lecture rappels notifications par défaut', error);
    return null;
  }
};

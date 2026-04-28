import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AppTheme } from '@/constants/theme';

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

export const DEFAULT_NOTIFICATION_REMINDERS: DefaultNotificationReminder[] = [
  {
    id: 'weight-morning',
    kind: 'weight',
    title: 'Pense à niquer ta mère.',
    body: 'Pense à niquer ta mère.',
    hour: 20,
    minute: 30,
  },
  // {
  //   id: 'meal-lunch',
  //   kind: 'meal',
  //   title: 'Rappel repas',
  //   body: 'Pense à entrer ton repas du midi.',
  //   hour: 13,
  //   minute: 0,
  // },
  // {
  //   id: 'meal-evening',
  //   kind: 'meal',
  //   title: 'Rappel repas',
  //   body: 'Pense à entrer ton repas du soir.',
  //   hour: 20,
  //   minute: 30,
  // },
];

const SCHEDULED_REMINDERS_STORAGE_KEY = 'suivi-repas:default-notification-reminders:v1';
const REMINDER_CHANNEL_ID = 'suivi-repas-reminders';
const DEFAULT_REMINDERS_SIGNATURE = DEFAULT_NOTIFICATION_REMINDERS.map(
  (reminder) => `${reminder.id}:${reminder.hour}:${reminder.minute}`
).join('|');

let hasConfiguredNotificationHandler = false;

export const isNotificationsSupported = () => Platform.OS === 'android' || Platform.OS === 'ios';

export const configureNotificationHandler = () => {
  if (hasConfiguredNotificationHandler || !isNotificationsSupported()) {
    return;
  }

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
    return;
  }

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Rappels Suivi Repas',
    description: 'Rappels pour enregistrer les repas et le poids.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: AppTheme.primary,
    sound: 'default',
  });
};

const arePermissionsGranted = (
  permissions: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>
) =>
  permissions.granted ||
  permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

export const getNotificationPermissionStateAsync = async (): Promise<NotificationPermissionState> => {
  if (!isNotificationsSupported()) {
    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  const permissions = await Notifications.getPermissionsAsync();

  return {
    supported: true,
    granted: arePermissionsGranted(permissions),
    canAskAgain: permissions.canAskAgain,
  };
};

export const requestNotificationPermissionAsync = async (): Promise<NotificationPermissionState> => {
  if (!isNotificationsSupported()) {
    return {
      supported: false,
      granted: false,
      canAskAgain: false,
    };
  }

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  const permissions = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return {
    supported: true,
    granted: arePermissionsGranted(permissions),
    canAskAgain: permissions.canAskAgain,
  };
};

export const formatReminderTime = (hour: number, minute: number) =>
  `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

export const scheduleDefaultRemindersAsync = async () => {
  if (!isNotificationsSupported()) {
    return;
  }

  configureNotificationHandler();
  await setupNotificationChannelAsync();

  const scheduledReminders = await loadScheduledDefaultRemindersAsync();
  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledNotificationIds = new Set(
    scheduledNotifications.map((notification) => notification.identifier)
  );

  if (
    scheduledReminders?.signature === DEFAULT_REMINDERS_SIGNATURE &&
    scheduledReminders.notificationIds.length === DEFAULT_NOTIFICATION_REMINDERS.length &&
    scheduledReminders.notificationIds.every((notificationId) =>
      scheduledNotificationIds.has(notificationId)
    )
  ) {
    return;
  }

  if (scheduledReminders) {
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

  await AsyncStorage.setItem(
    SCHEDULED_REMINDERS_STORAGE_KEY,
    JSON.stringify({
      signature: DEFAULT_REMINDERS_SIGNATURE,
      notificationIds,
    })
  );
};

const loadScheduledDefaultRemindersAsync = async () => {
  const stored = await AsyncStorage.getItem(SCHEDULED_REMINDERS_STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ScheduledDefaultReminders>;

    if (
      typeof parsed.signature !== 'string' ||
      !Array.isArray(parsed.notificationIds) ||
      parsed.notificationIds.some((notificationId) => typeof notificationId !== 'string')
    ) {
      return null;
    }

    return {
      signature: parsed.signature,
      notificationIds: parsed.notificationIds,
    };
  } catch (error) {
    console.log('Erreur lecture rappels notifications par défaut', error);
    return null;
  }
};

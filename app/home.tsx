import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTheme } from '@/constants/theme';
import {
  configureNotificationHandler,
  DEFAULT_NOTIFICATION_REMINDERS,
  formatReminderTime,
  getNotificationPermissionStateAsync,
  isNotificationsSupported,
  type NotificationPermissionState,
  requestNotificationPermissionAsync,
  scheduleDefaultRemindersAsync,
} from '@/src/lib/notificationReminders';
import { supabase } from '@/src/lib/supabase';

type HomeProps = {
  session?: Session | null;
};

type TabKey = 'home' | 'meal' | 'weight' | 'settings';
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type SavingAction = 'meal' | 'weight' | 'profile' | null;
type WeightRangeKey = 'week' | 'month' | 'year' | 'all';

type ProfileRow = {
  user_id: string;
  email: string | null;
  pseudo: string | null;
  updated_at: string;
};

type MealRow = {
  id: number;
  user_id: string;
  user_email: string | null;
  name: string;
  calories: number;
  proteins: number;
  photo_path: string | null;
  photo_url?: string | null;
  created_at: string;
};

type WeightRow = {
  id: number;
  user_id: string;
  user_email: string | null;
  weight: number;
  created_at: string;
};

type ChartPoint = {
  id: number;
  weight: number;
  createdAt: string;
};

type ActivityType = 'meal' | 'weight';
type ReactionValue = 'up' | 'down';

type ActivityReactionRow = {
  target_type: ActivityType;
  target_id: number;
  user_id: string;
  reaction: ReactionValue;
};

type ActivityReactions = {
  up: number;
  down: number;
  currentUserReaction: ReactionValue | null;
};

type BaseActivityItem = {
  key: string;
  type: ActivityType;
  id: number;
  userId: string;
  userDisplayName: string;
  createdAt: string;
  reactions: ActivityReactions;
};

type MealActivityItem = BaseActivityItem & {
  type: 'meal';
  meal: MealRow;
};

type WeightActivityItem = BaseActivityItem & {
  type: 'weight';
  weight: WeightRow;
};

type ActivityItem = MealActivityItem | WeightActivityItem;

type TabItem = {
  key: TabKey;
  label: string;
  icon: IconName;
};

type WeightRangeOption = {
  key: WeightRangeKey;
  label: string;
  days: number | null;
};

const TABS: TabItem[] = [
  { key: 'home', label: 'Accueil', icon: 'home-outline' },
  { key: 'meal', label: 'Repas', icon: 'silverware-fork-knife' },
  { key: 'weight', label: 'Poids', icon: 'scale-bathroom' },
  { key: 'settings', label: 'Paramètres', icon: 'cog-outline' },
];

const WEIGHT_RANGES: WeightRangeOption[] = [
  { key: 'week', label: 'Semaine', days: 7 },
  { key: 'month', label: 'Mois', days: 30 },
  { key: 'year', label: 'Année', days: 365 },
  { key: 'all', label: 'Tout', days: null },
];

const MEAL_PHOTOS_BUCKET = 'meal-photos';
const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

const getPhotoExtension = (asset: ImagePicker.ImagePickerAsset) => {
  const mimeExtension = asset.mimeType?.split('/')[1]?.split(';')[0];

  if (mimeExtension) {
    return mimeExtension === 'jpeg' ? 'jpg' : mimeExtension;
  }

  const fileMatch = asset.fileName?.match(/\.([a-z0-9]+)$/i);
  const uriMatch = asset.uri.match(/\.([a-z0-9]+)(?:\?|#|$)/i);

  return (fileMatch?.[1] ?? uriMatch?.[1] ?? 'jpg').toLowerCase();
};

const getPhotoContentType = (asset: ImagePicker.ImagePickerAsset) => {
  if (asset.mimeType) {
    if (asset.mimeType === 'image/jpg' || asset.mimeType === 'image/pjpeg') {
      return 'image/jpeg';
    }

    return asset.mimeType;
  }

  const extension = getPhotoExtension(asset);

  if (extension === 'png') {
    return 'image/png';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  if (extension === 'heic' || extension === 'heif') {
    return 'image/heic';
  }

  return 'image/jpeg';
};

const createSignedMealPhotoUrl = async (photoPath?: string | null) => {
  if (!photoPath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(MEAL_PHOTOS_BUCKET)
    .createSignedUrl(photoPath, PHOTO_SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.log('Erreur création URL signée photo repas', error);
    return null;
  }

  return data.signedUrl;
};

const uploadMealPhoto = async (asset: ImagePicker.ImagePickerAsset, userId: string) => {
  const extension = getPhotoExtension(asset);
  const photoPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const response = await fetch(asset.uri);

  if (!response.ok) {
    throw new Error("La photo n'a pas pu être lue.");
  }

  const photoData = asset.file ?? (await response.arrayBuffer());
  const { error } = await supabase.storage.from(MEAL_PHOTOS_BUCKET).upload(photoPath, photoData, {
    contentType: getPhotoContentType(asset),
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return photoPath;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return 'Aucune donnée';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const formatActivityTime = (value: string) => {
  const date = new Date(value);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  return minutes === '00' ? `${hours}h` : `${hours}h${minutes}`;
};

const getActivityKey = (type: ActivityType, id: number) => `${type}-${id}`;

const getDisplayName = (pseudo?: string | null, email?: string | null) => {
  const cleanPseudo = pseudo?.trim();

  if (cleanPseudo) {
    return cleanPseudo;
  }

  if (!email) {
    return 'Utilisateur';
  }

  const [name] = email.split('@');

  return name || email;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message);
  }

  return 'Une erreur inattendue est survenue.';
};

export default function Home({ session }: HomeProps) {
  const hasLoadedProfile = useRef(false);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [weightHistory, setWeightHistory] = useState<WeightRow[]>([]);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [mealName, setMealName] = useState('');
  const [mealCalories, setMealCalories] = useState('');
  const [mealProteins, setMealProteins] = useState('');
  const [mealPhoto, setMealPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [weight, setWeight] = useState('');
  const [profilePseudo, setProfilePseudo] = useState('');
  const [profileDraft, setProfileDraft] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>({
    supported: isNotificationsSupported(),
    granted: false,
    canAskAgain: true,
  });
  const [isNotificationPermissionLoading, setIsNotificationPermissionLoading] = useState(true);
  const [isNotificationPromptDismissed, setIsNotificationPromptDismissed] = useState(false);

  const userId = session?.user.id;
  const email = session?.user.email ?? 'utilisateur';
  const isSavingMeal = savingAction === 'meal';
  const isSavingWeight = savingAction === 'weight';
  const isSavingProfile = savingAction === 'profile';
  const displayIdentity = profilePseudo ? `${profilePseudo} - ${email}` : email;
  const areNotificationsReady = notificationPermission.supported && notificationPermission.granted;
  const shouldShowNotificationModal =
    notificationPermission.supported &&
    !isNotificationPermissionLoading &&
    !notificationPermission.granted &&
    !isNotificationPromptDismissed;

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
    []
  );

  const refreshNotificationPermission = useCallback(async () => {
    setIsNotificationPermissionLoading(true);

    try {
      const nextPermission = await getNotificationPermissionStateAsync();
      setNotificationPermission(nextPermission);

      if (nextPermission.granted) {
        await scheduleDefaultRemindersAsync();
      }
    } catch (error) {
      console.log('Erreur vérification permission notifications', error);
      setNotificationPermission({
        supported: false,
        granted: false,
        canAskAgain: false,
      });
    } finally {
      setIsNotificationPermissionLoading(false);
    }
  }, []);

  const ensureCurrentProfile = useCallback(async () => {
    if (!userId) {
      return;
    }

    const { error } = await supabase.from('profiles').upsert(
      {
        user_id: userId,
        email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      console.log('Erreur Supabase upsert profile', error);
    }
  }, [email, userId]);

  const loadDashboard = useCallback(async (options?: { silent?: boolean }) => {
    if (!userId) {
      setIsDashboardLoading(false);
      return;
    }

    const shouldShowLoading = !options?.silent;

    console.log('Chargement du fil d activité du groupe');
    if (shouldShowLoading) {
      setIsDashboardLoading(true);
    }
    setDashboardError(null);

    try {
      const [profilesResult, mealsResult, weightsResult, reactionsResult] = await Promise.all([
        supabase.from('profiles').select('user_id,email,pseudo,updated_at').order('email'),
        supabase
          .from('meals')
          .select('id,user_id,user_email,name,calories,proteins,photo_path,created_at')
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('weights')
          .select('id,user_id,user_email,weight,created_at')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('activity_reactions')
          .select('target_type,target_id,user_id,reaction')
          .limit(10000),
      ]);

      if (profilesResult.error) {
        throw profilesResult.error;
      }

      if (mealsResult.error) {
        throw mealsResult.error;
      }

      if (weightsResult.error) {
        throw weightsResult.error;
      }

      if (reactionsResult.error) {
        throw reactionsResult.error;
      }

      const profileRows = (profilesResult.data ?? []) as ProfileRow[];
      const mealRows = (mealsResult.data ?? []) as MealRow[];
      const weightRows = (weightsResult.data ?? []) as WeightRow[];
      const reactionRows = (reactionsResult.data ?? []) as ActivityReactionRow[];
      const currentUserWeights = weightRows
        .filter((weightEntry) => weightEntry.user_id === userId)
        .sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      const profilesByUser = new Map(
        profileRows.map((profile) => [profile.user_id, profile])
      );
      const currentProfile = profilesByUser.get(userId);
      const nextProfilePseudo = currentProfile?.pseudo?.trim() ?? '';

      setProfilePseudo(nextProfilePseudo);
      if (!hasLoadedProfile.current) {
        setProfileDraft(nextProfilePseudo);
        hasLoadedProfile.current = true;
      }

      const getDisplayNameForUser = (id: string, fallbackEmail?: string | null) => {
        const profile = profilesByUser.get(id);

        if (id === userId) {
          return getDisplayName(profile?.pseudo, email);
        }

        return getDisplayName(profile?.pseudo, fallbackEmail ?? profile?.email);
      };
      const reactionsByActivity = new Map<string, ActivityReactions>();
      const getReactionSummary = (type: ActivityType, id: number) => {
        const key = getActivityKey(type, id);
        const existing = reactionsByActivity.get(key);

        if (existing) {
          return existing;
        }

        const summary: ActivityReactions = {
          up: 0,
          down: 0,
          currentUserReaction: null,
        };

        reactionsByActivity.set(key, summary);
        return summary;
      };

      reactionRows.forEach((reaction) => {
        if (reaction.reaction !== 'up' && reaction.reaction !== 'down') {
          return;
        }

        const summary = getReactionSummary(
          reaction.target_type,
          Number(reaction.target_id)
        );
        summary[reaction.reaction] += 1;

        if (reaction.user_id === userId) {
          summary.currentUserReaction = reaction.reaction;
        }
      });

      const mealsWithPhotoUrls = await Promise.all(
        mealRows.map(async (meal) => ({
          ...meal,
          photo_url: await createSignedMealPhotoUrl(meal.photo_path),
        }))
      );
      const mealActivities = mealsWithPhotoUrls.map<ActivityItem>((meal) => ({
        key: getActivityKey('meal', meal.id),
        type: 'meal',
        id: meal.id,
        userId: meal.user_id,
        userDisplayName: getDisplayNameForUser(meal.user_id, meal.user_email),
        createdAt: meal.created_at,
        meal,
        reactions: getReactionSummary('meal', meal.id),
      }));
      const weightActivities = weightRows.map<ActivityItem>((weightEntry) => ({
        key: getActivityKey('weight', weightEntry.id),
        type: 'weight',
        id: weightEntry.id,
        userId: weightEntry.user_id,
        userDisplayName: getDisplayNameForUser(weightEntry.user_id, weightEntry.user_email),
        createdAt: weightEntry.created_at,
        weight: weightEntry,
        reactions: getReactionSummary('weight', weightEntry.id),
      }));
      const nextActivityFeed = [...mealActivities, ...weightActivities].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      console.log('Fil d activité chargé', { count: nextActivityFeed.length });
      setActivityFeed(nextActivityFeed);
      setWeightHistory(currentUserWeights);
    } catch (error) {
      const message = getErrorMessage(error);

      console.log('Erreur chargement dashboard Supabase', error);
      setDashboardError(
        `${message}. Si les tables n'existent pas encore, exécute le fichier supabase/schema.sql dans Supabase.`
      );
    } finally {
      if (shouldShowLoading) {
        setIsDashboardLoading(false);
      }
    }
  }, [email, userId]);

  useEffect(() => {
    void ensureCurrentProfile().then(() => loadDashboard());
  }, [ensureCurrentProfile, loadDashboard]);

  useEffect(() => {
    configureNotificationHandler();
    void refreshNotificationPermission();
  }, [refreshNotificationPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshNotificationPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshNotificationPermission]);

  useEffect(() => {
    const channel = supabase
      .channel('suivi-repas-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void loadDashboard({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => {
        void loadDashboard({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, () => {
        void loadDashboard({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_reactions' }, () => {
        void loadDashboard({ silent: true });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadDashboard]);

  const handleSignOut = async () => {
    console.log('Tentative de déconnexion');
    setIsSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        console.log('Erreur Supabase signOut', error);
        Alert.alert('Déconnexion impossible', error.message);
        return;
      }

      console.log('Déconnexion réussie');
    } catch (error) {
      console.log('Erreur inattendue pendant la déconnexion', error);
      Alert.alert('Déconnexion impossible', 'Une erreur inattendue est survenue.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handlePickMealPhoto = async (source: 'camera' | 'library') => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission nécessaire',
          source === 'camera'
            ? "Autorise l'appareil photo pour prendre une photo de ton repas."
            : "Autorise l'accès aux photos pour choisir une photo de ton repas."
        );
        return;
      }

      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.75,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              ...pickerOptions,
              cameraType: ImagePicker.CameraType.back,
            })
          : await ImagePicker.launchImageLibraryAsync(pickerOptions);

      if (!result.canceled) {
        setMealPhoto(result.assets[0] ?? null);
      }
    } catch (error) {
      console.log('Erreur sélection photo repas', error);
      Alert.alert('Photo indisponible', getErrorMessage(error));
    }
  };

  const handleSaveMeal = async () => {
    if (!userId) {
      Alert.alert('Session manquante', "Reconnecte-toi avant d'ajouter un repas.");
      return;
    }

    const calories = Number(mealCalories.replace(',', '.'));
    const proteins = Number(mealProteins.replace(',', '.'));

    if (!mealName.trim()) {
      Alert.alert('Repas incomplet', 'Ajoute au moins un nom de repas.');
      return;
    }

    if (!Number.isFinite(calories) || calories < 0) {
      Alert.alert('Calories invalides', 'Renseigne un nombre de calories valide.');
      return;
    }

    if (!Number.isFinite(proteins) || proteins < 0) {
      Alert.alert('Protéines invalides', 'Renseigne un nombre de protéines valide.');
      return;
    }

    const nextMeal = {
      user_id: userId,
      user_email: email,
      name: mealName.trim(),
      calories,
      proteins,
      photo_path: null as string | null,
    };

    setSavingAction('meal');

    try {
      if (mealPhoto) {
        nextMeal.photo_path = await uploadMealPhoto(mealPhoto, userId);
      }

      console.log('Ajout repas Supabase', nextMeal);
      const { error } = await supabase.from('meals').insert(nextMeal);

      if (error) {
        console.log('Erreur Supabase insert meal', error);
        if (nextMeal.photo_path) {
          await supabase.storage.from(MEAL_PHOTOS_BUCKET).remove([nextMeal.photo_path]);
        }
        Alert.alert('Repas non enregistré', error.message);
        return;
      }

      console.log('Repas Supabase ajouté');
      setMealName('');
      setMealCalories('');
      setMealProteins('');
      setMealPhoto(null);
      Alert.alert('Repas ajouté', "Le repas est visible sur l'accueil.");
      setActiveTab('home');
      await loadDashboard();
    } catch (error) {
      console.log('Erreur inattendue insert meal', error);
      if (nextMeal.photo_path) {
        await supabase.storage.from(MEAL_PHOTOS_BUCKET).remove([nextMeal.photo_path]);
      }
      Alert.alert('Repas non enregistré', getErrorMessage(error));
    } finally {
      setSavingAction(null);
    }
  };

  const handleSaveWeight = async () => {
    if (!userId) {
      Alert.alert('Session manquante', "Reconnecte-toi avant d'ajouter un poids.");
      return;
    }

    const nextWeight = Number(weight.replace(',', '.'));

    if (!Number.isFinite(nextWeight) || nextWeight <= 0) {
      Alert.alert('Poids invalide', 'Renseigne un poids valide en kg.');
      return;
    }

    const entry = {
      user_id: userId,
      user_email: email,
      weight: nextWeight,
    };

    console.log('Ajout poids Supabase', entry);
    setSavingAction('weight');

    try {
      const { error } = await supabase.from('weights').insert(entry);

      if (error) {
        console.log('Erreur Supabase insert weight', error);
        Alert.alert('Poids non enregistré', error.message);
        return;
      }

      console.log('Poids Supabase ajouté');
      setWeight('');
      Alert.alert('Poids ajouté', "Le poids est visible sur l'accueil.");
      setActiveTab('home');
      await loadDashboard();
    } catch (error) {
      console.log('Erreur inattendue insert weight', error);
      Alert.alert('Poids non enregistré', getErrorMessage(error));
    } finally {
      setSavingAction(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!userId) {
      Alert.alert('Session manquante', 'Reconnecte-toi avant de modifier ton profil.');
      return;
    }

    const nextPseudo = profileDraft.trim();

    if (nextPseudo.length > 32) {
      Alert.alert('Pseudo trop long', 'Choisis un pseudo de 32 caractères maximum.');
      return;
    }

    setSavingAction('profile');

    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: userId,
          email,
          pseudo: nextPseudo || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      if (error) {
        throw error;
      }

      setProfilePseudo(nextPseudo);
      setProfileDraft(nextPseudo);
      Alert.alert('Profil enregistré', nextPseudo ? 'Ton pseudo est à jour.' : 'Ton pseudo a été retiré.');
      await loadDashboard({ silent: true });
    } catch (error) {
      console.log('Erreur sauvegarde profil Supabase', error);
      Alert.alert('Profil non enregistré', getErrorMessage(error));
    } finally {
      setSavingAction(null);
    }
  };

  const handleRequestNotifications = async () => {
    setIsNotificationPermissionLoading(true);

    try {
      if (!notificationPermission.canAskAgain) {
        await Linking.openSettings();
        return;
      }

      const nextPermission = await requestNotificationPermissionAsync();
      setNotificationPermission(nextPermission);

      if (nextPermission.granted) {
        await scheduleDefaultRemindersAsync();
        setIsNotificationPromptDismissed(true);
      }
    } catch (error) {
      console.log('Erreur demande permission notifications', error);
      Alert.alert('Notifications indisponibles', getErrorMessage(error));
    } finally {
      setIsNotificationPermissionLoading(false);
    }
  };

  const handleReaction = async (activity: ActivityItem, reaction: ReactionValue) => {
    if (!userId) {
      Alert.alert('Session manquante', 'Reconnecte-toi avant de réagir.');
      return;
    }

    const activityKey = getActivityKey(activity.type, activity.id);
    const isRemovingReaction = activity.reactions.currentUserReaction === reaction;

    setReactingTo(activityKey);

    try {
      if (isRemovingReaction) {
        const { error } = await supabase
          .from('activity_reactions')
          .delete()
          .match({
            target_type: activity.type,
            target_id: activity.id,
            user_id: userId,
          });

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase.from('activity_reactions').upsert(
          {
            target_type: activity.type,
            target_id: activity.id,
            user_id: userId,
            reaction,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'target_type,target_id,user_id' }
        );

        if (error) {
          throw error;
        }
      }

      await loadDashboard({ silent: true });
    } catch (error) {
      console.log('Erreur reaction activité', error);
      Alert.alert('Réaction impossible', getErrorMessage(error));
    } finally {
      setReactingTo(null);
    }
  };

  const renderReactionButton = (
    activity: ActivityItem,
    reaction: ReactionValue,
    icon: IconName,
    activeIcon: IconName,
    count: number
  ) => {
    const isActive = activity.reactions.currentUserReaction === reaction;
    const isReacting = reactingTo === getActivityKey(activity.type, activity.id);
    const color = reaction === 'up' ? AppTheme.primary : AppTheme.danger;

    return (
      <Pressable
        disabled={isReacting}
        onPress={() => void handleReaction(activity, reaction)}
        style={({ pressed }) => [
          styles.reactionButton,
          isActive && (reaction === 'up' ? styles.reactionButtonUpActive : styles.reactionButtonDownActive),
          pressed && styles.reactionButtonPressed,
          isReacting && styles.buttonDisabled,
        ]}>
        <MaterialCommunityIcons
          name={isActive ? activeIcon : icon}
          size={18}
          color={isActive ? AppTheme.surface : color}
        />
        <Text style={[styles.reactionCount, isActive && styles.reactionCountActive]}>{count}</Text>
      </Pressable>
    );
  };

  const renderActivityItem = (activity: ActivityItem) => {
    const isMeal = activity.type === 'meal';
    const isCurrentUserActivity = activity.userId === userId;

    return (
      <View key={activity.key} style={styles.activityItem}>
        <View style={styles.activityMainRow}>
          <View style={[styles.activityIcon, isMeal ? styles.activityIconMeal : styles.activityIconWeight]}>
            <MaterialCommunityIcons
              name={isMeal ? 'silverware-fork-knife' : 'scale-bathroom'}
              size={20}
              color={isMeal ? AppTheme.primary : AppTheme.success}
            />
          </View>

          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>
              <Text style={styles.activityTime}>{formatActivityTime(activity.createdAt)} : </Text>
              {activity.userDisplayName} a ajouté {isMeal ? 'un repas' : 'son poids'}
            </Text>
            <Text style={styles.activityValue}>
              {isMeal
                ? `${activity.meal.name} - ${activity.meal.calories} kcal - ${activity.meal.proteins} g prot.`
                : `${activity.weight.weight} kg`}
            </Text>
            <Text style={styles.activityMeta}>
              {formatDate(activity.createdAt)}
              {isCurrentUserActivity ? ' - Moi' : ''}
            </Text>
            {isMeal && activity.meal.photo_url ? (
              <Image
                source={{ uri: activity.meal.photo_url }}
                style={styles.mealPhoto}
                contentFit="cover"
              />
            ) : null}
          </View>
        </View>

        <View style={styles.reactionsRow}>
          {renderReactionButton(
            activity,
            'up',
            'thumb-up-outline',
            'thumb-up',
            activity.reactions.up
          )}
          {renderReactionButton(
            activity,
            'down',
            'thumb-down-outline',
            'thumb-down',
            activity.reactions.down
          )}
        </View>
      </View>
    );
  };

  const renderHomeTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Fil du groupe</Text>
          <Text style={styles.sectionSubtitle}>
            Les infos les plus récentes en premier - {todayLabel}
          </Text>
        </View>
        <Pressable onPress={() => void loadDashboard()} style={styles.refreshButton}>
          <MaterialCommunityIcons name="refresh" size={20} color={AppTheme.primary} />
        </Pressable>
      </View>

      {notificationPermission.supported && !areNotificationsReady ? (
        <View style={styles.notificationHomeCard}>
          <View style={styles.notificationHomeHeader}>
            <View style={styles.notificationHomeIcon}>
              <MaterialCommunityIcons name="bell-ring-outline" size={22} color={AppTheme.primary} />
            </View>
            <View style={styles.notificationHomeText}>
              <Text style={styles.notificationHomeTitle}>Active les rappels</Text>
              <Text style={styles.notificationHomeSubtitle}>
                Pesée et repas seront rappelés automatiquement.
              </Text>
            </View>
          </View>

          <View style={styles.defaultRemindersList}>
            {DEFAULT_NOTIFICATION_REMINDERS.map((reminder) => (
              <Text key={reminder.id} style={styles.defaultReminderText}>
                {formatReminderTime(reminder.hour, reminder.minute)} - {reminder.body}
              </Text>
            ))}
          </View>

          <Pressable
            disabled={isNotificationPermissionLoading}
            onPress={handleRequestNotifications}
            style={({ pressed }) => [
              styles.inlineButton,
              pressed && styles.inlineButtonPressed,
              isNotificationPermissionLoading && styles.buttonDisabled,
            ]}>
            {isNotificationPermissionLoading ? (
              <ActivityIndicator color={AppTheme.primary} />
            ) : (
              <>
                <MaterialCommunityIcons name="bell-ring-outline" size={18} color={AppTheme.primary} />
                <Text style={styles.inlineButtonText}>
                  {notificationPermission.canAskAgain ? 'Activer les notifications' : 'Ouvrir les réglages'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {dashboardError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{dashboardError}</Text>
        </View>
      ) : null}

      {isDashboardLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={AppTheme.primary} />
          <Text style={styles.loadingText}>Chargement du groupe...</Text>
        </View>
      ) : (
        <View style={styles.activityList}>
          {activityFeed.length > 0 ? (
            activityFeed.map(renderActivityItem)
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Aucune information</Text>
              <Text style={styles.emptyText}>
                Ajoute un repas ou un poids pour commencer le suivi du groupe.
              </Text>
            </View>
          )}
        </View>
      )}

    </View>
  );

  const renderMealTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.formHeader}>
        <Text style={styles.title}>Repas du jour</Text>
        <Text style={styles.subtitle}>
          Ajoute ton repas avec ses calories et protéines. Il sera visible par les membres.
        </Text>
      </View>

      <View style={styles.formCard}>
        <View style={styles.field}>
          <Text style={styles.label}>Nom du repas</Text>
          <TextInput
            value={mealName}
            onChangeText={setMealName}
            editable={!isSavingMeal}
            placeholder="Ex : Poulet riz"
            placeholderTextColor={AppTheme.placeholder}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Calories</Text>
          <TextInput
            value={mealCalories}
            onChangeText={setMealCalories}
            editable={!isSavingMeal}
            keyboardType="numeric"
            placeholder="Ex : 650"
            placeholderTextColor={AppTheme.placeholder}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Protéines (g)</Text>
          <TextInput
            value={mealProteins}
            onChangeText={setMealProteins}
            editable={!isSavingMeal}
            keyboardType="numeric"
            placeholder="Ex : 42"
            placeholderTextColor={AppTheme.placeholder}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Photo du repas</Text>
          <View style={styles.photoActions}>
            <Pressable
              disabled={isSavingMeal}
              onPress={() => void handlePickMealPhoto('camera')}
              style={({ pressed }) => [
                styles.photoActionButton,
                pressed && styles.photoActionButtonPressed,
                isSavingMeal && styles.buttonDisabled,
              ]}>
              <MaterialCommunityIcons name="camera-outline" size={19} color={AppTheme.primary} />
              <Text style={styles.photoActionButtonText}>Prendre</Text>
            </Pressable>
            <Pressable
              disabled={isSavingMeal}
              onPress={() => void handlePickMealPhoto('library')}
              style={({ pressed }) => [
                styles.photoActionButton,
                pressed && styles.photoActionButtonPressed,
                isSavingMeal && styles.buttonDisabled,
              ]}>
              <MaterialCommunityIcons name="image-outline" size={19} color={AppTheme.primary} />
              <Text style={styles.photoActionButtonText}>Choisir</Text>
            </Pressable>
          </View>

          {mealPhoto ? (
            <View style={styles.photoPreview}>
              <Image
                source={{ uri: mealPhoto.uri }}
                style={styles.photoPreviewImage}
                contentFit="cover"
              />
              <Pressable
                disabled={isSavingMeal}
                onPress={() => setMealPhoto(null)}
                style={({ pressed }) => [
                  styles.removePhotoButton,
                  pressed && styles.removePhotoButtonPressed,
                  isSavingMeal && styles.buttonDisabled,
                ]}>
                <MaterialCommunityIcons name="close" size={18} color={AppTheme.danger} />
                <Text style={styles.removePhotoButtonText}>Retirer</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <MaterialCommunityIcons name="image-plus" size={26} color={AppTheme.textMuted} />
              <Text style={styles.photoPlaceholderText}>Aucune photo sélectionnée</Text>
            </View>
          )}
        </View>

        <Pressable
          disabled={isSavingMeal}
          onPress={handleSaveMeal}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSavingMeal && styles.buttonDisabled,
          ]}>
          {isSavingMeal ? (
            <ActivityIndicator color={AppTheme.surface} />
          ) : (
            <Text style={styles.primaryButtonText}>Ajouter le repas</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderWeightTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.formHeader}>
        <Text style={styles.title}>Poids du jour</Text>
        <Text style={styles.subtitle}>
          Ton poids sera enregistré et visible dans le suivi du groupe.
        </Text>
      </View>

      <WeightChart weights={weightHistory} />

      <View style={styles.formCard}>
        <View style={styles.field}>
          <Text style={styles.label}>Poids en kg</Text>
          <TextInput
            value={weight}
            onChangeText={setWeight}
            editable={!isSavingWeight}
            keyboardType="decimal-pad"
            placeholder="Ex : 78.5"
            placeholderTextColor={AppTheme.placeholder}
            style={styles.input}
          />
        </View>

        <Pressable
          disabled={isSavingWeight}
          onPress={handleSaveWeight}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSavingWeight && styles.buttonDisabled,
          ]}>
          {isSavingWeight ? (
            <ActivityIndicator color={AppTheme.surface} />
          ) : (
            <Text style={styles.primaryButtonText}>Ajouter le poids</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderSettingsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.formHeader}>
        <Text style={styles.title}>Paramètres</Text>
        <Text style={styles.subtitle}>
          Choisis le pseudo affiché dans le fil et gère ta session.
        </Text>
      </View>

      <View style={styles.formCard}>
        <View style={styles.profileSummary}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {(profilePseudo || email).charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileSummaryText}>
            <Text style={styles.profileName}>{profilePseudo || 'Aucun pseudo'}</Text>
            <Text numberOfLines={1} style={styles.profileEmail}>
              {email}
            </Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Pseudo</Text>
          <TextInput
            value={profileDraft}
            onChangeText={setProfileDraft}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!isSavingProfile}
            maxLength={32}
            placeholder="Ex : Alex"
            placeholderTextColor={AppTheme.placeholder}
            returnKeyType="done"
            style={styles.input}
            onSubmitEditing={handleSaveProfile}
          />
          <Text style={styles.helperText}>{profileDraft.trim().length}/32 caractères</Text>
        </View>

        <Pressable
          disabled={isSavingProfile}
          onPress={handleSaveProfile}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSavingProfile && styles.buttonDisabled,
          ]}>
          {isSavingProfile ? (
            <ActivityIndicator color={AppTheme.surface} />
          ) : (
            <Text style={styles.primaryButtonText}>Enregistrer le profil</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        disabled={isSigningOut}
        onPress={handleSignOut}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.signOutButtonPressed,
          isSigningOut && styles.buttonDisabled,
        ]}>
        {isSigningOut ? (
          <ActivityIndicator color={AppTheme.primary} />
        ) : (
          <Text style={styles.signOutButtonText}>Se déconnecter</Text>
        )}
      </Pressable>
    </View>
  );

  const renderNotificationPermissionModal = () => (
    <Modal
      animationType="fade"
      onRequestClose={() => setIsNotificationPromptDismissed(true)}
      transparent
      visible={shouldShowNotificationModal}>
      <View style={styles.modalBackdrop}>
        <View style={styles.notificationModal}>
          <View style={styles.modalIcon}>
            <MaterialCommunityIcons name="bell-ring-outline" size={30} color={AppTheme.primary} />
          </View>
          <Text style={styles.modalTitle}>Activer les notifications</Text>
          <Text style={styles.modalText}>
            Reçois tes rappels pour la pesée et les repas.
          </Text>

          <Pressable
            disabled={isNotificationPermissionLoading}
            onPress={handleRequestNotifications}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isNotificationPermissionLoading && styles.buttonDisabled,
            ]}>
            {isNotificationPermissionLoading ? (
              <ActivityIndicator color={AppTheme.surface} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {notificationPermission.canAskAgain ? 'Activer' : 'Ouvrir les réglages'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setIsNotificationPromptDismissed(true)}
            style={({ pressed }) => [
              styles.modalSecondaryButton,
              pressed && styles.modalSecondaryButtonPressed,
            ]}>
            <Text style={styles.modalSecondaryButtonText}>Plus tard</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const renderActiveTab = () => {
    if (activeTab === 'meal') {
      return renderMealTab();
    }

    if (activeTab === 'weight') {
      return renderWeightTab();
    }

    if (activeTab === 'settings') {
      return renderSettingsTab();
    }

    return renderHomeTab();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.appBar}>
            <View style={styles.brandLockup}>
              <View style={styles.brandMark}>
                <MaterialCommunityIcons
                  name="silverware-fork-knife"
                  size={22}
                  color={AppTheme.primary}
                />
              </View>
              <View style={styles.brandText}>
                <Text style={styles.appName}>Suivi Repas</Text>
                <Text numberOfLines={1} style={styles.appMeta}>
                  {displayIdentity}
                </Text>
              </View>
            </View>
            <View style={styles.sessionPill}>
              <MaterialCommunityIcons name="leaf" size={16} color={AppTheme.primary} />
              <Text style={styles.sessionPillText}>Connecté</Text>
            </View>
          </View>
          {renderActiveTab()}
        </ScrollView>

        <View style={styles.bottomBar}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;

            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={({ pressed }) => [
                  styles.tabButton,
                  isActive && styles.tabButtonActive,
                  pressed && styles.tabButtonPressed,
                ]}>
                <MaterialCommunityIcons
                  name={tab.icon}
                  size={24}
                  color={isActive ? AppTheme.primary : AppTheme.textMuted}
                />
                <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAvoidingView>
      {renderNotificationPermissionModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: 20,
    padding: 18,
    paddingBottom: 102,
  },
  appBar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 14,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  brandLockup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 12,
    backgroundColor: AppTheme.primarySoft,
  },
  brandText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  appName: {
    color: AppTheme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  appMeta: {
    color: AppTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  sessionPill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 999,
    backgroundColor: AppTheme.primarySoft,
    paddingHorizontal: 11,
  },
  sessionPillText: {
    color: AppTheme.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  tabContent: {
    flex: 1,
    gap: 18,
  },
  title: {
    color: AppTheme.text,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: AppTheme.textSoft,
    fontSize: 16,
    lineHeight: 23,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  sectionTitle: {
    color: AppTheme.text,
    fontSize: 20,
    fontWeight: '900',
  },
  sectionSubtitle: {
    marginTop: 2,
    color: AppTheme.textMuted,
    fontSize: 14,
  },
  refreshButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 12,
    backgroundColor: AppTheme.primarySoft,
  },
  notificationHomeCard: {
    gap: 12,
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 8,
    backgroundColor: AppTheme.primarySoft,
    padding: 14,
  },
  notificationHomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notificationHomeIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 10,
    backgroundColor: AppTheme.surface,
  },
  notificationHomeText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  notificationHomeTitle: {
    color: AppTheme.text,
    fontSize: 16,
    fontWeight: '900',
  },
  notificationHomeSubtitle: {
    color: AppTheme.textSoft,
    fontSize: 13,
    lineHeight: 18,
  },
  defaultRemindersList: {
    gap: 4,
  },
  defaultReminderText: {
    color: AppTheme.textSoft,
    fontSize: 13,
    lineHeight: 18,
  },
  activityList: {
    gap: 10,
  },
  activityItem: {
    gap: 12,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 14,
  },
  activityMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  activityIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
  },
  activityIconMeal: {
    borderColor: AppTheme.primaryBorder,
    backgroundColor: AppTheme.primarySoft,
  },
  activityIconWeight: {
    borderColor: AppTheme.successBorder,
    backgroundColor: AppTheme.successSoft,
  },
  activityText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  activityTitle: {
    color: AppTheme.text,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 21,
  },
  activityTime: {
    color: AppTheme.primary,
  },
  activityValue: {
    color: AppTheme.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  activityMeta: {
    color: AppTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  reactionButton: {
    minWidth: 62,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 10,
    backgroundColor: AppTheme.surfaceAlt,
    paddingHorizontal: 10,
  },
  reactionButtonUpActive: {
    borderColor: AppTheme.primary,
    backgroundColor: AppTheme.primary,
  },
  reactionButtonDownActive: {
    borderColor: AppTheme.danger,
    backgroundColor: AppTheme.danger,
  },
  reactionButtonPressed: {
    opacity: 0.78,
  },
  reactionCount: {
    color: AppTheme.textSoft,
    fontSize: 13,
    fontWeight: '900',
  },
  reactionCountActive: {
    color: AppTheme.surface,
  },
  mealPhoto: {
    width: '100%',
    height: 156,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: AppTheme.grid,
  },
  loadingCard: {
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 24,
  },
  loadingText: {
    color: AppTheme.textMuted,
    fontSize: 15,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: AppTheme.dangerBorder,
    borderRadius: 8,
    backgroundColor: AppTheme.dangerSoft,
    padding: 14,
  },
  errorText: {
    color: AppTheme.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    gap: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 20,
  },
  emptyTitle: {
    color: AppTheme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: AppTheme.textMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  formHeader: {
    gap: 8,
  },
  formCard: {
    gap: 16,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 20,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  profileSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surfaceAlt,
    padding: 12,
  },
  profileAvatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 12,
    backgroundColor: AppTheme.primarySoft,
  },
  profileAvatarText: {
    color: AppTheme.primary,
    fontSize: 18,
    fontWeight: '900',
  },
  profileSummaryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileName: {
    color: AppTheme.text,
    fontSize: 16,
    fontWeight: '900',
  },
  profileEmail: {
    color: AppTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  inlineButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 10,
    backgroundColor: AppTheme.primarySoft,
    paddingHorizontal: 12,
  },
  inlineButtonPressed: {
    backgroundColor: AppTheme.primarySoftPressed,
  },
  inlineButtonText: {
    color: AppTheme.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  chartCard: {
    gap: 16,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 18,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  chartTitle: {
    color: AppTheme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  chartSubtitle: {
    marginTop: 2,
    color: AppTheme.textMuted,
    fontSize: 14,
  },
  chartBadge: {
    borderRadius: 999,
    backgroundColor: AppTheme.successSoft,
    borderWidth: 1,
    borderColor: AppTheme.successBorder,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chartBadgeText: {
    color: AppTheme.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  rangeSelector: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 10,
    backgroundColor: AppTheme.primarySoft,
    padding: 4,
  },
  rangeButton: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  rangeButtonActive: {
    backgroundColor: AppTheme.primary,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 2,
  },
  rangeButtonPressed: {
    opacity: 0.75,
  },
  rangeButtonText: {
    color: AppTheme.textSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  rangeButtonTextActive: {
    color: AppTheme.surface,
  },
  chartArea: {
    flexDirection: 'row',
    gap: 8,
  },
  yAxis: {
    width: 46,
    height: 160,
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  yAxisLabel: {
    color: AppTheme.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'right',
  },
  chartCanvas: {
    flex: 1,
    height: 160,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surfaceAlt,
  },
  chartGridLine: {
    position: 'absolute',
    right: 14,
    left: 14,
    height: 1,
    backgroundColor: AppTheme.grid,
  },
  chartLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    backgroundColor: AppTheme.primary,
  },
  chartDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderWidth: 2,
    borderColor: AppTheme.surface,
    borderRadius: 999,
    backgroundColor: AppTheme.primary,
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  chartFooterText: {
    color: AppTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  chartTrend: {
    marginTop: 10,
    color: AppTheme.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  chartEmpty: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surfaceAlt,
    padding: 22,
  },
  field: {
    gap: 8,
  },
  label: {
    color: AppTheme.textSoft,
    fontSize: 14,
    fontWeight: '900',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 10,
    backgroundColor: AppTheme.surfaceAlt,
    color: AppTheme.text,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  helperText: {
    color: AppTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 10,
  },
  photoActionButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 10,
    backgroundColor: AppTheme.primarySoft,
  },
  photoActionButtonPressed: {
    opacity: 0.75,
  },
  photoActionButtonText: {
    color: AppTheme.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  photoPreview: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surfaceAlt,
  },
  photoPreviewImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: AppTheme.grid,
  },
  removePhotoButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: AppTheme.border,
    backgroundColor: AppTheme.surface,
  },
  removePhotoButtonPressed: {
    backgroundColor: AppTheme.dangerSoft,
  },
  removePhotoButtonText: {
    color: AppTheme.danger,
    fontSize: 14,
    fontWeight: '900',
  },
  photoPlaceholder: {
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: AppTheme.primaryBorder,
    borderRadius: 8,
    backgroundColor: AppTheme.surfaceAlt,
  },
  photoPlaceholderText: {
    color: AppTheme.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: AppTheme.primary,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: AppTheme.surface,
    fontSize: 16,
    fontWeight: '900',
  },
  signOutButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 10,
    backgroundColor: AppTheme.surface,
  },
  signOutButtonPressed: {
    backgroundColor: AppTheme.primarySoft,
  },
  signOutButtonText: {
    color: AppTheme.primary,
    fontSize: 16,
    fontWeight: '900',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 32, 22, 0.42)',
    padding: 24,
  },
  notificationModal: {
    width: '100%',
    maxWidth: 420,
    gap: 16,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 22,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 10,
  },
  modalIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 14,
    backgroundColor: AppTheme.primarySoft,
  },
  modalTitle: {
    color: AppTheme.text,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
  },
  modalText: {
    color: AppTheme.textSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  modalSecondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 10,
    backgroundColor: AppTheme.surface,
  },
  modalSecondaryButtonPressed: {
    backgroundColor: AppTheme.surfaceAlt,
  },
  modalSecondaryButtonText: {
    color: AppTheme.textSoft,
    fontSize: 15,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  bottomBar: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    left: 16,
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 18,
    backgroundColor: AppTheme.surface,
    padding: 8,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: AppTheme.primarySoft,
  },
  tabButtonPressed: {
    opacity: 0.75,
  },
  tabButtonText: {
    color: AppTheme.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  tabButtonTextActive: {
    color: AppTheme.primary,
  },
});

function WeightChart({ weights }: { weights: WeightRow[] }) {
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedRange, setSelectedRange] = useState<WeightRangeKey>('month');
  const chartHeight = 160;
  const padding = 22;
  const selectedRangeOption = WEIGHT_RANGES.find((range) => range.key === selectedRange);
  const cutoffDate = selectedRangeOption?.days
    ? new Date(Date.now() - selectedRangeOption.days * 24 * 60 * 60 * 1000)
    : null;
  const points = weights
    .filter((weightEntry) => {
      if (!cutoffDate) {
        return true;
      }

      return new Date(weightEntry.created_at).getTime() >= cutoffDate.getTime();
    })
    .map<ChartPoint>((weightEntry) => ({
      id: weightEntry.id,
      weight: weightEntry.weight,
      createdAt: weightEntry.created_at,
    }));
  const weightsOnly = points.map((point) => point.weight);
  const minWeight = weightsOnly.length ? Math.min(...weightsOnly) : 0;
  const maxWeight = weightsOnly.length ? Math.max(...weightsOnly) : 0;
  const yAxisMin = weightsOnly.length ? Math.floor(minWeight - 1) : 0;
  const yAxisMax = weightsOnly.length ? Math.ceil(maxWeight + 1) : 0;
  const range = Math.max(yAxisMax - yAxisMin, 1);
  const latestWeight = points.at(-1);
  const previousWeight = points.at(-2);
  const trend =
    latestWeight && previousWeight
      ? Number((latestWeight.weight - previousWeight.weight).toFixed(1))
      : null;

  const chartPoints =
    chartWidth > 0
      ? points.map((point, index) => {
          const usableWidth = Math.max(chartWidth - padding * 2, 1);
          const usableHeight = chartHeight - padding * 2;
          const x =
            padding +
            (points.length === 1 ? usableWidth / 2 : (index / (points.length - 1)) * usableWidth);
          const y = padding + ((yAxisMax - point.weight) / range) * usableHeight;

          return { ...point, x, y };
        })
      : [];

  const handleChartLayout = (event: LayoutChangeEvent) => {
    setChartWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartTitle}>Courbe du poids</Text>
          <Text style={styles.chartSubtitle}>
            {points.length} mesure{points.length > 1 ? 's' : ''} sur la période
          </Text>
        </View>
        <View style={styles.chartBadge}>
          <Text style={styles.chartBadgeText}>
            {latestWeight ? `${latestWeight.weight} kg` : '-- kg'}
          </Text>
        </View>
      </View>

      <View style={styles.rangeSelector}>
        {WEIGHT_RANGES.map((range) => {
          const isActive = selectedRange === range.key;

          return (
            <Pressable
              key={range.key}
              onPress={() => setSelectedRange(range.key)}
              style={({ pressed }) => [
                styles.rangeButton,
                isActive && styles.rangeButtonActive,
                pressed && styles.rangeButtonPressed,
              ]}>
              <Text style={[styles.rangeButtonText, isActive && styles.rangeButtonTextActive]}>
                {range.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {points.length > 0 ? (
        <View>
          <View style={styles.chartArea}>
            <View style={styles.yAxis}>
              <Text style={styles.yAxisLabel}>{yAxisMax} kg</Text>
              <Text style={styles.yAxisLabel}>{Math.round((yAxisMax + yAxisMin) / 2)} kg</Text>
              <Text style={styles.yAxisLabel}>{yAxisMin} kg</Text>
            </View>

            <View style={styles.chartCanvas} onLayout={handleChartLayout}>
              <View style={[styles.chartGridLine, { top: padding }]} />
              <View style={[styles.chartGridLine, { top: chartHeight / 2 }]} />
              <View style={[styles.chartGridLine, { bottom: padding }]} />

              {chartPoints.map((point, index) => {
                const nextPoint = chartPoints[index + 1];

                if (!nextPoint) {
                  return null;
                }

                const dx = nextPoint.x - point.x;
                const dy = nextPoint.y - point.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);

                return (
                  <View
                    key={`${point.id}-${nextPoint.id}`}
                    style={[
                      styles.chartLine,
                      {
                        left: point.x + dx / 2 - length / 2,
                        top: point.y + dy / 2 - 2,
                        width: length,
                        transform: [{ rotateZ: `${angle}rad` }],
                      },
                    ]}
                  />
                );
              })}

              {chartPoints.map((point) => (
                <View
                  key={point.id}
                  style={[
                    styles.chartDot,
                    {
                      left: point.x - 6,
                      top: point.y - 6,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.chartFooter}>
            <Text style={styles.chartFooterText}>{formatDate(points[0]?.createdAt)}</Text>
            <Text style={styles.chartFooterText}>{formatDate(latestWeight?.createdAt)}</Text>
          </View>

          <Text style={styles.chartTrend}>
            {trend === null
              ? 'Ajoute une deuxième mesure pour voir la tendance.'
              : trend === 0
                ? 'Stable depuis la dernière mesure.'
                : `${trend > 0 ? '+' : ''}${trend} kg depuis la dernière mesure.`}
          </Text>
        </View>
      ) : (
        <View style={styles.chartEmpty}>
          <MaterialCommunityIcons name="chart-line" size={30} color={AppTheme.textMuted} />
          <Text style={styles.emptyTitle}>Pas encore de courbe</Text>
          <Text style={styles.emptyText}>
            Ajoute ton premier poids pour commencer ton suivi.
          </Text>
        </View>
      )}
    </View>
  );
}

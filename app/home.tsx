import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/src/lib/supabase';

type HomeProps = {
  session?: Session | null;
};

type TabKey = 'home' | 'meal' | 'weight';
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type SavingAction = 'meal' | 'weight' | null;
type WeightRangeKey = 'week' | 'month' | 'year' | 'all';

type ProfileRow = {
  user_id: string;
  email: string | null;
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

type UserSummary = {
  userId: string;
  email: string;
  latestMeal: MealRow | null;
  latestWeight: WeightRow | null;
  lastActivityAt: string | null;
  isCurrentUser: boolean;
};

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
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [weightHistory, setWeightHistory] = useState<WeightRow[]>([]);
  const [mealName, setMealName] = useState('');
  const [mealCalories, setMealCalories] = useState('');
  const [mealProteins, setMealProteins] = useState('');
  const [mealPhoto, setMealPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [weight, setWeight] = useState('');

  const userId = session?.user.id;
  const email = session?.user.email ?? 'utilisateur';
  const isSavingMeal = savingAction === 'meal';
  const isSavingWeight = savingAction === 'weight';

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
    []
  );

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

  const loadDashboard = useCallback(async () => {
    if (!userId) {
      setIsDashboardLoading(false);
      return;
    }

    console.log('Chargement des dernières informations de tous les utilisateurs');
    setIsDashboardLoading(true);
    setDashboardError(null);

    try {
      const [profilesResult, mealsResult, weightsResult] = await Promise.all([
        supabase.from('profiles').select('user_id,email,updated_at').order('email'),
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

      const profileRows = (profilesResult.data ?? []) as ProfileRow[];
      const mealRows = (mealsResult.data ?? []) as MealRow[];
      const weightRows = (weightsResult.data ?? []) as WeightRow[];
      const currentUserWeights = weightRows
        .filter((weightEntry) => weightEntry.user_id === userId)
        .sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      const summaries = new Map<string, UserSummary>();

      const ensureUser = (id: string, fallbackEmail?: string | null) => {
        const existing = summaries.get(id);

        if (existing) {
          if (fallbackEmail && existing.email === 'Utilisateur') {
            existing.email = fallbackEmail;
          }

          return existing;
        }

        const summary: UserSummary = {
          userId: id,
          email: fallbackEmail ?? 'Utilisateur',
          latestMeal: null,
          latestWeight: null,
          lastActivityAt: null,
          isCurrentUser: id === userId,
        };

        summaries.set(id, summary);
        return summary;
      };

      ensureUser(userId, email);

      profileRows.forEach((profile) => {
        const summary = ensureUser(profile.user_id, profile.email);
        summary.email = profile.email ?? summary.email;
      });

      mealRows.forEach((meal) => {
        const summary = ensureUser(meal.user_id, meal.user_email);

        if (!summary.latestMeal) {
          summary.latestMeal = meal;
        }

        if (
          !summary.lastActivityAt ||
          new Date(meal.created_at).getTime() > new Date(summary.lastActivityAt).getTime()
        ) {
          summary.lastActivityAt = meal.created_at;
        }
      });

      weightRows.forEach((weightEntry) => {
        const summary = ensureUser(weightEntry.user_id, weightEntry.user_email);

        if (!summary.latestWeight) {
          summary.latestWeight = weightEntry;
        }

        if (
          !summary.lastActivityAt ||
          new Date(weightEntry.created_at).getTime() >
            new Date(summary.lastActivityAt).getTime()
        ) {
          summary.lastActivityAt = weightEntry.created_at;
        }
      });

      await Promise.all(
        Array.from(summaries.values()).map(async (summary) => {
          if (!summary.latestMeal?.photo_path) {
            return;
          }

          summary.latestMeal.photo_url = await createSignedMealPhotoUrl(
            summary.latestMeal.photo_path
          );
        })
      );

      const nextUsers = Array.from(summaries.values()).sort((a, b) => {
        const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;

        if (aTime !== bTime) {
          return bTime - aTime;
        }

        if (a.isCurrentUser !== b.isCurrentUser) {
          return a.isCurrentUser ? -1 : 1;
        }

        return a.email.localeCompare(b.email);
      });

      console.log('Dashboard utilisateurs chargé', { count: nextUsers.length });
      setUsers(nextUsers);
      setWeightHistory(currentUserWeights);
    } catch (error) {
      const message = getErrorMessage(error);

      console.log('Erreur chargement dashboard Supabase', error);
      setDashboardError(
        `${message}. Si les tables n'existent pas encore, exécute le fichier supabase/schema.sql dans Supabase.`
      );
    } finally {
      setIsDashboardLoading(false);
    }
  }, [email, userId]);

  useEffect(() => {
    void ensureCurrentProfile().then(loadDashboard);
  }, [ensureCurrentProfile, loadDashboard]);

  useEffect(() => {
    const channel = supabase
      .channel('suivi-repas-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void loadDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => {
        void loadDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, () => {
        void loadDashboard();
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

  const renderUserCard = (user: UserSummary) => (
    <View key={user.userId} style={styles.userCard}>
      <View style={styles.userHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.email.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.userTitle}>
          <Text style={styles.userEmail}>{user.email}</Text>
          <Text style={styles.userMeta}>
            {user.isCurrentUser ? 'Moi' : 'Membre'} - {formatDate(user.lastActivityAt)}
          </Text>
        </View>
      </View>

      <View style={styles.infoRows}>
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={21} color="#2563EB" />
          <View style={styles.infoText}>
            <Text style={styles.infoLabel}>Dernier repas</Text>
            <Text style={styles.infoValue}>
              {user.latestMeal
                ? `${user.latestMeal.name} - ${user.latestMeal.calories} kcal - ${user.latestMeal.proteins} g prot.`
                : 'Aucun repas'}
            </Text>
            {user.latestMeal?.photo_url ? (
              <Image
                source={{ uri: user.latestMeal.photo_url }}
                style={styles.mealPhoto}
                contentFit="cover"
              />
            ) : null}
          </View>
        </View>

        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="scale-bathroom" size={21} color="#16A34A" />
          <View style={styles.infoText}>
            <Text style={styles.infoLabel}>Dernier poids</Text>
            <Text style={styles.infoValue}>
              {user.latestWeight ? `${user.latestWeight.weight} kg` : 'Aucun poids'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderHomeTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.heroCard}>
        <Text style={styles.kicker}>Groupe</Text>
        <Text style={styles.title}>Accueil</Text>
        <Text style={styles.subtitle}>
          Les dernières informations de tous les utilisateurs apparaissent ici.
        </Text>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Derniers suivis</Text>
          <Text style={styles.sectionSubtitle}>{todayLabel}</Text>
        </View>
        <Pressable onPress={loadDashboard} style={styles.refreshButton}>
          <MaterialCommunityIcons name="refresh" size={20} color="#2563EB" />
        </Pressable>
      </View>

      {dashboardError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{dashboardError}</Text>
        </View>
      ) : null}

      {isDashboardLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.loadingText}>Chargement du groupe...</Text>
        </View>
      ) : (
        <View style={styles.usersList}>
          {users.length > 0 ? (
            users.map(renderUserCard)
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

      <Pressable
        disabled={isSigningOut}
        onPress={handleSignOut}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.signOutButtonPressed,
          isSigningOut && styles.buttonDisabled,
        ]}>
        {isSigningOut ? (
          <ActivityIndicator color="#2563EB" />
        ) : (
          <Text style={styles.signOutButtonText}>Se déconnecter</Text>
        )}
      </Pressable>
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
            placeholderTextColor="#8A96A8"
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
            placeholderTextColor="#8A96A8"
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
            placeholderTextColor="#8A96A8"
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
              <MaterialCommunityIcons name="camera-outline" size={19} color="#2563EB" />
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
              <MaterialCommunityIcons name="image-outline" size={19} color="#2563EB" />
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
                <MaterialCommunityIcons name="close" size={18} color="#B91C1C" />
                <Text style={styles.removePhotoButtonText}>Retirer</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <MaterialCommunityIcons name="image-plus" size={26} color="#94A3B8" />
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
            <ActivityIndicator color="#FFFFFF" />
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
            placeholderTextColor="#8A96A8"
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
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Ajouter le poids</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderActiveTab = () => {
    if (activeTab === 'meal') {
      return renderMealTab();
    }

    if (activeTab === 'weight') {
      return renderWeightTab();
    }

    return renderHomeTab();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
                  color={isActive ? '#2563EB' : '#64748B'}
                />
                <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F7FB',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 96,
  },
  tabContent: {
    flex: 1,
    gap: 18,
  },
  heroCard: {
    gap: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 22,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  kicker: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    color: '#15803D',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  title: {
    color: '#132033',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  subtitle: {
    color: '#5A6B7D',
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
    color: '#132033',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSubtitle: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 14,
  },
  refreshButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
  },
  usersList: {
    gap: 14,
  },
  userCard: {
    gap: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#DBEAFE',
  },
  avatarText: {
    color: '#1D4ED8',
    fontSize: 18,
    fontWeight: '900',
  },
  userTitle: {
    flex: 1,
    gap: 2,
  },
  userEmail: {
    color: '#132033',
    fontSize: 16,
    fontWeight: '800',
  },
  userMeta: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  infoRows: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    padding: 12,
  },
  infoText: {
    flex: 1,
    gap: 2,
  },
  infoLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '800',
  },
  infoValue: {
    color: '#1E293B',
    fontSize: 15,
    lineHeight: 21,
  },
  mealPhoto: {
    width: '100%',
    height: 156,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
  },
  loadingCard: {
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 15,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    padding: 14,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  emptyTitle: {
    color: '#132033',
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 21,
  },
  formHeader: {
    gap: 8,
  },
  formCard: {
    gap: 16,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  chartCard: {
    gap: 16,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  chartTitle: {
    color: '#132033',
    fontSize: 18,
    fontWeight: '800',
  },
  chartSubtitle: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 14,
  },
  chartBadge: {
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chartBadgeText: {
    color: '#15803D',
    fontSize: 14,
    fontWeight: '900',
  },
  rangeSelector: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    padding: 4,
  },
  rangeButton: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  rangeButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  rangeButtonPressed: {
    opacity: 0.75,
  },
  rangeButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  rangeButtonTextActive: {
    color: '#2563EB',
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
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
  },
  chartCanvas: {
    flex: 1,
    height: 160,
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  chartGridLine: {
    position: 'absolute',
    right: 14,
    left: 14,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  chartLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  chartDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  chartFooterText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  chartTrend: {
    marginTop: 10,
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  chartEmpty: {
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    padding: 22,
  },
  field: {
    gap: 8,
  },
  label: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    color: '#132033',
    fontSize: 16,
    paddingHorizontal: 16,
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
    borderColor: '#BFDBFE',
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
  },
  photoActionButtonPressed: {
    opacity: 0.75,
  },
  photoActionButtonText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '800',
  },
  photoPreview: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  photoPreviewImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#E2E8F0',
  },
  removePhotoButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  removePhotoButtonPressed: {
    backgroundColor: '#FEF2F2',
  },
  removePhotoButtonText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '800',
  },
  photoPlaceholder: {
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  photoPlaceholderText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#2563EB',
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  signOutButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  signOutButtonPressed: {
    backgroundColor: '#EFF6FF',
  },
  signOutButtonText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '800',
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
    borderColor: '#E2E8F0',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    padding: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 16,
  },
  tabButtonActive: {
    backgroundColor: '#EFF6FF',
  },
  tabButtonPressed: {
    opacity: 0.75,
  },
  tabButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  tabButtonTextActive: {
    color: '#2563EB',
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
          <MaterialCommunityIcons name="chart-line" size={30} color="#94A3B8" />
          <Text style={styles.emptyTitle}>Pas encore de courbe</Text>
          <Text style={styles.emptyText}>
            Ajoute ton premier poids pour commencer ton suivi.
          </Text>
        </View>
      )}
    </View>
  );
}

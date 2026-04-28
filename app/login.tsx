import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppTheme } from '@/constants/theme';
import { supabase } from '@/src/lib/supabase';

type LoadingAction = 'signIn' | 'signUp' | null;
type FeedbackType = 'info' | 'success' | 'error';

type Feedback = {
  message: string;
  type: FeedbackType;
};

type LoginProps = {
  onAuthSuccess?: (session: Session) => void;
};

export default function Login({ onAuthSuccess }: LoginProps) {
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const trimmedEmail = email.trim();
  const isLoading = loadingAction !== null;
  const isSignUpMode = authMode === 'signUp';
  const isSignInLoading = loadingAction === 'signIn';
  const isSignUpLoading = loadingAction === 'signUp';

  const showError = (title: string, message: string) => {
    console.log("Erreur affichée à l'utilisateur", { title, message });
    setFeedback({ type: 'error', message });
    Alert.alert(title, message);
  };

  const validateForm = (action: Exclude<LoadingAction, null>) => {
    if (!trimmedEmail || !password) {
      showError('Champs manquants', 'Saisis ton email et ton mot de passe.');
      return false;
    }

    if (action === 'signUp' && password.length < 6) {
      showError(
        'Mot de passe trop court',
        'Choisis un mot de passe de 6 caractères minimum.'
      );
      return false;
    }

    if (action === 'signUp' && password !== confirmPassword) {
      showError('Confirmation incorrecte', 'Les deux mots de passe doivent être identiques.');
      return false;
    }

    return true;
  };

  const openSignUp = () => {
    setAuthMode('signUp');
    setPassword('');
    setConfirmPassword('');
    setFeedback(null);
  };

  const openSignIn = () => {
    setAuthMode('signIn');
    setConfirmPassword('');
    setFeedback(null);
  };

  const handleSignIn = async () => {
    console.log('Tentative de connexion', { email: trimmedEmail });
    setFeedback(null);

    if (!validateForm('signIn')) {
      return;
    }

    setLoadingAction('signIn');
    setFeedback({ type: 'info', message: 'Connexion en cours...' });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        console.log('Erreur Supabase signInWithPassword', error);
        showError('Connexion impossible', error.message);
        return;
      }

      console.log('Connexion réussie', {
        email: data.user?.email,
        userId: data.user?.id,
        hasSession: Boolean(data.session),
      });

      setFeedback({ type: 'success', message: 'Connexion réussie.' });

      if (data.session) {
        onAuthSuccess?.(data.session);
      } else {
        Alert.alert('Connexion réussie', 'Session en cours de récupération...');
      }
    } catch (error) {
      console.log('Erreur inattendue pendant la connexion', error);
      showError('Connexion impossible', 'Une erreur inattendue est survenue.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSignUp = async () => {
    console.log("Tentative d'inscription", { email: trimmedEmail });
    setFeedback(null);

    if (!validateForm('signUp')) {
      return;
    }

    setLoadingAction('signUp');
    setFeedback({ type: 'info', message: 'Création du compte en cours...' });

    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) {
        console.log('Erreur Supabase signUp', error);
        showError('Inscription impossible', error.message);
        return;
      }

      console.log('Inscription réussie', {
        email: data.user?.email,
        userId: data.user?.id,
        hasSession: Boolean(data.session),
      });

      if (data.session) {
        setFeedback({ type: 'success', message: 'Compte créé, connexion réussie.' });
        onAuthSuccess?.(data.session);
        return;
      }

      const message =
        'Compte créé. Si Supabase demande une confirmation email, confirme ton adresse puis connecte-toi.';

      setFeedback({ type: 'success', message });
      Alert.alert('Compte créé', message);
      openSignIn();
    } catch (error) {
      console.log("Erreur inattendue pendant l'inscription", error);
      showError('Inscription impossible', 'Une erreur inattendue est survenue.');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.brandMark}>
              <MaterialCommunityIcons
                name={isSignUpMode ? 'account-plus-outline' : 'silverware-fork-knife'}
                size={28}
                color={AppTheme.primary}
              />
            </View>
            <Text style={styles.title}>{isSignUpMode ? 'Créer un compte' : 'Suivi Repas'}</Text>
            <Text style={styles.subtitle}>
              {isSignUpMode
                ? 'Renseigne tes informations pour rejoindre le suivi du groupe.'
                : 'Connecte-toi pour suivre tes repas et ton poids.'}
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!isLoading}
                keyboardType="email-address"
                placeholder="email@exemple.com"
                placeholderTextColor={AppTheme.placeholder}
                returnKeyType="next"
                style={styles.input}
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Mot de passe</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                editable={!isLoading}
                onSubmitEditing={isSignUpMode ? undefined : handleSignIn}
                placeholder="Mot de passe"
                placeholderTextColor={AppTheme.placeholder}
                returnKeyType={isSignUpMode ? 'next' : 'done'}
                secureTextEntry
                style={styles.input}
                textContentType={isSignUpMode ? 'newPassword' : 'password'}
              />
            </View>

            {isSignUpMode ? (
              <View style={styles.field}>
                <Text style={styles.label}>Confirmer le mot de passe</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect={false}
                  editable={!isLoading}
                  onSubmitEditing={handleSignUp}
                  placeholder="Confirme ton mot de passe"
                  placeholderTextColor={AppTheme.placeholder}
                  returnKeyType="done"
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                />
              </View>
            ) : null}
          </View>

          {feedback ? (
            <View style={[styles.feedback, styles[`${feedback.type}Feedback`]]}>
              <Text style={[styles.feedbackText, styles[`${feedback.type}FeedbackText`]]}>
                {feedback.message}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {isSignUpMode ? (
              <>
                <Pressable
                  disabled={isLoading}
                  onPress={handleSignUp}
                  style={({ pressed }) => [
                    styles.button,
                    styles.primaryButton,
                    (pressed || isSignUpLoading) && styles.primaryButtonPressed,
                    isLoading && !isSignUpLoading && styles.buttonDisabled,
                  ]}>
                  {isSignUpLoading ? (
                    <ActivityIndicator color={AppTheme.surface} />
                  ) : (
                    <>
                      <MaterialCommunityIcons
                        name="account-plus-outline"
                        size={19}
                        color={AppTheme.surface}
                      />
                      <Text style={styles.primaryButtonText}>Créer le compte</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  disabled={isLoading}
                  onPress={openSignIn}
                  style={({ pressed }) => [
                    styles.button,
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                    isLoading && styles.buttonDisabled,
                  ]}>
                  <MaterialCommunityIcons name="arrow-left" size={19} color={AppTheme.primary} />
                  <Text style={styles.secondaryButtonText}>Déjà un compte</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  disabled={isLoading}
                  onPress={handleSignIn}
                  style={({ pressed }) => [
                    styles.button,
                    styles.primaryButton,
                    (pressed || isSignInLoading) && styles.primaryButtonPressed,
                    isLoading && !isSignInLoading && styles.buttonDisabled,
                  ]}>
                  {isSignInLoading ? (
                    <ActivityIndicator color={AppTheme.surface} />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="login" size={19} color={AppTheme.surface} />
                      <Text style={styles.primaryButtonText}>Se connecter</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  disabled={isLoading}
                  onPress={openSignUp}
                  style={({ pressed }) => [
                    styles.button,
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                    isLoading && styles.buttonDisabled,
                  ]}>
                  <MaterialCommunityIcons
                    name="account-plus-outline"
                    size={19}
                    color={AppTheme.primary}
                  />
                  <Text style={styles.secondaryButtonText}>Créer un compte</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    gap: 22,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 8,
    backgroundColor: AppTheme.surface,
    padding: 24,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 5,
  },
  header: {
    gap: 10,
  },
  brandMark: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    borderRadius: 14,
    backgroundColor: AppTheme.primarySoft,
  },
  title: {
    color: AppTheme.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 40,
  },
  subtitle: {
    color: AppTheme.textSoft,
    fontSize: 16,
    lineHeight: 23,
  },
  form: {
    gap: 16,
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
  feedback: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  infoFeedback: {
    borderColor: AppTheme.primaryBorder,
    backgroundColor: AppTheme.primarySoft,
  },
  successFeedback: {
    borderColor: AppTheme.successBorder,
    backgroundColor: AppTheme.successSoft,
  },
  errorFeedback: {
    borderColor: AppTheme.dangerBorder,
    backgroundColor: AppTheme.dangerSoft,
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 20,
  },
  infoFeedbackText: {
    color: AppTheme.primary,
  },
  successFeedbackText: {
    color: AppTheme.success,
  },
  errorFeedbackText: {
    color: AppTheme.danger,
  },
  actions: {
    gap: 12,
  },
  button: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
  },
  primaryButton: {
    backgroundColor: AppTheme.primary,
    shadowColor: AppTheme.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.13,
    shadowRadius: 12,
    elevation: 3,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: AppTheme.primaryBorder,
    backgroundColor: AppTheme.surface,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  secondaryButtonPressed: {
    backgroundColor: AppTheme.primarySoftPressed,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: AppTheme.surface,
    fontSize: 16,
    fontWeight: '900',
  },
  secondaryButtonText: {
    color: AppTheme.primary,
    fontSize: 16,
    fontWeight: '900',
  },
});

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const trimmedEmail = email.trim();
  const isLoading = loadingAction !== null;
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

    return true;
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
            <Text style={styles.title}>Suivi Repas</Text>
            <Text style={styles.subtitle}>
              Connecte-toi pour suivre tes repas et ton poids
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
                placeholderTextColor="#8A96A8"
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
                onSubmitEditing={handleSignIn}
                placeholder="Mot de passe"
                placeholderTextColor="#8A96A8"
                returnKeyType="done"
                secureTextEntry
                style={styles.input}
                textContentType="password"
              />
            </View>
          </View>

          {feedback ? (
            <View style={[styles.feedback, styles[`${feedback.type}Feedback`]]}>
              <Text style={[styles.feedbackText, styles[`${feedback.type}FeedbackText`]]}>
                {feedback.message}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
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
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Se connecter</Text>
              )}
            </Pressable>

            <Pressable
              disabled={isLoading}
              onPress={handleSignUp}
              style={({ pressed }) => [
                styles.button,
                styles.secondaryButton,
                (pressed || isSignUpLoading) && styles.secondaryButtonPressed,
                isLoading && !isSignUpLoading && styles.buttonDisabled,
              ]}>
              {isSignUpLoading ? (
                <ActivityIndicator color="#2563EB" />
              ) : (
                <Text style={styles.secondaryButtonText}>Créer un compte</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F7FB',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    gap: 22,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 24,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 5,
  },
  header: {
    gap: 8,
  },
  title: {
    color: '#132033',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
  },
  subtitle: {
    color: '#5A6B7D',
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
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
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
  feedback: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  infoFeedback: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  successFeedback: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  errorFeedback: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 20,
  },
  infoFeedbackText: {
    color: '#1D4ED8',
  },
  successFeedbackText: {
    color: '#15803D',
  },
  errorFeedbackText: {
    color: '#B91C1C',
  },
  actions: {
    gap: 12,
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  primaryButton: {
    backgroundColor: '#2563EB',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#2563EB',
    backgroundColor: '#FFFFFF',
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  secondaryButtonPressed: {
    backgroundColor: '#EFF6FF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '800',
  },
});

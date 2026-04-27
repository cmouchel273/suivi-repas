import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { supabase } from '@/src/lib/supabase';

import Home from '../home';
import Login from '../login';

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      console.log('Verification de la session Supabase');
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.log('Erreur Supabase getSession', error);
      }

      if (isMounted) {
        setSession(data.session);
        setIsCheckingSession(false);
      }
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.log('Changement etat auth Supabase', {
        event,
        email: nextSession?.user.email,
        hasSession: Boolean(nextSession),
      });

      if (isMounted) {
        setSession(nextSession);
        setIsCheckingSession(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (isCheckingSession) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={AppTheme.primary} size="large" />
      </View>
    );
  }

  if (session) {
    return <Home session={session} />;
  }

  return <Login onAuthSuccess={setSession} />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppTheme.background,
  },
});

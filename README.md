# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## PWA

Pour générer la Progressive Web App, lance :

```bash
npm run build:web
```

Le build statique est généré dans le dossier **dist**. Déploie ce dossier sur un hébergement HTTPS pour que l'installation PWA et le service worker fonctionnent correctement.

### Notifications PWA

Les notifications PWA utilisent le Web Push du navigateur, pas `expo-notifications`. Pour activer les rappels quand la PWA est fermée :

1. Applique `supabase/schema.sql` ou la migration `supabase/migrations/20260428_add_web_push_notifications.sql`.
2. Déploie la fonction :

   ```bash
   supabase functions deploy send-reminders --no-verify-jwt
   ```

3. Ajoute les secrets Supabase avec les valeurs de ton `.env` local :

   ```bash
   supabase secrets set WEB_PUSH_VAPID_PUBLIC_KEY=... WEB_PUSH_VAPID_PRIVATE_KEY=... WEB_PUSH_SUBJECT=mailto:contact@suivi-repas.app REMINDER_FUNCTION_SECRET=...
   ```

4. Appelle `send-reminders` toutes les 5 minutes avec un cron Supabase (`supabase/web_push_cron.sql`) ou un cron externe :

   ```bash
   curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-reminders" \
     -H "Authorization: Bearer <REMINDER_FUNCTION_SECRET>" \
     -H "Content-Type: application/json" \
     -d "{}"
   ```

Pour tester tout de suite sans attendre l'heure d'un rappel, envoie `{"force":true}` dans le body.

Sur iOS, les Web Push fonctionnent pour une PWA installée sur l'écran d'accueil.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

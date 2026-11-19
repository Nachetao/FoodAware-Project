import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cl.foodaware.app',
  appName: 'FoodAware',
  // Build de producción. La URL del backend se fija al compilar:
  // npm run android:sync usa la de staging (scripts/android.js).
  webDir: 'www',
  server: {
    // Es el valor por defecto; explícito porque define el origen de la app,
    // https://localhost, que el backend debe aceptar en CORS_ORIGINS.
    androidScheme: 'https',
  },
  android: {
    // La app solo habla con el backend por HTTPS.
    allowMixedContent: false,
  },
};

export default config;

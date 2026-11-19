// App de Android (Capacitor) apuntando al backend de staging.
//
//   npm run android:sync   compila en producción y copia la app a android/
//   npm run android:apk    lo anterior y compila el APK de depuración
//
// API_URL cambia el backend (por defecto, el de staging). Necesita JAVA_HOME
// con el JDK 21 y ANDROID_HOME con el SDK de Android (o android/local.properties).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const STAGING = 'https://foodaware-staging-backend.onrender.com';
const RAIZ = path.join(__dirname, '..');
const ANDROID = path.join(RAIZ, 'android');
const APK = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

const accion = process.argv[2];
if (accion !== 'sync' && accion !== 'apk') {
  console.error('Uso: node scripts/android.js <sync|apk>');
  process.exit(2);
}

function ejecutar(comando, argumentos, opciones = {}) {
  const { status } = spawnSync(comando, argumentos, { cwd: RAIZ, stdio: 'inherit', ...opciones });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

function binario(paquete, relativo) {
  return path.join(path.dirname(require.resolve(`${paquete}/package.json`, { paths: [RAIZ] })), relativo);
}

if (!fs.existsSync(ANDROID)) {
  console.error('No existe frontend/android: ejecuta primero "npx cap add android".');
  process.exit(1);
}

// 1. Build de producción con la URL del backend (el service worker no se
//    registra en Android: app.module.ts lo desactiva en plataforma nativa).
const entorno = { ...process.env, API_URL: (process.env.API_URL || '').trim() || STAGING };
ejecutar(process.execPath, [path.join(__dirname, 'generar-api-url.js')], { env: entorno });
ejecutar(process.execPath, [binario('@angular/cli', 'bin/ng.js'), 'build', '--configuration', 'production'], {
  env: entorno,
});

// 2. Copia www/ y los plugins al proyecto nativo.
ejecutar(process.execPath, [binario('@capacitor/cli', 'bin/capacitor'), 'sync', 'android']);

if (accion === 'apk') {
  const faltan = [];
  if (!process.env.JAVA_HOME) {
    faltan.push('JAVA_HOME (JDK 21)');
  }
  if (!process.env.ANDROID_HOME && !fs.existsSync(path.join(ANDROID, 'local.properties'))) {
    faltan.push('ANDROID_HOME (SDK de Android) o android/local.properties');
  }
  if (faltan.length > 0) {
    console.error(`Falta definir: ${faltan.join(' y ')}.`);
    process.exit(1);
  }

  // 3. APK de depuración (firmado con la clave de depuración local).
  // Lo mismo que hace gradlew(.bat), pero sin shell: el java de JAVA_HOME
  // ejecuta el wrapper de Gradle con argumentos separados, así ninguna ruta
  // (con espacios, &, %...) pasa por cmd ni por sh.
  const java = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  ejecutar(
    java,
    [
      '-Xmx64m',
      '-Xms64m',
      '-Dorg.gradle.appname=gradlew',
      '-classpath',
      path.join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
      'org.gradle.wrapper.GradleWrapperMain',
      'assembleDebug',
    ],
    { cwd: ANDROID },
  );

  const megas = (fs.statSync(APK).size / 1024 / 1024).toFixed(1);
  console.log(`\nAPK de depuración (${megas} MB): ${path.relative(RAIZ, APK)}`);
  console.log(`Backend: ${entorno.API_URL}`);
}

# 📱 Guía de Instalación en iPhone y iPad (iOS / iPadOS) — StreamFlow IPTV

StreamFlow IPTV ofrece una **estrategia dual** para disfrutar de la mejor experiencia en iPhone y iPad:

---

## 🚀 Método 1: PWA Instantánea desde Safari (Sin Ordenador ni Instaladores)
*Tiempo estimado: 30 segundos. No caduca nunca y funciona a pantalla completa.*

1. **Abre Safari** en tu iPhone o iPad.
2. Entra en la dirección de la app:
   - **En la nube (Producción Vercel):** [https://streamflow-iptv-eta.vercel.app](https://streamflow-iptv-eta.vercel.app)
   - **En tu red Wi-Fi local:** `http://192.168.0.50:3000`
3. En la barra inferior de Safari (o superior en iPad), pulsa el botón **Compartir** (icono de cuadrado con una flecha hacia arriba ⎋).
4. Desplázate hacia abajo en el menú y selecciona **«Añadir a pantalla de inicio»** (o *Add to Home Screen*).
5. Pulsa **«Añadir»** arriba a la derecha.

> **¡Listo!** Se creará el icono de **StreamFlow** en tu pantalla de inicio. Al abrirlo, se iniciará como una **App Nativa independiente**, a pantalla completa, sin barras de navegación de Safari y con soporte adaptativo para el Notch y la Dynamic Island.

---

## 📦 Método 2: Instalación de la App Nativa (`.ipa`) con GitHub Actions
*Para empaquetar la app como aplicación nativa iOS de Capacitor con soporte de `CapacitorHttp` (bypass nativo total de CORS y Mixed Content).*

### Paso 1: Generar el archivo `.ipa` en GitHub Actions (En la nube, sin tener un Mac)
1. Entra en tu repositorio de GitHub: `https://github.com/daniesletido-cmyk/streamflow-iptv`.
2. Ve a la pestaña **Actions** en la parte superior.
3. En el menú lateral izquierdo, pulsa sobre **«Build iOS IPA (Capacitor)»**.
4. Haz clic en el botón desplegable **«Run workflow»** y luego pulsa el botón verde **«Run workflow»** (sobre la rama `master`).
5. GitHub iniciará un servidor macOS en la nube que compilará el proyecto Xcode y empaquetará el `.ipa`.
6. Al terminar (tarda unos 2-3 minutos), pulsa sobre la ejecución completada y descarga el archivo comprimido dentro de la sección **Artifacts**: **`StreamFlow-IPTV-ipa`** (que contiene `StreamFlow-IPTV.ipa`).

---

### Paso 2: Instalar el `.ipa` en tu iPhone / iPad desde Windows

#### Opción A: Usando Sideloadly (Recomendado en Windows)
1. Descarga e instala **[Sideloadly](https://sideloadly.io/)** en tu PC con Windows.
2. Asegúrate de tener iTunes (versión de Apple o Microsoft Store) instalado para los drivers de iPhone/iPad.
3. Conecta tu iPhone o iPad al PC mediante cable USB (confirma *"Confiar en este ordenador"* en la pantalla del dispositivo si te lo pide).
4. Abre Sideloadly:
   - Arrastra el archivo **`StreamFlow-IPTV.ipa`** a la ventana de Sideloadly.
   - Introduce tu Apple ID (correo) en el campo correspondiente.
   - Pulsa el botón **Start**.
5. Si es la primera vez, introduce la contraseña de tu Apple ID o el código de autenticación de doble factor (2FA).
6. Una vez completado (*Done!*), ve en tu iPhone/iPad a:
   - **Ajustes** → **General** → **Gestión de dispositivos y VPN**.
   - Pulsa sobre tu cuenta de Apple ID y selecciona **«Confiar en...»**.
7. *(Solo iOS 16 o posterior)*: Ve a **Ajustes** → **Privacidad y seguridad** → **Modo de desarrollo** y actívalo.

#### Opción B: Usando SideStore / AltStore (Directamente desde el dispositivo)
1. Si ya tienes **SideStore** o **AltStore** en tu iPhone/iPad:
2. Envía o descarga el archivo `StreamFlow-IPTV.ipa` en la app **Archivos** (*Files*) de tu dispositivo (vía iCloud Drive, Telegram, Google Drive, etc.).
3. Abre SideStore / AltStore, pulsa el botón **`+`** (Añadir aplicación) y selecciona `StreamFlow-IPTV.ipa`.
4. La app se firmará e instalará directamente en tu dispositivo sin necesidad de volver a conectar el cable.

---

## ⚙️ Características Técnicas de la App iOS
- **`CapacitorHttp` Activo:** Todas las llamadas a las APIs de Xtream Codes y la reproducción de listas M3U se ejecutan en la capa de red nativa de iOS (`NSURLSession`), eliminando restricciones de CORS o bloqueos de Mixed Content.
- **`NSAllowsArbitraryLoads: true`:** Soporte completo para canales IPTV que emitan sobre conexiones HTTP sin certificado TLS.
- **Audio en segundo plano:** Configurado con `UIBackgroundModes: audio` para permitir la continuidad de reproducción en modo multitarea y Picture-in-Picture (PiP).
- **Safe Area Adaptativo:** Respeto estricto de los bordes mediante `env(safe-area-inset-top)` y `env(safe-area-inset-bottom)` tanto en orientación vertical como horizontal.

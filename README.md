# 📺 StreamFlow IPTV

Una aplicación moderna y ligera inspirada en el hilo de **@sxvros**, diseñada para reproducir contenidos IPTV con proveedores **Xtream Codes** tanto en **PC** como en **iPhone y iPad (iOS)**.

---

## ✨ Características Principales

1. **Interfaz estilo Netflix / TiviMate:**
   - Tema oscuro moderno con tarjetas de canales, películas (VOD) y series con temporadas/capítulos.
   - Navegación por categorías con scroll horizontal fluido.
   - Buscador instantáneo de canales y sistema de **favoritos** y **recientes**.

2. **Compatibilidad total (PC e iOS):**
   - **PC (Windows/Mac/Linux):** Navegación completa con ratón o con **mando/teclado** (flechas arriba/abajo/izq/der, Enter, Espacio, Esc, F para pantalla completa, M para mute).
   - **iPhone y iPad (iOS):** Optimizado para Safari con soporte nativo de HLS por aceleración hardware, Picture-in-Picture (PiP), gestos táctiles (deslizar para cambiar de canal) y soporte PWA (*Añadir a pantalla de inicio* para usarla a pantalla completa como una app nativa).

3. **Arquitectura Robusta y Anti-bloqueos:**
   - **Proxy de streaming integrado:** Resuelve los bloqueos por CORS y Mixed Content (HTTP vs HTTPS) que suelen bloquear las emisiones IPTV en navegadores modernos e iOS.
   - **Watchdog Anti-congelamiento:** Monitoriza la reproducción y si el flujo se queda estancado más de 4 segundos, relanza y recupera la conexión automáticamente.
   - **Fallback Inteligente:** Prueba streams HLS (`.m3u8`) con alternativa a flujo directo (`.ts`).

---

## 🚀 Cómo Iniciar la Aplicación

### Opción 1: Con doble clic en Windows
Haz doble clic sobre el archivo `iniciar.bat`. Se abrirá la consola del servidor y tu navegador automáticamente en `http://localhost:3000`.

### Opción 2: Desde la terminal
```bash
npm start
```

---

## 📱 Cómo Conectar tu iPhone o iPad

1. Asegúrate de que tu iPhone/iPad esté conectado a la **misma red Wi-Fi** que tu PC.
2. Al iniciar el servidor, verás un mensaje con tu IP local, por ejemplo:
   ```
   💻 Acceso en este PC:        http://localhost:3000
   📱 Acceso en iPhone / iPad:  http://192.168.1.35:3000
   ```
3. Abre **Safari** en tu iPhone o iPad y escribe esa dirección (ejemplo: `http://192.168.1.35:3000`).
4. **Para tenerla como App nativa a pantalla completa:**
   - Pulsa el botón **Compartir** de Safari (icono de cuadrado con flecha hacia arriba).
   - Selecciona **"Añadir a pantalla de inicio"**.
   - ¡Listo! Se creará el icono de StreamFlow en tu pantalla de inicio y se abrirá sin barras de navegación del navegador.

---

## 🔑 Configurar tu Lista Xtream Code

1. Abre la aplicación y pulsa en el botón de perfil o en **"Configurar Lista Xtream Code"**.
2. Rellena los datos proporcionados por tu proveedor:
   - **Servidor / Host:** `http://servidor-iptv.com:8080`
   - **Usuario:** Tu usuario
   - **Contraseña:** Tu contraseña
3. Pulsa en **"Conectar Lista Xtream"**. La aplicación cargará tus canales en directo, películas y series automáticamente.
4. *Nota: También incluye un botón de "Modo Demo" para probar el reproductor al instante con emisiones en directo gratuitas.*

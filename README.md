# 🌅 InstaSunx v2 — Guía de instalación

App de reels en español para vos y tus amigos. Sin publicidad, sin algoritmos raros.
Videos reales de YouTube en español, chat en tiempo real, likes visibles entre amigos.

---

## Paso 1 — Configurar Supabase (base de datos)

Tus keys ya están en el código. Solo necesitás crear las tablas:

1. Ir a tu proyecto en **supabase.com**
2. Click en **SQL Editor** (ícono de terminal en el sidebar)
3. Click en **New query**
4. Copiar TODO el contenido de `supabase_setup.sql` y pegarlo
5. Click en **Run** (o Ctrl+Enter)
6. Debería decir "Success" en verde

---

## Paso 2 — Subir a Netlify

**Opción más fácil (drag & drop):**
1. Ir a **netlify.com** → iniciar sesión
2. En el dashboard, arrastrar la carpeta `instasunx2` completa
3. Netlify te da una URL tipo `https://algo-random.netlify.app`
4. Opcionalmente: Site settings → Change site name → ponerle `instasunx` o lo que quieras

**Opción con GitHub (mejor para actualizar después):**
1. Crear repo en github.com y subir los archivos
2. En Netlify → "Add new site" → "Import an existing project" → conectar GitHub
3. Cada push al repo = redeploy automático

---

## Paso 3 — Instalar en el celular (importante)

Una vez que tengas la URL de Netlify, tanto vos como tus amigos:

**iPhone:**
- Abrir la URL en **Safari** (no Chrome, tiene que ser Safari)
- Tocar el botón de compartir (cuadradito con flecha)
- "Añadir a pantalla de inicio"
- Listo, aparece como app

**Android:**
- Abrir en Chrome
- Tocar los tres puntitos → "Añadir a pantalla de inicio" o "Instalar app"

---

## Paso 4 — Compartir con tus amigos

Mandales la URL de Netlify. Cada uno:
1. Toca "Registrarse"
2. Pone su nombre, un nombre de usuario único, email y contraseña
3. Una vez dentro, va a "Amigos" y te busca por tu nombre de usuario
4. Te manda solicitud → vos la aceptás → ya pueden chatear y mandarse reels

---

## Cómo funciona todo

**Reels:**
- Trae videos cortos de YouTube en español buscando "humor argentino", "memes argentinos", etc.
- Tres feeds: "Para vos" (personalizado), "Trending" (lo más visto) y "Humor AR" (específico Argentina)
- Scroll infinito igual que TikTok/Instagram
- Al dar like, tus amigos lo ven en su pestaña Amigos

**Chat:**
- Desde cualquier reel tocás "Enviar" → elegís el amigo → llega con notificación
- En el chat podés responder mensajes (mantener presionado) y poner emojis de reacción
- Los mensajes nuevos llegan solos cada pocos segundos sin recargar

**Amigos:**
- Buscás por nombre de usuario → mandás solicitud → el otro acepta
- En la pestaña Amigos ves qué le gustó a cada uno (scroll horizontal)

---

## Preguntas frecuentes

**¿Cuántos usuarios soporta gratis?**
El plan gratuito de Supabase soporta hasta 50.000 requests/mes y 500MB de base de datos.
Para 10 amigos es más que suficiente por años.

**¿Los videos cargan bien en celular?**
Sí, son iframes de YouTube con autoplay. Necesitan conexión (no funciona offline).
La calidad la ajusta YouTube automáticamente según la velocidad de internet.

**¿Cómo actualizo la app?**
Reemplazá los archivos en Netlify (arrastrando la carpeta de nuevo) o si usás GitHub, hacé push.

**¿Puedo cambiar las búsquedas de YouTube?**
Sí, en `app.js` al inicio hay un objeto `YT_QUERIES` con las búsquedas de cada pestaña. Podés cambiarlas o agregar más.

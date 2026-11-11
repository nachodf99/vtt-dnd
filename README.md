# Mesa de Rol — VTT (D&D + Dungeon Alchemist)

Mesa virtual propia: importa mapas de Dungeon Alchemist (export de Foundry o Universal VTT), niebla de guerra con línea de visión, tokens con imagen, iniciativa, dados y partidas multijugador en tiempo real.

**Stack:** HTML/JS estático (sin build) + funciones de Vercel + Supabase (Postgres, Realtime, Storage, Auth anónima).

## Arquitectura de entornos

| | Producción | Preproducción |
|---|---|---|
| Rama Git | `main` | `develop` |
| Vercel | entorno **Production** | entorno **Preview** |
| Supabase | proyecto `vtt-prod` | proyecto `vtt-dev` |

El frontend pide su configuración a `/api/config`, que lee las variables de entorno del entorno de Vercel en el que corre: así el mismo código apunta a la base de datos correcta. En preproducción la cabecera muestra la insignia **🧪 PREPRODUCCIÓN**.

## Puesta en marcha

### 1. Supabase (dos proyectos)

Para **cada** proyecto (`vtt-prod` y `vtt-dev`):

1. Crea el proyecto en [supabase.com](https://supabase.com) (plan Free vale).
2. **SQL Editor** → pega y ejecuta `supabase/schema.sql` entero (tablas, políticas RLS, realtime y bucket de storage; es re-ejecutable).
3. **Authentication → Sign In / Up** → activa **Anonymous sign-ins** (así tus jugadores entran sin registrarse).
4. Apunta de **Project Settings → API**: `Project URL` y la clave `anon public`.

### 2. GitHub

```bash
git init && git add -A && git commit -m "VTT inicial"
git branch -M main
git remote add origin git@github.com:TU_USUARIO/vtt-dnd.git
git push -u origin main
git checkout -b develop && git push -u origin develop
```

### 3. Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo. Framework: **Other**, sin build command, output por defecto. Deploy.
2. **Settings → Environment Variables**, crea DOS variables, cada una con valor distinto por entorno:
   - `SUPABASE_URL` → Production: URL de `vtt-prod` · Preview + Development: URL de `vtt-dev`
   - `SUPABASE_ANON_KEY` → Production: anon de `vtt-prod` · Preview + Development: anon de `vtt-dev`
3. Redeploy.

Resultado:
- `https://tu-proyecto.vercel.app` → **producción** (rama `main`, BD prod)
- cada push a `develop` → URL de **preview** (BD dev), p. ej. `vtt-dnd-git-develop-xxx.vercel.app`

### Desarrollo en local (opcional)

Copia `config.local.example.js` como `config.local.js` con las claves del proyecto DEV y sirve la carpeta: `npx serve .` (o `vercel dev` si quieres también `/api/config`).

## Flujo de trabajo

- Cambios nuevos → rama `develop` → pruebas en la URL de preview contra la BD de desarrollo.
- Cuando esté estable → merge a `main` → producción. Los datos de tus partidas reales nunca se mezclan con las pruebas.

## Cómo se juega

1. El DM abre la URL, pone su nombre y **crea una partida** (privada ⇒ código de 5 letras).
2. Pasa a sus jugadores la URL y el código; cada uno entra desde su pantalla con su nombre.
3. El DM importa el mapa (pestaña 🗺): el JSON del export **Foundry** de Dungeon Alchemist junto a su imagen/vídeo, o un `.dd2vtt`.
4. Solo el DM mueve tokens, abre puertas 🔒/🚪 y lleva la iniciativa; los jugadores ven su visión compartida, tiran dados, chatean y señalan con doble clic.

## Permisos (RLS)

- **Identidad**: sesión anónima de Supabase, persistida en el navegador. Quien crea una partida es su DM (no borres los datos del sitio en el navegador del DM o perderá esa identidad).
- `games`, `maps`, `tokens`: cualquiera puede leer; solo el DM/dueño puede escribir (lo impone la base de datos, no solo la interfaz).
- `rolls`: cada usuario firma sus propias tiradas y mensajes.
- El código de partida es un control social (tipo Jackbox), no un secreto criptográfico: no metas información sensible.

## Estructura

```
index.html                 ← toda la app (canvas, niebla, tokens, dados…)
api/config.js              ← config por entorno (función Vercel)
supabase/schema.sql        ← tablas + RLS + realtime + storage (ejecutar en cada proyecto)
config.local.example.js    ← plantilla para desarrollo local
```

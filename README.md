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

## Rondas libres (en `develop`)

- El DM pulsa 📱 para mostrar un **QR** en la esquina del mapa (también en el proyector). Los jugadores lo escanean y entran en modo móvil.
- Cada jugador elige su PJ y ve su **ficha** (imagen, clase, raza, PV, CA, ataque, alcance) e **inventario** (5 casillas por defecto, el DM las amplía).
- Con la ronda abierta (pestaña ⚔ Iniciativa), cada jugador hace **una** acción: 🎲 Movimiento (tira su dado y toca una casilla iluminada), ⚔ Atacar (enemigos a la vista y a su alcance; d20 + ataque contra la CA) o ⏭ Pasar. El DM pasa de ronda.
- **Ataques por clase** (12 clases × 4-5 ataques) que se desbloquean por nivel; catálogo en la tabla `attacks`.
- **Experiencia**: impacto +10 XP, fallo +2 XP; al matar un monstruo su XP (por defecto 5 × PV máx, mín. 20) se reparte entre el grupo. Niveles: 100 / 300 / 600 / 1000 / 1500 / 2100 / 2800 / 3600 / 4500 XP. Subir de nivel da PV según la clase y +1 al ataque en los niveles 5 y 9.
- **Monstruos**: a 0 PV desaparecen. Son defensivos: contraatacan si sobreviven y el PJ está a su alcance, y atacan al PJ que termina su movimiento a su alcance y con línea de visión. Los ocultos no reaccionan. Un PJ a 0 PV queda inconsciente.
- **Objetos (5e 2024)**: catálogo de 234 objetos (armas, armaduras, equipo, pociones, pergaminos, objetos mágicos) para dar a un PJ o a todo el grupo. Consumibles con efecto automático: pociones de curación (acción adicional), ácido, fuego de alquimista (deja Ardiendo: 1d4 por ronda), agua bendita (solo Infernal/No muerto), poción de aliento de fuego, varitas de proyectil mágico / bolas de fuego / relámpagos y collar de bolas de fuego. El resto son narrativos (se gastan y quedan en el registro).
- Las reglas se validan en el servidor: ejecutar en orden `supabase/rounds.sql`, `supabase/combat_v2.sql`, `supabase/items.sql` y `supabase/effects.sql` en cada proyecto antes de promover el código.

> Mecánicas de objetos basadas en el System Reference Document 5.2 (SRD 5.2) de Wizards of the Coast LLC, disponible bajo licencia [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Traducciones y textos propios.

## Equipo y características (en `develop`)
- 88 objetos del catálogo son equipables (armaduras, escudos, armas y objetos mágicos). En el móvil: tocar el objeto → **Equipar / Quitar**. Queda guardado en el personaje.
- El servidor (`supabase/equipment.sql`) recalcula CA (ligera: +Des, intermedia: +Des máx. 2, pesada: sin Des; defensa sin armadura de bárbaro/monje), arma (ataque = característica + competencia + bonificador), características mejoradas por objetos y sintonía (máx. 3).
- La ficha muestra las 6 características, el equipo puesto y el desglose de la CA. El DM edita las características y un ajuste de CA en el modal del token.
- Los objetos escritos a mano se enlazan solos con el catálogo si el nombre coincide (sin importar tildes ni mayúsculas); si no, se marcan como «personalizado» sin efecto automático.

## Luces, medidas, plantillas y sonido (en `develop`)
- **Ejecutar `supabase/mesa_extras.sql`** en cada proyecto (re-ejecutable): crea las tablas `templates` y `explored`, la función `set_game_audio` y permite subir audio al bucket `assets`.
- **Luces**: al importar se leen las luces de Dungeon Alchemist (export de Foundry y `.dd2vtt`). Cada mapa tiene un nivel de **oscuridad** (🗺 Mapas → Luz y oscuridad); desde el 55 % los PJ solo ven lo iluminado o con **visión en la oscuridad** (por raza: elfo, enano, gnomo, semielfo, semiorco, tiflin = 12 casillas; o a mano en el token). Los tokens pueden llevar antorcha, linterna, vela o conjuro Luz. Con 🧱 el DM ve las 💡 y las enciende o apaga tocándolas. Si el radio no cuadra con el dibujo, ajusta «tamaño ×».
- **📏 Regla** con varios puntos (cada toque añade un tramo); el resto del grupo la ve en directo.
- **📐 Plantillas de área** (círculo, cono, línea de 5 ft, cubo): se arrastran desde el origen y marcan las casillas afectadas. Las crea cualquiera; las borra su autor o el DM.
- **Niebla explorada guardada** por jugador y mapa (en el dispositivo y en Supabase). El DM la reinicia para todos desde 🗺 Mapas.
- **🎵 Sonido**: el DM sube música (una a la vez) y ambientes (se mezclan); suenan sincronizados en todos los dispositivos. Cada uno ajusta su volumen o silencia; si el navegador bloquea el audio aparece «🔈 Activar sonido». El proyector no reproduce audio para no duplicarlo.

## Pruebas automáticas
`tools/pruebas/` contiene un servidor que imita Supabase (auth anónima, REST con las políticas RLS reales sobre un PostgreSQL local, storage y realtime) y tres baterías de pruebas de extremo a extremo con varios jugadores a la vez. Instrucciones en `tools/pruebas/LEEME.md`.

## Pantallas y ayuda
- Diseño adaptable: en ordenador, panel lateral (se oculta con ☰); en móvil o pantalla estrecha, panel y mapa apilados (⤢ cambia el tamaño del mapa); en móvil horizontal, lado a lado.
- Botón **?** en la cabecera (y «❓ Ayuda» en el lobby): ayuda por secciones según seas DM o jugador, explicación de cada botón y preguntas frecuentes.
- **Tutorial guiado** que resalta cada parte de la pantalla. Se ofrece la primera vez que entras a una partida (una vez como DM y otra como jugador).

## Partidas, mapas y personajes (en `develop`)
- Cada partida tiene **varios mapas** (`maps.data.gameId`). El DM activa uno y es el que ven los jugadores. Sus mapas de otras partidas se pueden copiar con «➕ Añadir».
- Los **PJ pertenecen a la partida**, no al mapa: `tokens.data.mapId` indica dónde están (o `null` = banquillo). El DM los mueve con «Mover a…», «📍 Aquí» o «Traer a todo el grupo», y conservan vida, ataque, daño, inventario, equipo y experiencia.
- Al borrar un mapa, sus PJ pasan al banquillo y sus monstruos se borran.
- **🚩 Punto de aparición** por mapa (`maps.data.spawn`). Al activar otro mapa, los PJ del mapa anterior y del banquillo viajan solos a su 🚩 (ajuste «llevar al grupo automáticamente», `games.data.autoMove`). Los PJ nuevos también aparecen ahí.
- Monstruos y PNJ quedan guardados en su mapa y posición. «➕ Añadir» un mapa antiguo lo mueve a la partida con sus tokens; uno de otra partida se copia con sus monstruos y PNJ.

## Cuentas
- Se puede jugar como **invitado** (sesión anónima). Al **crear cuenta** (correo + contraseña o Google) el invitado se convierte en cuenta **sin perder nada** (mismo identificador).
- Perfil: nombre visible, personajes en todas tus partidas, cambiar contraseña, cerrar sesión y **borrar la cuenta** (borra partidas que diriges, mapas y mensajes; libera tus PJ).
- El correo nunca se muestra a otros jugadores.

### Ajustes que hay que hacer a mano en Supabase (Authentication), en cada proyecto
1. **URL Configuration** → *Site URL*: la URL de producción. *Redirect URLs*: producción y `https://*-nachodf99s-projects.vercel.app/**` (vistas previas).
2. **Providers → Google**: activar con el *Client ID* y *Client secret* de Google Cloud (OAuth, tipo «Aplicación web», URI de redirección autorizada `https://<proyecto>.supabase.co/auth/v1/callback`).
3. **Sign In / Providers → Allow manual linking**: activado (para pasar de invitado a Google sin perder datos).
4. **Email**: *Confirm email* activado; contraseña mínima 8 con letras y números. Configurar **SMTP propio** (p. ej. Resend o Brevo): el correo integrado de Supabase solo envía a miembros del equipo y con un límite muy bajo.
5. Opcional: **Attack Protection → CAPTCHA** (Cloudflare Turnstile) y *Leaked password protection* (plan Pro).

## Seguridad
- **RLS por pertenencia**: solo los miembros de una partida (`game_members`) ven la partida, sus mapas, sus tokens y su chat. Los monstruos ocultos y las tiradas privadas del DM no llegan nunca al navegador de los jugadores.
- **Códigos privados** en `game_secrets` (solo los ve el DM); se entra con `join_game` / `join_by_code`, que comprueban el código en el servidor. Máximo 10 intentos fallidos cada 15 min.
- Solo el DM escribe tokens y partidas; los jugadores actúan solo mediante funciones que validan las reglas. Todas las funciones internas están bloqueadas.
- Canales en tiempo real **privados** por partida (presencia y señales) con políticas en `realtime.messages`.
- Almacenamiento: cada usuario solo sube a su carpeta, máximo 50 MB, solo imágenes y vídeo (sin SVG), y nadie puede listar archivos ajenos.
- Navegador: **CSP estricta** (`script-src 'self'`, sin scripts en línea), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy` en `vercel.json`. Librerías y fuentes alojadas en `/vendor` (sin CDNs de terceros ni Google Fonts: no se filtra la IP de los jugadores). Los datos recibidos se sanean antes de pintarse.
- Pruebas de ataque (intruso, fuerza bruta de códigos, subir PV a mano, hacerse DM, leer secretos…) en el historial de `supabase/security.sql`.

## Permisos (RLS)

- **Identidad**: sesión de Supabase (invitado anónimo o cuenta con correo/Google). Con cuenta, el DM puede entrar desde cualquier dispositivo; como invitado, su identidad vive en ese navegador.
- Detalle completo en la sección **Seguridad** y en `supabase/security.sql`.

## Estructura

```
index.html                 ← toda la app (canvas, niebla, tokens, dados…)
api/config.js              ← config por entorno (función Vercel)
supabase/schema.sql        ← tablas + RLS + realtime + storage (ejecutar en cada proyecto)
config.local.example.js    ← plantilla para desarrollo local
```

_Rama develop → entorno de preproducción (BD vtt-dev)._

## Dados 3D
- Cada tirada (panel 🎲, ataques, movimiento, monstruos) se ve rodando en 3D sobre el mapa en la pantalla de todos, con física real (three.js + cannon-es, en `vendor/dice-libs.js`, se cargan solo con la primera tirada).
- El resultado lo decide la tirada de siempre; la animación solo gira el dado para que muestre ese número, así el registro y la mesa siempre coinciden.
- Cada jugador tiene su color de dados; los monstruos tiran dados negros con números rojos. Las tiradas ocultas 🤫 solo las ven quien tira y el DM. Un 20 natural sale como ¡CRÍTICO! y un 1 como PIFIA.
- La casilla **3D** del panel de dados lo desactiva en ese dispositivo. Código en `dice3d.js`.

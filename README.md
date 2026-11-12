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

## Pantallas y ayuda
- Diseño adaptable: en ordenador, panel lateral (se oculta con ☰); en móvil o pantalla estrecha, panel y mapa apilados (⤢ cambia el tamaño del mapa); en móvil horizontal, lado a lado.
- Botón **?** en la cabecera (y «❓ Ayuda» en el lobby): ayuda por secciones según seas DM o jugador, explicación de cada botón y preguntas frecuentes.
- **Tutorial guiado** que resalta cada parte de la pantalla. Se ofrece la primera vez que entras a una partida (una vez como DM y otra como jugador).

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

_Rama develop → entorno de preproducción (BD vtt-dev)._

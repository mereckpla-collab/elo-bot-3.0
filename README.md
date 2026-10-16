# Elo de Doskuith

Bot de Discord (discord.js v14) para gestionar colas 4v4 de Haxball con draft, elo, resultados,
sustituciones y bans. Funciona en cualquier servidor donde se instale (multi-servidor).

## Instalación

1. Instala Node.js 18 o superior.
2. Dentro de la carpeta del proyecto:
   ```
   npm install
   ```
3. Crea una aplicación de bot en https://discord.com/developers/applications, copia el token
   y el "Application ID".
4. Copia `.env.example` a `.env` y rellena:
   - `DISCORD_TOKEN`: el token del bot
   - `CLIENT_ID`: el Application ID
   - `OWNER_ID`: tu ID de usuario de Discord (clic derecho sobre tu perfil -> Copiar ID,
     necesitas el modo desarrollador activado en Discord)
5. Registra los comandos slash (una sola vez, o cada vez que cambies un comando):
   ```
   npm run deploy
   ```
6. Invita al bot a tu servidor con permisos de: Gestionar canales, Gestionar roles,
   Enviar mensajes, Insertar enlaces, Usar comandos de aplicación, Crear hilos públicos,
   Mencionar a todos.
7. Arranca el bot:
   ```
   npm start
   ```
8. En el servidor de Discord, un administrador ejecuta `/install` en cualquier canal.
   Esto crea (o reutiliza, si ya existen con el mismo nombre) los canales:
   `init`, `info_chat`, `submit`, `game_announcement`, `bans`, y la categoría
   "Elo Queues" con el canal `4v4-solo`, además del rol `Elo Admin`.

## Estructura del proyecto

- `src/index.js` – arranque del bot, carga de comandos y eventos.
- `src/deploy-commands.js` – registra los slash commands en Discord (global).
- `src/database.js` – capa de persistencia en JSON (`data/db.json`), con datos separados por servidor.
- `src/config.js` – constantes (nombres de canales, elo inicial, topes, colores, roles, etc).
- `src/utils/` – lógica de elo, embeds reutilizables, nombres de jugadores, traducciones (i18n).
- `src/commands/` – un archivo por comando slash.
- `src/handlers/` – lógica de la queue, el draft/pick y la votación de resultados.
- `src/events/` – `ready` e `interactionCreate` (enruta slash commands, botones y menús).

## Notas importantes / limitaciones de esta primera versión

- La persistencia es un archivo JSON local (`data/db.json`). Funciona bien para un
  volumen moderado de partidas; si esto crece mucho a futuro se puede migrar a una
  base de datos real sin cambiar el resto del bot (toda la persistencia pasa por `database.js`).
- Los timers de pick (2 min) y de expulsión de la queue por inactividad viven en memoria:
  si reinicias el bot mientras hay un draft en curso o gente en la queue, esos timers se
  vuelven a armar al iniciar el proceso pero el conteo se reinicia desde cero.
- El balanceo de elo implementado es una heurística razonable siguiendo tus reglas
  (elo inicial 0, tope de -25 en derrota, sin tope en victoria, primer partido fijo ±12,
  bonus/penalización por racha, y ganancia reducida si tu elo o el de tus compañeros picks
  es mucho más alto que el rival). Está todo en `src/utils/elo.js` en una sola función,
  así que es fácil de ajustar los números si quieres afinar el balance.
- El botón "Moderator" del embed de la queue abre un menú con acciones rápidas de
  administrador (forzar inicio del draft, vaciar la queue) — lo dejé como panel extensible.
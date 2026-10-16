const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ guilds: {}, salas: {} }, null, 2));
}

function load() {
  ensureFile();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function defaultGuild() {
  return {
    channels: {},          // { init, info_chat, submit, game_announcement, bans, queue }
    categoryId: null,
    adminRoleId: null,
    queueMessage: null,    // { channelId, messageId }
    nextGameId: 1,
    reusableGameIds: [],    // números de Game liberados por un draft cancelado (capitán AFK), a reutilizar antes de gastar uno nuevo
    players: {},           // userId -> playerObj
    queue: [],             // [{ userId, joinedAt }]
    games: {},             // gameId -> gameObj
    bans: {},               // userId -> { bannedBy, until, reason, mode }
    captainBlacklist: {},   // userId -> { bannedBy, reason, bannedAt } — nunca elegible como capitán
    modes: {},               // key -> { key, name, type, teams, playersPerTeam, totalPlayers, streakBoost, defaultRanks, pickSystem, players, queue, channelId, queueMessage, createdAt, createdBy }
    vip: { tier: 'free', activatedAt: null, expiresAt: null, limitAlerted: false }, // tier: 'free' | 'basic' | 'pro'
    knownPlayerIds: {},      // userId -> true. Todo el que se unió a CUALQUIER cola alguna vez, sin importar el modo — el límite de VIP se mide con esto, no con el elo (que ahora es independiente por modo).
    preferredNames: {},      // userId -> nombre elegido con /rename. Es GLOBAL al servidor (no por cola), para que el nombre se vea igual en todos lados: se aplica de una a todas las colas donde ya jugó, y se usa como nombre de arranque si más adelante se une a una cola nueva.
    season: 1,               // se incrementa con /reset_season. Sirve para saber en qué temporada se ganó cada rol de logro (player.achievements[key].season) — el reset NO borra los logros ya ganados, solo el elo/stats.
    seasonDividerRoleId: null, // rol gris "───── TEMPORADA N ─────" que separa visualmente los roles de logro por temporada (ver /temporada y utils/seasonDivider.js)
    seasonParticipants: {},   // userId -> true. Quién se unió a una cola durante la temporada actual — a esos se les da el rol de temporada; al resetear, se les saca y esta lista se vacía.
    resetSeasonAuthorized: {}, // userId -> { addedAt }. Gente (además del dueño del bot, vía OWNER_ID) autorizada a usar /reset_season en ESTE servidor — se administra con /reset_season_autorizar, que solo el dueño del bot puede usar.
    championEnabled: false,   // si esta cola le da un rol de "Campeón" al n°1 del elo cuando se resetea la temporada (ver utils/championRole.js)
    championColor: null,      // color elegido para ese rol (null = dorado por default)
    championRoleId: null,     // el rol en sí — se reutiliza y se renombra cada temporada, nunca se crea uno nuevo
    currentChampionId: null   // quién lo tiene puesto ahora mismo, para sacárselo cuando cambie el campeón
  };
}

function getGuild(guildId) {
  const db = load();
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = defaultGuild();
    save(db);
  }
  // Compatibilidad hacia atrás: guilds guardados antes de que existiera esta
  // lista no la tienen todavía.
  if (!db.guilds[guildId].captainBlacklist) {
    db.guilds[guildId].captainBlacklist = {};
    save(db);
  }
  if (!db.guilds[guildId].reusableGameIds) {
    db.guilds[guildId].reusableGameIds = [];
    save(db);
  }
  // Secuencia del "número" mostrado (Game n°X) de la cola de siempre,
  // independiente de la de cualquier modo (ver draftManager.ensureNumberSeq).
  // Se siembra UNA sola vez a partir del contador global viejo para no
  // resetear de golpe el número que la gente ya venía viendo en esta cola.
  if (!db.guilds[guildId].numberSeq) {
    db.guilds[guildId].numberSeq = { next: db.guilds[guildId].nextGameId || 1, reusable: [] };
    save(db);
  }
  if (!db.guilds[guildId].modes) {
    db.guilds[guildId].modes = {};
    save(db);
  }
  if (!db.guilds[guildId].knownPlayerIds) {
    // Se siembra con los jugadores que YA existían en la cola legacy, para
    // que nadie que ya jugaba antes de esta actualización de golpe cuente
    // como "nuevo" y quede bloqueado por el límite de VIP.
    const seeded = {};
    for (const userId of Object.keys(db.guilds[guildId].players || {})) seeded[userId] = true;
    db.guilds[guildId].knownPlayerIds = seeded;
    save(db);
  }
  if (!db.guilds[guildId].vip) {
    db.guilds[guildId].vip = { tier: 'free', activatedAt: null, expiresAt: null, limitAlerted: false };
    save(db);
  }
  if (!db.guilds[guildId].preferredNames) {
    db.guilds[guildId].preferredNames = {};
    save(db);
  }
  if (!db.guilds[guildId].resetSeasonAuthorized) {
    db.guilds[guildId].resetSeasonAuthorized = {};
    save(db);
  }
  if (!db.guilds[guildId].season) {
    db.guilds[guildId].season = 1;
    save(db);
  }
  return db.guilds[guildId];
}

function saveGuild(guildId, guildData) {
  const db = load();
  db.guilds[guildId] = guildData;
  save(db);
}

function isInstalled(guildId) {
  const g = getGuild(guildId);
  return Boolean(g.channels && g.channels.init);
}

/**
 * Estado de las salas de Haxball (comando /salas). Es GLOBAL, no por
 * servidor, porque las salas son un recurso compartido. Se auto-repara si
 * faltan entradas (por ejemplo, si se agregó una sala nueva a config.js
 * después de que ya existía el archivo de datos).
 */
function defaultSalaEntry() {
  return { status: 'libre', updatedAt: Date.now(), updatedBy: null };
}

function getSalas() {
  const { HAXBALL_ROOMS } = require('./config');
  const db = load();
  if (!db.salas) db.salas = {};
  let changed = false;
  for (const room of HAXBALL_ROOMS) {
    if (!db.salas[room.code]) {
      db.salas[room.code] = defaultSalaEntry();
      changed = true;
    }
  }
  if (changed) save(db);
  return db.salas;
}

function saveSalas(salas) {
  const db = load();
  db.salas = salas;
  save(db);
}

function defaultPlayer(userId, displayName) {
  return {
    userId,
    name: displayName,
    elo: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    gamesPlayed: 0,
    streak: 0,       // positivo = racha de wins, negativo = racha de losses
    bestStreak: 0,
    worstStreak: 0,
    bestElo: 0,
    worstElo: 0,
    firstGamePlayed: false,
    currentRank: require('./config').RANKS[0].key, // rango en el que arranca (Bronce)
    rankHistory: {},                               // { rankKey: [temporadas en las que estuvo en ese rango] }
    since: Date.now()
  };
}

function getOrCreatePlayer(guild, userId, fallbackName) {
  if (!guild.players[userId]) {
    guild.players[userId] = defaultPlayer(userId, fallbackName || userId);
  }
  return guild.players[userId];
}

/**
 * Si el jugador ya existe pero su nombre guardado quedó "roto" (es igual a su
 * propio ID de Discord, típicamente por haber sido agregado con /force_join
 * antes de que existiera un nombre real disponible), lo actualiza con
 * freshName. No pisa un nombre real ya establecido (ej. por /rename).
 */
function healPlayerName(guild, userId, freshName) {
  if (!freshName) return;
  const p = guild.players[userId];
  if (p && p.name === userId && freshName !== userId) {
    p.name = freshName;
  }
}

/**
 * Recorre todos los jugadores de este servidor cuyo nombre guardado quedó
 * "roto" (igual a su propio ID de Discord, por ejemplo por haber sido
 * agregados con /force_join cuando el bot no pudo resolver su apodo en su
 * momento) e intenta resolverlos ahora contra el guild real de Discord.
 * Devuelve true si sanó al menos un nombre (para saber si conviene guardar).
 */
async function healAllBrokenNames(discordGuild, guildData) {
  const brokenIds = Object.values(guildData.players)
    .filter(p => p.name === p.userId)
    .map(p => p.userId);
  if (!brokenIds.length) return false;

  let healedAny = false;
  for (const userId of brokenIds) {
    let member = discordGuild.members.cache.get(userId);
    if (!member) member = await discordGuild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const freshName = member.nickname || member.user.globalName || member.user.username;
    if (freshName && freshName !== userId) {
      guildData.players[userId].name = freshName;
      healedAny = true;
    }
  }
  return healedAny;
}

/**
 * Devuelve dónde vive la economía de elo de una partida: si es de un modo
 * creado con el wizard, sus propios jugadores/elo (independientes de
 * cualquier otra cola); si es la cola de siempre (legacy), la economía
 * global de todo el servidor. También devuelve el nombre del modo, para
 * mostrarlo en los embeds (ej. "silver-queue n°599").
 */
function resolveGameContext(guildData, game) {
  if (game.modeKey && guildData.modes[game.modeKey]) {
    const mode = guildData.modes[game.modeKey];
    if (!mode.players) mode.players = {};
    return { store: mode, label: mode.name };
  }
  return { store: guildData, label: null };
}

module.exports = {
  getGuild,
  saveGuild,
  isInstalled,
  defaultGuild,
  defaultPlayer,
  getOrCreatePlayer,
  healPlayerName,
  healAllBrokenNames,
  resolveGameContext,
  getSalas,
  saveSalas
};
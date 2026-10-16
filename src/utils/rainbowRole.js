const { getGuild, saveGuild } = require('../database');
const { RAINBOW_INTERVAL_MS, RAINBOW_HUE_STEP } = require('../config');

// ---------------------------------------------------------------------------
// Rol rainbow: un rol que cambia de color solo.
//
// Por qué Discord "lo detecta" y frena al bot: editar un rol muy seguido
// choca con el límite de la API (error 429). Si el bot insiste, Discord lo
// frena un rato y, si sigue, puede bloquearlo. Para evitarlo:
//   - UN solo cambio a la vez por servidor (nunca en paralelo), y el
//     siguiente se programa recién cuando el anterior terminó.
//   - Un intervalo prudente entre cambios (RAINBOW_INTERVAL_MS en config.js).
//   - Si Discord avisa que hay límite (rate limit) o falla algo, se espera el
//     doble cada vez (hasta 5 min) y se vuelve a la normalidad al recuperarse.
//   - Si faltan permisos o el rol ya no existe, se PAUSA en vez de insistir.
//   - Si nadie tiene el rol, no se hace ninguna llamada.
// ---------------------------------------------------------------------------

const MAX_DELAY_MS = 5 * 60 * 1000;
const loops = new Map(); // guildId -> { timer, hue, delay }

/** Color (número) a partir de matiz 0-360, saturación y luminosidad 0-1. */
function hslToInt(h, s = 1, l = 0.5) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/**
 * Sube el rol lo más arriba que Discord permita: justo DEBAJO del rol más alto
 * del bot (un bot no puede poner ningún rol a la altura de su propio rol ni
 * por encima). Devuelve cómo quedó y, si algún rol con color sigue por encima,
 * cuáles son (esos tapan el color del rainbow en el nombre).
 */
async function placeOnTop(guild, role) {
  const botRole = guild.members.me?.roles?.highest;
  if (!botRole) return { atTop: false, blockers: [], botRoleName: null };

  const target = Math.max(1, botRole.position - 1);
  let current = await guild.roles.fetch(role.id, { force: true }).catch(() => role);
  if (current.position < target) {
    await current.setPosition(target, { reason: 'Rol rainbow arriba de todo' }).catch(() => {});
    current = await guild.roles.fetch(role.id, { force: true }).catch(() => current);
  }

  const blockers = [...guild.roles.cache.values()]
    .filter(r => r.id !== current.id && r.position > current.position && r.color !== 0 && r.id !== botRole.id)
    .map(r => r.name);
  return { atTop: current.position >= target, blockers, botRoleName: botRole.name };
}

// Revisión liviana (solo lee la caché): si algo quedó por encima del rainbow y
// el bot puede subirlo, lo sube. Solo llama a Discord cuando hace falta.
async function keepOnTop(guild, role) {
  const botTop = guild.members.me?.roles?.highest?.position;
  if (!botTop || role.position >= botTop - 1) return;
  await role.setPosition(botTop - 1, { reason: 'Rol rainbow arriba de todo' }).catch(() => {});
}

/** ¿Puede esta persona tener el rol? El dueño del bot y quienes él autorice. */
function isAllowed(guildData, userId) {
  return userId === process.env.OWNER_ID || (guildData.rainbow?.holders || []).includes(userId);
}

async function step(client, guildId) {
  const st = loops.get(guildId);
  if (!st) return;

  try {
    const guildData = getGuild(guildId);
    const cfg = guildData.rainbow;
    if (!cfg?.roleId) { loops.delete(guildId); return; }

    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw new Error('No encuentro el servidor');

    const role = guild.roles.cache.get(cfg.roleId) || await guild.roles.fetch(cfg.roleId).catch(() => null);
    if (!role) {
      console.warn(`[rainbow] El rol rainbow de ${guildId} ya no existe: se detiene. Usa /rainbow crear para hacerlo de nuevo.`);
      cfg.roleId = null;
      saveGuild(guildId, guildData);
      loops.delete(guildId);
      return;
    }

    // Cada ~20 cambios (unos 4 min) se comprueba que siga arriba de todo.
    st.ticks = (st.ticks || 0) + 1;
    if (st.ticks % 20 === 1) await keepOnTop(guild, role);

    // Sin nadie con el rol no hace falta llamar a Discord.
    if ((cfg.holders || []).length) {
      st.hue = (st.hue + RAINBOW_HUE_STEP) % 360;
      await role.setColor(hslToInt(st.hue), 'Rol rainbow');
    }
    st.delay = Math.max(RAINBOW_INTERVAL_MS, Math.round(st.delay / 2)); // se recupera rápido tras un contratiempo
  } catch (err) {
    // Sin permisos / sin acceso: insistir no sirve y solo molesta a Discord.
    if (err?.code === 50013 || err?.code === 50001) {
      console.warn(`[rainbow] No puedo editar el rol en ${guildId} (permisos). Se pausa: sube mi rol por encima del 🌈 y reinicia el bot.`);
      loops.delete(guildId);
      return;
    }
    st.delay = Math.min(st.delay * 2, MAX_DELAY_MS);
    console.warn(`[rainbow] No pude cambiar el color (${err?.message || err}). Reintento en ${Math.round(st.delay / 1000)} s.`);
  }

  if (loops.get(guildId) === st) st.timer = setTimeout(() => step(client, guildId), st.delay);
}

/** Arranca (o reinicia) el cambio de color de un servidor. */
function startRainbow(client, guildId) {
  stopRainbow(guildId);
  const st = { timer: null, hue: Math.floor(Math.random() * 360), delay: RAINBOW_INTERVAL_MS };
  loops.set(guildId, st);
  st.timer = setTimeout(() => step(client, guildId), 1000);
}

function stopRainbow(guildId) {
  const st = loops.get(guildId);
  if (st?.timer) clearTimeout(st.timer);
  loops.delete(guildId);
}

/** Al arrancar el bot: retoma el rainbow de los servidores que ya lo tienen. */
function startAll(client) {
  // Si Discord avisa de un límite de velocidad sobre roles, se frena todo.
  client.rest?.on?.('rateLimited', info => {
    if (!String(info?.url || info?.route || '').includes('/roles/')) return;
    for (const st of loops.values()) st.delay = Math.min(st.delay * 2, MAX_DELAY_MS);
    console.warn('[rainbow] Discord avisó de un límite de velocidad: se espacian más los cambios de color.');
  });

  for (const guildId of client.guilds.cache.keys()) {
    if (getGuild(guildId).rainbow?.roleId) startRainbow(client, guildId);
  }
}

module.exports = { startRainbow, stopRainbow, startAll, isAllowed, hslToInt, placeOnTop };
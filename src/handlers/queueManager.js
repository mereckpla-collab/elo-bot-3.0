const { getGuild, saveGuild, getOrCreatePlayer, healPlayerName } = require('../database');
const { displayName } = require('../utils/names');
const { queueEmbed, queueButtons, modeQueueButtons, errorEmbed } = require('../utils/embeds');
const { QUEUE_SIZE } = require('../config');
const { getQueueTimeoutMs } = require('../utils/modeTimers');
const { startDraft, peekNextGameNumber } = require('./draftManager');
const { findQueueBlockingGame } = require('./resultManager');
const { tagSeasonParticipant } = require('../utils/seasonDivider');

// Timers de inactividad en memoria: `${guildId}:${modeKey||'_default'}` -> userId -> Timeout
const inactivityTimers = new Map();

// Detecta a qué cola pertenece un canal: la de siempre (legacy, modeKey=null)
// o la de algún modo creado con el wizard. Devuelve null si el canal no es
// ninguna cola. Se usa en /force_join, /force_leave, etc. para saber en cuál
// cola operar según DESDE DÓNDE se corre el comando.
function resolveModeFromChannel(guildData, channelId) {
  if (guildData.channels.queue === channelId) {
    return { modeKey: null, totalPlayers: QUEUE_SIZE, label: 'la cola por defecto' };
  }
  for (const mode of Object.values(guildData.modes || {})) {
    if (mode.channelId === channelId) {
      return { modeKey: mode.key, totalPlayers: mode.totalPlayers, label: `el modo \`${mode.name}\`` };
    }
  }
  return null;
}

function timerBucketKey(guildId, modeKey) {
  return `${guildId}:${modeKey || '_default'}`;
}

// Devuelve el "cajón" de estado de cola correspondiente: el de siempre
// (guildData directamente) si no se pasa modeKey, o el del modo puntual
// (guildData.modes[modeKey]) si sí. Todo lo que se le pega a lo que devuelve
// esta función termina guardado igual con un solo saveGuild(), porque sigue
// siendo el mismo objeto guildData por referencia.
function getStore(guildData, modeKey) {
  if (!modeKey) return guildData;
  const mode = guildData.modes[modeKey];
  if (mode && !mode.queue) mode.queue = [];
  if (mode && !mode.players) mode.players = {};
  return mode;
}

function getQueueChannelId(guildData, modeKey) {
  return modeKey ? guildData.modes[modeKey].channelId : guildData.channels.queue;
}

function getTotalPlayers(guildData, modeKey) {
  return modeKey ? guildData.modes[modeKey].totalPlayers : QUEUE_SIZE;
}

// Cuenta cuántas partidas de ESTA cola (misma modeKey) están activas ahora
// mismo — en draft o esperando que se vote el resultado. La cola sigue
// aceptando gente mientras estas partidas se resuelven, así que puede haber
// varias activas en simultáneo para el mismo canal.
function countActiveGames(guildData, modeKey) {
  return Object.values(guildData.games || {}).filter(g =>
    (g.modeKey || null) === (modeKey || null) && (g.status === 'drafting' || g.status === 'pending')
  ).length;
}

function clearTimer(guildId, userId, modeKey) {
  const bucket = inactivityTimers.get(timerBucketKey(guildId, modeKey));
  if (bucket && bucket.has(userId)) {
    clearTimeout(bucket.get(userId));
    bucket.delete(userId);
  }
}

function armTimer(client, guildId, channel, userId, modeKey) {
  const bucketKey = timerBucketKey(guildId, modeKey);
  if (!inactivityTimers.has(bucketKey)) inactivityTimers.set(bucketKey, new Map());
  clearTimer(guildId, userId, modeKey);
  // El tiempo de AFK en cola es configurable por modo (/afk_time).
  const timeoutMs = getQueueTimeoutMs(getGuild(guildId), modeKey);
  const t = setTimeout(async () => {
    const guildData = getGuild(guildId);
    const store = getStore(guildData, modeKey);
    const before = store.queue.length;
    store.queue = store.queue.filter(q => q.userId !== userId);
    if (store.queue.length !== before) {
      saveGuild(guildId, guildData);
      await refreshQueueMessage(client, guildId, `🟠 <@${userId}> fue removido de la cola por inactividad <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);
    }
  }, timeoutMs);
  inactivityTimers.get(bucketKey).set(userId, t);
}

async function refreshQueueMessage(client, guildId, activityText, bump = false, modeKey = null) {
  const guildData = getGuild(guildId);
  const store = getStore(guildData, modeKey);
  const queueMessage = modeKey ? store.queueMessage : guildData.queueMessage;
  if (!queueMessage) return;
  const channel = await client.channels.fetch(queueMessage.channelId).catch(() => null);
  if (!channel) return;

  const total = getTotalPlayers(guildData, modeKey);
  const modeLabel = modeKey ? guildData.modes[modeKey].name : null;
  const activeCount = countActiveGames(guildData, modeKey);
  const embed = modeKey
    ? queueEmbed(store, peekNextGameNumber(guildData, modeKey), activityText, store.queue, total, modeLabel, activeCount)
    : queueEmbed(guildData, peekNextGameNumber(guildData, null), activityText, undefined, undefined, undefined, activeCount);
  const components = modeKey ? modeQueueButtons(modeKey) : queueButtons();

  if (bump) {
    const old = await channel.messages.fetch(queueMessage.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
    const msg = await channel.send({ embeds: [embed], components });
    if (modeKey) store.queueMessage.messageId = msg.id;
    else guildData.queueMessage.messageId = msg.id;
    saveGuild(guildId, guildData);
  } else {
    const msg = await channel.messages.fetch(queueMessage.messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [embed], components }).catch(() => {});
  }
}

async function joinQueue(client, interaction, guildData, modeKey = null) {
  const userId = interaction.user.id;
  const store = getStore(guildData, modeKey);

  if (store.queue.some(q => q.userId === userId)) {
    return interaction.reply({ embeds: [errorEmbed('Ya estás en la cola.')], ephemeral: true });
  }
  const ban = guildData.bans[userId];
  const bannedHere = ban && (!ban.until || ban.until > Date.now()) &&
    (ban.mode === 'all' || !ban.mode || ban.mode === (modeKey || 'default'));
  if (bannedHere) {
    return interaction.reply({ embeds: [errorEmbed('Estás baneado en esta cola y no puedes unirte.')], ephemeral: true });
  }

  const blocking = findQueueBlockingGame(guildData, userId, modeKey);
  if (blocking) {
    const blockingNumber = blocking.game.number ?? blocking.game.id;
    const msg = blocking.reason === 'drafting'
      ? `Todavía estás en el draft de la Game n°${blockingNumber}. Espera a que termine de armarse el equipo.`
      : `Antes de volver a unirte a la cola debes votar el resultado de tu Game n°${blockingNumber}.`;
    return interaction.reply({ embeds: [errorEmbed(msg)], ephemeral: true });
  }

  // El límite de jugadores del plan (Free/Basic/Pro) es GLOBAL al servidor
  // (no por modo) y se mide con knownPlayerIds — quién se unió alguna vez a
  // CUALQUIER cola — para que no se pueda esquivar creando modos nuevos.
  // El elo en sí ahora SÍ es independiente por modo (ver más abajo).
  const isNewPlayer = !guildData.knownPlayerIds[userId];
  if (isNewPlayer) {
    const { getLimits, vipPromoEmbed } = require('../utils/vip');
    const limits = getLimits(guildData);
    const currentTotal = Object.keys(guildData.knownPlayerIds).length;
    if (currentTotal >= limits.maxPlayers) {
      if (!guildData.vip.limitAlerted) {
        guildData.vip.limitAlerted = true;
        saveGuild(interaction.guildId, guildData);
        const channelId = getQueueChannelId(guildData, modeKey);
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) await channel.send({ embeds: [vipPromoEmbed(guildData)] }).catch(() => null);
      }
      return interaction.reply({
        embeds: [errorEmbed(
          `Este servidor llegó al límite de **${limits.maxPlayers} jugadores** de su plan (${limits.label}). ` +
          `Como todavía no estás registrado, no podés unirte hasta que el servidor compre VIP para ampliar el cupo. Hablá con un administrador.`
        )],
        ephemeral: true
      });
    }
    guildData.knownPlayerIds[userId] = true;
  }

  // El elo/nombre/racha de este jugador vive en la economía de ESTA cola —
  // si es un modo, es 100% independiente del elo que tenga en la cola de
  // siempre o en cualquier otro modo. El nombre sí es común: si ya se puso
  // un nombre con /rename en cualquier otra cola, arranca con ese en vez de
  // su apodo de Discord, para que se vea igual en todos lados.
  const fallbackName = guildData.preferredNames?.[userId] ||
    interaction.member?.nickname || interaction.user.globalName || interaction.user.username;
  getOrCreatePlayer(store, userId, fallbackName);
  healPlayerName(store, userId, fallbackName);
  store.queue.push({ userId, joinedAt: Date.now() });
  saveGuild(interaction.guildId, guildData);
  armTimer(client, interaction.guildId, interaction.channel, userId, modeKey);

  // Le pone el rol de la temporada actual — solo a quien se une. Si nunca
  // se une, nunca lo tiene.
  await tagSeasonParticipant(interaction.guild, guildData, userId).catch(() => {});
  saveGuild(interaction.guildId, guildData);

  await interaction.deferUpdate();
  await refreshQueueMessage(client, interaction.guildId, `🟢 <@${userId}> se unió a la cola <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);

  // Confirmación privada (solo la ve quien tocó el botón) con en qué cola y
  // temporada quedó anotado — para que sepa a qué le va a contar el logro
  // que vaya consiguiendo, sobre todo si el server tiene varias colas.
  const modeLabel = modeKey ? guildData.modes[modeKey].name : 'la cola por defecto';
  const season = guildData.season || 1; // la temporada es una sola, compartida por todas las colas
  await interaction.followUp({
    content: `✅ Te uniste a **${modeLabel}** — Temporada ${season}.`,
    ephemeral: true
  }).catch(() => {});

  const totalNeeded = getTotalPlayers(guildData, modeKey);
  if (store.queue.length >= totalNeeded) {
    if (modeKey) {
      const mode = guildData.modes[modeKey];
      await startDraft(client, interaction.guildId, {
        modeKey,
        teamsCount: mode.teams,
        playersPerTeam: mode.playersPerTeam,
        pickSystem: mode.pickSystem
      });
    } else {
      await startDraft(client, interaction.guildId);
    }
  }
}

async function leaveQueue(client, interaction, guildData, modeKey = null) {
  const userId = interaction.user.id;
  const store = getStore(guildData, modeKey);
  if (!store.queue.some(q => q.userId === userId)) {
    return interaction.reply({ embeds: [errorEmbed('No estás en la cola.')], ephemeral: true });
  }
  store.queue = store.queue.filter(q => q.userId !== userId);
  saveGuild(interaction.guildId, guildData);
  clearTimer(interaction.guildId, userId, modeKey);

  await interaction.deferUpdate();
  await refreshQueueMessage(client, interaction.guildId, `🔴 <@${userId}> salió de la cola <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);
}

async function refreshOwnTimer(client, interaction, guildData, modeKey = null) {
  const userId = interaction.user.id;
  const store = getStore(guildData, modeKey);
  if (!store.queue.some(q => q.userId === userId)) {
    return interaction.reply({ embeds: [errorEmbed('No estás en la cola.')], ephemeral: true });
  }
  armTimer(client, interaction.guildId, interaction.channel, userId, modeKey);
  await interaction.reply({ content: 'Tu tiempo en la cola se reinició.', ephemeral: true });
}

// Cooldown del botón "Queue": 2 segundos por cola (no por usuario), para que
// no se pueda spamear el borrar-y-reenviar el mensaje aunque sean varias
// personas distintas clickeando seguido.
const BUMP_COOLDOWN_MS = 2000;
const lastBumpAt = new Map(); // `${guildId}:${modeKey||'_default'}` -> timestamp

function isBumpOnCooldown(guildId, modeKey) {
  const key = timerBucketKey(guildId, modeKey);
  const last = lastBumpAt.get(key);
  if (last && Date.now() - last < BUMP_COOLDOWN_MS) return true;
  lastBumpAt.set(key, Date.now());
  return false;
}

async function bumpQueue(client, interaction, guildData, modeKey = null) {
  if (isBumpOnCooldown(interaction.guildId, modeKey)) {
    return interaction.reply({ embeds: [errorEmbed('⏱️ Esperá 2 segundos antes de volver a usar "Queue".')], ephemeral: true });
  }
  await interaction.deferUpdate();
  await refreshQueueMessage(client, interaction.guildId, null, true, modeKey);
}

// Misma acción que el botón "Queue" (bajar el mensaje de la cola al final del
// canal), pero disparada desde un slash command en vez de un botón. Los
// botones usan deferUpdate() porque editan la interacción sobre un mensaje
// existente; un slash command no tiene ese mensaje, así que responde aparte
// con una confirmación efímera.
async function bumpQueueCommand(client, interaction, guildData) {
  if (isBumpOnCooldown(interaction.guildId, null)) {
    return interaction.reply({ embeds: [errorEmbed('⏱️ Esperá 2 segundos antes de volver a usar "Queue".')], ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  await refreshQueueMessage(client, interaction.guildId, null, true);
  await interaction.editReply({ content: '🔽 La cola fue movida al final del canal.' });
}

// Vacía la cola de espera de una sola pasada: saca a todos los que estaban
// esperando (sin tocar ninguna partida ya en draft/pendiente de votar,
// esas siguen su curso normal) y cancela sus timers de inactividad. La
// usan /reset_queue y /room manage reset-queue (son la misma acción).
async function resetQueue(client, guildId, modeKey) {
  const guildData = getGuild(guildId);
  const store = getStore(guildData, modeKey);
  if (!store) return { ok: false, count: 0 };

  const removed = store.queue.map(q => q.userId);
  store.queue = [];
  saveGuild(guildId, guildData);

  for (const userId of removed) clearTimer(guildId, userId, modeKey);

  await refreshQueueMessage(
    client,
    guildId,
    removed.length ? `🔄 La cola fue reiniciada — se sacó a ${removed.length} jugador(es) que estaban esperando.` : '🔄 La cola fue reiniciada.',
    false,
    modeKey
  );

  return { ok: true, count: removed.length };
}

module.exports = {
  joinQueue, leaveQueue, refreshOwnTimer, bumpQueue, bumpQueueCommand,
  refreshQueueMessage, armTimer, clearTimer, resolveModeFromChannel, countActiveGames, resetQueue
};
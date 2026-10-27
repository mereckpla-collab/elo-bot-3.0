const { getGuild, saveGuild, getOrCreatePlayer, healPlayerName } = require('../database');
const { displayName } = require('../utils/names');
const { queueEmbed, queueButtons, modeQueueButtons, errorEmbed } = require('../utils/embeds');
const { QUEUE_SIZE } = require('../config');
const { getQueueTimeoutMs } = require('../utils/modeTimers');
const { startDraft, peekNextGameNumber } = require('./draftManager');
const { findQueueBlockingGame } = require('./resultManager');
const { tagSeasonParticipant } = require('../utils/seasonDivider');
const { withLock } = require('../utils/guildLock');

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

// El refresco del mensaje de la cola se hace de a uno por cola (si dos
// refrescos con "bajar mensaje" corrían a la vez, cada uno mandaba su propio
// mensaje y quedaban 2 colas en el canal: una real y otra "huérfana").
function refreshQueueMessage(client, guildId, activityText, bump = false, modeKey = null) {
  return withLock(`msg:${timerBucketKey(guildId, modeKey)}`, () =>
    doRefreshQueueMessage(client, guildId, activityText, bump, modeKey)
  );
}

async function doRefreshQueueMessage(client, guildId, activityText, bump, modeKey) {
  const first = getGuild(guildId);
  const firstStore = getStore(first, modeKey);
  if (!firstStore) return;
  const firstRef = modeKey ? firstStore.queueMessage : first.queueMessage;
  if (!firstRef) return;
  const channel = await client.channels.fetch(firstRef.channelId).catch(() => null);
  if (!channel) return;

  // Se vuelve a leer la base ya con el canal en la mano, para que el embed
  // muestre la cola tal cual está AHORA (y no como estaba hace un momento).
  const guildData = getGuild(guildId);
  const store = getStore(guildData, modeKey);
  if (!store) return;
  const queueMessage = modeKey ? store.queueMessage : guildData.queueMessage;
  if (!queueMessage) return;

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
    const msg = await channel.send({ embeds: [embed], components }).catch(() => null);
    if (!msg) return;
    // Se guarda el id del mensaje nuevo sobre una copia FRESCA de la base:
    // guardar la que se leyó antes pisaba lo que otros hicieron mientras tanto.
    const fresh = getGuild(guildId);
    const freshStore = getStore(fresh, modeKey);
    const freshRef = modeKey ? freshStore?.queueMessage : fresh.queueMessage;
    if (freshRef) {
      freshRef.messageId = msg.id;
      saveGuild(guildId, fresh);
    }
  } else {
    const msg = await channel.messages.fetch(queueMessage.messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [embed], components }).catch(() => {});
  }
}

// --- Responder a un botón O a un slash command (/queue, /salir) -------------
// Se confirma la interacción de inmediato (Discord da solo 3 segundos) y
// después se trabaja con calma, por turnos.
async function ackInteraction(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try {
    if (interaction.isButton()) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    console.warn('[cola] No pude confirmar la interacción:', err.message);
  }
}

// Mensaje privado para quien tocó el botón / usó el comando.
async function tell(interaction, payload) {
  try {
    if (interaction.isButton()) return await interaction.followUp({ ...payload, ephemeral: true });
    return await interaction.editReply(payload);
  } catch (err) {
    return null;
  }
}

// Le pone el rol de temporada a quien se une, sin trabar la cola. Trabaja
// sobre su propia copia y después solo copia los 2 campos que toca, para no
// pisar nada de lo que pasó mientras Discord ponía el rol.
async function tagSeasonSafe(guild, guildId, userId) {
  try {
    const gd = getGuild(guildId);
    await tagSeasonParticipant(guild, gd, userId);
    const fresh = getGuild(guildId);
    fresh.seasonParticipants = { ...(fresh.seasonParticipants || {}), ...(gd.seasonParticipants || {}) };
    if (gd.seasonDividerRoleId) fresh.seasonDividerRoleId = gd.seasonDividerRoleId;
    saveGuild(guildId, fresh);
  } catch (err) {
    console.warn('[cola] No pude poner el rol de temporada:', err.message);
  }
}

// Arranca el draft de la cola si ya hay jugadores de sobra. startDraft
// vuelve a comprobarlo por dentro, así que aunque lo llamen dos a la vez
// solo se crea UNA partida.
async function maybeStartDraft(client, guildId, modeKey) {
  const guildData = getGuild(guildId);
  if (modeKey) {
    const mode = guildData.modes[modeKey];
    if (!mode) return;
    return startDraft(client, guildId, {
      modeKey,
      teamsCount: mode.teams,
      playersPerTeam: mode.playersPerTeam,
      pickSystem: mode.pickSystem
    });
  }
  return startDraft(client, guildId);
}

// Unirse a la cola. Sirve para el botón "Unirse", el botón de cada modo y el
// comando /queue. Los que se unen al mismo tiempo se atienden DE UNO EN UNO
// (en orden de llegada): cada uno revisa la cola ya con los anteriores
// adentro, así nunca se crean 2 colas ni se pierde a nadie.
// (El 3er parámetro se ignora a propósito: los datos se leen frescos adentro.)
async function joinQueue(client, interaction, _staleGuildData, modeKey = null) {
  await ackInteraction(interaction);
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const outcome = await withLock(`join:${timerBucketKey(guildId, modeKey)}`, async () => {
    const guildData = getGuild(guildId);
    const store = getStore(guildData, modeKey);
    if (!store) return { error: 'Esa cola ya no existe.' };

    if (store.queue.some(q => q.userId === userId)) {
      return { error: 'Ya estás en la cola.' };
    }
    const ban = guildData.bans[userId];
    const bannedHere = ban && (!ban.until || ban.until > Date.now()) &&
      (ban.mode === 'all' || !ban.mode || ban.mode === (modeKey || 'default'));
    if (bannedHere) {
      return { error: 'Estás baneado en esta cola y no puedes unirte.' };
    }

    const blocking = findQueueBlockingGame(guildData, userId, modeKey);
    if (blocking) {
      const blockingNumber = blocking.game.number ?? blocking.game.id;
      return {
        error: blocking.reason === 'drafting'
          ? `Todavía estás en el draft de la Game n°${blockingNumber}. Espera a que termine de armarse el equipo.`
          : `Antes de volver a unirte a la cola debes votar el resultado de tu Game n°${blockingNumber}.`
      };
    }

    // El límite de jugadores del plan (Free/Basic/Pro) es GLOBAL al servidor
    // (no por modo) y se mide con knownPlayerIds — quién se unió alguna vez a
    // CUALQUIER cola — para que no se pueda esquivar creando modos nuevos.
    const isNewPlayer = !guildData.knownPlayerIds[userId];
    if (isNewPlayer) {
      const { getLimits } = require('../utils/vip');
      const limits = getLimits(guildData);
      const currentTotal = Object.keys(guildData.knownPlayerIds).length;
      if (currentTotal >= limits.maxPlayers) {
        const firstAlert = !guildData.vip.limitAlerted;
        if (firstAlert) {
          guildData.vip.limitAlerted = true;
          saveGuild(guildId, guildData);
        }
        return {
          error:
            `Este servidor llegó al límite de **${limits.maxPlayers} jugadores** de su plan (${limits.label}). ` +
            `Como todavía no estás registrado, no podés unirte hasta que el servidor compre VIP para ampliar el cupo. Hablá con un administrador.`,
          vipPromo: firstAlert
        };
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
    saveGuild(guildId, guildData);

    return {
      ok: true,
      shouldStart: store.queue.length >= getTotalPlayers(guildData, modeKey),
      modeLabel: modeKey ? guildData.modes[modeKey].name : 'la cola por defecto',
      season: guildData.season || 1 // la temporada es una sola, compartida por todas las colas
    };
  });

  if (!outcome.ok) {
    await tell(interaction, { embeds: [errorEmbed(outcome.error)] });
    if (outcome.vipPromo) {
      const { vipPromoEmbed } = require('../utils/vip');
      const gd = getGuild(guildId);
      const channel = await client.channels.fetch(getQueueChannelId(gd, modeKey)).catch(() => null);
      if (channel) await channel.send({ embeds: [vipPromoEmbed(gd)] }).catch(() => null);
    }
    return;
  }

  armTimer(client, guildId, interaction.channel, userId, modeKey);

  // Le pone el rol de la temporada actual — solo a quien se une. Va aparte
  // para no hacer esperar a los demás.
  tagSeasonSafe(interaction.guild, guildId, userId);

  await refreshQueueMessage(client, guildId, `🟢 <@${userId}> se unió a la cola <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);

  // Confirmación privada (solo la ve quien tocó el botón) con en qué cola y
  // temporada quedó anotado — para que sepa a qué le va a contar el logro
  // que vaya consiguiendo, sobre todo si el server tiene varias colas.
  await tell(interaction, { content: `✅ Te uniste a **${outcome.modeLabel}** — Temporada ${outcome.season}.` });

  if (outcome.shouldStart) await maybeStartDraft(client, guildId, modeKey);
}

// Salir de la cola: botón "Salir" (de la cola o de un modo) y comando /salir.
async function leaveQueue(client, interaction, _staleGuildData, modeKey = null) {
  await ackInteraction(interaction);
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const result = await withLock(`join:${timerBucketKey(guildId, modeKey)}`, async () => {
    const guildData = getGuild(guildId);
    const store = getStore(guildData, modeKey);
    if (!store) return { error: 'Esa cola ya no existe.' };
    if (!store.queue.some(q => q.userId === userId)) return { error: 'No estás en la cola.' };
    store.queue = store.queue.filter(q => q.userId !== userId);
    saveGuild(guildId, guildData);
    return { ok: true };
  });

  if (!result.ok) {
    await tell(interaction, { embeds: [errorEmbed(result.error)] });
    return;
  }

  clearTimer(guildId, userId, modeKey);
  await refreshQueueMessage(client, guildId, `🔴 <@${userId}> salió de la cola <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);
  // Con el botón no hace falta avisar (se ve en el mensaje); con /salir sí.
  if (!interaction.isButton()) await tell(interaction, { content: '👋 Saliste de la cola.' });
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
  refreshQueueMessage, armTimer, clearTimer, resolveModeFromChannel, countActiveGames, resetQueue, maybeStartDraft
};

const { getGuild, saveGuild } = require('../database');
const { displayName } = require('../utils/names');
const { draftContainer, draftButtons, errorEmbed } = require('../utils/embeds');
const { QUEUE_SIZE } = require('../config');
const { getPickTimeoutMs } = require('../utils/modeTimers');
const { scheduleThreadDeletion } = require('../utils/threadCleanup');

const pickTimers = new Map(); // `${guildId}_${gameId}` -> Timeout

// El número de la próxima Game: si hay uno liberado por un draft cancelado
// (capitán AFK), se reutiliza ese antes de gastar uno nuevo. peekNextGameId
// no consume nada, solo sirve para mostrarlo en la vista previa de la cola.
// Este es el ID INTERNO (guardado como game.id, clave de guildData.games,
// usado en los customId de los botones). Es GLOBAL a todo el servidor a
// propósito, para que nunca haya dos partidas (de colas distintas) con el
// mismo ID interno al mismo tiempo — eso rompería los botones/lookup.
function peekNextGameId(guildData) {
  if (guildData.reusableGameIds && guildData.reusableGameIds.length > 0) {
    return guildData.reusableGameIds[0];
  }
  return guildData.nextGameId;
}

function takeNextGameId(guildData) {
  if (guildData.reusableGameIds && guildData.reusableGameIds.length > 0) {
    return guildData.reusableGameIds.shift();
  }
  return guildData.nextGameId++;
}

// El "número" que se le MUESTRA a la gente (Game n°X) es independiente por
// cola: cada cola (la de siempre, o cada modo) tiene su propia secuencia
// 1,2,3... que no se mezcla con la de ninguna otra. Esto es lo que corrige
// el bug de "dos colas cuentan como una sola" — antes se usaba el mismo
// contador global (peekNextGameId/takeNextGameId) para el número mostrado,
// así que la cola A veía "Game n°9" y la cola B, que arrancó un draft justo
// después, veía "Game n°10" aunque fueran partidas totalmente distintas.
function ensureNumberSeq(guildData, modeKey) {
  const store = modeKey ? guildData.modes[modeKey] : guildData;
  if (!store.numberSeq) {
    // La cola de siempre ya trae numberSeq sembrado desde database.js
    // (getGuild) para no resetear de golpe el número que venía mostrando.
    // Los modos (que antes compartían el contador global) arrancan su
    // propia secuencia limpia en 1, ahora que están separados.
    store.numberSeq = { next: 1, reusable: [] };
  }
  return store.numberSeq;
}

// Números de las partidas de esta cola que siguen abiertas (en draft o
// esperando resultado). Cuando /reset_season vuelve la numeración a 1, una
// partida que quedó abierta de antes podría chocar con un número nuevo: por
// eso se los salta.
function openGameNumbers(guildData, modeKey) {
  const open = new Set();
  for (const g of Object.values(guildData.games || {})) {
    if ((g.modeKey || null) !== (modeKey || null)) continue;
    if (g.status === 'drafting' || g.status === 'pending') open.add(g.number);
  }
  return open;
}

function pickGameNumber(seq, open) {
  const idx = seq.reusable.findIndex(n => !open.has(n));
  if (idx !== -1) return { value: seq.reusable[idx], reusableIdx: idx };
  let n = seq.next;
  while (open.has(n)) n++;
  return { value: n, reusableIdx: -1 };
}

function peekNextGameNumber(guildData, modeKey) {
  const seq = ensureNumberSeq(guildData, modeKey);
  return pickGameNumber(seq, openGameNumbers(guildData, modeKey)).value;
}

function takeNextGameNumber(guildData, modeKey) {
  const seq = ensureNumberSeq(guildData, modeKey);
  const pick = pickGameNumber(seq, openGameNumbers(guildData, modeKey));
  if (pick.reusableIdx !== -1) seq.reusable.splice(pick.reusableIdx, 1);
  else seq.next = pick.value + 1;
  return pick.value;
}

function releaseGameNumber(guildData, modeKey, number) {
  if (number == null) return;
  const seq = ensureNumberSeq(guildData, modeKey);
  seq.reusable.push(number);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draft "clásico" (snake), generalizado a cualquier cantidad de equipos.
 * Cada capitán ya tiene 1 jugador (a sí mismo), así que faltan
 * playersPerTeam-1 rondas. Ronda impar: orden derecho (0,1,2...). Ronda par:
 * orden invertido. Para 2 equipos x 4 jugadores da exactamente [0,1,1,0,0,1]
 * — el mismo patrón 1-2-2-1(+auto) que ya usaba el bot antes de generalizarse.
 */
function buildPickSequenceClassic(teamsCount, playersPerTeam) {
  const rounds = playersPerTeam - 1;
  const sequence = [];
  for (let r = 0; r < rounds; r++) {
    const order = Array.from({ length: teamsCount }, (_, t) => t);
    if (r % 2 === 1) order.reverse();
    sequence.push(...order);
  }
  return sequence;
}

/**
 * Draft "pick único": cada capitán elige exactamente 1 jugador por turno,
 * siempre en el mismo orden (0,1,2...,0,1,2...), sin dobles picks nunca.
 */
function buildPickSequenceSingle(teamsCount, playersPerTeam) {
  const rounds = playersPerTeam - 1;
  const sequence = [];
  for (let r = 0; r < rounds; r++) {
    for (let t = 0; t < teamsCount; t++) sequence.push(t);
  }
  return sequence;
}

function buildPickSequence(teamsCount, playersPerTeam, pickSystem) {
  if (pickSystem === 'single') return buildPickSequenceSingle(teamsCount, playersPerTeam);
  return buildPickSequenceClassic(teamsCount, playersPerTeam);
}

// Mantiene team1/team2/captain1/captain2 sincronizados con teams[]/captains[]
// para que el resto del bot (resultManager, embeds de resultados, anuncios)
// siga funcionando sin cambios mientras solo se usen 2 equipos, que es el
// único caso que existe hoy en producción.
function syncLegacyFields(game) {
  if (game.teamsCount === 2) {
    game.captain1 = game.captains[0];
    game.captain2 = game.captains[1];
    game.team1 = game.teams[0];
    game.team2 = game.teams[1];
  }
}

async function startDraft(client, guildId, options = {}) {
  const modeKey = options.modeKey || null;
  const teamsCount = options.teamsCount || 2;
  const playersPerTeam = options.playersPerTeam || (QUEUE_SIZE / 2);
  const pickSystem = options.pickSystem || 'classic';
  const totalPlayers = teamsCount * playersPerTeam;

  const guildData = getGuild(guildId);
  const store = modeKey ? guildData.modes[modeKey] : guildData;
  if (modeKey && !store.queue) store.queue = [];
  const queueChannelId = modeKey ? store.channelId : guildData.channels.queue;

  // Guarda anti-duplicados: si la cola ya no tiene los jugadores necesarios
  // (porque otro aviso simultáneo ya armó la partida y se llevó a esos
  // jugadores), no se hace nada. Esto evita que se creen 2 drafts a la vez.
  if (store.queue.length < totalPlayers) return;

  const players = store.queue.slice(0, totalPlayers).map(q => q.userId);

  // Los jugadores en captainBlacklist nunca son elegidos como capitanes
  // (pero sí pueden ser pickeados normalmente como jugadores). Un ban
  // manual (/captainban) no vence nunca. Ya NO existe el ban automático por
  // quedarse AFK al pickear.
  //
  // Este ban se respeta SIEMPRE: si entre los primeros de la cola no hay
  // suficientes jugadores elegibles para cubrir todos los capitanes, el
  // draft directamente NO arranca (y la cola no se toca) hasta que la
  // situación cambie — alguien se va, entra gente nueva, o un admin
  // desbanea a alguien. No hay excepción que lo salte.
  const blacklist = guildData.captainBlacklist || {};
  const now = Date.now();
  const isBlacklisted = id => {
    const b = blacklist[id];
    if (!b) return false;
    if (b.auto) return false; // el ban automático por AFK ya no existe: los que quedaron de antes se ignoran
    if (b.until && b.until <= now) return false;
    if (b.mode && b.mode !== 'all' && b.mode !== (modeKey || 'default')) return false; // baneado en OTRO modo, no en este
    return true;
  };
  const eligibleForCaptain = players.filter(id => !isBlacklisted(id));

  if (eligibleForCaptain.length < teamsCount) {
    const channel = await client.channels.fetch(queueChannelId).catch(() => null);
    if (channel) {
      await channel.send({
        content: `⚠️ La cola está completa, pero no hay suficientes jugadores elegibles para ser capitán (hacen falta ${teamsCount}, hay ${eligibleForCaptain.length}). El draft va a esperar hasta que la situación cambie.`
      }).catch(() => {});
    }
    return;
  }

  store.queue = store.queue.slice(totalPlayers);
  const shuffled = shuffle(players);
  const captainPool = shuffle(eligibleForCaptain);

  const captains = captainPool.slice(0, teamsCount);
  const remainingPlayers = shuffled.filter(id => !captains.includes(id));
  const teams = captains.map(id => [id]);

  // El último jugador que queda no necesita que nadie lo "elija" — no hay
  // ninguna decisión real ahí (es el único que sobra). Se recorta la
  // secuencia en 1 y se guarda a qué equipo le tocaría ese último pick,
  // para asignarlo solo apenas quede 1 jugador sin equipo.
  const fullSequence = buildPickSequence(teamsCount, playersPerTeam, pickSystem);
  const lastTeamIndex = fullSequence.length ? fullSequence[fullSequence.length - 1] : null;
  const pickSequence = fullSequence.slice(0, -1);

  // Si cada equipo tiene 1 solo jugador (1v1, o un FFA de a 1), cada capitán
  // YA ES el equipo completo — no hay nada que pickear. Antes esto rompía el
  // draft: pickSequence quedaba vacío, currentCaptain terminaba en
  // "undefined" y el hilo se quedaba trabado sin botones para pickear a
  // nadie. Ahora, en ese caso, se salta el draft directo y se pasa a la
  // votación del resultado.
  const noPicksNeeded = pickSequence.length === 0;

  const gameId = takeNextGameId(guildData);
  const gameNumber = takeNextGameNumber(guildData, modeKey);
  const game = {
    id: gameId,
    number: gameNumber,
    status: noPicksNeeded ? 'pending' : 'drafting',
    modeKey,
    teamsCount,
    playersPerTeam,
    pickSystem,
    captains,
    teams,
    remainingPlayers,
    pickSequence,
    lastTeamIndex,
    pickIndex: 0,
    currentCaptain: noPicksNeeded ? null : captains[pickSequence[0]],
    threadId: null,
    pickDeadline: null,
    votes: { team1: [], team2: [], draw: [], cancel: [] },
    createdAt: Date.now()
  };
  syncLegacyFields(game);
  guildData.games[gameId] = game;
  saveGuild(guildId, guildData);

  // Refresca el mensaje de la cola para que el contador de "partidas en
  // curso" suba de inmediato (require diferido: evita el ciclo con
  // queueManager, que a su vez requiere cosas de este archivo).
  const { refreshQueueMessage } = require('./queueManager');
  await refreshQueueMessage(client, guildId, null, false, modeKey).catch(() => {});

  // Se arma el timer (y su deadline, para mostrar la cuenta regresiva) antes
  // de publicar el primer embed del draft. Si no hay picks, no hay timer que
  // armar — no hay ningún capitán esperando a que le toque.
  if (!noPicksNeeded) {
    armPickTimer(client, guildId, gameId);
  }

  const channel = await client.channels.fetch(queueChannelId).catch(() => null);
  if (!channel) return;

  const thread = await channel.threads.create({
    name: `Game n°${gameNumber}`,
    autoArchiveDuration: 1440,
    reason: 'Draft de partida'
  }).catch(() => null);

  if (thread) {
    const gd = getGuild(guildId);
    const g = gd.games[gameId];
    if (g) {
      g.threadId = thread.id;
      saveGuild(guildId, gd);
    }
    await thread.send({ content: players.map(id => `<@${id}>`).join(' ') });

    if (noPicksNeeded) {
      await thread.send({ content: '✅ 1 jugador por equipo — no hace falta draft, los equipos ya quedaron armados.' });
      const { postResultVote } = require('./resultManager');
      await postResultVote(client, guildId, gameId);
    } else {
      await postDraftState(client, guildId, gameId);
    }
  }

  // Apenas arranca la partida, el mensaje de la cola se baja al fondo del
  // canal (se borra el viejo y se publica uno nuevo), para que quede debajo
  // del aviso del hilo y los jugadores lo vean enseguida para volver a unirse.
  await refreshQueueMessage(client, guildId, null, true, modeKey).catch(() => {});

  if (noPicksNeeded) return;

  // Aviso por DM al primer capitán — con guarda contra duplicados: si por
  // error hay más de un proceso del bot corriendo a la vez (dos pm2, un
  // redeploy que no mató bien la instancia vieja, etc.), esto evita que se
  // manden 2 o 3 DMs iguales para el mismo pick.
  const firstCaptain = captains[pickSequence[0]];
  const freshForDm = getGuild(guildId);
  const freshGame = freshForDm.games[gameId];
  if (freshGame && freshGame.notifiedPickIndex !== 0) {
    freshGame.notifiedPickIndex = 0;
    saveGuild(guildId, freshForDm);
    const cap = await client.users.fetch(firstCaptain).catch(() => null);
    if (cap) {
      const p = guildData.players[firstCaptain];
      if (!p || !p.dmTagDisabled) {
        await cap.send(`Te tocó pickear en la Game n°${gameNumber}. Ve al hilo del servidor para elegir a tu jugador.`).catch(() => {});
      }
    }
  }
}

async function postDraftState(client, guildId, gameId) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game || !game.threadId) return;
  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (!thread) return;

  const { resolveGameContext } = require('../database');
  const { store, label } = resolveGameContext(guildData, game);
  const embed = draftContainer(store, game, label);
  const buttonRows = draftButtons(store, game);
  await thread.send({ embeds: [embed], components: buttonRows });
}

function armPickTimer(client, guildId, gameId) {
  const key = `${guildId}_${gameId}`;
  if (pickTimers.has(key)) clearTimeout(pickTimers.get(key));

  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  // El tiempo de pick es configurable por modo (/pick_time).
  const pickMs = getPickTimeoutMs(guildData, game?.modeKey || null);
  if (game) {
    game.pickDeadline = Date.now() + pickMs;
    saveGuild(guildId, guildData);
  }

  const t = setTimeout(() => handlePickTimeout(client, guildId, gameId), pickMs);
  pickTimers.set(key, t);
}

function clearPickTimer(guildId, gameId) {
  const key = `${guildId}_${gameId}`;
  if (pickTimers.has(key)) {
    clearTimeout(pickTimers.get(key));
    pickTimers.delete(key);
  }
}

/**
 * Se dispara cuando un capitán no pickea a tiempo: se lo saca de la
 * partida entera (no solo se salta su turno), los demás jugadores de esa
 * Game vuelven a la cola (adelante de todos), y si con eso la cola ya
 * llega al cupo completo, arranca un draft nuevo al toque. El capitán AFK
 * ya NO recibe ningún ban de capitán por esto.
 */
async function handlePickTimeout(client, guildId, gameId) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game || game.status !== 'drafting') return;

  const afkCaptainId = game.currentCaptain;
  const { resolveGameContext } = require('../database');
  const { store: gameStore } = resolveGameContext(guildData, game);
  const afkName = displayName(gameStore, afkCaptainId);
  const others = [...game.teams.flat(), ...game.remainingPlayers].filter(id => id !== afkCaptainId);

  game.status = 'cancelled';
  game.cancelReason = 'afk_captain';
  clearPickTimer(guildId, gameId);

  // Esta Game prácticamente no se jugó (nadie completó el draft), así que
  // su número se libera para la próxima partida en vez de quemarse — tanto
  // el ID interno (global) como el número mostrado (de SU cola puntual).
  guildData.reusableGameIds = guildData.reusableGameIds || [];
  guildData.reusableGameIds.push(gameId);
  releaseGameNumber(guildData, game.modeKey, game.number);

  // Re-encolar a los otros, reiniciando su tiempo de inactividad en la cola
  // del modo correspondiente (o la cola de siempre, si es una game legacy).
  const store = game.modeKey ? guildData.modes[game.modeKey] : guildData;
  const now = Date.now();
  store.queue = store.queue.filter(q => !others.includes(q.userId));
  store.queue = [...others.map(userId => ({ userId, joinedAt: now })), ...store.queue];
  saveGuild(guildId, guildData);

  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (thread) {
    await thread.send({
      content: `⏱️ **${afkName}** no pickeó a tiempo y quedó AFK. La Game n°${game.number} fue cancelada y los otros ${others.length} jugadores volvieron a la cola.`
    });
  }
  await scheduleThreadDeletion(client, game.threadId, `Game n°${game.number} cancelada por capitán AFK`);

  // Requiere queueManager solo acá adentro para evitar el require circular
  // (queueManager ya requiere draftManager arriba).
  const queueManager = require('./queueManager');
  for (const userId of others) {
    queueManager.armTimer(client, guildId, null, userId, game.modeKey);
  }
  await queueManager.refreshQueueMessage(
    client,
    guildId,
    `${afkName} estaba AFK y fue removido de la Game n°${game.number}. La cola se re-formó con los otros ${others.length} jugadores.`,
    false,
    game.modeKey
  );

  // Si con los que vuelven (+ quien ya estuviera esperando) la cola llega
  // al cupo, se arma un draft nuevo de una, sin esperar a que alguien más
  // se una a mano.
  const refreshed = getGuild(guildId);
  const refreshedStore = game.modeKey ? refreshed.modes[game.modeKey] : refreshed;
  const totalNeeded = game.modeKey ? refreshedStore.totalPlayers : QUEUE_SIZE;
  if (refreshedStore.queue.length >= totalNeeded) {
    await startDraft(client, guildId, game.modeKey ? {
      modeKey: game.modeKey,
      teamsCount: refreshedStore.teamsCount,
      playersPerTeam: refreshedStore.playersPerTeam,
      pickSystem: refreshedStore.pickSystem
    } : {});
  }
}

async function resolvePick(client, guildId, gameId, pickedUserId, wasAuto = false) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game || game.status !== 'drafting') return;

  const teamIndex = game.pickSequence[game.pickIndex];
  game.teams[teamIndex].push(pickedUserId);
  game.remainingPlayers = game.remainingPlayers.filter(id => id !== pickedUserId);
  game.pickIndex += 1;

  if (game.pickIndex >= game.pickSequence.length) {
    // Si por algún motivo queda 1 jugador suelto (no debería pasar con la
    // secuencia generalizada, pero se cubre por las dudas), se lo asigna al
    // último equipo que pickeó.
    if (game.remainingPlayers.length === 1) {
      const lastTeamIndex = game.lastTeamIndex ?? game.pickSequence[game.pickSequence.length - 1];
      game.teams[lastTeamIndex].push(game.remainingPlayers[0]);
      game.remainingPlayers = [];
    }
    syncLegacyFields(game);
    game.status = 'pending';
    game.currentCaptain = null;
    game.pickDeadline = null;
    clearPickTimer(guildId, gameId);
    saveGuild(guildId, guildData);

    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) {
      await thread.send({ content: '✅ Draft terminado. El equipo quedó armado.' });
    }

    const { postResultVote } = require('./resultManager');
    await postResultVote(client, guildId, gameId);
    return;
  }

  const nextTeamIndex = game.pickSequence[game.pickIndex];
  game.currentCaptain = game.captains[nextTeamIndex];
  syncLegacyFields(game);
  saveGuild(guildId, guildData);

  armPickTimer(client, guildId, gameId);
  await postDraftState(client, guildId, gameId);

  // Misma guarda contra duplicados que en el primer pick: si dos procesos
  // del bot llegan a estar corriendo a la vez, esto evita mandar el mismo
  // DM 2 o 3 veces para el mismo turno.
  const freshForDm = getGuild(guildId);
  const freshGame = freshForDm.games[gameId];
  if (freshGame && freshGame.notifiedPickIndex !== game.pickIndex) {
    freshGame.notifiedPickIndex = game.pickIndex;
    saveGuild(guildId, freshForDm);
    const nextCaptainUser = await client.users.fetch(game.currentCaptain).catch(() => null);
    if (nextCaptainUser) {
      const p = guildData.players[game.currentCaptain];
      if (!p || !p.dmTagDisabled) {
        await nextCaptainUser.send(`Te toca pickear en la Game n°${game.number}.`).catch(() => {});
      }
    }
  }
}

module.exports = {
  startDraft, resolvePick, armPickTimer, clearPickTimer,
  peekNextGameId, peekNextGameNumber, takeNextGameNumber, releaseGameNumber
};

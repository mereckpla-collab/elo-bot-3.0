const { getGuild, saveGuild, resolveGameContext } = require('../database');
const { resultEmbed, resultButtons, gameAnnouncementEmbed, errorEmbed, joinNextQueueButton } = require('../utils/embeds');
const { applyGameResult, applyRankedGameResult, revertGameResult } = require('../utils/elo');
const { scheduleThreadDeletion } = require('../utils/threadCleanup');
const { checkAndGrantAchievements } = require('./achievements');

/**
 * Publica el embed para votar el resultado. Se publica en el mismo hilo que
 * se creó para el draft de esa partida (game.threadId); solo si por algún
 * motivo no existe el hilo (p. ej. no se pudo crear), se usa el canal
 * submit como respaldo.
 */
async function postResultVote(client, guildId, gameId) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game) return;

  const targetChannelId = game.threadId || guildData.channels.submit;
  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel) return;

  const { store, label } = resolveGameContext(guildData, game);
  const embed = resultEmbed(store, game, null, label);
  const msg = await channel.send({ embeds: [embed], components: resultButtons(game) });
  game.resultMessage = { channelId: channel.id, messageId: msg.id };
  saveGuild(guildId, guildData);
}

/** Publica el anuncio final (ganó/perdió/empate/cancelada) en game_announcement. */
async function postGameAnnouncement(client, guildId, gameId, changes, outcome, opts) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game) return;

  const channelId = guildData.channels.game_announcement;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const { store, label } = resolveGameContext(guildData, game);
  const embed = gameAnnouncementEmbed(store, game, changes, outcome, opts, label);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

/**
 * Busca si el jugador tiene una partida en estado 'pending' (draft terminado,
 * esperando resultado) en la que participó y todavía no votó. Se usa para
 * bloquear el reingreso a la cola hasta que vote. Si se pasa modeKey, solo
 * mira partidas de ESA cola — estar pendiente de votar en la cola A no debe
 * bloquear el ingreso a la cola B, son cosas totalmente independientes.
 */
function findPendingVoteGame(guildData, userId, modeKey) {
  for (const game of Object.values(guildData.games)) {
    if (modeKey !== undefined && (game.modeKey || null) !== (modeKey || null)) continue;
    if (game.status !== 'pending') continue;
    const allPlayers = game.teams ? game.teams.flat() : [...game.team1, ...game.team2];
    if (!allPlayers.includes(userId)) continue;
    const votes = game.votes || {};
    const alreadyVoted = Object.values(votes).some(arr => arr.includes(userId));
    if (!alreadyVoted) return game;
  }
  return null;
}

/**
 * Busca si el jugador está participando ahora mismo en un draft en curso
 * (status 'drafting'), ya sea como capitán, ya elegido en un equipo, o
 * todavía disponible para ser pickeado. Se usa para bloquear el ingreso a
 * la cola mientras esa partida no termine de armarse. Igual que arriba,
 * scoped por modeKey si se pasa: un draft en la cola A no bloquea la cola B.
 */
function findActiveDraftGame(guildData, userId, modeKey) {
  for (const game of Object.values(guildData.games)) {
    if (modeKey !== undefined && (game.modeKey || null) !== (modeKey || null)) continue;
    if (game.status !== 'drafting') continue;
    const allPlayers = game.teams ? game.teams.flat() : [...game.team1, ...game.team2];
    const involved = allPlayers.includes(userId) || game.remainingPlayers.includes(userId);
    if (involved) return game;
  }
  return null;
}

/**
 * Combina ambos chequeos: devuelve { game, reason } si el jugador no puede
 * unirse a la cola todavía, o null si puede. modeKey identifica A CUÁL cola
 * se está tratando de unir — solo bloquea por partidas de ESA MISMA cola.
 */
function findQueueBlockingGame(guildData, userId, modeKey) {
  const draftGame = findActiveDraftGame(guildData, userId, modeKey);
  if (draftGame) return { game: draftGame, reason: 'drafting' };
  const pendingGame = findPendingVoteGame(guildData, userId, modeKey);
  if (pendingGame) return { game: pendingGame, reason: 'pending_vote' };
  return null;
}

function isEloAdmin(interaction, guildData) {
  if (!guildData.adminRoleId) return false;
  return interaction.member?.roles?.cache?.has(guildData.adminRoleId);
}

async function handleVote(client, interaction, guildData, gameId, choice) {
  const game = guildData.games[gameId];
  if (!game) {
    return interaction.reply({ embeds: [errorEmbed('Esa partida ya no existe.')], ephemeral: true });
  }
  if (game.status === 'finished' || game.status === 'cancelled') {
    return interaction.reply({ embeds: [errorEmbed('Esa partida ya tiene un resultado.')], ephemeral: true });
  }

  const userId = interaction.user.id;
  const allPlayers = game.teams ? game.teams.flat() : [...game.team1, ...game.team2];
  const isPlayer = allPlayers.includes(userId);
  const admin = isEloAdmin(interaction, guildData);

  if (!isPlayer && !admin) {
    return interaction.reply({ embeds: [errorEmbed('Solo los jugadores de esta partida o un Elo Admin pueden votar.')], ephemeral: true });
  }

  // Con más de 2 equipos no hay voto de jugadores (ver resultButtons): solo
  // "Cancelar" llega hasta acá, y solo lo puede tocar un Elo Admin.
  if ((game.teamsCount || 2) > 2) {
    if (!admin) {
      return interaction.reply({ embeds: [errorEmbed('En partidas de más de 2 equipos, solo un Elo Admin puede cancelar o cargar el resultado.')], ephemeral: true });
    }
    await interaction.deferUpdate();
    await resolveResult(client, interaction.guildId, gameId, 'cancel');
    return;
  }

  if (admin) {
    await interaction.deferUpdate();
    await resolveResult(client, interaction.guildId, gameId, choice);
    return;
  }

  // Quitar el voto previo de este usuario en cualquier opción, y añadirlo a la nueva.
  for (const key of Object.keys(game.votes)) {
    game.votes[key] = game.votes[key].filter(id => id !== userId);
  }
  game.votes[choice].push(userId);
  saveGuild(interaction.guildId, guildData);

  await interaction.deferUpdate();

  // Cuántos votos hacen falta para confirmar un resultado: mayoría estricta
  // de TODOS los jugadores de la partida — la mitad más uno (no la mitad
  // justa). Para 4v4 (8 jugadores) son 5 votos; para 2v2 (4) son 3; para
  // 1v1 (2) tienen que votar los dos.
  const votesNeeded = Math.floor(allPlayers.length / 2) + 1;

  if (game.votes[choice].length >= votesNeeded) {
    await resolveResult(client, interaction.guildId, gameId, choice);
  } else {
    const { store, label } = resolveGameContext(guildData, game);
    const embed = resultEmbed(store, game, null, label);
    await interaction.editReply({ embeds: [embed], components: resultButtons(game) }).catch(() => {});
  }
}

async function resolveResult(client, guildId, gameId, outcome) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game) return;

  if (outcome === 'cancel') {
    game.status = 'cancelled';
    saveGuild(guildId, guildData);
    await editResultMessage(client, guildId, gameId, null, 'Partida cancelada. No afecta rachas ni elo.');
    await postGameAnnouncement(client, guildId, gameId, null, 'cancel');
    await scheduleThreadDeletion(client, game.threadId, `Game n°${gameId} cancelada`);
    const { refreshQueueMessage } = require('./queueManager');
    await refreshQueueMessage(client, guildId, null, false, game.modeKey).catch(() => {});
    return;
  }

  // El elo se aplica en la economía de ESTA partida — la de siempre, o la
  // del modo puntual si se jugó en una cola de modo — nunca se mezcla con
  // la de otro modo.
  const { store } = resolveGameContext(guildData, game);
  const team1Players = game.team1.map(id => store.players[id]).filter(Boolean);
  const team2Players = game.team2.map(id => store.players[id]).filter(Boolean);

  const changes = applyGameResult(store, team1Players, team2Players, outcome);
  game.status = 'finished';
  game.result = outcome;
  game.eloChanges = changes;
  saveGuild(guildId, guildData);

  const note = outcome === 'draw' ? 'La partida terminó en empate.' :
    outcome === 'team1' ? 'Ganó el Team n°1.' : 'Ganó el Team n°2.';
  await editResultMessage(client, guildId, gameId, changes, note);
  await postGameAnnouncement(client, guildId, gameId, changes, outcome);
  await checkAndGrantAchievements(client, guildId, game.modeKey, Object.keys(changes));
  await scheduleThreadDeletion(client, game.threadId, `Game n°${gameId} finalizada`);
  const { refreshQueueMessage } = require('./queueManager');
  await refreshQueueMessage(client, guildId, null, false, game.modeKey).catch(() => {});
}

/**
 * Valida y parsea el texto que escribe el admin en el modal de ranking
 * (ej. "3,1,4,2") contra la cantidad de equipos de la partida. Devuelve
 * { ok: true, order: [2,0,3,1] } (índices de equipo 0-based, en orden de
 * puesto) o { ok: false, error: '...' }.
 */
function parseRankingInput(raw, teamsCount) {
  const parts = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length !== teamsCount) {
    return { ok: false, error: `Tenés que poner los ${teamsCount} equipos, separados por coma (ej. ${Array.from({ length: teamsCount }, (_, i) => i + 1).join(',')}).` };
  }
  const nums = parts.map(p => parseInt(p, 10));
  if (nums.some(n => !Number.isInteger(n) || n < 1 || n > teamsCount)) {
    return { ok: false, error: `Cada número tiene que ser un equipo válido, del 1 al ${teamsCount}.` };
  }
  const uniq = new Set(nums);
  if (uniq.size !== teamsCount) {
    return { ok: false, error: 'No podés repetir ni saltearte ningún equipo — cada uno aparece una sola vez, del 1° al último puesto.' };
  }
  return { ok: true, order: nums.map(n => n - 1) };
}

/** Aplica el resultado por ranking (3+ equipos). order = índices de equipo 0-based, en orden de puesto (index0 = 1°). */
async function resolveRankedResult(client, guildId, gameId, order) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game) return;

  const { store } = resolveGameContext(guildData, game);
  const rankedTeams = order.map(teamIdx => game.teams[teamIdx].map(id => store.players[id]).filter(Boolean));
  const changes = applyRankedGameResult(store, rankedTeams);

  game.status = 'finished';
  game.result = 'ranked';
  game.ranking = order;
  game.eloChanges = changes;
  saveGuild(guildId, guildData);

  const note = `Puesto final: ${order.map((teamIdx, pos) => `${pos + 1}° Team n°${teamIdx + 1}`).join(' · ')}`;
  await editResultMessage(client, guildId, gameId, changes, note);
  await postGameAnnouncement(client, guildId, gameId, changes, 'ranked');
  await checkAndGrantAchievements(client, guildId, game.modeKey, Object.keys(changes));
  await scheduleThreadDeletion(client, game.threadId, `Game n°${gameId} finalizada`);
  const { refreshQueueMessage } = require('./queueManager');
  await refreshQueueMessage(client, guildId, null, false, game.modeKey).catch(() => {});
}

async function editResultMessage(client, guildId, gameId, changes, note) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game || !game.resultMessage) return;
  const channel = await client.channels.fetch(game.resultMessage.channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(game.resultMessage.messageId).catch(() => null);
  if (!msg) return;

  const { store, label } = resolveGameContext(guildData, game);
  const embed = resultEmbed(store, game, changes, label);
  if (note) embed.setDescription(note);
  // Una vez decidido el resultado ya no hace falta seguir votando — se
  // reemplazan los botones de voto por uno solo para volver a anotarse a
  // la misma cola sin salir del hilo.
  await msg.edit({ embeds: [embed], components: [joinNextQueueButton(game.modeKey)] }).catch(() => {});
}

/** Usado por /revertir: revierte el resultado anterior (si existía) y aplica el nuevo.
 *  newOutcome puede ser 'team1'|'team2'|'draw'|'cancel' (2 equipos), o
 *  { ranked: [índices de equipo en orden de puesto] } para 3+ equipos. */
async function revertAndReapply(client, guildId, gameId, newOutcome) {
  const guildData = getGuild(guildId);
  const game = guildData.games[gameId];
  if (!game) return { ok: false, reason: 'Esa partida no existe.' };

  const { store } = resolveGameContext(guildData, game);

  if (game.eloChanges) {
    revertGameResult(store, game.eloChanges);
  }

  if (newOutcome === 'cancel') {
    game.status = 'cancelled';
    game.result = null;
    game.ranking = null;
    game.eloChanges = null;
    saveGuild(guildId, guildData);
    await postGameAnnouncement(client, guildId, gameId, null, 'cancel', { reverted: true });
    return { ok: true, changes: null };
  }

  if (typeof newOutcome === 'object' && newOutcome && newOutcome.ranked) {
    const order = newOutcome.ranked;
    const rankedTeams = order.map(teamIdx => game.teams[teamIdx].map(id => store.players[id]).filter(Boolean));
    const changes = applyRankedGameResult(store, rankedTeams);
    game.status = 'finished';
    game.result = 'ranked';
    game.ranking = order;
    game.eloChanges = changes;
    saveGuild(guildId, guildData);
    await postGameAnnouncement(client, guildId, gameId, changes, 'ranked', { reverted: true });
    await checkAndGrantAchievements(client, guildId, game.modeKey, Object.keys(changes));
    return { ok: true, changes };
  }

  const team1Players = game.team1.map(id => store.players[id]).filter(Boolean);
  const team2Players = game.team2.map(id => store.players[id]).filter(Boolean);
  const changes = applyGameResult(store, team1Players, team2Players, newOutcome);
  game.status = 'finished';
  game.result = newOutcome;
  game.eloChanges = changes;
  saveGuild(guildId, guildData);
  await postGameAnnouncement(client, guildId, gameId, changes, newOutcome, { reverted: true });
  await checkAndGrantAchievements(client, guildId, game.modeKey, Object.keys(changes));
  return { ok: true, changes };
}

module.exports = {
  postResultVote, postGameAnnouncement, handleVote, resolveResult, resolveRankedResult,
  parseRankingInput, revertAndReapply, isEloAdmin,
  findPendingVoteGame, findActiveDraftGame, findQueueBlockingGame
};
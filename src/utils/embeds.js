const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const { COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARN, QUEUE_SIZE } = require('../config');
const { displayName } = require('./names');
const { rankProgress, rankLabel, progressBar, rankBadge, rankHistoryText } = require('./ranks');

function queueEmbed(guildData, gameId, lastActivity, queueArr, totalPlayers, modeLabel, activeGames = 0) {
  const arr = queueArr || guildData.queue;
  const total = totalPlayers || QUEUE_SIZE;
  const filled = arr.length;
  const bar = '🟩'.repeat(filled) + '⬛'.repeat(Math.max(0, total - filled));

  const players = arr.map(q => {
    const p = guildData.players[q.userId];
    return `👤 **${displayName(guildData, q.userId)}**: ${p ? p.elo : 0}`;
  });

  const title = modeLabel ? `🎮 ${modeLabel}-queue n°${gameId}` : `🎮 Game n°${gameId}`;
  const SEP = '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯';

  const lines = [
    SEP,
    '👥 **__Jugadores__**',
    players.length ? players.join('\n') : '—',
    `**Cupo · [${filled} / ${total}]**`,
    bar
  ];

  if (activeGames > 0) {
    lines.push(SEP, `🟢 **${activeGames}** partida${activeGames > 1 ? 's' : ''} en curso ahora mismo`);
  }

  if (lastActivity) {
    lines.push(SEP, lastActivity);
  }

  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(title)
    .setDescription(lines.join('\n'));
}

function queueButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('queue_join').setLabel('Unirse').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('queue_leave').setLabel('Salir').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('queue_bump').setLabel('Queue').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('queue_refresh').setLabel('Refrescar').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('queue_moderator').setLabel('🛠️ Moderador').setStyle(ButtonStyle.Secondary)
    )
  ];
}

// Misma idea que queueButtons(), pero para la cola propia de un modo
// (Etapa 3b). El modeKey va codificado en el customId para que
// interactionCreate.js sepa a qué cola/modo pertenece cada click.
function modeQueueButtons(modeKey) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mq_join_${modeKey}`).setLabel('Unirse').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`mq_leave_${modeKey}`).setLabel('Salir').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`mq_bump_${modeKey}`).setLabel('Queue').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`mq_refresh_${modeKey}`).setLabel('Refrescar').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mq_moderator_${modeKey}`).setLabel('🛠️ Moderador').setStyle(ButtonStyle.Secondary)
    )
  ];
}

// Botón que se muestra debajo del resultado YA decidido (reemplaza los
// botones de voto una vez que la partida se cierra): re-unirse a la MISMA
// cola de una sola tocada, sin tener que ir hasta el canal de la cola.
// joinQueue() ya se encarga de todo lo demás (bans, límite de VIP, no
// dejar entrar si sigue en otra partida pendiente, etc.) — este botón solo
// dispara esa misma función.
function joinNextQueueButton(modeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`joinnext_${modeKey || '__default__'}`).setLabel('Unirse a Siguiente Cola').setEmoji('➡️').setStyle(ButtonStyle.Success)
  );
}

// Mismo estilo "clásico" (EmbedBuilder + fields) que resultEmbed, en vez del
// Container de Components V2 que usaba antes.
function draftContainer(guildData, game, modeLabel) {
  const eloOf = id => guildData.players[id]?.elo ?? 0;
  // Nombre bien grande y en negrita, elo al lado — mismo estilo que la
  // referencia (letras grandes con ### para los títulos, negrita para lo
  // demás en vez de campos chiquitos separados).
  const playerLine = id => `**${displayName(guildData, id)}**: ${eloOf(id)}`;

  // teams/captains generalizado (N equipos). Si es un draft viejo guardado
  // antes de esta versión (solo tiene team1/team2), se arma el array acá
  // mismo para no romper partidas que ya estaban en curso.
  const teams = game.teams || [game.team1, game.team2];
  const captains = game.captains || [game.captain1, game.captain2];
  const teamEmojis = ['🔴', '🔵', '🟡', '🟢', '🟣', '🟠'];

  const deadlineTag = game.pickDeadline ? `<t:${Math.floor(game.pickDeadline / 1000)}:R>` : null;
  const gameNumber = game.number ?? game.id;
  const title = modeLabel ? `🎯 Draft — ${modeLabel} n°${gameNumber}` : `🎯 Draft — Game n°${gameNumber}`;

  const teamBlocks = teams.map((team, i) => {
    const isCurrent = captains[i] === game.currentCaptain;
    const lines = [
      `### ${teamEmojis[i % teamEmojis.length]} Team n°${i + 1}`,
      `**Capitán:** <@${captains[i]}>`
    ];
    if (isCurrent) {
      lines.push('', '**🕐 Le toca pickear ahora**', deadlineTag ? `Le queda: ${deadlineTag}` : null);
    }
    lines.push('', team.length ? team.map(playerLine).join('\n') : '—');
    return lines.filter(line => line !== null).join('\n');
  });

  const remainingBlock = [
    '### 👥 Jugadores disponibles',
    game.remainingPlayers.length ? game.remainingPlayers.map(playerLine).join('\n') : '—'
  ].join('\n');

  const description = [...teamBlocks, remainingBlock].join('\n\n**⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯**\n\n');

  return new EmbedBuilder().setColor(COLOR_PRIMARY).setTitle(title).setDescription(description);
}

function draftButtons(guildData, game) {
  const rows = [];
  let row = new ActionRowBuilder();
  game.remainingPlayers.forEach((id, i) => {
    if (i > 0 && i % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    const elo = guildData.players[id]?.elo ?? 0;
    const label = `${displayName(guildData, id)} (${elo})`.slice(0, 80);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`pick_${game.id}_${id}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Success)   // 👈 antes era ButtonStyle.Secondary
    );
  });
  rows.push(row);

  // Botón de pick al azar: ignora el elo, elige cualquiera de los jugadores
  // disponibles. Va en su propia fila al final.
  const randomRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pickrandom_${game.id}`)
      .setLabel('Random')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Primary) // Primary = azul
  );
  rows.push(randomRow);

  return rows;
}

const SEPARATOR = { name: '\u200b', value: '**⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯**', inline: false };

/** Línea de "quién votó qué", para mostrar arriba del embed mientras la partida está pendiente de resultado. */
function voteStatusBlock(game) {
  const votes = game.votes || { team1: [], team2: [], draw: [], cancel: [] };
  const mentions = ids => (ids.length ? ids.map(id => `<@${id}>`).join(' ') : '—');

  const lines = [
    `1️⃣ **Team 1** (${votes.team1.length}) → ${mentions(votes.team1)}`,
    `2️⃣ **Team 2** (${votes.team2.length}) → ${mentions(votes.team2)}`,
    `🤝 **Empate** (${votes.draw.length}) → ${mentions(votes.draw)}`,
    `❌ **Cancelar** (${votes.cancel.length}) → ${mentions(votes.cancel)}`
  ];
  return `### 🗳️ Votación\n${lines.join('\n')}`;
}

function resultEmbed(guildData, game, changes, modeLabel) {
  const gameNumber = game.number ?? game.id;
  const title = modeLabel ? `🎮 ${modeLabel} n°${gameNumber}` : `🎮 Game n°${gameNumber}`;
  const embed = new EmbedBuilder().setColor(COLOR_PRIMARY).setTitle(title);

  const teamBlock = team => team.map(id => `${displayName(guildData, id)}: \`${guildData.players[id]?.elo ?? 0}\``).join('\n') || '—';
  const teams = game.teams || [game.team1, game.team2];

  // Mientras la partida sigue esperando votos, mostramos arriba quién votó qué.
  if (game.status === 'pending' && !changes && !game.ranking) {
    embed.setDescription(voteStatusBlock(game));
  }

  embed.addFields(
    SEPARATOR,
    ...teams.map((team, i) => ({ name: `🔷 Team n°${i + 1}`, value: teamBlock(team), inline: true }))
  );

  if (game.ranking) {
    const places = ['🥇', '🥈', '🥉'];
    const lines = game.ranking.map((teamIdx, pos) => `${places[pos] || `${pos + 1}°`} Team n°${teamIdx + 1}`);
    embed.addFields(SEPARATOR, { name: '🏁 Puesto final', value: lines.join('\n') });
  }

  if (changes) {
    const nameWidth = 14;
    const header = `${'Jugador'.padEnd(nameWidth)} Antes  Ahora   Racha    +/-`;
    const sep = '─'.repeat(header.length);
    const lines = [];
    for (const id of teams.flat()) {
      const c = changes[id];
      if (!c) continue;
      const arrow = c.delta > 0 ? `+${c.delta}` : `${c.delta}`;
      const streakIcon = c.streakAfter > 0 ? '📈' : c.streakAfter < 0 ? '📉' : '➖';
      const name = displayName(guildData, id).slice(0, nameWidth).padEnd(nameWidth);
      const racha = `${c.streakBefore} → ${c.streakAfter}`.padEnd(8);
      lines.push(`${name} ${String(c.before).padStart(5)}  ${String(c.after).padStart(5)}  ${racha} ${arrow.padStart(4)} ${streakIcon}`);
    }
    embed.addFields(
      SEPARATOR,
      { name: '📊 Resultado', value: ['```', header, sep, lines.join('\n'), '```'].join('\n') }
    );
  }

  return embed;
}

function resultButtons(game) {
  // Con más de 2 equipos no hay botones de "quién ganó" (son demasiadas
  // combinaciones posibles) — un Elo Admin carga el puesto final con un
  // formulario (botón "Cargar ranking").
  if ((game.teamsCount || 2) > 2) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rank_${game.id}`).setLabel('Cargar ranking (Admin)').setEmoji('🏆').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vote_${game.id}_cancel`).setLabel('Cancelar (Admin)').setEmoji('❌').setStyle(ButtonStyle.Danger)
      )
    ];
  }

  const votes = game.votes || { team1: [], team2: [], draw: [], cancel: [] };
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vote_${game.id}_team1`).setLabel(`Team 1 (${votes.team1.length})`).setEmoji('1️⃣').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vote_${game.id}_team2`).setLabel(`Team 2 (${votes.team2.length})`).setEmoji('2️⃣').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`vote_${game.id}_draw`).setLabel(`Empate (${votes.draw.length})`).setEmoji('🤝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`vote_${game.id}_cancel`).setLabel(`Cancelar (${votes.cancel.length})`).setEmoji('❌').setStyle(ButtonStyle.Danger)
    )
  ];
}

const LEADERBOARD_PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { key: 'elo', label: 'Elo' },
  { key: 'wins', label: 'Wins' },
  { key: 'losses', label: 'Losses' },
  { key: 'games', label: 'Games' },
  { key: 'beststreak', label: 'Best streak' },
  { key: 'streak', label: 'Streak' },
  { key: 'highestelo', label: 'Highest elo' },
  { key: 'lowestelo', label: 'Lowest elo' },
  { key: 'winrate', label: 'Win rate %' },
  { key: 'since', label: 'Since' }
];

function winRatePct(p) {
  return p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed) * 100 : 0;
}

function sortPlayers(players, sortKey) {
  const arr = [...players];
  switch (sortKey) {
    case 'wins': return arr.sort((a, b) => b.wins - a.wins);
    case 'losses': return arr.sort((a, b) => b.losses - a.losses);
    case 'games': return arr.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    case 'beststreak': return arr.sort((a, b) => b.bestStreak - a.bestStreak);
    case 'streak': return arr.sort((a, b) => b.streak - a.streak);
    case 'highestelo': return arr.sort((a, b) => b.bestElo - a.bestElo);
    case 'lowestelo': return arr.sort((a, b) => a.worstElo - b.worstElo);
    case 'winrate': return arr.sort((a, b) => winRatePct(b) - winRatePct(a));
    case 'since': return arr.sort((a, b) => (a.since || 0) - (b.since || 0));
    case 'elo':
    default: return arr.sort((a, b) => b.elo - a.elo);
  }
}

function statValue(p, sortKey) {
  switch (sortKey) {
    case 'wins': return `${p.wins}`;
    case 'losses': return `${p.losses}`;
    case 'games': return `${p.gamesPlayed}`;
    case 'beststreak': return `${p.bestStreak}`;
    case 'streak': return `${p.streak}`;
    case 'highestelo': return `${p.bestElo}`;
    case 'lowestelo': return `${p.worstElo}`;
    case 'winrate': return `${winRatePct(p).toFixed(0)}%`;
    case 'since': return p.since ? new Date(p.since).toLocaleDateString('es-ES') : '—';
    case 'elo':
    default: return `${p.elo}`;
  }
}

/** Tabla de posiciones paginada y ordenable, en formato de tabla monoespaciada. */
function leaderboardEmbed(guildData, sortKey, page, modeLabel) {
  const opt = SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0];
  const allPlayers = Object.values(guildData.players);
  const sorted = sortPlayers(allPlayers, opt.key);
  const totalPages = Math.max(1, Math.ceil(sorted.length / LEADERBOARD_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageItems = sorted.slice(clampedPage * LEADERBOARD_PAGE_SIZE, clampedPage * LEADERBOARD_PAGE_SIZE + LEADERBOARD_PAGE_SIZE);

  const nameWidth = 16;
  const statWidth = Math.max(opt.label.length, 6);
  const header = `${'#'.padStart(3)}  ${'Player'.padEnd(nameWidth)}  ${opt.label.padStart(statWidth)}`;
  const sep = '─'.repeat(header.length);

  const lines = pageItems.map((p, i) => {
    const position = clampedPage * LEADERBOARD_PAGE_SIZE + i + 1;
    const name = displayName(guildData, p.userId).slice(0, nameWidth).padEnd(nameWidth);
    const value = statValue(p, opt.key).padStart(statWidth);
    return `${String(position).padStart(3)}  ${name}  ${value}`;
  });

  const body = lines.length ? lines.join('\n') : 'Todavía no hay jugadores registrados.';
  const table = ['```', header, sep, body, '```'].join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`🏆 Elo Leaderboard${modeLabel ? ` — ${modeLabel}` : ''} — ${opt.label}`)
    .setDescription(table)
    .setFooter({ text: `Página ${clampedPage + 1} / ${totalPages}  •  ${sorted.length} jugador(es)` });

  return { embed, page: clampedPage, totalPages, sortKey: opt.key };
}

function leaderboardComponents(sortKey, page, modeKey) {
  const modeTag = modeKey || 'default';
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lbpage_first_${sortKey}_${page}_${modeTag}`).setLabel('⏮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lbpage_prev_${sortKey}_${page}_${modeTag}`).setLabel('◀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lbpage_next_${sortKey}_${page}_${modeTag}`).setLabel('▶').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lbpage_last_${sortKey}_${page}_${modeTag}`).setLabel('⏭').setStyle(ButtonStyle.Secondary)
  );

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`lbsort_${page}_${modeTag}`)
      .setPlaceholder(SORT_OPTIONS.find(o => o.key === sortKey)?.label || 'Elo')
      .addOptions(SORT_OPTIONS.map(o => ({ label: o.label, value: o.key, default: o.key === sortKey })))
  );

  return [buttonsRow, selectRow];
}

/** Ficha de jugador con el rango destacado arriba a la derecha del embed. */
function playerStatsEmbed(guildData, player, position, modeLabel) {
  const { current, next, pct } = rankProgress(player.elo);
  const winRate = player.gamesPlayed > 0 ? winRatePct(player).toFixed(1) : '0.0';
  const medal = position === 1 ? '🥇 ' : position === 2 ? '🥈 ' : position === 3 ? '🥉 ' : '';

  const rankValue = next
    ? `**${rankLabel(current)}**\n${progressBar(pct)} ${pct}%\nSiguiente: ${rankLabel(next)} (${next.min} elo)`
    : `**${rankLabel(current)}**\n${progressBar(100)} MAX`;

  const embed = new EmbedBuilder()
    .setColor(current.color)
    .setTitle(`${medal}${displayName(guildData, player.userId)}${modeLabel ? ` — ${modeLabel}` : ''}`)
    .addFields(
      { name: '📋 INFO', value: `Discord: <@${player.userId}>\nMiembro desde: ${player.since ? new Date(player.since).toLocaleDateString('es-ES') : '—'}`, inline: true },
      { name: '🎮 GAMES', value: `Games: ${player.gamesPlayed}\nWins: ${player.wins}\nLosses: ${player.losses}\nW/L: ${winRate}%`, inline: true },
      { name: '🏅 RANGO', value: rankValue, inline: true },
      { name: '📈 ELO', value: `Elo: **${player.elo}**\nBest: ${player.bestElo}\nWorst: ${player.worstElo}`, inline: true },
      { name: '🔥 STREAK', value: `Actual: ${player.streak}\nMejor: ${player.bestStreak}\nPeor: ${player.worstStreak}`, inline: true }
    )
    .setFooter({ text: `Posición en el leaderboard: ${position}` });

  // Insignia del rango arriba a la derecha (quien llame a esta función tiene
  // que mandar también el archivo: ver rankBadge en utils/ranks.js).
  const badge = rankBadge(current.rankKey);
  if (badge) embed.setThumbnail(badge.url);

  // Cuántas temporadas estuvo en cada rango (ej. Bronce ×2 · Plata ×1).
  const history = rankHistoryText(player);
  if (history) embed.addFields({ name: '📜 HISTORIAL DE RANGOS', value: history, inline: false });

  return embed;
}

/** Anuncio de resultado de partida para el canal game_announcement. */
function gameAnnouncementEmbed(guildData, game, changes, outcome, { reverted = false } = {}, modeLabel) {
  const outcomeMeta = {
    team1: { title: '🏆 ¡Victoria del Team n°1!', color: COLOR_SUCCESS },
    team2: { title: '🏆 ¡Victoria del Team n°2!', color: COLOR_SUCCESS },
    draw: { title: '🤝 Partida terminada en empate', color: COLOR_WARN },
    ranked: { title: '🏆 ¡Partida terminada!', color: COLOR_SUCCESS },
    cancel: { title: '☠️ Partida cancelada', color: COLOR_DANGER }
  };
  const meta = outcomeMeta[outcome] || outcomeMeta.cancel;
  const prefix = reverted ? '🔄 Resultado corregido — ' : '';
  const gameNumber = game.number ?? game.id;
  const gameLabel = modeLabel ? `${modeLabel} n°${gameNumber}` : `Game n°${gameNumber}`;

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${prefix}${meta.title}`)
    .setDescription(`**${gameLabel}**`)
    .setTimestamp();

  const teams = game.teams || [game.team1, game.team2];
  const teamBlock = team => team.map(id => `${displayName(guildData, id)} \`${guildData.players[id]?.elo ?? 0}\``).join('\n') || '—';

  if (outcome === 'ranked' && game.ranking) {
    const places = ['🥇 1°', '🥈 2°', '🥉 3°'];
    embed.addFields(
      ...game.ranking.map((teamIdx, pos) => ({
        name: places[pos] || `${pos + 1}°`,
        value: `Team n°${teamIdx + 1}\n${teamBlock(teams[teamIdx])}`,
        inline: true
      }))
    );
  } else {
    embed.addFields(
      { name: '🔷 Team n°1', value: teamBlock(teams[0]), inline: true },
      { name: '🔶 Team n°2', value: teamBlock(teams[1]), inline: true }
    );
  }

  if (changes) {
    const nameWidth = 14;
    const header = `${'Player'.padEnd(nameWidth)} Before  After   Racha    +/-`;
    const sep = '─'.repeat(header.length);
    const lines = teams.flat().map(id => {
      const c = changes[id];
      if (!c) return null;
      const delta = c.delta > 0 ? `+${c.delta}` : `${c.delta}`;
      const icon = c.delta > 0 ? '📈' : c.delta < 0 ? '📉' : '➖';
      const name = displayName(guildData, id).slice(0, nameWidth).padEnd(nameWidth);
      const racha = `${c.streakBefore} → ${c.streakAfter}`.padEnd(8);
      return `${name} ${String(c.before).padStart(6)}  ${String(c.after).padStart(6)}  ${racha} ${delta.padStart(4)} ${icon}`;
    }).filter(Boolean);
    embed.addFields({ name: '📊 Resultado', value: ['```', header, sep, lines.join('\n'), '```'].join('\n') });
  } else if (outcome === 'cancel') {
    embed.addFields({ name: '📊 Resultado', value: 'Esta partida fue cancelada. No afecta elo ni rachas.' });
  }

  embed.setFooter({ text: `Elo by Doskuith v1 • ${gameLabel}` });
  return embed;
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(COLOR_DANGER).setDescription(`⚠️ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor(COLOR_SUCCESS).setDescription(`✅ ${message}`);
}

function initWelcomeEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setDescription(
      `This is the moderators channel to control my settings\n` +
      `This bot offers 3 types of queues:\n\n` +
      `**Solo**: You join alone and you are grouped with other players to play team games\n` +
      `**Team**: You join with your own group and you face another group\n` +
      `**FFA**: Free for all queues, you join alone and play a 1v1v1v...v1 type of game\n\n` +
      `**Note:** Usá los botones de abajo para crear un modo nuevo.`
    );
}

function initWelcomeButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mw_type_solo').setLabel('Add Solo queue').setEmoji('👤').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mw_type_team').setLabel('Add Team Queue').setEmoji('🤝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mw_type_ffa').setLabel('Add FFA Queue').setEmoji('⚔️').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mw_viewmodes').setLabel('View Modes').setEmoji('📋').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

module.exports = {
  queueEmbed, queueButtons, modeQueueButtons, joinNextQueueButton,
  draftContainer, draftButtons,
  resultEmbed, resultButtons,
  leaderboardEmbed, leaderboardComponents, SORT_OPTIONS,
  playerStatsEmbed,
  gameAnnouncementEmbed,
  errorEmbed, successEmbed,
  initWelcomeEmbed, initWelcomeButtons
};
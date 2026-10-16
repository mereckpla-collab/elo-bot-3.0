const { EmbedBuilder } = require('discord.js');
const { COLOR_PRIMARY, ELO_START } = require('../config');
const { displayName } = require('./names');
const { resultEmbed } = require('./embeds');

// ---------------------------------------------------------------------------
// Utilidades comunes
// ---------------------------------------------------------------------------

// Partidas de UNA cola/modo. modeKey null = la cola de siempre.
function gamesOfEconomy(guildData, modeKey) {
  return Object.values(guildData.games || {}).filter(g => (g.modeKey || null) === (modeKey || null));
}

function teamsOf(game) {
  return game.teams || [game.team1 || [], game.team2 || []];
}

function playerTeamIndex(game, userId) {
  return teamsOf(game).findIndex(t => (t || []).includes(userId));
}

// Índice del equipo ganador (0, 1, ...) o null si fue empate / sin datos.
function winnerTeamIndex(game) {
  if (game.result === 'team1') return 0;
  if (game.result === 'team2') return 1;
  if (game.result === 'ranked' && Array.isArray(game.ranking) && game.ranking.length) return game.ranking[0];
  return null;
}

function pct(wins, games) {
  return games > 0 ? `${((wins / games) * 100).toFixed(1)}%` : '0%';
}

// Gráfica de barras con QuickChart (misma idea que /stats graph: una URL de
// imagen, sin librerías de canvas).
function quickChartUrl(chartConfig, width = 600, height = 380) {
  return `https://quickchart.io/chart?width=${width}&height=${height}&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

// ---------------------------------------------------------------------------
// /stats game
// ---------------------------------------------------------------------------
const STATUS_TEXT = {
  finished: '✅ Finalizada',
  cancelled: '❌ Cancelada',
  drafting: '🎯 En draft',
  pending: '🗳️ Esperando resultado'
};

function gameEmbed(store, guildData, economy, number) {
  const modeKey = economy.key === 'default' ? null : economy.key;
  const matches = gamesOfEconomy(guildData, modeKey)
    .filter(g => (g.number ?? g.id) === number)
    .sort((a, b) => Number(b.id) - Number(a.id));
  const game = matches[0];
  if (!game) return { error: `No encontré la partida n°${number} en ${economy.label || 'la cola por defecto'}.` };

  const embed = resultEmbed(store, game, null, economy.label);

  let resultText = '—';
  if (game.result === 'team1') resultText = 'Ganó el Team n°1';
  else if (game.result === 'team2') resultText = 'Ganó el Team n°2';
  else if (game.result === 'draw') resultText = '🤝 Empate';
  else if (game.result === 'ranked') resultText = '🏁 Resuelta por ranking';

  embed.addFields(
    { name: 'Estado', value: STATUS_TEXT[game.status] || String(game.status || '—'), inline: true },
    { name: 'Resultado', value: resultText, inline: true }
  );
  if (game.threadId) embed.addFields({ name: 'Hilo', value: `<#${game.threadId}>`, inline: true });
  if (matches.length > 1) {
    embed.setFooter({ text: `Hay ${matches.length} partidas con ese número (la numeración vuelve a 1 cada temporada). Se muestra la más reciente.` });
  }
  return { embed };
}

// ---------------------------------------------------------------------------
// /stats history
// ---------------------------------------------------------------------------
function outcomeFor(game, userId) {
  if (game.result === 'draw') return { emoji: '🤝', text: 'Empate' };
  const teams = teamsOf(game);
  const idx = playerTeamIndex(game, userId);
  if (game.result === 'ranked') {
    const place = (game.ranking || []).indexOf(idx);
    if (place === -1) return { emoji: '❔', text: 'Sin datos' };
    return place === 0 ? { emoji: '🏆', text: 'Ganada (1°)' } : { emoji: '💀', text: `${place + 1}° puesto` };
  }
  const w = winnerTeamIndex(game);
  if (w === null || idx === -1) return { emoji: '❔', text: 'Sin datos' };
  return idx === w ? { emoji: '🏆', text: 'Ganada' } : { emoji: '💀', text: 'Perdida' };
}

function historyEmbed(store, guildData, economy, userId) {
  const modeKey = economy.key === 'default' ? null : economy.key;
  const player = store.players[userId];
  if (!player) return { error: 'Ese jugador todavía no tiene partidas registradas ahí.' };

  const games = gamesOfEconomy(guildData, modeKey)
    .filter(g => g.status === 'finished' && playerTeamIndex(g, userId) !== -1)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!games.length) return { error: 'Ese jugador todavía no jugó ninguna partida terminada ahí.' };

  const history = player.history || [];
  const LAST = 10;
  const recent = games.slice(-LAST).reverse(); // de la más nueva a la más vieja
  const lines = recent.map((g, i) => {
    const o = outcomeFor(g, userId);
    // Elo del jugador después de esa partida (el historial de elo está en el
    // mismo orden que las partidas, así que se alinea por el final).
    const hi = history.length - 1 - i;
    let eloText = '';
    if (hi >= 0) {
      const after = history[hi];
      const prev = hi > 0 ? history[hi - 1] : ELO_START;
      const d = after - prev;
      eloText = ` · ${after} (${d >= 0 ? '+' : ''}${d})`;
    }
    return `${o.emoji} **n°${g.number ?? g.id}** — ${o.text}${eloText}`;
  });

  const decided = player.wins + player.losses;
  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`📜 Historial — ${displayName(store, userId)}${economy.label ? ` (${economy.label})` : ''}`)
    .setDescription(
      `**${player.wins}** W · **${player.losses}** L · **${player.draws || 0}** E — win rate ${pct(player.wins, decided)}\n\n` +
      lines.join('\n')
    )
    .setFooter({ text: `Últimas ${recent.length} de ${games.length} partidas terminadas.` });
  return { embed };
}

// ---------------------------------------------------------------------------
// /stats matchup
// ---------------------------------------------------------------------------
function matchupEmbed(store, guildData, economy, userId) {
  const modeKey = economy.key === 'default' ? null : economy.key;
  const player = store.players[userId];
  if (!player) return { error: 'Ese jugador todavía no tiene partidas registradas ahí.' };

  const together = {};  // compañeros
  const against = {};   // rivales
  const bump = (map, id, won, draw) => {
    const r = map[id] || (map[id] = { games: 0, wins: 0, losses: 0, draws: 0 });
    r.games += 1;
    if (draw) r.draws += 1; else if (won) r.wins += 1; else r.losses += 1;
  };

  let total = 0;
  for (const g of gamesOfEconomy(guildData, modeKey)) {
    if (g.status !== 'finished') continue;
    const teams = teamsOf(g);
    const myIdx = playerTeamIndex(g, userId);
    if (myIdx === -1) continue;
    const draw = g.result === 'draw' || winnerTeamIndex(g) === null;
    const won = !draw && winnerTeamIndex(g) === myIdx;
    total += 1;
    teams.forEach((team, i) => {
      for (const id of team || []) {
        if (id === userId) continue;
        if (i === myIdx) bump(together, id, won, draw);
        else bump(against, id, won, draw);
      }
    });
  }
  if (!total) return { error: 'Ese jugador todavía no jugó ninguna partida terminada ahí.' };

  const fmt = (map) => {
    const rows = Object.entries(map)
      .sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins)
      .slice(0, 8)
      .map(([id, r]) => {
        const decided = r.wins + r.losses;
        const rec = `${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ''}`;
        return `**${displayName(store, id)}** — ${r.games} partidas · ${pct(r.wins, decided)} wins (${rec})`;
      });
    return rows.length ? rows.join('\n') : '—';
  };

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`⚔️ Matchup — ${displayName(store, userId)}${economy.label ? ` (${economy.label})` : ''}`)
    .addFields(
      { name: '🤝 Con quién juega (compañeros)', value: fmt(together).slice(0, 1024) },
      { name: '🆚 Contra quién juega (rivales)', value: fmt(against).slice(0, 1024) }
    )
    .setFooter({ text: `Basado en ${total} partidas terminadas. Formato: victorias-derrotas${'(-empates)'}.` });
  return { embed };
}

// ---------------------------------------------------------------------------
// /stats server
// ---------------------------------------------------------------------------
function serverEmbed(store, guildData, economy) {
  const modeKey = economy.key === 'default' ? null : economy.key;
  const games = gamesOfEconomy(guildData, modeKey);
  const finished = games.filter(g => g.status === 'finished');
  const cancelled = games.filter(g => g.status === 'cancelled').length;
  const open = games.filter(g => g.status === 'drafting' || g.status === 'pending').length;
  const draws = finished.filter(g => g.result === 'draw').length;

  const players = Object.values(store.players || {});
  const active = players.filter(p => p.gamesPlayed > 0);
  const avgElo = active.length ? Math.round(active.reduce((s, p) => s + p.elo, 0) / active.length) : 0;

  const top = (key, label) => {
    const best = players.reduce((a, b) => ((b[key] || 0) > (a?.[key] || 0) ? b : a), null);
    return best && (best[key] || 0) > 0 ? `${displayName(store, best.userId)} (${best[key]})` : '—';
  };
  const topElo = [...players].sort((a, b) => b.elo - a.elo)[0];

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`📊 Stats del servidor — ${economy.label || 'Cola por defecto'}`)
    .addFields(
      { name: '👥 Jugadores', value: `${players.length} registrados\n${active.length} con partidas`, inline: true },
      { name: '🎮 Partidas', value: `${finished.length} terminadas\n${cancelled} canceladas\n${open} abiertas`, inline: true },
      { name: '🤝 Empates', value: String(draws), inline: true },
      { name: '📈 Elo promedio', value: String(avgElo), inline: true },
      { name: '🥇 Mayor elo', value: topElo ? `${displayName(store, topElo.userId)} (${topElo.elo})` : '—', inline: true },
      { name: '🏆 Más wins', value: top('wins'), inline: true },
      { name: '🎯 Más partidas', value: top('gamesPlayed'), inline: true },
      { name: '🔥 Mejor racha', value: top('bestStreak'), inline: true }
    );
  return { embed };
}

// ---------------------------------------------------------------------------
// /stats team-graph
// ---------------------------------------------------------------------------
function teamGraphEmbed(store, guildData, economy) {
  const modeKey = economy.key === 'default' ? null : economy.key;
  const finished = gamesOfEconomy(guildData, modeKey).filter(g => g.status === 'finished');
  if (!finished.length) return { error: 'Todavía no hay partidas terminadas ahí como para armar la gráfica.' };

  const teamsCount = Math.max(store.teamsCount || 2, ...finished.map(g => teamsOf(g).length));
  const wins = Array(teamsCount).fill(0);
  let draws = 0;
  for (const g of finished) {
    const w = winnerTeamIndex(g);
    if (w === null) draws += 1;
    else if (w >= 0 && w < teamsCount) wins[w] += 1;
  }

  const labels = [...wins.map((_, i) => `Team ${i + 1}`), 'Empates'];
  const data = [...wins, draws];
  const colors = ['#5865F2', '#ED4245', '#57F287', '#FEE75C', '#EB459E', '#F0883E', '#3BA55D', '#9B59B6', '#95A5A6'];
  const title = `Victorias por equipo — ${economy.label || 'cola por defecto'}`;

  const url = quickChartUrl({
    type: 'bar',
    data: { labels, datasets: [{ label: 'Victorias', data, backgroundColor: labels.map((_, i) => colors[i % colors.length]) }] },
    options: {
      title: { display: true, text: title },
      legend: { display: false },
      scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] }
    }
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(`📊 ${title}`)
    .setDescription(labels.map((l, i) => `**${l}:** ${data[i]}`).join('  ·  '))
    .setImage(url)
    .setFooter({ text: `Sobre ${finished.length} partidas terminadas.` });
  return { embed };
}

module.exports = { gameEmbed, historyEmbed, matchupEmbed, serverEmbed, teamGraphEmbed, gamesOfEconomy };

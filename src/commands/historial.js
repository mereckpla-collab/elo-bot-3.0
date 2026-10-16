const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { displayName } = require('../utils/names');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { COLOR_PRIMARY } = require('../config');

const PAGE_SIZE = 4;

function encodeModeKey(modeKey) {
  return modeKey || '__default__';
}
function decodeModeKey(encoded) {
  return encoded === '__default__' ? null : encoded;
}
function encodeUserId(userId) {
  return userId || '__all__';
}
function decodeUserId(encoded) {
  return encoded === '__all__' ? null : encoded;
}

function teamNames(store, team) {
  return (team || []).map(id => displayName(store, id)).join(', ') || '—';
}

// Qué le tocó a ESE jugador puntual en esa partida — no el resultado en
// general, sino si a él/ella le fue bien o mal.
function outcomeForPlayer(game, userId) {
  if (game.status === 'cancelled' || game.result === 'cancel') return { emoji: '❌', text: 'Cancelada' };
  if (game.result === 'draw') return { emoji: '🤝', text: 'Empate' };

  if (game.result === 'ranked') {
    const teams = game.teams || [];
    const teamIdx = teams.findIndex(t => t.includes(userId));
    const placement = (game.ranking || []).indexOf(teamIdx);
    if (placement === -1) return { emoji: '❔', text: 'Sin datos' };
    if (placement === 0) return { emoji: '🏆', text: 'Ganada (1°)' };
    return { emoji: '💀', text: `${placement + 1}° puesto` };
  }

  const team1 = game.team1 || game.teams?.[0] || [];
  const team2 = game.team2 || game.teams?.[1] || [];
  const inTeam1 = team1.includes(userId);
  const won = (game.result === 'team1' && inTeam1) || (game.result === 'team2' && !inTeam1 && team2.includes(userId));
  return won ? { emoji: '🏆', text: 'Ganada' } : { emoji: '💀', text: 'Perdida' };
}

// Resultado "en general" de la partida, sin importar a quién le tocó qué —
// se usa en la vista de toda la cola (cuando no se elige un jugador).
function overallOutcome(game) {
  if (game.status === 'cancelled' || game.result === 'cancel') return { emoji: '❌', text: 'Cancelada' };
  if (game.result === 'draw') return { emoji: '🤝', text: 'Empate' };
  if (game.result === 'ranked') return { emoji: '🏁', text: 'Resuelta por ranking' };
  if (game.result === 'team1') return { emoji: '🏆', text: 'Ganó el Team n°1' };
  if (game.result === 'team2') return { emoji: '🏆', text: 'Ganó el Team n°2' };
  return { emoji: '❔', text: 'Sin datos' };
}

function getQueueGames(guildData, modeKey) {
  return Object.values(guildData.games)
    .filter(g => (g.modeKey || null) === (modeKey || null))
    .filter(g => g.status === 'finished' || g.status === 'cancelled')
    .sort((a, b) => b.id - a.id); // más reciente primero
}

function getPlayerGames(guildData, modeKey, userId) {
  return getQueueGames(guildData, modeKey).filter(g => {
    const all = g.teams ? g.teams.flat() : [...(g.team1 || []), ...(g.team2 || [])];
    return all.includes(userId);
  });
}

function buildHistoryPage(guildData, modeKey, targetUserId, targetName, page, showRevert) {
  const store = storeForModeKey(guildData, modeKey);
  const games = targetUserId ? getPlayerGames(guildData, modeKey, targetUserId) : getQueueGames(guildData, modeKey);
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const items = games.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const modeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'Cola por defecto';
  // OJO: los títulos de embed NO renderizan menciones (<@id> queda como
  // texto crudo ahí) — por eso el nombre va con displayName(), no con una
  // mención, en el título. Esto es lo que se veía roto antes.
  const embed = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(targetUserId ? `📜 Historial de ${targetName} — ${modeLabel}` : `📜 Historial de ${modeLabel}`)
    .setDescription(targetUserId ? `Jugador: <@${targetUserId}>` : 'Todas las partidas terminadas o canceladas de esta cola.');

  if (!items.length) {
    embed.addFields({ name: '\u200b', value: 'Todavía no hay partidas acá.' });
  } else {
    for (const g of items) {
      const gameNumber = g.number ?? g.id;
      if (targetUserId) {
        const { emoji, text } = outcomeForPlayer(g, targetUserId);
        const change = g.eloChanges?.[targetUserId];
        const deltaStr = change ? ` **(${change.delta >= 0 ? '+' : ''}${change.delta})**` : '';
        embed.addFields({
          name: `${emoji} Game n°${gameNumber} — ${text}${deltaStr}`,
          value: `🔷 ${teamNames(store, g.team1 || g.teams?.[0])}\n🔶 ${teamNames(store, g.team2 || g.teams?.[1])}`
        });
      } else {
        const { emoji, text } = overallOutcome(g);
        embed.addFields({
          name: `${emoji} Game n°${gameNumber} — ${text}`,
          value: `🔷 ${teamNames(store, g.team1 || g.teams?.[0])}\n🔶 ${teamNames(store, g.team2 || g.teams?.[1])}`
        });
      }
    }
  }
  embed.setFooter({ text: `Página ${clampedPage + 1} / ${totalPages} · ${games.length} partida(s)` });

  const encodedMode = encodeModeKey(modeKey);
  const encodedUser = encodeUserId(targetUserId);
  const rows = [];

  // Nota de plataforma: Discord no deja poner un botón "al lado" de un
  // campo puntual del embed — todos los botones van siempre debajo del
  // embed entero, en filas propias. Para que se entienda igual a cuál
  // partida corresponde cada uno, el número va en la etiqueta del botón
  // (ej. "Revertir n°14"), en el mismo orden que las partidas de arriba.
  if (showRevert) {
    const finishedShown = items.filter(g => g.status === 'finished');
    if (finishedShown.length) {
      rows.push(new ActionRowBuilder().addComponents(
        finishedShown.map(g =>
          new ButtonBuilder().setCustomId(`historyrevert_${g.id}`).setLabel(`Revertir n°${g.number ?? g.id}`).setStyle(ButtonStyle.Success)
        )
      ));
    }
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`historypage_first_${clampedPage}_${encodedMode}_${encodedUser}`).setLabel('⏮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`historypage_prev_${clampedPage}_${encodedMode}_${encodedUser}`).setLabel('◀').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`historypage_next_${clampedPage}_${encodedMode}_${encodedUser}`).setLabel('▶').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`historypage_last_${clampedPage}_${encodedMode}_${encodedUser}`).setLabel('⏭').setStyle(ButtonStyle.Success)
  ));

  return { embed, components: rows, totalPages, page: clampedPage };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Ve el historial de partidas: de un jugador, o de toda la cola si no elegís a nadie.')
    .addUserOption(o => o.setName('usuario').setDescription('De quién ver el historial (vacío = toda la cola)').setRequired(false))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'historial'))) return;

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    // Sin `usuario`: historial de TODA la cola, no el del que corrió el
    // comando — para eso ya alcanza con poner tu propio @.
    const target = interaction.options.getUser('usuario');
    const store = storeForModeKey(guildData, resolved.modeKey);
    const targetName = target ? displayName(store, target.id) : null;

    // Los botones de "Revertir" son cosa de Elo Admin — a cualquiera se le
    // muestra el historial igual, pero sin esos botones.
    const showRevert = isEloAdmin(interaction, guildData);

    const { embed, components } = buildHistoryPage(guildData, resolved.modeKey, target?.id || null, targetName, 0, showRevert);
    await interaction.reply({ embeds: [embed], components });
  },

  buildHistoryPage,
  encodeModeKey,
  decodeModeKey,
  encodeUserId,
  decodeUserId
};
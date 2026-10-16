const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild, resolveGameContext } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { displayName } = require('../utils/names');
const { COLOR_WARN } = require('../config');

// Misma idea que en /stats y /ban: cada cola (la de siempre, o cada modo)
// es una opción posible. Ahora que cada una tiene su propio número de
// partida independiente (ver draftManager), el número solo no alcanza para
// identificar una partida sin ambigüedad — hace falta saber en cuál cola.
function resolveQueueOptions(guildData) {
  const options = [];
  if (guildData.channels.queue) options.push({ key: 'default', label: 'Cola por defecto' });
  for (const mode of Object.values(guildData.modes || {})) {
    options.push({ key: mode.key, label: mode.name });
  }
  return options;
}

const RESULT_LABELS = {
  team1: '🏆 Ganó el Team n°1',
  team2: '🏆 Ganó el Team n°2',
  draw: '🤝 Empate',
  ranked: '🏁 Resultado por ranking',
  cancel: '☠️ Cancelada'
};

const TEAM_EMOJIS = ['🔷', '🔶', '🟢', '🟣', '🟠', '⚪'];

// Arma el embed + botones para revertir UNA partida ya resuelta (game). Lo
// usan tanto /revertir como /historial (el botón "Revertir" de cada fila
// abre exactamente esto mismo, sin tener que volver a pedir número/modo).
function buildRevertPrompt(guildData, game, revertedByName) {
  const { store, label } = resolveGameContext(guildData, game);
  const teams = game.teams || [game.team1, game.team2];
  const teamBlock = team => (team && team.length ? team.map(id => `• ${displayName(store, id)}`).join('\n') : '—');
  const gameNumber = game.number ?? game.id;
  const resultLabel = RESULT_LABELS[game.result] || 'Sin resultado todavía';

  const embed = new EmbedBuilder()
    .setColor(COLOR_WARN)
    .setTitle(`🔁 Revertir resultado`)
    .setDescription(
      `**${label ? `${label} — ` : ''}Game n°${gameNumber}**\n` +
      `Resultado actual: **${resultLabel}**\n\n` +
      `Elegí abajo cuál es el resultado correcto 👇`
    )
    .addFields(teams.map((team, i) => ({
      name: `${TEAM_EMOJIS[i % TEAM_EMOJIS.length]} Team n°${i + 1}`,
      value: teamBlock(team),
      inline: true
    })))
    .setFooter({ text: `Revirtiendo por ${revertedByName}` })
    .setTimestamp();

  // Los botones usan el ID INTERNO de la partida (game.id), no el número
  // que se le muestra a la gente — son cosas distintas a propósito, para
  // que nunca haya ambigüedad entre partidas de colas distintas que
  // comparten el mismo número mostrado.
  const gameId = game.id;
  const row = (game.teamsCount || 2) > 2
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`revert_rank_${gameId}`).setLabel('🏆 Corregir ranking').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`revert_${gameId}_cancel`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      )
    : new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`revert_${gameId}_team1`).setLabel('Team 1 gana').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`revert_${gameId}_team2`).setLabel('Team 2 gana').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`revert_${gameId}_draw`).setLabel('Empate').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`revert_${gameId}_cancel`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      );

  return { embed, components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('revertir')
    .setDescription('Elo Admin: revierte el resultado de cualquier partida del historial.')
    .addIntegerOption(o => o.setName('partida').setDescription('Número de la partida (ej. 69)').setRequired(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = resolveQueueOptions(guildData)
      .filter(o => o.key.includes(focused) || o.label.toLowerCase().includes(focused))
      .map(o => ({ name: o.key === 'default' ? 'Cola por defecto' : `${o.label} (${o.key})`.slice(0, 100), value: o.key }));
    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'revertir'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const partida = interaction.options.getInteger('partida');
    const modoInput = interaction.options.getString('modo');
    const queueOptions = resolveQueueOptions(guildData);

    let modeKey;
    if (modoInput) {
      const found = queueOptions.find(o => o.key === modoInput);
      if (!found) {
        return interaction.reply({ embeds: [errorEmbed('Ese modo no existe. Usá `/mode list` para ver los disponibles, o dejá el campo vacío si solo hay una cola.')], ephemeral: true });
      }
      modeKey = found.key === 'default' ? null : found.key;
    } else if (queueOptions.length <= 1) {
      // Solo hay una cola en todo el servidor: no hace falta preguntar.
      modeKey = queueOptions.length === 1 && queueOptions[0].key !== 'default' ? queueOptions[0].key : null;
    } else {
      return interaction.reply({
        embeds: [errorEmbed(
          `Este servidor tiene ${queueOptions.length} colas/modos — especificá en cuál con la opción \`modo\`:\n` +
          queueOptions.map(o => `• \`${o.key}\` — ${o.label}`).join('\n')
        )],
        ephemeral: true
      });
    }

    const game = Object.values(guildData.games).find(g => (g.number ?? g.id) === partida && (g.modeKey || null) === (modeKey || null));
    if (!game) {
      const scopeLabel = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'la cola por defecto';
      return interaction.reply({ embeds: [errorEmbed(`No existe la partida n°${partida} en **${scopeLabel}**. Revisá el número y la cola.`)], ephemeral: true });
    }

    const { embed, components } = buildRevertPrompt(guildData, game, interaction.user.username);
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  },

  buildRevertPrompt
};
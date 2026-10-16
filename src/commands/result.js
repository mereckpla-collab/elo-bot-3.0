const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild } = require('../database');
const { assertChannel } = require('../utils/channelGuard');
const { COLOR_WARN } = require('../config');

const PAGE_SIZE = 3;

function buildPage(guildData, page) {
  const pending = Object.values(guildData.games)
    .filter(g => g.status === 'pending')
    .sort((a, b) => a.id - b.id);

  const totalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const items = pending.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder().setColor(COLOR_WARN).setTitle('Pending Matches');
  if (!items.length) {
    embed.setDescription('No hay partidas pendientes de resultado.');
  } else {
    for (const g of items) {
      const allPlayers = g.teams ? g.teams.flat() : [...g.team1, ...g.team2];
      const allPlayersStr = allPlayers.map(id => `<@${id}>`).join(' ');
      embed.addFields({ name: `Game #${g.id}`, value: allPlayersStr });
    }
  }
  embed.setFooter({ text: `Página ${clampedPage + 1} / ${totalPages}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resultpage_first_${clampedPage}`).setLabel('⏮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`resultpage_prev_${clampedPage}`).setLabel('◀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`resultpage_next_${clampedPage}`).setLabel('▶').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`resultpage_last_${clampedPage}`).setLabel('⏭').setStyle(ButtonStyle.Secondary)
  );

  return { embed, row, totalPages, page: clampedPage };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('Resultados de partidas.')
    .addSubcommand(sc => sc.setName('show').setDescription('Muestra partidas.')
      .addStringOption(o => o.setName('filtro').setDescription('unfinished').setRequired(true)
        .addChoices({ name: 'unfinished', value: 'unfinished' }))),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'result'))) return;

    const { embed, row } = buildPage(guildData, 0);
    await interaction.reply({ embeds: [embed], components: [row] });
  },

  buildPage
};
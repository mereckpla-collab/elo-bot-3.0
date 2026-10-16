const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { COLOR_PRIMARY } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag_ver')
    .setDescription('Ve el rol de avisos (/tag_activar) de cada cola.'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'tag_ver'))) return;

    const stores = [
      { label: 'Cola por defecto', store: guildData },
      ...Object.values(guildData.modes || {}).map(m => ({ label: m.name, store: m }))
    ];

    const lines = stores
      .filter(({ store }) => store.tagRoleId)
      .map(({ label, store }) => `**${label}:** <@&${store.tagRoleId}>`);

    if (!lines.length) {
      return interaction.reply({
        embeds: [errorEmbed('Todavía ninguna cola tiene un rol de avisos — se crea solo la primera vez que alguien usa `/tag_activar` ahí.')],
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle('🔔 Roles de aviso por cola')
      .setDescription(lines.join('\n'));

    await interaction.reply({ embeds: [embed] });
  }
};

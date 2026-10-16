const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const modeWizard = require('../handlers/modeWizard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapadd')
    .setDescription('Elo Admin: crea un mapa (modo) nuevo — arranca el asistente.')
    .addStringOption(o => o
      .setName('type')
      .setDescription('Tipo de cola')
      .setRequired(true)
      .addChoices(
        { name: 'Solo', value: 'solo' },
        { name: 'Team', value: 'team' },
        { name: 'FFA', value: 'ffa' }
      )),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'mode'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const type = interaction.options.getString('type');
    return modeWizard.start(interaction, type);
  }
};
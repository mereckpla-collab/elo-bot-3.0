const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const modeWizard = require('../handlers/modeWizard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas')
    .setDescription('Elo Admin: muestra cuántos mapas (modos) hay creados en este servidor.'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'mode'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    return interaction.reply({ embeds: [modeWizard.countModesEmbed(guildData)], ephemeral: true });
  }
};
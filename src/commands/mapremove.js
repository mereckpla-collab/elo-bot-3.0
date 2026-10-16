const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const modeWizard = require('../handlers/modeWizard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapremove')
    .setDescription('Elo Admin: elimina un mapa (modo) y su canal de cola.')
    .addStringOption(o => o
      .setName('mode')
      .setDescription('El mapa/modo a eliminar')
      .setRequired(true)
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.values(guildData.modes || {})
      .filter(m => m.key.includes(focused) || m.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(m => ({ name: `${m.name} (${m.key})`.slice(0, 100), value: m.key }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'mode'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const key = interaction.options.getString('mode');
    const result = await modeWizard.removeMode(interaction, guildData, key);
    return interaction.reply({ embeds: [result.embed], ephemeral: true });
  }
};
const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { bumpQueueCommand } = require('../handlers/queueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Baja el mensaje de la cola al final del canal (igual que el botón "Queue").'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'queue'))) return;

    if (!guildData.queueMessage) {
      return interaction.reply({ embeds: [errorEmbed('Todavía no hay un mensaje de cola instalado en este servidor.')], ephemeral: true });
    }

    return bumpQueueCommand(interaction.client, interaction, guildData);
  }
};
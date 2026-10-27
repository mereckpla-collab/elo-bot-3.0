const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { leaveQueue, resolveModeFromChannel } = require('../handlers/queueManager');

// /salir = lo mismo que el botón "Salir": te saca de la cola del canal donde
// lo escribes (la de siempre o la de cualquier modo).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('salir')
    .setDescription('Sal de la cola de este canal (igual que el botón "Salir").'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    const resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved) {
      return interaction.reply({
        embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (la cola por defecto o el canal de algún modo).')],
        ephemeral: true
      });
    }
    return leaveQueue(interaction.client, interaction, guildData, resolved.modeKey);
  }
};

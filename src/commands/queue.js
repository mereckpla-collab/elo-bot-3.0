const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { joinQueue, resolveModeFromChannel } = require('../handlers/queueManager');

// /queue = lo mismo que el botón "Unirse": te mete a la cola del canal donde
// lo escribes (la de siempre o la de cualquier modo). El mensaje de la cola
// se sigue pudiendo bajar al final del canal con el botón "Queue".
module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Únete a la cola de este canal (igual que el botón "Unirse").'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    const resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved) {
      return interaction.reply({
        embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (la cola por defecto o el canal de algún modo).')],
        ephemeral: true
      });
    }

    const hasMessage = resolved.modeKey
      ? guildData.modes[resolved.modeKey]?.queueMessage
      : guildData.queueMessage;
    if (!hasMessage) {
      return interaction.reply({ embeds: [errorEmbed('Todavía no hay un mensaje de cola instalado en este canal.')], ephemeral: true });
    }

    return joinQueue(interaction.client, interaction, guildData, resolved.modeKey);
  }
};

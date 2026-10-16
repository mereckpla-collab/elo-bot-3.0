const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeFromChannel, resetQueue } = require('../handlers/queueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_queue')
    .setDescription('Elo Admin: reinicia la cola actual (saca a todos los que estén esperando).'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'reset_queue'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    // "La cola actual" = la del canal (o el hilo de una partida de esa
    // cola) desde donde se corre el comando — mismo criterio que /force_join.
    let resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved && interaction.channel?.isThread?.()) {
      resolved = resolveModeFromChannel(guildData, interaction.channel.parentId);
    }
    if (!resolved) {
      return interaction.reply({
        embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (o el hilo de una partida de esa cola).')],
        ephemeral: true
      });
    }

    const { count } = await resetQueue(interaction.client, interaction.guildId, resolved.modeKey);

    await interaction.reply({
      embeds: [successEmbed(
        count
          ? `✅ Se reinició **${resolved.label}** — se sacó a ${count} jugador(es) que estaban esperando.`
          : `✅ **${resolved.label}** ya estaba vacía, no había nadie esperando.`
      )]
    });
  }
};

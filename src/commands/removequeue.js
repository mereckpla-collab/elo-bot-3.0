const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { isEloAdmin } = require('../handlers/resultManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removequeue')
    .setDescription('Elo Admin: borra la cola por defecto (4v4-solo) si se creó por error.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!isEloAdmin(interaction, guildData) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    if (!guildData.channels.queue) {
      return interaction.reply({ embeds: [errorEmbed('Este servidor no tiene la cola por defecto creada. No hay nada que borrar.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await interaction.guild.channels.fetch(guildData.channels.queue).catch(() => null);
    if (channel) {
      await channel.delete('Cola por defecto eliminada con /removequeue').catch(() => null);
    }

    delete guildData.channels.queue;
    guildData.queueMessage = null;
    saveGuild(interaction.guildId, guildData);

    return interaction.editReply({
      embeds: [successEmbed(
        'La cola por defecto (4v4-solo) fue eliminada. Los modos que ya creaste con el wizard no se tocaron — esto solo afecta la cola vieja fija.'
      )]
    });
  }
};
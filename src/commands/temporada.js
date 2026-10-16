const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { ensureSeasonDividerRole, announceSeasonChange, clearSeasonParticipants } = require('../utils/seasonDivider');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temporada')
    .setDescription('Ve o cambia la temporada actual del servidor (compartida por todas las colas/modos).')
    .addIntegerOption(o => o.setName('numero').setDescription('Nueva temporada (déjalo vacío para solo ver la actual)').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'temporada'))) return;

    const numero = interaction.options.getInteger('numero');

    // Sin número: solo informa en qué temporada están, sin tocar nada.
    if (numero === null) {
      const roleTag = guildData.seasonDividerRoleId ? ` (<@&${guildData.seasonDividerRoleId}>)` : '';
      return interaction.reply({ embeds: [successEmbed(`Este servidor está en la **Temporada ${guildData.season || 1}**${roleTag}.`)] });
    }

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede cambiar la temporada.')], ephemeral: true });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Necesito el permiso "Gestionar roles" para crear/mover el rol separador.')], ephemeral: true });
    }

    await interaction.deferReply();

    guildData.season = numero;
    guildData.seasonResetQueues = {}; // un cambio manual de temporada empieza un ciclo de reset nuevo
    await clearSeasonParticipants(interaction.guild, guildData).catch(() => {});
    const role = await ensureSeasonDividerRole(interaction.guild, guildData, numero);
    await announceSeasonChange(interaction.client, guildData, numero).catch(() => {});
    saveGuild(interaction.guildId, guildData);

    if (!role) {
      return interaction.editReply({ embeds: [errorEmbed(`Temporada cambiada a **${numero}**, pero no pude crear/mover el rol separador — revisá que mi rol esté por encima en la jerarquía.`)] });
    }

    await interaction.editReply({
      embeds: [successEmbed(`Temporada cambiada a **${numero}** (compartida por todas las colas/modos). Rol separador: <@&${role.id}>.`)]
    });
  }
};
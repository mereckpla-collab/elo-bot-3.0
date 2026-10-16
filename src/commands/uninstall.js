const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild, saveGuild, defaultGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uninstall')
    .setDescription('Elo Admin: desinstala el bot de este servidor (borra canales y datos).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Necesitas permiso de "Gestionar servidor" para desinstalar el bot.')], ephemeral: true });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('uninstall_confirm').setLabel('Sí, desinstalar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('uninstall_cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: '⚠️ Esto borrará los canales creados por `/install` (init, info_chat, submit, game_announcement, bans, anuncios), **el canal de cada modo que hayas creado**, **los roles creados con `/crear_rol`**, y TODOS los datos guardados (elo, historial, bans, modos, roles, categorías) de este servidor. ¿Confirmas?',
      components: [confirmRow],
      ephemeral: true
    });
  },

  async handleConfirm(interaction) {
    const guild = interaction.guild;
    const guildData = getGuild(guild.id);

    // Canales de siempre (init, info_chat, submit, game_announcement, bans,
    // y la cola por defecto si todavía existía).
    for (const channelId of Object.values(guildData.channels)) {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (ch) await ch.delete('Desinstalación de Elo de Doskuith').catch(() => {});
    }

    // Canal de cada modo creado con el wizard — antes quedaban huérfanos
    // porque borrar la categoría no borra lo que tiene adentro.
    for (const mode of Object.values(guildData.modes || {})) {
      if (!mode.channelId) continue;
      const ch = await guild.channels.fetch(mode.channelId).catch(() => null);
      if (ch) await ch.delete('Desinstalación de Elo de Doskuith').catch(() => {});
    }

    // Roles de logros creados con /crear_rol (cola de siempre + cada modo).
    const allStores = [guildData, ...Object.values(guildData.modes || {})];
    for (const store of allStores) {
      for (const ach of Object.values(store.roleAchievements || {})) {
        if (!ach.roleId) continue;
        const role = await guild.roles.fetch(ach.roleId).catch(() => null);
        if (role) await role.delete('Desinstalación de Elo de Doskuith').catch(() => {});
      }
    }

    // Las dos categorías (Elo Queues y Elo Admin).
    if (guildData.categoryId) {
      const cat = await guild.channels.fetch(guildData.categoryId).catch(() => null);
      if (cat) await cat.delete('Desinstalación de Elo de Doskuith').catch(() => {});
    }
    if (guildData.adminCategoryId) {
      const adminCat = await guild.channels.fetch(guildData.adminCategoryId).catch(() => null);
      if (adminCat) await adminCat.delete('Desinstalación de Elo de Doskuith').catch(() => {});
    }

    saveGuild(guild.id, defaultGuild());

    await interaction.update({ content: '✅ El bot fue desinstalado de este servidor — se borraron todos los canales, incluidos los de cada modo.', components: [] });
  },

  async handleCancel(interaction) {
    await interaction.update({ content: 'Desinstalación cancelada.', components: [] });
  }
};
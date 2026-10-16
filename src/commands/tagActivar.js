const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { resolveModeFromChannel } = require('../handlers/queueManager');

async function ensureTagRole(guild, store, modeLabel) {
  let role = store.tagRoleId ? await guild.roles.fetch(store.tagRoleId).catch(() => null) : null;
  if (role) return role;
  role = await guild.roles.create({
    name: `🔔 Aviso — ${modeLabel}`,
    mentionable: true,
    permissions: [],
    reason: 'Rol de avisos de cola (/tag_activar)'
  }).catch(() => null);
  if (role) store.tagRoleId = role.id;
  return role;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag_activar')
    .setDescription('Activa o desactiva que te avisen por @ cuando a esta cola le falte poca gente.'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'tag_activar'))) return;

    // Como /force_join: la cola depende de desde qué canal (o el hilo de
    // una partida de esa cola) se corre el comando.
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
    const { modeKey, label } = resolved;
    const store = modeKey ? guildData.modes[modeKey] : guildData;

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Necesito el permiso "Gestionar roles" para armar el rol de avisos.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const role = await ensureTagRole(interaction.guild, store, label);
    if (!role) {
      return interaction.editReply({ embeds: [errorEmbed('No pude crear el rol de avisos — revisá que mi rol esté por encima en la jerarquía.')] });
    }
    saveGuild(interaction.guildId, guildData);

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const hasIt = member.roles.cache.has(role.id);

    if (hasIt) {
      await member.roles.remove(role.id).catch(() => {});
      return interaction.editReply({ embeds: [successEmbed(`🔕 Listo, ya no te van a avisar cuando a **${label}** le falte poca gente.`)] });
    }

    await member.roles.add(role.id).catch(() => {});
    return interaction.editReply({ embeds: [successEmbed(`🔔 Listo, te van a avisar con <@&${role.id}> cuando a **${label}** le falten pocos jugadores para completarse.`)] });
  }
};

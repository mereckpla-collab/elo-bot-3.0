const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveQueueOptions, resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eliminar_rol')
    .setDescription('Elo Admin: elimina un rol de logro (y el rol de Discord asociado).')
    .addStringOption(o => o.setName('rol').setDescription('Rol a eliminar').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focusedOpt = interaction.options.getFocused(true);

    if (focusedOpt.name === 'modo') return autocompleteModo(interaction, guildData);

    // 'rol'
    const focused = String(focusedOpt.value || '').toLowerCase();
    const modoInput = interaction.options.getString('modo');
    let entries = [];

    if (modoInput) {
      const resolved = resolveModeKeyFromInput(guildData, modoInput);
      if (resolved.ok) {
        const store = storeForModeKey(guildData, resolved.modeKey);
        entries = Object.values(store.roleAchievements || {}).map(a => ({ name: a.name, value: a.key }));
      }
    } else {
      for (const opt of resolveQueueOptions(guildData)) {
        const store = storeForModeKey(guildData, opt.key === 'default' ? null : opt.key);
        for (const a of Object.values(store.roleAchievements || {})) {
          entries.push({ name: `${a.name} (${opt.label})`, value: a.key });
        }
      }
    }

    const choices = entries
      .filter(e => e.name.toLowerCase().includes(focused) || e.value.includes(focused))
      .slice(0, 25);
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'eliminar_rol'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const rolKey = interaction.options.getString('rol');
    const ach = store.roleAchievements?.[rolKey];
    if (!ach) {
      return interaction.reply({ embeds: [errorEmbed(`No encontré ese rol en **${resolved.label}**. Fijate con \`/ver_roles\`.`)], ephemeral: true });
    }

    await interaction.deferReply();

    if (ach.roleId) {
      const role = await interaction.guild.roles.fetch(ach.roleId).catch(() => null);
      if (role) await role.delete(`/eliminar_rol por ${interaction.user.tag}`).catch(() => {});
    }
    delete store.roleAchievements[rolKey];
    saveGuild(interaction.guildId, guildData);

    await interaction.editReply({ embeds: [successEmbed(`Rol **${ach.name}** eliminado de **${resolved.label}** (junto con el rol de Discord).`)] });
  }
};

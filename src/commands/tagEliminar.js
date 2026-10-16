const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag_eliminar')
    .setDescription('Elo Admin: borra el rol de avisos de una cola (se puede volver a crear con /tag_activar).')
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'tag_eliminar'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    if (!store.tagRoleId) {
      return interaction.reply({ embeds: [errorEmbed(`**${resolved.label}** todavía no tiene ningún rol de avisos.`)], ephemeral: true });
    }

    await interaction.deferReply();

    const role = await interaction.guild.roles.fetch(store.tagRoleId).catch(() => null);
    if (role) await role.delete(`/tag_eliminar por ${interaction.user.tag}`).catch(() => {});
    store.tagRoleId = null;
    saveGuild(interaction.guildId, guildData);

    await interaction.editReply({
      embeds: [successEmbed(`Listo — se borró el rol de avisos de **${resolved.label}**. Se vuelve a crear solo la próxima vez que alguien use \`/tag_activar\` ahí.`)]
    });
  }
};

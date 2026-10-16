const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { COLOR_PRIMARY } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ver_categorias')
    .setDescription('Ve las categorías de roles configuradas en una cola/modo.')
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'ver_categorias'))) return;

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const categories = Object.values(store.roleCategories || {});

    if (!categories.length) {
      return interaction.reply({ embeds: [errorEmbed(`**${resolved.label}** todavía no tiene ninguna categoría. Creá una con \`/crear_categoria\`.`)], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`🗂️ Categorías — ${resolved.label}`)
      .setDescription(categories.map(c => {
        const roleCount = Object.values(store.roleAchievements || {}).filter(a => a.categoryKey === c.key).length;
        return `🔹 **${c.name}** \`#${c.color.toString(16).padStart(6, '0')}\` — ${roleCount} rol(es)`;
      }).join('\n'));

    await interaction.reply({ embeds: [embed] });
  }
};

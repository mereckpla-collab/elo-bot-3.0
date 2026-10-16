const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveQueueOptions, resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eliminar_categoria')
    .setDescription('Elo Admin: elimina una categoría de roles.')
    .addStringOption(o => o.setName('categoria').setDescription('Categoría a eliminar').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focusedOpt = interaction.options.getFocused(true);

    if (focusedOpt.name === 'modo') return autocompleteModo(interaction, guildData);

    // 'categoria'
    const focused = String(focusedOpt.value || '').toLowerCase();
    const modoInput = interaction.options.getString('modo');
    let entries = [];

    if (modoInput) {
      const resolved = resolveModeKeyFromInput(guildData, modoInput);
      if (resolved.ok) {
        const store = storeForModeKey(guildData, resolved.modeKey);
        entries = Object.values(store.roleCategories || {}).map(c => ({ name: c.name, value: c.key }));
      }
    } else {
      // Todavía no eligió modo: junta categorías de todas las colas, marcando de cuál es cada una.
      for (const opt of resolveQueueOptions(guildData)) {
        const store = storeForModeKey(guildData, opt.key === 'default' ? null : opt.key);
        for (const c of Object.values(store.roleCategories || {})) {
          entries.push({ name: `${c.name} (${opt.label})`, value: c.key });
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
    if (!(await assertChannel(interaction, guildData, 'eliminar_categoria'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const categoriaKey = interaction.options.getString('categoria');
    const categoria = store.roleCategories?.[categoriaKey];
    if (!categoria) {
      return interaction.reply({ embeds: [errorEmbed(`No encontré esa categoría en **${resolved.label}**. Fijate con \`/ver_categorias\`.`)], ephemeral: true });
    }

    delete store.roleCategories[categoriaKey];

    // Los roles que estaban en esta categoría no se borran — quedan "sin categoría".
    let affected = 0;
    for (const ach of Object.values(store.roleAchievements || {})) {
      if (ach.categoryKey === categoriaKey) {
        ach.categoryKey = null;
        affected++;
      }
    }

    saveGuild(interaction.guildId, guildData);

    await interaction.reply({
      embeds: [successEmbed(
        `Categoría **${categoria.name}** eliminada de **${resolved.label}**.` +
        (affected ? ` ${affected} rol(es) que estaban ahí quedaron sin categoría.` : '')
      )]
    });
  }
};

const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { parseColor, COLOR_NAMES_HELP } = require('../utils/color');

function slugify(name) {
  const base = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return base || 'categoria';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crear_categoria')
    .setDescription('Elo Admin: crea una categoría de rareza para agrupar roles (ej. Raro, Exótico, Legendario).')
    .addStringOption(o => o.setName('nombre').setDescription('Nombre de la categoría').setRequired(true).setMaxLength(32))
    .addStringOption(o => o.setName('color').setDescription('Color (hex como #57F287, o un nombre como verde/azul/rojo)').setRequired(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'crear_categoria'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const nombre = interaction.options.getString('nombre').trim();
    const color = parseColor(interaction.options.getString('color'));
    if (color === null) {
      return interaction.reply({
        embeds: [errorEmbed(`Ese color no lo reconozco. Usá un hex (ej. \`#57F287\`) o uno de estos nombres: ${COLOR_NAMES_HELP}.`)],
        ephemeral: true
      });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    store.roleCategories = store.roleCategories || {};

    let key = slugify(nombre);
    if (store.roleCategories[key]) {
      let n = 2;
      while (store.roleCategories[`${key}_${n}`]) n++;
      key = `${key}_${n}`;
    }

    store.roleCategories[key] = { key, name: nombre, color, createdAt: Date.now(), createdBy: interaction.user.id };
    saveGuild(interaction.guildId, guildData);

    await interaction.reply({ embeds: [successEmbed(`Categoría **${nombre}** creada en **${resolved.label}**.`)] });
  }
};

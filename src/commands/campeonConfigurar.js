const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { parseColor, COLOR_NAMES_HELP } = require('../utils/color');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campeon_configurar')
    .setDescription('Elo Admin: activa/desactiva el rol de campeón de temporada en una cola, y su color.')
    .addBooleanOption(o => o.setName('activado').setDescription('¿Dar rol de campeón al n°1 cuando se resetee la temporada?').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Color del rol (hex como #FFD700, o un nombre como dorado/azul/rojo)').setRequired(false))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'campeon_configurar'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const activado = interaction.options.getBoolean('activado');
    const colorInput = interaction.options.getString('color');
    let color = null;
    if (colorInput) {
      color = parseColor(colorInput);
      if (color === null) {
        return interaction.reply({
          embeds: [errorEmbed(`Ese color no lo reconozco. Usá un hex (ej. \`#FFD700\`) o uno de estos nombres: ${COLOR_NAMES_HELP}.`)],
          ephemeral: true
        });
      }
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    store.championEnabled = activado;
    if (color !== null) store.championColor = color;
    saveGuild(interaction.guildId, guildData);

    const colorNote = color !== null ? ` (color actualizado)` : '';
    await interaction.reply({
      embeds: [successEmbed(
        activado
          ? `Listo — **${resolved.label}** le va a dar el rol 🏆 Campeón al n°1 de elo cada vez que se use \`/reset_season\` ahí${colorNote}.`
          : `Listo — **${resolved.label}** ya NO da el rol de campeón al resetear la temporada.`
      )]
    });
  }
};

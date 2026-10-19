const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { parseColorList } = require('../utils/color');

const hex = c => `#${Number(c).toString(16).padStart(6, '0').toUpperCase()}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campeon_configurar')
    .setDescription('Elo Admin: activa/desactiva los roles de podio (🥇🥈🥉) de temporada y sus colores.')
    .addBooleanOption(o => o.setName('activado').setDescription('¿Dar roles al top 3 (🥇 1º, 🥈 2º, 🥉 3º) al resetear la temporada?').setRequired(true))
    .addStringOption(o => o.setName('colores').setDescription('3 colores con coma: 1º, 2º, 3º (ej. amarillo, azul, verde; o hex #FFD700)').setRequired(false))
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
    const colorInput = interaction.options.getString('colores');

    // "amarillo, azul, verde" -> [🥇 1º, 🥈 2º, 🥉 3º]. Se piden mínimo 3.
    let colors = null;
    if (colorInput) {
      const parsed = parseColorList(colorInput, 3);
      if (!parsed.ok) {
        return interaction.reply({ embeds: [errorEmbed(parsed.message)], ephemeral: true });
      }
      colors = parsed.colors;
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    store.championEnabled = activado;

    if (colors) {
      store.championColor = colors[0];
      store.secondColor = colors[1];
      store.thirdColor = colors[2];
      // Si los roles ya existen, se les cambia el color ahora mismo;
      // si no, se aplica cuando se creen en el próximo reset de temporada.
      const ids = [store.championRoleId, store.secondRoleId, store.thirdRoleId];
      for (let i = 0; i < 3; i++) {
        if (!ids[i]) continue;
        const role = await interaction.guild.roles.fetch(ids[i]).catch(() => null);
        if (role) await role.edit({ color: colors[i] }).catch(() => {});
      }
    }
    saveGuild(interaction.guildId, guildData);

    const colorNote = colors
      ? `\nColores: 🥇 \`${hex(colors[0])}\` · 🥈 \`${hex(colors[1])}\` · 🥉 \`${hex(colors[2])}\``
      : '';

    await interaction.reply({
      embeds: [successEmbed(
        activado
          ? `Listo — **${resolved.label}** va a dar los roles 🥇 Campeón, 🥈 Subcampeón y 🥉 3er lugar al top 3 de Elo cada vez que se use \`/reset_season\` ahí.${colorNote}`
          : `Listo — **${resolved.label}** ya NO da roles de podio al resetear la temporada.${colorNote}`
      )]
    });
  }
};

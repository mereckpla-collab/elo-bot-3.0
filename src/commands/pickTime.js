const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { PICK_TIMEOUT_MS } = require('../config');
const { resolveTargetMode, modeChoices, formatDuration } = require('../utils/modeTimers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pick_time')
    .setDescription('Elo Admin: cambia cuánto tiempo tiene cada capitán para pickear en un modo.')
    .addIntegerOption(o => o
      .setName('seconds')
      .setDescription('Segundos por pick (15 a 600)')
      .setMinValue(15)
      .setMaxValue(600)
      .setRequired(true))
    .addStringOption(o => o
      .setName('mode')
      .setDescription('El modo a editar (obligatorio si hay varios modos)')
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return interaction.respond(modeChoices(guildData, interaction.options.getFocused()));
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'pick_time'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const target = resolveTargetMode(guildData, interaction.options.getString('mode'));
    if (target.error) {
      return interaction.reply({ embeds: [errorEmbed(target.error)], ephemeral: true });
    }

    const seconds = interaction.options.getInteger('seconds');
    target.store.pickTimeoutMs = seconds * 1000;
    saveGuild(interaction.guildId, guildData);

    return interaction.reply({
      embeds: [successEmbed(
        `En ${target.label} cada capitán ahora tiene **${formatDuration(seconds * 1000)}** para pickear ` +
        `(por defecto: ${formatDuration(PICK_TIMEOUT_MS)}). Se aplica desde el próximo pick; los drafts en curso terminan con el tiempo que ya tenían.`
      )],
      ephemeral: true
    });
  }
};
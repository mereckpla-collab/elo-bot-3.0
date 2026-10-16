const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { QUEUE_TIMEOUT_MS } = require('../config');
const { resolveTargetMode, modeChoices, formatDuration } = require('../utils/modeTimers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk_time')
    .setDescription('Elo Admin: cambia cuánto tiempo puede estar alguien AFK en la cola de un modo antes de ser kickeado.')
    .addIntegerOption(o => o
      .setName('minutes')
      .setDescription('Minutos en cola antes del kick por AFK (1 a 120)')
      .setMinValue(1)
      .setMaxValue(120)
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
    if (!(await assertChannel(interaction, guildData, 'afk_time'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const target = resolveTargetMode(guildData, interaction.options.getString('mode'));
    if (target.error) {
      return interaction.reply({ embeds: [errorEmbed(target.error)], ephemeral: true });
    }

    const minutes = interaction.options.getInteger('minutes');
    target.store.queueTimeoutMs = minutes * 60 * 1000;
    saveGuild(interaction.guildId, guildData);

    return interaction.reply({
      embeds: [successEmbed(
        `En ${target.label} quien esté en la cola sin jugar será kickeado por AFK a los **${formatDuration(minutes * 60 * 1000)}** ` +
        `(por defecto: ${formatDuration(QUEUE_TIMEOUT_MS)}). Se aplica a quienes se unan desde ahora; el que ya está en cola conserva su tiempo anterior.`
      )],
      ephemeral: true
    });
  }
};
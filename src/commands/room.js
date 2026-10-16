const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resetQueue } = require('../handlers/queueManager');
const { resolveModeKeyFromInput, autocompleteModo } = require('../utils/queueScope');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('room')
    .setDescription('Elo Admin: herramientas de administración de colas.')
    .addSubcommandGroup(g => g
      .setName('manage')
      .setDescription('Gestionar una cola puntual por su ID.')
      .addSubcommand(sc => sc
        .setName('reset-queue')
        .setDescription('Reinicia la cola de queue_id, equivalente a /reset_queue.')
        .addStringOption(o => o.setName('queue_id').setDescription('Qué cola reiniciar').setRequired(true).setAutocomplete(true)))),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'room'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (group === 'manage' && sub === 'reset-queue') {
      const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('queue_id'));
      if (!resolved.ok) {
        return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
      }

      const { count } = await resetQueue(interaction.client, interaction.guildId, resolved.modeKey);

      return interaction.reply({
        embeds: [successEmbed(
          count
            ? `✅ Se reinició **${resolved.label}** — se sacó a ${count} jugador(es) que estaban esperando.`
            : `✅ **${resolved.label}** ya estaba vacía, no había nadie esperando.`
        )]
      });
    }
  }
};

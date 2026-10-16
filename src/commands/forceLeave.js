const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { clearTimer, refreshQueueMessage, resolveModeFromChannel } = require('../handlers/queueManager');
const { displayName } = require('../utils/names');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force_leave')
    .setDescription('Elo Admin: fuerza a uno o varios jugadores a salir de la cola de este canal.')
    .addStringOption(o => o.setName('usuarios').setDescription('Menciona a los jugadores (@user @user ...)').setRequired(true)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'force_leave'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved) {
      return interaction.reply({ embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (la cola por defecto o el canal de algún modo).')], ephemeral: true });
    }
    const { modeKey } = resolved;
    const store = modeKey ? guildData.modes[modeKey] : guildData;
    if (modeKey && !store.queue) store.queue = [];

    const mentioned = interaction.options.getString('usuarios').match(/\d{15,20}/g) || [];
    if (!mentioned.length) {
      return interaction.reply({ embeds: [errorEmbed('Menciona al menos a un jugador.')], ephemeral: true });
    }

    const removed = [];
    for (const userId of mentioned) {
      const wasInQueue = store.queue.some(q => q.userId === userId);
      if (!wasInQueue) continue;
      store.queue = store.queue.filter(q => q.userId !== userId);
      clearTimer(interaction.guildId, userId, modeKey);
      removed.push(userId);
    }
    saveGuild(interaction.guildId, guildData);

    if (!removed.length) {
      return interaction.reply({ embeds: [errorEmbed('Ninguno de esos jugadores estaba en la cola de este canal.')], ephemeral: true });
    }

    await interaction.reply({
      embeds: [successEmbed(`${removed.map(id => `<@${id}>`).join(' ')} fue removido de la cola por <@${interaction.user.id}>.`)]
    });

    const names = removed.map(id => displayName(store, id)).join(', ');
    await refreshQueueMessage(interaction.client, interaction.guildId, `${names} fue removido de la cola por un Elo Admin.`, false, modeKey);
  }
};
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { COLOR_PRIMARY, QUEUE_SIZE } = require('../config');
const { resolveQueueOptions } = require('../utils/queueScope');

const STATUS_LABEL = {
  drafting: '🎯 Draft en curso',
  pending: '🗳️ Jugando / esperando resultado',
  finished: '✅ Terminada (se oculta pronto)',
  cancelled: '❌ Cancelada (se oculta pronto)'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partidas')
    .setDescription('Muestra qué colas y partidas (hilos) hay abiertas ahora mismo.'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    const options = resolveQueueOptions(guildData);
    if (!options.length) {
      return interaction.reply({ content: 'Este servidor todavía no tiene ninguna cola configurada.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const fields = [];
    let openTotal = 0;

    for (const opt of options) {
      const modeKey = opt.key === 'default' ? null : opt.key;
      const store = modeKey ? guildData.modes[modeKey] : guildData;
      const channelId = modeKey ? store.channelId : guildData.channels.queue;
      const total = modeKey ? store.totalPlayers : QUEUE_SIZE;
      const waiting = (store.queue || []).length;

      // Hilos que siguen abiertos (no archivados) en el canal de esta cola.
      const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
      let activeIds = null;
      if (channel?.threads) {
        const fetched = await channel.threads.fetchActive().catch(() => null);
        if (fetched) activeIds = new Set(fetched.threads.keys());
      }

      const games = Object.values(guildData.games || {})
        .filter(g => (g.modeKey || null) === modeKey && g.threadId)
        .filter(g => activeIds ? activeIds.has(g.threadId) : (g.status === 'drafting' || g.status === 'pending'))
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

      openTotal += games.length;

      const header = `${channelId ? `<#${channelId}>` : opt.label} — 👥 ${waiting}/${total} en cola`;
      const lines = games.length
        ? games.map(g => `${STATUS_LABEL[g.status] || g.status} · Game n°${g.number ?? g.id} → <#${g.threadId}>`).join('\n')
        : 'Sin partidas abiertas.';

      fields.push({ name: `${opt.label}`.slice(0, 256), value: `${header}\n${lines}`.slice(0, 1024) });
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle('🎮 Partidas abiertas')
      .setDescription(openTotal
        ? `Hay **${openTotal}** partida(s) con hilo abierto. Los hilos terminados se ocultan solos a los 10 minutos.`
        : 'No hay ninguna partida abierta ahora mismo. ¡Únete a una cola!')
      .addFields(fields.slice(0, 25));

    return interaction.editReply({ embeds: [embed] });
  }
};

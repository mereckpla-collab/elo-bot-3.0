const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { COLOR_WARN } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bans')
    .setDescription('Gestión de baneados.')
    .addSubcommand(sc => sc.setName('ban').setDescription('Ver si un jugador está baneado y por cuánto tiempo.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true)))
    .addSubcommand(sc => sc.setName('show').setDescription('Ver la lista completa de baneados.'))
    .addSubcommand(sc => sc.setName('clear').setDescription('Elo Admin: limpia TODA la lista de baneados.'))
    .addSubcommand(sc => sc.setName('unban').setDescription('Elo Admin: desbanea a un jugador específico.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'bans'))) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'ban') {
      const target = interaction.options.getUser('usuario');
      const ban = guildData.bans[target.id];
      if (!ban || (ban.until && ban.until <= Date.now())) {
        return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> no está baneado.`)] });
      }
      const untilText = ban.until ? `<t:${Math.floor(ban.until / 1000)}:R>` : 'nunca (permanente)';
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> está baneado hasta ${untilText}.\nRazón: ${ban.reason}`)] });
    }

    if (sub === 'show') {
      const active = Object.entries(guildData.bans).filter(([, b]) => !b.until || b.until > Date.now());
      const embed = new EmbedBuilder().setColor(COLOR_WARN).setTitle('Bans for All modes');
      if (!active.length) {
        embed.setDescription('No hay jugadores baneados.');
      } else {
        const lines = active.map(([userId, b]) => {
          const untilText = b.until ? `<t:${Math.floor(b.until / 1000)}:R>` : 'permanente';
          const scope = (!b.mode || b.mode === 'all') ? 'todos los modos' :
            b.mode === 'default' ? 'cola por defecto' : (guildData.modes[b.mode]?.name || b.mode);
          return `<@${userId}> until ${untilText} | ${b.reason} (by <@${b.bannedBy}>) — **${scope}**`;
        });
        embed.setDescription(lines.join('\n')).setFooter({ text: `${active.length} bans` });
      }
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'clear') {
      if (!isEloAdmin(interaction, guildData)) {
        return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede limpiar la lista de baneados.')], ephemeral: true });
      }
      const count = Object.keys(guildData.bans).length;
      guildData.bans = {};
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({ embeds: [successEmbed(`<@${interaction.user.id}> cleared the ban list, ${count} players got unbanned`)] });
    }

    if (sub === 'unban') {
      if (!isEloAdmin(interaction, guildData)) {
        return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede desbanear.')], ephemeral: true });
      }
      const target = interaction.options.getUser('usuario');
      if (!guildData.bans[target.id]) {
        return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> no estaba baneado.`)], ephemeral: true });
      }
      delete guildData.bans[target.id];
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> has been unbanned by <@${interaction.user.id}>`)] });
    }
  }
};
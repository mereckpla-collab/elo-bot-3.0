const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { isEloAdmin } = require('../handlers/resultManager');
const { isBotOwner, getEffectiveTier, getLimits, totalRegisteredPlayers, VIP_DURATION_MS } = require('../utils/vip');
const { VIP_TIERS } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vip')
    .setDescription('Gestión de VIP de este servidor.')
    .addSubcommand(sc => sc
      .setName('set')
      .setDescription('(Solo el dueño del bot) Activa un plan VIP para este servidor por 1 mes')
      .addStringOption(o => o
        .setName('tier')
        .setDescription('Plan a activar')
        .setRequired(true)
        .addChoices(
          { name: 'Free (quitar VIP)', value: 'free' },
          { name: 'VIP Basic', value: 'basic' },
          { name: 'VIP Pro', value: 'pro' }
        )))
    .addSubcommand(sc => sc.setName('status').setDescription('Muestra el plan VIP actual de este servidor')),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      if (!(await isBotOwner(interaction))) {
        return interaction.reply({ embeds: [errorEmbed('Solo el dueño del bot puede activar VIP.')], ephemeral: true });
      }

      const tier = interaction.options.getString('tier');
      if (tier === 'free') {
        guildData.vip = { tier: 'free', activatedAt: null, expiresAt: null, limitAlerted: false };
        saveGuild(interaction.guildId, guildData);
        return interaction.reply({ embeds: [successEmbed('VIP quitado. Este servidor volvió al plan Free.')], ephemeral: true });
      }

      const now = Date.now();
      guildData.vip = { tier, activatedAt: now, expiresAt: now + VIP_DURATION_MS, limitAlerted: false };
      saveGuild(interaction.guildId, guildData);

      const label = VIP_TIERS[tier].label;
      const expiresTag = `<t:${Math.floor((now + VIP_DURATION_MS) / 1000)}:D>`;
      return interaction.reply({
        embeds: [successEmbed(`Se activó **${label}** para este servidor. Vence el ${expiresTag}.`)],
        ephemeral: true
      });
    }

    if (sub === 'status') {
      if (!isEloAdmin(interaction, guildData)) {
        return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede ver el estado del VIP.')], ephemeral: true });
      }
      const tier = getEffectiveTier(guildData);
      const limits = getLimits(guildData);
      const total = totalRegisteredPlayers(guildData);
      const modesCount = Object.keys(guildData.modes || {}).length;

      let expiresLine = '';
      if (tier !== 'free' && guildData.vip.expiresAt) {
        expiresLine = `\nVence: <t:${Math.floor(guildData.vip.expiresAt / 1000)}:D> (<t:${Math.floor(guildData.vip.expiresAt / 1000)}:R>)`;
      }

      return interaction.reply({
        embeds: [successEmbed(
          `**Plan actual:** ${limits.label}${expiresLine}\n` +
          `**Jugadores registrados:** ${total} / ${limits.maxPlayers === Infinity ? '∞' : limits.maxPlayers}\n` +
          `**Modos creados:** ${modesCount} / ${limits.maxModes === Infinity ? '∞' : limits.maxModes}`
        )],
        ephemeral: true
      });
    }
  }
};
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { COLOR_PRIMARY } = require('../config');

function metaLabel(ach) {
  const ping = ach.pingEveryone ? ' 📢' : '';
  if (ach.negative) return `(caer a ${ach.threshold} de Elo o menos) 💀${ping}`;
  return metaLabelBase(ach) + ping;
}

function metaLabelBase(ach) {
  switch (ach.metric) {
    case 'elo': return `(alcanzar ${ach.threshold} de Elo)`;
    case 'racha': return `(racha de ${ach.threshold} partidos ganados)`;
    case 'winrate': return `(${ach.threshold}% de WR, mín. ${ach.minGames} partidas)`;
    case 'partidas': return `(${ach.threshold} partidas jugadas)`;
    case 'victorias': return `(${ach.threshold} partidas ganadas)`;
    default: return '';
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ver_roles')
    .setDescription('Ve los roles de logro configurados en una cola/modo.')
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'ver_roles'))) return;

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const allAchievements = Object.values(store.roleAchievements || {});
    const achievements = allAchievements.filter(a => !a.negative);
    const negatives = allAchievements.filter(a => a.negative).sort((a, b) => b.threshold - a.threshold);
    if (!allAchievements.length) {
      return interaction.reply({ embeds: [errorEmbed(`**${resolved.label}** todavía no tiene ningún rol de logro. Creá uno con \`/crear_rol\`.`)], ephemeral: true });
    }

    const categories = Object.values(store.roleCategories || {});
    const lines = [];

    for (const cat of categories) {
      const roles = achievements.filter(a => a.categoryKey === cat.key);
      if (!roles.length) continue;
      lines.push(`\n**${cat.name.toUpperCase()}:**`);
      for (const a of roles) lines.push(`<@&${a.roleId}> ${metaLabel(a)}`);
    }

    const uncategorized = achievements.filter(a => !a.categoryKey || !store.roleCategories?.[a.categoryKey]);
    if (uncategorized.length) {
      lines.push(`\n**SIN CATEGORÍA:**`);
      for (const a of uncategorized) lines.push(`<@&${a.roleId}> ${metaLabel(a)}`);
    }

    if (negatives.length) {
      lines.push(`\n**NEGATIVOS 💀:**`);
      for (const a of negatives) lines.push(`<@&${a.roleId}> ${metaLabel(a)}`);
    }
    if (allAchievements.some(a => a.pingEveryone)) {
      lines.push(`\n-# 📢 = el bot menciona @everyone en anuncios cuando alguien lo consigue`);
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`🏅 Roles — ${resolved.label}`)
      .setDescription(lines.join('\n').trim());

    await interaction.reply({ embeds: [embed] });
  }
};

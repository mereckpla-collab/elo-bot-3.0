const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { computeStat } = require('../handlers/achievements');
const { COLOR_PRIMARY } = require('../config');

function progressLine(ach, player) {
  const roleTag = ach.roleId ? `<@&${ach.roleId}>` : `**${ach.name}**`;

  if (ach.metric === 'winrate') {
    const gamesLeft = Math.max(0, (ach.minGames || 1) - player.gamesPlayed);
    if (gamesLeft > 0) {
      return `🔒 ${roleTag} — te faltan **${gamesLeft} partida(s)** jugadas para calificar (mín. ${ach.minGames})`;
    }
    const value = computeStat(player, 'winrate');
    const remaining = Math.max(0, ach.threshold - value);
    return `🔒 ${roleTag} — ${value.toFixed(1)}% de WR (necesitás ${ach.threshold}%) — te faltan **${remaining.toFixed(1)} pts**`;
  }

  const value = computeStat(player, ach.metric);
  const remaining = Math.max(0, ach.threshold - value);
  const unit = ach.metric === 'elo' ? 'de Elo' : ach.metric === 'racha' ? 'de racha' : ach.metric === 'victorias' ? 'partidas ganadas' : 'partidas jugadas';
  return `🔒 ${roleTag} — ${Math.round(value)}/${ach.threshold} ${unit} — te faltan **${Math.ceil(remaining)}**`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logros_progreso')
    .setDescription('Ve qué te falta (o le falta a otra persona) para conseguir cada logro.')
    .addUserOption(o => o.setName('usuario').setDescription('De quién ver el progreso (por defecto, el tuyo)').setRequired(false)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'logros_progreso'))) return;

    const target = interaction.options.getUser('usuario') || interaction.user;
    const isSelf = target.id === interaction.user.id;

    const stores = [
      { label: 'Cola por defecto', store: guildData },
      ...Object.values(guildData.modes || {}).map(m => ({ label: m.name, store: m }))
    ];

    const sections = [];
    for (const { label, store } of stores) {
      const player = store.players?.[target.id];
      const achievements = Object.values(store.roleAchievements || {}).filter(a => !a.negative);
      if (!player || !achievements.length) continue;

      const pending = achievements.filter(a => !(player.achievements && player.achievements[a.key]));
      if (!pending.length) continue;

      const lines = pending
        .sort((a, b) => a.threshold - b.threshold)
        .map(a => progressLine(a, player));
      sections.push(`**${label}:**\n${lines.join('\n')}`);
    }

    if (!sections.length) {
      return interaction.reply({
        embeds: [errorEmbed(
          isSelf
            ? 'No te falta ningún logro por conseguir en ninguna cola donde jugaste (¡o todavía no hay roles configurados!).'
            : `A <@${target.id}> no le falta ningún logro por conseguir en ninguna cola donde jugó.`
        )],
        ephemeral: isSelf
      });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const displayName = member?.displayName || target.username;

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`🔒 Progreso de logros — ${displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(sections.join('\n\n'));

    await interaction.reply({ embeds: [embed] });
  }
};

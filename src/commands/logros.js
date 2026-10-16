const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { COLOR_PRIMARY } = require('../config');
const { earnedSeasons } = require('../handlers/achievements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logros')
    .setDescription('Ve los logros/roles que ya conseguiste, o los de otra persona.')
    .addUserOption(o => o.setName('usuario').setDescription('De quién ver los logros (por defecto, los tuyos)').setRequired(false)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'logros'))) return;

    const target = interaction.options.getUser('usuario') || interaction.user;
    const isSelf = target.id === interaction.user.id;

    // Se recorren todas las colas (la de siempre + cada modo) porque los
    // logros son independientes por cola — alguien puede tener roles
    // conseguidos en varias a la vez.
    const stores = [
      { label: 'Cola por defecto', store: guildData },
      ...Object.values(guildData.modes || {}).map(m => ({ label: m.name, store: m }))
    ];

    const sections = [];
    for (const { label, store } of stores) {
      const player = store.players?.[target.id];
      if (!player?.achievements) continue;
      const keys = Object.keys(player.achievements);
      if (!keys.length) continue;

      const lines = keys
        .sort((a, b) => (player.achievements[a].earnedAt || 0) - (player.achievements[b].earnedAt || 0))
        .map(key => {
          const ach = store.roleAchievements?.[key];
          const info = player.achievements[key];
          const dateTag = info?.earnedAt ? `<t:${Math.floor(info.earnedAt / 1000)}:D>` : 'fecha desconocida';
          const roleTag = ach?.roleId ? `<@&${ach.roleId}>` : `**${ach ? ach.name : key}**`;
          // Un solo renglón por rol: si lo consiguió en varias temporadas se
          // agrupa como "Aprendiz (x2)" en vez de repetirlo.
          const seasons = earnedSeasons(info);
          const icon = ach?.negative ? '💀' : '🏅';
          if (seasons.length > 1) {
            return `${icon} ${roleTag} **(x${seasons.length})** — primera vez ${dateTag} (Temporadas ${seasons.join(', ')})`;
          }
          return `${icon} ${roleTag} — conseguido ${dateTag} (Temporada ${info?.season ?? '?'})`;
        });

      sections.push(`**${label}:**\n${lines.join('\n')}`);
    }

    if (!sections.length) {
      return interaction.reply({
        embeds: [errorEmbed(isSelf ? 'Todavía no conseguiste ningún logro.' : `<@${target.id}> todavía no consiguió ningún logro.`)],
        ephemeral: isSelf
      });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const displayName = member?.displayName || target.username;

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`🏅 Logros de ${displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(sections.join('\n\n'));

    await interaction.reply({ embeds: [embed] });
  }
};
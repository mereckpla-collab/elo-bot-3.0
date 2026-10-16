const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { COLOR_WARN } = require('../config');

function isBotOwner(interaction) {
  return interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_season_autorizar')
    .setDescription('Solo el dueño del bot: da o quita permiso para usar /reset_season en este servidor.')
    .addSubcommand(sc => sc
      .setName('add')
      .setDescription('Autoriza a alguien a usar /reset_season acá.')
      .addUserOption(o => o.setName('usuario').setDescription('Persona a autorizar').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('remove')
      .setDescription('Le saca el permiso de usar /reset_season a alguien.')
      .addUserOption(o => o.setName('usuario').setDescription('Persona a desautorizar').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('show')
      .setDescription('Ve quién tiene permiso de usar /reset_season en este servidor.')),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'reset_season_autorizar'))) return;

    // Este comando es en sí mismo tan sensible como /reset_season — si
    // cualquiera pudiera autorizar gente, el permiso dejaría de significar
    // algo. Por eso SOLO el dueño del bot (el mismo que ya puede usar
    // /reset_season siempre) puede tocarlo, nunca un Elo Admin.
    if (!isBotOwner(interaction)) {
      return interaction.reply({ embeds: [errorEmbed('Solo el dueño del bot puede usar este comando.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    guildData.resetSeasonAuthorized = guildData.resetSeasonAuthorized || {};

    if (sub === 'add') {
      const target = interaction.options.getUser('usuario');
      guildData.resetSeasonAuthorized[target.id] = { addedAt: Date.now(), addedBy: interaction.user.id };
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> ya puede usar \`/reset_season\` en este servidor.`)] });
    }

    if (sub === 'remove') {
      const target = interaction.options.getUser('usuario');
      if (!guildData.resetSeasonAuthorized[target.id]) {
        return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> no estaba autorizado a usar \`/reset_season\`.`)], ephemeral: true });
      }
      delete guildData.resetSeasonAuthorized[target.id];
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> ya no puede usar \`/reset_season\` en este servidor.`)] });
    }

    if (sub === 'show') {
      const ids = Object.keys(guildData.resetSeasonAuthorized);
      const embed = new EmbedBuilder().setColor(COLOR_WARN).setTitle('🔑 Autorizados a usar /reset_season');
      embed.setDescription(
        ids.length
          ? ids.map(id => `<@${id}>`).join('\n')
          : 'Nadie más — acá solo vos (el dueño del bot) podés usarlo.'
      );
      return interaction.reply({ embeds: [embed] });
    }
  }
};

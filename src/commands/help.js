const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR_PRIMARY } = require('../config');
const { t, commandDescriptions, SUPPORTED_LANGS, COMMAND_CATEGORIES, CATEGORY_ORDER } = require('../utils/i18n');
const { buildChannelsEmbed, buildChannelsLangRow } = require('../utils/channelsHelp');
const { getGuild } = require('../database');

// Un embed por categoría en vez de uno solo con todos los comandos — Discord
// no deja más de 25 campos (fields) por embed, y entre todos los comandos
// del bot ya se pasa de sobra ese número.
function buildHelpEmbeds(lang) {
  const descriptions = commandDescriptions(lang);

  const grouped = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const [cmd, desc] of Object.entries(descriptions)) {
    const cat = COMMAND_CATEGORIES[cmd] || 'players';
    (grouped[cat] || (grouped[cat] = [])).push([cmd, desc]);
  }

  const embeds = [];
  const first = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(t(lang, 'help_title'))
    .setDescription(t(lang, 'help_desc'));
  embeds.push(first);

  CATEGORY_ORDER.forEach((cat, i) => {
    const entries = grouped[cat];
    if (!entries.length) return;
    const embed = i === 0 ? first : new EmbedBuilder().setColor(COLOR_PRIMARY);
    embed.addFields({ name: t(lang, `cat_${cat}`), value: '\u200b' });
    for (const [cmd, desc] of entries) embed.addFields({ name: cmd, value: desc });
    if (i !== 0) embeds.push(embed);
  });

  return embeds;
}

function buildLangRow() {
  const labels = { es: '🇪🇸 Español', en: '🇬🇧 English', pt: '🇵🇹 Português', fr: '🇫🇷 Français' };
  const row = new ActionRowBuilder();
  for (const lang of SUPPORTED_LANGS) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`help_lang_${lang}`).setLabel(labels[lang]).setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Muestra los comandos del bot, o en qué canal va cada uno (tema: canales).')
    .addStringOption(o => o.setName('tema').setDescription('Qué quieres ver (por defecto, los comandos)').setRequired(false)
      .addChoices({ name: 'Comandos', value: 'comandos' }, { name: 'Canales (qué comando va en cada canal)', value: 'canales' })),

  async execute(interaction) {
    if (interaction.options.getString('tema') === 'canales') {
      return interaction.reply({
        embeds: [buildChannelsEmbed('es', getGuild(interaction.guildId), interaction.client)],
        components: [buildChannelsLangRow()],
        ephemeral: true
      });
    }
    await interaction.reply({
      embeds: buildHelpEmbeds('es'),
      components: [buildLangRow()],
      ephemeral: true
    });
  },

  buildHelpEmbeds,
  buildLangRow
};
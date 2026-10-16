const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { COLOR_WARN } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('captainban')
    .setDescription('Jugadores que nunca pueden ser elegidos capitanes en el draft.')
    .addSubcommand(sc => sc.setName('add').setDescription('Elo Admin: impide que un jugador sea capitán.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
      .addStringOption(o => o.setName('razon').setDescription('Razón').setRequired(false))
      .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Elo Admin: permite de nuevo que un jugador sea capitán.')
      .addUserOption(o => o.setName('usuario').setDescription('Jugador').setRequired(true))
      .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)))
    .addSubcommand(sc => sc.setName('show').setDescription('Ver la lista negra de capitanes (black captains list) de una cola.')
      .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true))),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'captainban'))) return;
    const sub = interaction.options.getSubcommand();

    // La black captains list es independiente por cola — igual que el elo
    // y los logros. Un ban en una cola no afecta a las demás.
    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }
    const store = storeForModeKey(guildData, resolved.modeKey);
    store.captainBlacklist = store.captainBlacklist || {};

    if (sub === 'add') {
      if (!isEloAdmin(interaction, guildData)) {
        return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
      }
      const target = interaction.options.getUser('usuario');
      const razon = interaction.options.getString('razon') || 'Sin razón especificada';
      store.captainBlacklist[target.id] = { bannedBy: interaction.user.id, reason: razon, bannedAt: Date.now() };
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({
        embeds: [successEmbed(
          `<@${target.id}> fue agregado a la **black captains list** de **${resolved.label}** por <@${interaction.user.id}>.\n` +
          `Razón: ${razon}\n` +
          `Sigue pudiendo jugar y ser pickeado normalmente ahí, pero nunca volverá a salir sorteado como capitán en esa cola.`
        )]
      });
    }

    if (sub === 'remove') {
      if (!isEloAdmin(interaction, guildData)) {
        return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
      }
      const target = interaction.options.getUser('usuario');
      if (!store.captainBlacklist[target.id]) {
        return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> no está en la black captains list de **${resolved.label}**.`)], ephemeral: true });
      }
      delete store.captainBlacklist[target.id];
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> fue removido de la black captains list de **${resolved.label}** por <@${interaction.user.id}>.`)] });
    }

    if (sub === 'show') {
      const now = Date.now();
      // Los entries automáticos (AFK al pickear) que ya vencieron no
      // aplican más — se muestran aparte para no mezclarlos con los bans
      // manuales, que no vencen nunca.
      const entries = Object.entries(store.captainBlacklist)
        .filter(([, b]) => !(b.until && b.until <= now));
      const embed = new EmbedBuilder().setColor(COLOR_WARN).setTitle(`🚫 Black Captains List — ${resolved.label}`);
      if (!entries.length) {
        embed.setDescription('No hay jugadores en la lista negra de capitanes de esta cola.');
      } else {
        const lines = entries.map(([userId, b]) => {
          if (b.auto) return `<@${userId}> — ${b.reason} (vence <t:${Math.floor(b.until / 1000)}:R>)`;
          return `<@${userId}> — ${b.reason} (agregado por <@${b.bannedBy}>)`;
        });
        embed.setDescription(lines.join('\n')).setFooter({ text: `${entries.length} jugador(es) en la lista` });
      }
      return interaction.reply({ embeds: [embed] });
    }
  }
};
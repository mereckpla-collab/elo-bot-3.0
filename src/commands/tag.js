const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { resolveModeFromChannel } = require('../handlers/queueManager');

const COOLDOWN_MS = 7 * 60 * 1000; // 7 minutos
const MAX_MISSING = 3; // solo se puede avisar si faltan 3 jugadores o menos

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Avisa a los que activaron /tag_activar que a la cola le faltan pocos jugadores.'),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'tag'))) return;

    let resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved && interaction.channel?.isThread?.()) {
      resolved = resolveModeFromChannel(guildData, interaction.channel.parentId);
    }
    if (!resolved) {
      return interaction.reply({
        embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (o el hilo de una partida de esa cola).')],
        ephemeral: true
      });
    }
    const { modeKey, totalPlayers, label } = resolved;
    const store = modeKey ? guildData.modes[modeKey] : guildData;

    // Solo alguien que está EN la cola puede tirar el aviso — no cualquiera
    // de afuera que quiera spammear el rol.
    if (!store.queue.some(q => q.userId === interaction.user.id)) {
      return interaction.reply({ embeds: [errorEmbed(`Tenés que estar anotado en **${label}** para poder usar este comando.`)], ephemeral: true });
    }

    const missing = totalPlayers - store.queue.length;
    if (missing <= 0) {
      return interaction.reply({ embeds: [errorEmbed(`**${label}** ya está completa, no hace falta avisar.`)], ephemeral: true });
    }
    if (missing > MAX_MISSING) {
      return interaction.reply({
        embeds: [errorEmbed(`Todavía faltan **${missing}** jugadores en **${label}** — este aviso es solo para cuando faltan ${MAX_MISSING} o menos.`)],
        ephemeral: true
      });
    }

    const last = store.lastTagPing || 0;
    const elapsed = Date.now() - last;
    if (elapsed < COOLDOWN_MS) {
      const retryAt = Math.floor((last + COOLDOWN_MS) / 1000);
      return interaction.reply({
        embeds: [errorEmbed(`Este comando se puede usar una vez cada 7 minutos por cola — probá de nuevo <t:${retryAt}:R>.`)],
        ephemeral: true
      });
    }

    if (!store.tagRoleId) {
      return interaction.reply({
        embeds: [errorEmbed(`Todavía nadie activó los avisos de **${label}** con \`/tag_activar\` — no hay a quién avisarle.`)],
        ephemeral: true
      });
    }

    store.lastTagPing = Date.now();
    saveGuild(interaction.guildId, guildData);

    await interaction.reply({
      content: `<@&${store.tagRoleId}> 🔔 ¡A **${label}** le ${missing === 1 ? 'falta 1 jugador' : `faltan ${missing} jugadores`} para completarse! Vengan a unirse 👇`,
      allowedMentions: { roles: [store.tagRoleId] }
    });
  }
};

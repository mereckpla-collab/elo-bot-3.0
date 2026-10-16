const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuild, saveGuild, getOrCreatePlayer, healPlayerName } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { COLOR_SUCCESS } = require('../config');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin, findQueueBlockingGame } = require('../handlers/resultManager');
const { startDraft } = require('../handlers/draftManager');
const { resolveModeFromChannel, refreshQueueMessage } = require('../handlers/queueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force_join')
    .setDescription('Elo Admin: fuerza a uno o varios jugadores a unirse a la cola de este canal.')
    .addStringOption(o => o.setName('usuarios').setDescription('Menciona a los jugadores (@user @user ...)').setRequired(true)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'force_join'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    // La cola en la que se agrega depende de DESDE QUÉ CANAL se corre el
    // comando — si hay varios modos (silver, premium, etc.), cada uno tiene
    // su propio canal, y este comando actúa sobre la cola de ESE canal.
    const resolved = resolveModeFromChannel(guildData, interaction.channelId);
    if (!resolved) {
      return interaction.reply({ embeds: [errorEmbed('Este comando solo se puede usar dentro de un canal de cola (la cola por defecto o el canal de algún modo).')], ephemeral: true });
    }
    const { modeKey, totalPlayers } = resolved;
    const store = modeKey ? guildData.modes[modeKey] : guildData;
    if (modeKey && !store.queue) store.queue = [];
    if (modeKey && !store.players) store.players = {};

    const mentioned = interaction.options.getString('usuarios').match(/\d{15,20}/g) || [];
    if (!mentioned.length) {
      return interaction.reply({ embeds: [errorEmbed('Menciona al menos a un jugador.')], ephemeral: true });
    }

    const added = [];
    const skipped = [];
    for (const userId of mentioned) {
      if (store.queue.length >= totalPlayers) break;
      if (store.queue.some(q => q.userId === userId)) continue;

      // /force_join es una acción explícita de un Elo Admin: si decide meter
      // a alguien a la fuerza, eso vale incluso si esa persona está baneada.
      // El ban solo bloquea el auto-join normal (botón "Unirse"), no esto.
      if (findQueueBlockingGame(guildData, userId, modeKey)) {
        skipped.push(userId);
        continue;
      }

      // Resolver el nombre real del jugador: si ya tiene un nombre puesto
      // con /rename en cualquier otra cola, se usa ese primero (para que se
      // vea igual en todos lados); si no, nick del server > nombre global >
      // username, para no guardar nunca el ID crudo como nombre.
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const fallbackName = guildData.preferredNames?.[userId] ||
        member?.nickname || member?.user?.globalName || member?.user?.username || userId;

      getOrCreatePlayer(store, userId, fallbackName);
      healPlayerName(store, userId, fallbackName);
      guildData.knownPlayerIds[userId] = true;

      store.queue.push({ userId, joinedAt: Date.now() });
      added.push(userId);
    }
    saveGuild(interaction.guildId, guildData);

    const embed = new EmbedBuilder()
      .setColor(COLOR_SUCCESS)
      .setDescription(
        `## ✅ __Jugadores agregados a la cola__\n` +
        `${added.length ? added.map(id => `🟢 <@${id}>`).join('\n') : '— Nadie —'}\n` +
        `\n*Agregados por <@${interaction.user.id}>*` +
        (skipped.length
          ? `\n\n### ⚠️ No se pudo agregar\n${skipped.map(id => `🚫 <@${id}>`).join('\n')}\n*(ya está en un draft/partida pendiente de votar)*`
          : '')
      );

    await interaction.reply({ embeds: [embed] });

    // Esto era lo que faltaba: sin este refresh, el mensaje de la cola en el
    // canal se quedaba mostrando el cupo viejo aunque el jugador ya estuviera
    // adentro.
    if (added.length) {
      const mentions = added.map(id => `<@${id}>`).join(' ');
      await refreshQueueMessage(interaction.client, interaction.guildId, `🟢 ${mentions} fue agregado a la cola por un Elo Admin <t:${Math.floor(Date.now() / 1000)}:R>`, false, modeKey);
    }

    if (store.queue.length >= totalPlayers) {
      if (modeKey) {
        const mode = guildData.modes[modeKey];
        await startDraft(interaction.client, interaction.guildId, {
          modeKey, teamsCount: mode.teams, playersPerTeam: mode.playersPerTeam, pickSystem: mode.pickSystem
        });
      } else {
        await startDraft(interaction.client, interaction.guildId);
      }
    }
  }
};
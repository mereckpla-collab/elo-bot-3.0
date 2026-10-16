const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild, saveGuild, defaultPlayer } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { ensureSeasonDividerRole, announceSeasonChange, clearSeasonParticipants } = require('../utils/seasonDivider');
const { awardChampionRole, announceChampions } = require('../utils/championRole');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey, resolveQueueOptions } = require('../utils/queueScope');

// El modeKey va codificado en el customId del botón para que
// handleConfirm/handleCancel sepan sobre cuál cola actuar sin tener que
// adivinar ni depender de que sea la única que existe en ese momento.
// '__all__' = todas las colas del servidor (cuando no se elige `modo`).
const ALL = '__all__';
function encodeModeKey(modeKey) {
  return modeKey || '__default__';
}
function decodeModeKey(encoded) {
  return encoded === '__default__' ? null : encoded;
}

// Colas que todavía no se reiniciaron en este ciclo (cada cola cuenta cuando
// se la reinicia, haya tenido actividad o no). Vienen en el orden en que se
// crearon: la cola por defecto primero y después cada modo.
function pendingQueues(guildData) {
  const done = guildData.seasonResetQueues || {};
  return resolveQueueOptions(guildData).filter(opt => !done[opt.key]);
}

// Reinicia UNA cola: primero anuncia su podio (con el elo tal como está,
// antes de tocar nada) y después resetea elo/stats de todos sus jugadores.
// No borra los roles de logro ya ganados (eso vive en player.achievements,
// que se preserva a propósito). Marca la cola como reiniciada en este ciclo.
async function resetOneQueue(interaction, guildData, modeKey) {
  const store = storeForModeKey(guildData, modeKey);

  const champResult = await awardChampionRole(interaction.guild, guildData, modeKey).catch(() => null);
  if (champResult) {
    await announceChampions(interaction.client, guildData, champResult).catch(() => {});
  }

  for (const userId of Object.keys(store.players || {})) {
    const old = store.players[userId];
    store.players[userId] = defaultPlayer(userId, old.name);
    store.players[userId].achievements = old.achievements || {};
    store.players[userId].rankHistory = old.rankHistory || {}; // el historial de rangos se conserva entre temporadas
  }

  // El número de partida de esta cola vuelve a 1 (Game n°1, n°2...).
  store.numberSeq = { next: 1, reusable: [] };

  guildData.seasonResetQueues = guildData.seasonResetQueues || {};
  guildData.seasonResetQueues[modeKey || 'default'] = true;
  saveGuild(interaction.guildId, guildData);

  // Se refresca el mensaje de la cola para que ya muestre "nº1".
  const { refreshQueueMessage } = require('../handlers/queueManager');
  await refreshQueueMessage(interaction.client, interaction.guildId, null, false, modeKey).catch(() => {});
}

// La temporada es UNA sola para todo el servidor: avanza una única vez,
// cuando ya se reiniciaron todas las colas. El anuncio del separador queda
// DEBAJO de los podios (se manda al final).
async function advanceSeason(interaction, guildData) {
  guildData.season = (guildData.season || 1) + 1;
  guildData.seasonResetQueues = {};
  // Se les saca el rol a los que jugaron la temporada que termina ANTES
  // de renombrar el rol a la nueva — así arranca sin nadie puesto.
  await clearSeasonParticipants(interaction.guild, guildData).catch(() => {});
  await ensureSeasonDividerRole(interaction.guild, guildData, guildData.season).catch(() => {});
  await announceSeasonChange(interaction.client, guildData, guildData.season).catch(() => {});
  saveGuild(interaction.guildId, guildData);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_season')
    .setDescription('Reinicia el elo y stats de una cola, o de TODAS si no eliges modo. La temporada es global.')
    .addStringOption(o => o.setName('modo').setDescription('Una cola puntual. Vacío = todas las colas, en orden de creación').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'reset_season'))) return;

    // Además del dueño del bot (OWNER_ID), puede usarlo cualquiera que un
    // admin de este server haya autorizado con /reset_season_autorizar.
    const isAuthorized = interaction.user.id === process.env.OWNER_ID || guildData.resetSeasonAuthorized?.[interaction.user.id];
    if (!isAuthorized) {
      return interaction.reply({ embeds: [errorEmbed('Solo el dueño del bot (o alguien que haya autorizado) puede usar este comando.')], ephemeral: true });
    }

    const queueOptions = resolveQueueOptions(guildData);
    if (queueOptions.length === 0) {
      return interaction.reply({ embeds: [errorEmbed('Este servidor todavía no tiene ninguna cola configurada.')], ephemeral: true });
    }

    const modoInput = interaction.options.getString('modo');

    // Sin `modo` y con varias colas: se reinician TODAS, en el orden en que
    // se crearon, y la temporada nueva arranca al final.
    if (!modoInput && queueOptions.length > 1) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`reset_season_confirm_${ALL}`).setLabel('Sí, reiniciar TODAS las colas').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`reset_season_cancel_${ALL}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({
        content: `⚠️ Esto reinicia elo, wins, losses, rachas y partidas jugadas de **TODAS las colas**, en este orden: ${queueOptions.map(o => `**${o.label}**`).join(' → ')}.\n` +
          `Se anuncia el podio de cada una y, al terminar, arranca la **Temporada ${(guildData.season || 1) + 1}**. ` +
          `**Los roles de logro ya ganados NO se pierden** — quedan guardados con la temporada en la que se consiguieron. ¿Confirmas?\n` +
          `-# Si quieres reiniciar solo una, vuelve a usar el comando eligiendo \`modo\`.`,
        components: [row],
        ephemeral: true
      });
    }

    const resolved = resolveModeKeyFromInput(guildData, modoInput);
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const encoded = encodeModeKey(resolved.modeKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reset_season_confirm_${encoded}`).setLabel('Sí, reiniciar esta cola').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`reset_season_cancel_${encoded}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `⚠️ Esto reinicia elo, wins, losses, rachas y partidas jugadas de TODOS los jugadores de **${resolved.label}** (solo esa cola — las demás no se tocan en su elo). La **Temporada** nueva (compartida por todas las colas) arranca recién cuando hayas reiniciado TODAS las colas. **Los roles de logro ya ganados NO se pierden** — quedan guardados con la temporada en la que se consiguieron. ¿Confirmas?`,
      components: [row],
      ephemeral: true
    });
  },

  async handleConfirm(interaction) {
    // Se contesta al botón DE INMEDIATO: el reinicio (podios, roles de
    // temporada, etc.) puede tardar bastante más de los 3 segundos que Discord
    // da para responder; si no se contesta a tiempo la interacción caduca,
    // falla y (antes) tiraba abajo el bot.
    await interaction.deferUpdate().catch(() => {});

    try {
      const encoded = interaction.customId.replace('reset_season_confirm_', '');
      const guildData = getGuild(interaction.guildId);

      // ---- Todas las colas, en orden de creación ----
      if (encoded === ALL) {
        const queueOptions = resolveQueueOptions(guildData);
        for (const opt of queueOptions) {
          await resetOneQueue(interaction, guildData, opt.key === 'default' ? null : opt.key);
        }
        await advanceSeason(interaction, guildData);
        return await interaction.editReply({
          content: `✅ Se reiniciaron todas las colas (${queueOptions.map(o => `**${o.label}**`).join(', ')}) y se anunció el podio de cada una — ahora es la **Temporada ${guildData.season}**. Los roles de logro que ya se habían ganado se mantienen.`,
          components: []
        });
      }

      // ---- Una sola cola ----
      const modeKey = decodeModeKey(encoded);
      const label = modeKey ? (guildData.modes[modeKey]?.name || modeKey) : 'la cola por defecto';
      await resetOneQueue(interaction, guildData, modeKey);

      const pending = pendingQueues(guildData);
      if (pending.length) {
        return await interaction.editReply({
          content: `✅ Se reinició el elo y las estadísticas de **${label}** y se anunció su podio de la **Temporada ${guildData.season}**.\n` +
            `⏳ La **Temporada ${(guildData.season || 1) + 1}** arranca cuando reinicies también: ${pending.map(o => `**${o.label}**`).join(', ')}. Los roles de logro que ya se habían ganado se mantienen.`,
          components: []
        });
      }

      // Era la última cola que faltaba: ahora sí avanza la temporada.
      await advanceSeason(interaction, guildData);
      return await interaction.editReply({
        content: `✅ Se reinició **${label}** y ya estaban reiniciadas todas las demás colas — ahora es la **Temporada ${guildData.season}**. Los roles de logro que ya se habían ganado se mantienen.`,
        components: []
      });
    } catch (err) {
      console.error('[reset_season] Falló el reinicio:', err);
      await interaction.editReply({
        content: `⚠️ El reinicio falló a la mitad: ${err.message}\nRevisa la consola del bot. Lo que ya se reinició quedó guardado; puedes volver a usar /reset_season para seguir con las colas que falten.`,
        components: []
      }).catch(() => {});
    }
  },

  async handleCancel(interaction) {
    await interaction.update({ content: 'Cancelado. No se cambió nada.', components: [] });
  }
};
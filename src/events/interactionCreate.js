const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, leaderboardEmbed, leaderboardComponents } = require('../utils/embeds');
const queueManager = require('../handlers/queueManager');
const { resolvePick } = require('../handlers/draftManager');
const { handleVote, isEloAdmin, revertAndReapply, resolveRankedResult, parseRankingInput } = require('../handlers/resultManager');
const modeWizard = require('../handlers/modeWizard');
const { buildHelpEmbeds, buildLangRow } = require('../commands/help');
const { buildPage } = require('../commands/result');
const { buildHistoryPage, decodeModeKey: decodeHistoryModeKey, decodeUserId: decodeHistoryUserId } = require('../commands/historial');
const { displayName } = require('../utils/names');
const { buildRevertPrompt } = require('../commands/revertir');

// El mensaje de draft ahora es un embed clásico (no Components V2), así que
// acá solo hay filas de botones que reconstruir con los picks deshabilitados.
// El embed en sí no se toca: al no incluirlo en el payload del update(),
// Discord lo deja tal cual estaba.
function disablePickButtons(rawComponents, chosenCustomId) {
  return rawComponents.map(comp => {
    const newRow = ActionRowBuilder.from(comp);
    newRow.components = comp.components.map(c => {
      const btn = ButtonBuilder.from(c);
      if (c.customId === chosenCustomId) btn.setStyle(ButtonStyle.Danger);
      btn.setDisabled(true);
      return btn;
    });
    return newRow;
  });
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command?.autocomplete) return command.autocomplete(interaction);
        return interaction.respond([]);
      }

      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        return command.execute(interaction);
      }

      if (interaction.isButton()) {
        const id = interaction.customId;
        const guildData = getGuild(interaction.guildId);

        if (id === 'queue_join') return queueManager.joinQueue(interaction.client, interaction, guildData);
        if (id === 'queue_leave') return queueManager.leaveQueue(interaction.client, interaction, guildData);
        if (id === 'queue_bump') return queueManager.bumpQueue(interaction.client, interaction, guildData);
        if (id === 'queue_refresh') return queueManager.refreshOwnTimer(interaction.client, interaction, guildData);

        if (id.startsWith('mq_join_')) return queueManager.joinQueue(interaction.client, interaction, guildData, id.replace('mq_join_', ''));
        if (id.startsWith('mq_leave_')) return queueManager.leaveQueue(interaction.client, interaction, guildData, id.replace('mq_leave_', ''));
        if (id.startsWith('mq_bump_')) return queueManager.bumpQueue(interaction.client, interaction, guildData, id.replace('mq_bump_', ''));
        if (id.startsWith('mq_refresh_')) return queueManager.refreshOwnTimer(interaction.client, interaction, guildData, id.replace('mq_refresh_', ''));

        if (id.startsWith('joinnext_')) {
          const raw = id.replace('joinnext_', '');
          const modeKey = raw === '__default__' ? null : raw;
          return queueManager.joinQueue(interaction.client, interaction, guildData, modeKey);
        }

        if (id.startsWith('sala_free_') || id.startsWith('sala_occupy_') || id.startsWith('sala_down_')) {
          const { setRoomStatus, roomByCode } = require('../utils/salas');
          let action, code;
          if (id.startsWith('sala_free_')) { action = 'free'; code = id.slice('sala_free_'.length); }
          else if (id.startsWith('sala_occupy_')) { action = 'occupy'; code = id.slice('sala_occupy_'.length); }
          else { action = 'down'; code = id.slice('sala_down_'.length); }

          const room = roomByCode(code);
          if (!room) {
            return interaction.reply({ embeds: [errorEmbed('Esa sala ya no existe en la lista.')], ephemeral: true });
          }
          const statusMap = { free: 'libre', occupy: 'ocupada', down: 'caida' };
          const labelMap = { free: `🟢 **${room.name}** quedó libre.`, occupy: `🔴 **${room.name}** sigue ocupada.`, down: `⚫ **${room.name}** se cayó.` };
          setRoomStatus(room.code, statusMap[action], interaction.user.id);
          return interaction.reply({ content: `${labelMap[action]} (reportado por <@${interaction.user.id}>)` });
        }
        if (id.startsWith('mq_moderator_')) {
          if (!isEloAdmin(interaction, guildData)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar el panel de moderador.')], ephemeral: true });
          }
          const modeKey = id.replace('mq_moderator_', '');
          const mode = guildData.modes[modeKey];
          const count = mode ? mode.queue.length : 0;
          return interaction.reply({
            content: `Cola de \`${modeKey}\`: ${count} jugador(es). Usa \`/force_join\`, \`/bans\` y \`/revertir\` para el resto de acciones de moderación.`,
            ephemeral: true
          });
        }

        if (id.startsWith('mw_')) {
          const entryPoints = ['mw_type_solo', 'mw_type_team', 'mw_type_ffa', 'mw_viewmodes'];
          if (entryPoints.includes(id) && !isEloAdmin(interaction, guildData)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede crear o ver modos.')], ephemeral: true });
          }

          if (id === 'mw_type_solo') return modeWizard.start(interaction, 'solo');
          if (id === 'mw_type_team') return modeWizard.start(interaction, 'team');
          if (id === 'mw_type_ffa') return modeWizard.start(interaction, 'ffa');
          if (id === 'mw_viewmodes') return modeWizard.viewModes(interaction, guildData);

          if (id.startsWith('mw_teams_')) return modeWizard.chooseTeams(interaction, Number(id.replace('mw_teams_', '')));
          if (id === 'mw_teamsmore') return modeWizard.askTeamsMore(interaction);
          if (id.startsWith('mw_players_')) return modeWizard.choosePlayers(interaction, Number(id.replace('mw_players_', '')));
          if (id === 'mw_playersmore') return modeWizard.askPlayersMore(interaction);
          if (id === 'mw_rename') return modeWizard.askRename(interaction);
          if (id === 'mw_streak') return modeWizard.toggleStreak(interaction);
          if (id === 'mw_ranks') return modeWizard.toggleRanks(interaction);
          if (id === 'mw_season') return modeWizard.askSeason(interaction);
          if (id === 'mw_champion') return modeWizard.toggleChampion(interaction);
          if (id === 'mw_finish') return modeWizard.finish(interaction, guildData);
          if (id === 'mw_cancel') return modeWizard.cancel(interaction);
        }

        if (id === 'queue_moderator') {
          if (!isEloAdmin(interaction, guildData)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar el panel de moderador.')], ephemeral: true });
          }
          return interaction.reply({
            content: `Cola actual: ${guildData.queue.length} jugador(es). Usa \`/force_join\` para agregar gente o \`/bans\` y \`/revertir\` para el resto de acciones de moderación.`,
            ephemeral: true
          });
        }

        if (id.startsWith('pickrandom_')) {
          const gameId = id.split('_')[1];
          const game = guildData.games[Number(gameId)];
          if (!game || game.status !== 'drafting') {
            return interaction.reply({ embeds: [errorEmbed('Ese draft ya no está activo.')], ephemeral: true });
          }
          if (interaction.user.id !== game.currentCaptain) {
            return interaction.reply({ embeds: [errorEmbed('No es tu turno de pickear.')], ephemeral: true });
          }
          if (!game.remainingPlayers.length) {
            return interaction.reply({ embeds: [errorEmbed('No quedan jugadores disponibles para pickear.')], ephemeral: true });
          }

          // Elige a cualquiera de los disponibles al azar, sin importar el elo.
          const pickedUserId = game.remainingPlayers[Math.floor(Math.random() * game.remainingPlayers.length)];
          const pickCustomId = `pick_${gameId}_${pickedUserId}`;

          const updatedComponents = disablePickButtons(interaction.message.components, pickCustomId);
          await interaction.update({ components: updatedComponents });

          return resolvePick(interaction.client, interaction.guildId, Number(gameId), pickedUserId, false);
        }

        if (id.startsWith('pick_')) {
  const [, gameId, pickedUserId] = id.split('_');
  const game = guildData.games[Number(gameId)];
  if (!game || game.status !== 'drafting') {
    return interaction.reply({ embeds: [errorEmbed('Ese draft ya no está activo.')], ephemeral: true });
  }
  if (interaction.user.id !== game.currentCaptain) {
    return interaction.reply({ embeds: [errorEmbed('No es tu turno de pickear.')], ephemeral: true });
  }

  // En el mensaje donde se pickeó: el botón elegido pasa a rojo y se
  // deshabilita todo (el embed con el estado del draft se deja igual,
  // solo se tocan las filas de botones). El siguiente estado del draft
  // (sin ese jugador) se publica aparte como mensaje nuevo.
  const updatedComponents = disablePickButtons(interaction.message.components, id);
  await interaction.update({ components: updatedComponents });

  return resolvePick(interaction.client, interaction.guildId, Number(gameId), pickedUserId, false);
}

        if (id.startsWith('rank_')) {
          const gameId = Number(id.replace('rank_', ''));
          if (!isEloAdmin(interaction, guildData)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede cargar el ranking final.')], ephemeral: true });
          }
          const game = guildData.games[gameId];
          if (!game || game.status !== 'pending') {
            return interaction.reply({ embeds: [errorEmbed('Esa partida ya no está esperando resultado.')], ephemeral: true });
          }
          const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ARB } = require('discord.js');
          const exampleOrder = Array.from({ length: game.teamsCount }, (_, i) => i + 1).join(',');
          const modal = new ModalBuilder()
            .setCustomId(`rankmodal_${gameId}`)
            .setTitle(`Ranking final — Game n°${game.number ?? gameId}`)
            .addComponents(
              new ARB().addComponents(
                new TextInputBuilder()
                  .setCustomId('order')
                  .setLabel('Equipos del 1° al último puesto')
                  .setPlaceholder(`Ej. ${exampleOrder}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
              )
            );
          return interaction.showModal(modal);
        }

        if (id.startsWith('vote_')) {
          const [, gameId, choice] = id.split('_');
          return handleVote(interaction.client, interaction, guildData, Number(gameId), choice);
        }

        if (id.startsWith('revert_')) {
          if (!isEloAdmin(interaction, guildData)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede revertir resultados.')], ephemeral: true });
          }

          if (id.startsWith('revert_rank_')) {
            const gameId = Number(id.replace('revert_rank_', ''));
            const game = guildData.games[gameId];
            if (!game) return interaction.update({ content: `No existe la partida n°${gameId}.`, components: [] });
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ARB } = require('discord.js');
            const exampleOrder = Array.from({ length: game.teamsCount }, (_, i) => i + 1).join(',');
            const modal = new ModalBuilder()
              .setCustomId(`revertrankmodal_${gameId}`)
              .setTitle(`Corregir ranking — Game n°${game.number ?? gameId}`)
              .addComponents(
                new ARB().addComponents(
                  new TextInputBuilder()
                    .setCustomId('order')
                    .setLabel('Equipos del 1° al último puesto')
                    .setPlaceholder(`Ej. ${exampleOrder}`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                )
              );
            return interaction.showModal(modal);
          }

          const [, gameId, choice] = id.split('_');
          const result = await revertAndReapply(interaction.client, interaction.guildId, Number(gameId), choice);
          if (!result.ok) {
            return interaction.update({ content: result.reason, components: [] });
          }
          await interaction.update({ content: '✅ Listo.', components: [] });
          const revertedGame = guildData.games[Number(gameId)];
          return interaction.followUp({ content: `✅ La Game n°${revertedGame?.number ?? gameId} fue revertida y actualizada.`, ephemeral: false });
        }

        if (id.startsWith('resultpage_')) {
          const [, action, currentPageStr, filtro] = id.split('_');
          const currentPage = Number(currentPageStr);
          const gd = getGuild(interaction.guildId);
          let targetPage = currentPage;
          if (action === 'first') targetPage = 0;
          if (action === 'prev') targetPage = currentPage - 1;
          if (action === 'next') targetPage = currentPage + 1;
          if (action === 'last') targetPage = Number.MAX_SAFE_INTEGER;
          const { embed, row } = buildPage(gd, targetPage, filtro || 'unfinished');
          return interaction.update({ embeds: [embed], components: [row] });
        }

        if (id.startsWith('historypage_')) {
          const [, action, currentPageStr, modeKeyEnc, userIdEnc] = id.split('_');
          const currentPage = Number(currentPageStr);
          const modeKey = decodeHistoryModeKey(modeKeyEnc);
          const targetUserId = decodeHistoryUserId(userIdEnc);
          const gd = getGuild(interaction.guildId);
          const store = modeKey ? gd.modes[modeKey] : gd;
          const targetName = targetUserId ? displayName(store, targetUserId) : null;
          let targetPage = currentPage;
          if (action === 'first') targetPage = 0;
          if (action === 'prev') targetPage = currentPage - 1;
          if (action === 'next') targetPage = currentPage + 1;
          if (action === 'last') targetPage = Number.MAX_SAFE_INTEGER;
          // El permiso se recalcula con quien TOCÓ el botón, no con quien
          // corrió el comando originalmente — el mensaje es público.
          const showRevert = isEloAdmin(interaction, gd);
          const { embed, components } = buildHistoryPage(gd, modeKey, targetUserId, targetName, targetPage, showRevert);
          return interaction.update({ embeds: [embed], components });
        }

        if (id.startsWith('historyrevert_')) {
          const gameId = Number(id.replace('historyrevert_', ''));
          const gd = getGuild(interaction.guildId);
          if (!isEloAdmin(interaction, gd)) {
            return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede revertir un resultado.')], ephemeral: true });
          }
          const game = gd.games[gameId];
          if (!game) {
            return interaction.reply({ embeds: [errorEmbed('Esa partida ya no existe.')], ephemeral: true });
          }
          const { embed, components } = buildRevertPrompt(gd, game, interaction.user.username);
          return interaction.reply({ embeds: [embed], components, ephemeral: true });
        }

        if (id === 'uninstall_confirm') return require('../commands/uninstall').handleConfirm(interaction);
        if (id === 'uninstall_cancel') return require('../commands/uninstall').handleCancel(interaction);

        if (id.startsWith('reset_season_confirm_')) return require('../commands/resetSeason').handleConfirm(interaction);
        if (id.startsWith('reset_season_cancel_')) return require('../commands/resetSeason').handleCancel(interaction);

        if (id.startsWith('help_canales_')) {
          const lang = id.replace('help_canales_', '');
          const { buildChannelsEmbed, buildChannelsLangRow } = require('../utils/channelsHelp');
          return interaction.update({
            embeds: [buildChannelsEmbed(lang, getGuild(interaction.guildId), interaction.client)],
            components: [buildChannelsLangRow()]
          });
        }

        if (id.startsWith('help_lang_')) {
          const lang = id.replace('help_lang_', '');
          return interaction.update({ embeds: buildHelpEmbeds(lang), components: [buildLangRow()] });
        }

        if (id.startsWith('lbpage_')) {
          const [, action, sortKey, pageStr, modeTag] = id.split('_');
          const currentPage = Number(pageStr);
          const gd = getGuild(interaction.guildId);
          let targetPage = currentPage;
          if (action === 'first') targetPage = 0;
          if (action === 'prev') targetPage = currentPage - 1;
          if (action === 'next') targetPage = currentPage + 1;
          if (action === 'last') targetPage = Number.MAX_SAFE_INTEGER;
          const modeKey = modeTag && modeTag !== 'default' ? modeTag : null;
          const store = modeKey ? gd.modes[modeKey] : gd;
          const modeLabel = modeKey ? gd.modes[modeKey]?.name : null;
          const { embed, page } = leaderboardEmbed(store || gd, sortKey, targetPage, modeLabel);
          return interaction.update({ embeds: [embed], components: leaderboardComponents(sortKey, page, modeKey) });
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('mwmodal_')) {
          return modeWizard.handleModalSubmit(interaction);
        }

        if (interaction.customId.startsWith('rankmodal_')) {
          const gameId = Number(interaction.customId.replace('rankmodal_', ''));
          const gd = getGuild(interaction.guildId);
          const game = gd.games[gameId];
          if (!game || game.status !== 'pending') {
            return interaction.reply({ embeds: [errorEmbed('Esa partida ya no está esperando resultado.')], ephemeral: true });
          }
          const raw = interaction.fields.getTextInputValue('order');
          const parsed = parseRankingInput(raw, game.teamsCount);
          if (!parsed.ok) {
            return interaction.reply({ embeds: [errorEmbed(parsed.error)], ephemeral: true });
          }
          await interaction.reply({ content: '✅ Ranking cargado.', ephemeral: true });
          return resolveRankedResult(interaction.client, interaction.guildId, gameId, parsed.order);
        }

        if (interaction.customId.startsWith('revertrankmodal_')) {
          const gameId = Number(interaction.customId.replace('revertrankmodal_', ''));
          const gd = getGuild(interaction.guildId);
          const game = gd.games[gameId];
          if (!game) {
            return interaction.reply({ embeds: [errorEmbed(`No existe la partida n°${gameId}.`)], ephemeral: true });
          }
          const raw = interaction.fields.getTextInputValue('order');
          const parsed = parseRankingInput(raw, game.teamsCount);
          if (!parsed.ok) {
            return interaction.reply({ embeds: [errorEmbed(parsed.error)], ephemeral: true });
          }
          const result = await revertAndReapply(interaction.client, interaction.guildId, gameId, { ranked: parsed.order });
          if (!result.ok) {
            return interaction.reply({ content: result.reason, ephemeral: true });
          }
          return interaction.reply({ content: `✅ La Game n°${game.number ?? gameId} fue revertida y actualizada.`, ephemeral: false });
        }
      }

      if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;

        if (id.startsWith('lbsort_')) {
          const [, pageStr, modeTag] = id.split('_');
          const sortKey = interaction.values[0];
          const gd = getGuild(interaction.guildId);
          const modeKey = modeTag && modeTag !== 'default' ? modeTag : null;
          const store = modeKey ? gd.modes[modeKey] : gd;
          const modeLabel = modeKey ? gd.modes[modeKey]?.name : null;
          const { embed, page } = leaderboardEmbed(store || gd, sortKey, 0, modeLabel);
          return interaction.update({ embeds: [embed], components: leaderboardComponents(sortKey, page, modeKey) });
        }
      }
    } catch (err) {
      console.error('Error manejando interacción:', err);
      const payload = { embeds: [errorEmbed('Ocurrió un error inesperado procesando esto.')], ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
};
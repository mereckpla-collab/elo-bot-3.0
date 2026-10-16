const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild, getOrCreatePlayer, healPlayerName, resolveGameContext } = require('../database');
const { errorEmbed, successEmbed, resultEmbed, resultButtons } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeFromChannel } = require('../handlers/queueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('substitute')
    .setDescription('Elo Admin: sustituye a un jugador de una partida pendiente por alguien fuera de la cola.')
    .addUserOption(o => o.setName('mention_player_going_out').setDescription('Jugador que sale').setRequired(true))
    .addUserOption(o => o.setName('mention_player_going_in').setDescription('Jugador que entra').setRequired(true)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'substitute'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    // Igual que /force_join: la cola sobre la que actúa depende de DESDE QUÉ
    // CANAL se corre el comando. Si se corre dentro del hilo de una partida
    // (el caso normal, ya que el hilo es donde se ve el draft/resultado), se
    // resuelve la cola a partir del canal PADRE de ese hilo.
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
    const { modeKey } = resolved;

    // La economía (elo/nombre) de esta sustitución vive en la cola detectada
    // arriba — nunca en la cola de siempre si en realidad se sustituyó a
    // alguien en un modo. Esto es lo que causaba que el jugador nuevo
    // apareciera con su ID crudo en vez de su nombre: se lo creaba en el
    // store equivocado, y el store correcto nunca tenía sus datos.
    const store = modeKey ? guildData.modes[modeKey] : guildData;
    if (modeKey && !store.players) store.players = {};

    const out = interaction.options.getUser('mention_player_going_out');
    const inn = interaction.options.getUser('mention_player_going_in');

    const game = Object.values(guildData.games).find(g => {
      if ((g.modeKey || null) !== (modeKey || null)) return false;
      if (g.status !== 'pending' && g.status !== 'drafting') return false;
      const allPlayers = g.teams ? g.teams.flat() : [...(g.team1 || []), ...(g.team2 || [])];
      return allPlayers.includes(out.id) || g.remainingPlayers?.includes(out.id);
    });

    if (!game) {
      return interaction.reply({ embeds: [errorEmbed(`No se encontró a <@${out.id}> en una partida pendiente de ${resolved.label}.`)], ephemeral: true });
    }

    const fallbackName = guildData.preferredNames?.[inn.id] || inn.globalName || inn.username;
    getOrCreatePlayer(store, inn.id, fallbackName);
    healPlayerName(store, inn.id, fallbackName);
    guildData.knownPlayerIds[inn.id] = true;

    if (game.teams) {
      game.teams = game.teams.map(team => team.map(id => (id === out.id ? inn.id : id)));
    } else {
      for (const listName of ['team1', 'team2']) {
        if (game[listName]?.includes(out.id)) {
          game[listName] = game[listName].map(id => (id === out.id ? inn.id : id));
        }
      }
    }
    if (game.remainingPlayers?.includes(out.id)) {
      game.remainingPlayers = game.remainingPlayers.map(id => (id === out.id ? inn.id : id));
    }
    if (game.captains) {
      game.captains = game.captains.map(id => (id === out.id ? inn.id : id));
    }
    if (game.captain1 === out.id) game.captain1 = inn.id;
    if (game.captain2 === out.id) game.captain2 = inn.id;
    if (game.currentCaptain === out.id) game.currentCaptain = inn.id;
    if (game.teams && game.teamsCount === 2) {
      game.team1 = game.teams[0];
      game.team2 = game.teams[1];
    }
    // Si el jugador que salió ya había votado, ese voto queda huérfano —
    // se lo saca de cualquier lista de votos para no contar de más.
    if (game.votes) {
      for (const key of Object.keys(game.votes)) {
        game.votes[key] = game.votes[key].filter(id => id !== out.id);
      }
    }

    saveGuild(interaction.guildId, guildData);

    const gameNumber = game.number ?? game.id;
    await interaction.reply({
      embeds: [successEmbed(`En la Game n°${gameNumber}: <@${out.id}> fue sustituido por <@${inn.id}>. El nuevo jugador recibirá el elo normal al reportarse el resultado.`)]
    });

    // Si ya había un mensaje de votación publicado (partida en 'pending'), se
    // refresca ahí mismo para que se vea el nombre correcto de una — antes
    // había que esperar a que alguien votara o se cerrara la partida para
    // que el cambio se reflejara.
    if (game.status === 'pending' && game.resultMessage) {
      const { store: gameStore, label } = resolveGameContext(guildData, game);
      const channel = await interaction.client.channels.fetch(game.resultMessage.channelId).catch(() => null);
      const msg = channel ? await channel.messages.fetch(game.resultMessage.messageId).catch(() => null) : null;
      if (msg) {
        await msg.edit({ embeds: [resultEmbed(gameStore, game, null, label)], components: resultButtons(game) }).catch(() => {});
      }
    }
  }
};
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR_PRIMARY, COMMAND_CHANNEL_MAP } = require('../config');
const { SUPPORTED_LANGS } = require('./i18n');

// Comandos cuyo permiso de canal se decide con una clave distinta a su nombre
// (por ejemplo /mapadd, /mapas y /mapremove usan la clave 'mode' = init).
const CHANNEL_OVERRIDES = { mapadd: 'init', mapas: 'init', mapremove: 'init' };

// Subcomandos de /stats por si no se pueden leer del propio comando.
const STATS_FALLBACK = {
  pub: ['player', 'graph', 'leaderboard', 'game', 'history', 'matchup', 'server', 'team-graph'],
  edit: ['add-points', 'remove-points', 'points', 'name', 'reset-all-names', 'stat', 'stats']
};

const TEXT = {
  es: {
    title: '📍 Qué comando va en cada canal',
    intro: 'Cada comando solo funciona en su canal. Si lo usas en otro, el bot te dice a cuál ir. Esta lista sale de la configuración real del bot, así que siempre está al día.',
    anuncios: 'El bot publica aquí los anuncios: campeones, logros, subidas de rango y cambio de temporada. No lleva comandos.',
    init: 'Panel de los Elo Admin: crear colas y modos, roles, categorías, tiempos y temporada.',
    info_chat: 'Consultas de los jugadores: stats, logros, historial y nombres.',
    submit: 'Resultados y correcciones: reportar o revertir partidas, reiniciar temporada y editar stats (Elo Admin).',
    game_announcement: 'El bot avisa aquí cuando arranca una partida. No lleva comandos.',
    bans: 'Sanciones: bans y bans de capitán.',
    queue: 'Canales de cola: aquí se unen y se manejan las colas.',
    any: 'Funcionan en cualquier canal.',
    notSet: 'sin configurar',
    statsPublic: 'consultas', statsEdit: 'edición (Elo Admin)'
  },
  en: {
    title: '📍 Which command goes in which channel',
    intro: 'Each command only works in its own channel. If you use it elsewhere, the bot tells you where to go. This list is built from the bot\'s real settings, so it is always up to date.',
    anuncios: 'The bot posts announcements here: champions, achievements, rank-ups and season changes. No commands.',
    init: 'Elo Admin panel: create queues and modes, roles, categories, timers and the season.',
    info_chat: 'Player lookups: stats, achievements, history and names.',
    submit: 'Results and fixes: report or revert games, reset the season and edit stats (Elo Admin).',
    game_announcement: 'The bot announces here when a game starts. No commands.',
    bans: 'Sanctions: bans and captain bans.',
    queue: 'Queue channels: players join and manage queues here.',
    any: 'Work in any channel.',
    notSet: 'not set',
    statsPublic: 'lookups', statsEdit: 'editing (Elo Admin)'
  },
  pt: {
    title: '📍 Que comando vai em cada canal',
    intro: 'Cada comando só funciona no seu canal. Se o usares noutro, o bot diz-te para onde ir. Esta lista vem da configuração real do bot, por isso está sempre atualizada.',
    anuncios: 'O bot publica aqui os anúncios: campeões, conquistas, subidas de rank e mudança de temporada. Sem comandos.',
    init: 'Painel dos Elo Admin: criar filas e modos, cargos, categorias, tempos e temporada.',
    info_chat: 'Consultas dos jogadores: stats, conquistas, histórico e nomes.',
    submit: 'Resultados e correções: reportar ou reverter partidas, reiniciar a temporada e editar stats (Elo Admin).',
    game_announcement: 'O bot avisa aqui quando uma partida começa. Sem comandos.',
    bans: 'Sanções: bans e bans de capitão.',
    queue: 'Canais de fila: aqui entram e gerem-se as filas.',
    any: 'Funcionam em qualquer canal.',
    notSet: 'sem configurar',
    statsPublic: 'consultas', statsEdit: 'edição (Elo Admin)'
  },
  fr: {
    title: '📍 Quelle commande va dans quel salon',
    intro: 'Chaque commande ne fonctionne que dans son salon. Si tu l\'utilises ailleurs, le bot t\'indique où aller. Cette liste vient de la vraie configuration du bot, elle est donc toujours à jour.',
    anuncios: 'Le bot publie ici les annonces : champions, succès, montées de rang et changement de saison. Aucune commande.',
    init: 'Panneau des Elo Admin : créer files et modes, rôles, catégories, délais et saison.',
    info_chat: 'Consultations des joueurs : stats, succès, historique et noms.',
    submit: 'Résultats et corrections : signaler ou annuler des parties, réinitialiser la saison et modifier les stats (Elo Admin).',
    game_announcement: 'Le bot annonce ici le début d\'une partie. Aucune commande.',
    bans: 'Sanctions : bans et bans de capitaine.',
    queue: 'Salons de file : on y rejoint et gère les files.',
    any: 'Fonctionnent dans n\'importe quel salon.',
    notSet: 'non configuré',
    statsPublic: 'consultations', statsEdit: 'édition (Elo Admin)'
  }
};

// Subcomandos de /stats, leídos del propio comando (así no se desactualiza).
function statsSubcommands(client) {
  const json = client.commands.get('stats')?.data?.toJSON?.();
  const pub = [];
  const edit = [];
  for (const o of json?.options || []) {
    if (o.type === 1) pub.push(o.name);
    else if (o.type === 2 && o.name === 'edit') for (const s of o.options || []) edit.push(s.name);
  }
  return pub.length || edit.length ? { pub, edit } : STATS_FALLBACK;
}

// Arma { canal: [comandos], any: [comandos] } a partir de la configuración real.
function commandsByChannel(client) {
  const byChannel = {};
  const any = [];
  const add = (key, text) => { (byChannel[key] || (byChannel[key] = [])).push(text); };

  for (const name of [...client.commands.keys()].sort()) {
    if (name === 'stats') continue; // se reparte por subcomando
    const key = CHANNEL_OVERRIDES[name] || COMMAND_CHANNEL_MAP[name];
    if (!key || key === 'any') any.push(`/${name}`);
    else add(key, `/${name}`);
  }

  if (client.commands.has('stats')) {
    const { pub, edit } = statsSubcommands(client);
    // Las consultas van en info_chat; la edición va en submit.
    if (pub.length) add('info_chat', `/stats ${pub.join(' · ')}`);
    if (edit.length) add('submit', `/stats edit ${edit.join(' · ')}`);
  }
  return { byChannel, any };
}

function channelMention(guildData, key, tx) {
  const id = guildData.channels?.[key];
  return id ? `<#${id}>` : `#${key} (${tx.notSet})`;
}

function buildChannelsEmbed(lang, guildData, client) {
  const tx = TEXT[lang] || TEXT.es;
  const { byChannel, any } = commandsByChannel(client);
  const list = key => (byChannel[key] || []).join(' · ') || '—';
  const embed = new EmbedBuilder().setColor(COLOR_PRIMARY).setTitle(tx.title).setDescription(tx.intro);

  const field = (key, icon) => {
    const cmds = byChannel[key];
    embed.addFields({
      name: `${icon} ${channelMention(guildData, key, tx)}`,
      value: `${tx[key]}${cmds ? `\n${cmds.join(' · ')}` : ''}`.slice(0, 1024)
    });
  };
  field('anuncios', '📢');
  field('init', '🛠️');
  field('info_chat', '💬');
  field('submit', '📝');
  field('game_announcement', '🎮');
  field('bans', '🔨');

  // Canales de cola: el de siempre (si existe) + uno por cada modo.
  const queues = [];
  if (guildData.channels?.queue) queues.push(`<#${guildData.channels.queue}>`);
  for (const mode of Object.values(guildData.modes || {})) {
    if (mode.channelId) queues.push(`<#${mode.channelId}>`);
  }
  embed.addFields({
    name: `⏳ ${queues.length ? queues.join(' ') : '#queue'}`,
    value: `${tx.queue}\n${list('queue')}`.slice(0, 1024)
  });

  embed.addFields({ name: `🌐 ${tx.any}`, value: any.length ? any.join(' · ').slice(0, 1024) : '—' });
  return embed;
}

function buildChannelsLangRow() {
  const labels = { es: '🇪🇸 Español', en: '🇬🇧 English', pt: '🇵🇹 Português', fr: '🇫🇷 Français' };
  const row = new ActionRowBuilder();
  for (const lang of SUPPORTED_LANGS) {
    row.addComponents(new ButtonBuilder().setCustomId(`help_canales_${lang}`).setLabel(labels[lang]).setStyle(ButtonStyle.Secondary));
  }
  return row;
}

module.exports = { buildChannelsEmbed, buildChannelsLangRow };

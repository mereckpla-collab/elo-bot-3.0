const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { parseColor, COLOR_NAMES_HELP } = require('../utils/color');

function slugify(name) {
  const base = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return base || 'rol';
}

const METRIC_LABELS = {
  elo: 'Elo',
  racha: 'Racha de victorias',
  winrate: 'Win rate (%)',
  partidas: 'Partidas jugadas',
  victorias: 'Partidas ganadas'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crear_rol')
    .setDescription('Elo Admin: crea un rol por Elo, racha, win rate, partidas jugadas o partidas ganadas.')
    .addStringOption(o => o.setName('nombre').setDescription('Nombre del rol (ej. Aprendiz, Farmer, PRIME)').setRequired(true).setMaxLength(32))
    .addStringOption(o => o.setName('metrica').setDescription('Qué se mide para dar el rol').setRequired(true)
      .addChoices(
        { name: 'Elo (alcanzar cierta cantidad)', value: 'elo' },
        { name: 'Racha (partidos ganados seguidos)', value: 'racha' },
        { name: 'Win rate (% de victorias)', value: 'winrate' },
        { name: 'Partidas jugadas', value: 'partidas' },
        { name: 'Partidas ganadas (victorias)', value: 'victorias' }
      ))
    .addIntegerOption(o => o.setName('meta').setDescription('Número a alcanzar (ej. 500 de elo, 5 de racha, 80 = 80% de WR, 50 victorias)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('color').setDescription('Color del rol (hex como #57F287, o un nombre como verde/azul/rojo)').setRequired(true))
    .addIntegerOption(o => o.setName('minimo_partidas').setDescription('Solo para win rate: partidas mínimas jugadas para calificar').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('categoria').setDescription('Categoría de rareza (opcional)').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focusedOpt = interaction.options.getFocused(true);

    if (focusedOpt.name === 'modo') return autocompleteModo(interaction, guildData);

    // 'categoria': depende de la cola/modo elegido (si ya se elegió).
    const focused = String(focusedOpt.value || '').toLowerCase();
    const modoInput = interaction.options.getString('modo');
    const resolved = resolveModeKeyFromInput(guildData, modoInput);
    let entries = [];
    if (resolved.ok) {
      const store = storeForModeKey(guildData, resolved.modeKey);
      entries = Object.values(store.roleCategories || {}).map(c => ({ name: c.name, value: c.key }));
    }
    const choices = entries.filter(e => e.name.toLowerCase().includes(focused)).slice(0, 25);
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'crear_rol'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Necesito el permiso "Gestionar roles" para crear el rol.')], ephemeral: true });
    }

    const nombre = interaction.options.getString('nombre').trim();
    const metric = interaction.options.getString('metrica');
    const threshold = interaction.options.getInteger('meta');
    const minGames = interaction.options.getInteger('minimo_partidas');
    const colorInput = interaction.options.getString('color');
    const categoriaInput = interaction.options.getString('categoria');

    const color = parseColor(colorInput);
    if (color === null) {
      return interaction.reply({
        embeds: [errorEmbed(`Ese color no lo reconozco. Usá un hex (ej. \`#57F287\`) o uno de estos nombres: ${COLOR_NAMES_HELP}.`)],
        ephemeral: true
      });
    }

    if (metric === 'winrate' && !minGames) {
      return interaction.reply({
        embeds: [errorEmbed('Para un rol de win rate tenés que poner también `minimo_partidas` (ej. mín. 20 partidas), para que no lo consiga alguien con solo 1 o 2 jugadas.')],
        ephemeral: true
      });
    }
    if (metric === 'winrate' && threshold > 100) {
      return interaction.reply({ embeds: [errorEmbed('El win rate se mide en % — poné un número entre 1 y 100.')], ephemeral: true });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    store.roleCategories = store.roleCategories || {};
    store.roleAchievements = store.roleAchievements || {};

    let categoryKey = null;
    if (categoriaInput) {
      if (!store.roleCategories[categoriaInput]) {
        return interaction.reply({ embeds: [errorEmbed(`No encontré esa categoría en **${resolved.label}**. Creála antes con \`/crear_categoria\`, o dejá el campo vacío.`)], ephemeral: true });
      }
      categoryKey = categoriaInput;
    }

    await interaction.deferReply();

    // El rol es un rol de Discord real, para que se pueda mencionar, usar
    // como filtro de permisos, etc. — no es solo un dato interno del bot.
    const role = await interaction.guild.roles.create({
      name: nombre,
      color,
      mentionable: true,
      reason: `/crear_rol por ${interaction.user.tag}`
    }).catch(() => null);

    if (!role) {
      return interaction.editReply({ embeds: [errorEmbed('No pude crear el rol en Discord — revisá que mi rol esté por encima en la jerarquía y que tenga permiso de Gestionar roles.')] });
    }

    // Siempre queda por debajo del rol de temporada.
    await require('../utils/seasonDivider').placeBelowSeasonRole(interaction.guild, guildData, role).catch(() => {});

    let key = slugify(nombre);
    if (store.roleAchievements[key]) {
      let n = 2;
      while (store.roleAchievements[`${key}_${n}`]) n++;
      key = `${key}_${n}`;
    }

    store.roleAchievements[key] = {
      key,
      name: nombre,
      roleId: role.id,
      metric,
      threshold,
      minGames: metric === 'winrate' ? minGames : null,
      color,
      categoryKey,
      createdAt: Date.now(),
      createdBy: interaction.user.id
    };
    saveGuild(interaction.guildId, guildData);

    const metaLabel = metric === 'winrate' ? `${threshold}% de WR (mín. ${minGames} partidas)`
      : metric === 'elo' ? `${threshold} de Elo`
      : metric === 'racha' ? `racha de ${threshold} partidos ganados`
      : metric === 'victorias' ? `${threshold} partidas ganadas`
      : `${threshold} partidas jugadas`;

    await interaction.editReply({
      embeds: [successEmbed(
        `Rol <@&${role.id}> creado en **${resolved.label}**.\n` +
        `Meta: **${METRIC_LABELS[metric]}** — ${metaLabel}.` +
        (categoryKey ? `\nCategoría: **${store.roleCategories[categoryKey].name}**.` : '') +
        `\n\nSe otorga solo y se anuncia en <#${guildData.channels.anuncios || '???'}> cuando alguien lo alcanza.`
      )]
    });
  }
};

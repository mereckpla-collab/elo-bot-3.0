const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { ELO_FLOOR } = require('../config');
const { resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');
const { parseColor, COLOR_NAMES_HELP } = require('../utils/color');
const { placeBelowSeasonRole } = require('../utils/seasonDivider');

const DEFAULT_NEGATIVE_COLOR = 0xED4245; // rojo

function slugify(name) {
  const base = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return base || 'rol';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crear_rol_negativo')
    .setDescription('Elo Admin: crea un rol "negativo" que se da al caer a cierto Elo negativo, con anuncio de burla.')
    .addStringOption(o => o.setName('nombre').setDescription('Nombre del rol (ej. Payaso, Pozo, Bot)').setRequired(true).setMaxLength(32))
    .addIntegerOption(o => o.setName('meta').setDescription('Elo negativo a alcanzar, en positivo (ej. 25 = -25 de Elo o menos)').setRequired(true).setMinValue(1).setMaxValue(300))
    .addStringOption(o => o.setName('color').setDescription('Color del rol (hex como #ED4245, o un nombre como rojo/gris). Por defecto, rojo').setRequired(false))
    .addStringOption(o => o.setName('mensaje').setDescription('Mensaje de burla propio. Usa {jugador} {elo} {rol} {modo}. Vacío = uno al azar').setRequired(false).setMaxLength(300))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    return autocompleteModo(interaction, guildData);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'crear_rol_negativo'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Necesito el permiso "Gestionar roles" para crear el rol.')], ephemeral: true });
    }

    const nombre = interaction.options.getString('nombre').trim();
    const meta = interaction.options.getInteger('meta');
    const colorInput = interaction.options.getString('color');
    const mensaje = (interaction.options.getString('mensaje') || '').trim() || null;

    if (meta > Math.abs(ELO_FLOOR)) {
      return interaction.reply({
        embeds: [errorEmbed(`El elo nunca baja de ${ELO_FLOOR}, así que una meta de -${meta} no se podría conseguir jamás. Usa ${Math.abs(ELO_FLOOR)} o menos.`)],
        ephemeral: true
      });
    }

    const color = colorInput ? parseColor(colorInput) : DEFAULT_NEGATIVE_COLOR;
    if (color === null) {
      return interaction.reply({
        embeds: [errorEmbed(`Ese color no lo reconozco. Usa un hex (ej. \`#ED4245\`) o uno de estos nombres: ${COLOR_NAMES_HELP}.`)],
        ephemeral: true
      });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    store.roleAchievements = store.roleAchievements || {};

    const threshold = -meta;
    const duplicate = Object.values(store.roleAchievements).find(a => a.negative && a.threshold === threshold);
    if (duplicate) {
      return interaction.reply({
        embeds: [errorEmbed(`En **${resolved.label}** ya existe un rol negativo para ${threshold} de Elo (**${duplicate.name}**).`)],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const role = await interaction.guild.roles.create({
      name: nombre,
      color,
      mentionable: true,
      reason: `/crear_rol_negativo por ${interaction.user.tag}`
    }).catch(() => null);

    if (!role) {
      return interaction.editReply({ embeds: [errorEmbed('No pude crear el rol en Discord — revisa que mi rol esté por encima en la jerarquía y que tenga permiso de Gestionar roles.')] });
    }

    // Siempre queda por debajo del rol de temporada.
    await placeBelowSeasonRole(interaction.guild, guildData, role).catch(() => {});

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
      metric: 'elo',
      threshold,          // negativo: se da con elo <= threshold
      negative: true,
      mockMessage: mensaje,
      pingEveryone: false,
      minGames: null,
      color,
      categoryKey: null,
      createdAt: Date.now(),
      createdBy: interaction.user.id
    };
    saveGuild(interaction.guildId, guildData);

    await interaction.editReply({
      embeds: [successEmbed(
        `Rol negativo <@&${role.id}> creado en **${resolved.label}**.\n` +
        `Meta: caer a **${threshold} de Elo** o menos.\n` +
        `Se otorga solo y se anuncia con burla en <#${guildData.channels.anuncios || '???'}>. Se acumula por temporada como los demás: "(x2)", "(x3)"…` +
        (mensaje ? `\nMensaje propio: ${mensaje}` : '\nMensaje: uno de burla al azar.')
      )]
    });
  }
};

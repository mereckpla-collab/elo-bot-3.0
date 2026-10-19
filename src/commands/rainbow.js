const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { RAINBOW_ROLE_NAME, RAINBOW_INTERVAL_MS } = require('../config');
const { startRainbow, hslToInt, placeOnTop, getStatus } = require('../utils/rainbowRole');
const { isBotOwner } = require('../utils/vip');

// Dueño del bot: quien figura como OWNER_ID en el .env, o el dueño real de la
// aplicación en el Portal de Desarrolladores de Discord (lo mismo que ya usan
// /install y /vip). Así funciona aunque OWNER_ID esté vacío o sea de otra cuenta.
async function isOwner(interaction) {
  if (process.env.OWNER_ID && interaction.user.id === process.env.OWNER_ID) return true;
  return Boolean(await isBotOwner(interaction).catch(() => false));
}

// Texto que explica cómo quedó la posición del rol.
function positionText(role, pos) {
  if (pos.atTop && !pos.blockers.length) return `Quedó arriba de todo (justo debajo de mi rol).`;
  const why = pos.blockers.length
    ? `Todavía hay roles con color por encima: ${pos.blockers.slice(0, 5).map(n => `**${n}**`).join(', ')}.`
    : 'No pude subirlo más.';
  return `⚠️ ${why}\nDiscord no deja que un bot ponga un rol por encima de su propio rol, y yo no puedo subir mi rol por mi cuenta. ` +
    `Quien sea dueño del servidor (o tenga un rol más alto que el mío) tiene que arrastrar mi rol${pos.botRoleName ? ` **${pos.botRoleName}**` : ''} hacia arriba en *Ajustes del servidor → Roles*, y después usar \`/rainbow subir\`.`;
}

async function currentRole(guild, guildData) {
  const id = guildData.rainbow?.roleId;
  if (!id) return null;
  return guild.roles.fetch(id).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rainbow')
    .setDescription('Dueño del bot: rol 🌈 que cambia de color solo (crear, dar y quitar).')
    .addSubcommand(sc => sc.setName('crear').setDescription('Crea el rol rainbow (cambia de color solo) y te lo pone.'))
    .addSubcommand(sc => sc.setName('dar').setDescription('Le pone el rol rainbow a alguien.')
      .addUserOption(o => o.setName('usuario').setDescription('A quién se lo pones').setRequired(true)))
    .addSubcommand(sc => sc.setName('quitar').setDescription('Le quita el rol rainbow a alguien.')
      .addUserOption(o => o.setName('usuario').setDescription('A quién se lo quitas').setRequired(true)))
    .addSubcommand(sc => sc.setName('subir').setDescription('Sube el rol rainbow arriba de todo (lo más alto que pueda el bot).'))
    .addSubcommand(sc => sc.setName('estado').setDescription('Muestra si el rainbow está cambiando de color y, si no, por qué.')),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'rainbow'))) return;

    // Solo el dueño del bot.
    if (!(await isOwner(interaction))) {
      return interaction.reply({
        embeds: [errorEmbed(
          'Solo el dueño del bot puede usar este comando.\n' +
          `Tu ID de Discord es \`${interaction.user.id}\`: si eres el dueño, ponlo en el \`.env\` como \`OWNER_ID=${interaction.user.id}\` y reinicia el bot.`
        )],
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ---------------- crear ----------------
    if (sub === 'crear') {
      const existing = await currentRole(guild, guildData);
      if (existing) {
        return interaction.reply({
          embeds: [errorEmbed(`El rol rainbow ya existe: <@&${existing.id}>. Usa \`/rainbow dar\` para ponérselo a alguien.`)],
          ephemeral: true
        });
      }
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ embeds: [errorEmbed('Necesito el permiso "Gestionar roles" para crear el rol.')], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const role = await guild.roles.create({
        name: RAINBOW_ROLE_NAME,
        color: hslToInt(0),
        permissions: [],
        mentionable: false,
        reason: `/rainbow crear por ${interaction.user.tag}`
      }).catch(() => null);
      if (!role) {
        return interaction.editReply({ embeds: [errorEmbed('No pude crear el rol. Revisa que tenga el permiso "Gestionar roles".')] });
      }

      // Se sube justo debajo del rol más alto del bot: así su color se ve por
      // encima de los demás roles de quien lo tenga.
      const pos = await placeOnTop(guild, role);

      // Primero se anota quién puede tenerlo; recién después se le pone, así
      // el vigilante de roles (events/guildMemberUpdate.js) no se lo saca.
      guildData.rainbow = { roleId: role.id, holders: [interaction.user.id], createdAt: Date.now() };
      saveGuild(interaction.guildId, guildData);

      const me = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (me) await me.roles.add(role).catch(() => {});

      startRainbow(interaction.client, interaction.guildId);
      return interaction.editReply({ embeds: [successEmbed(
        `Rol <@&${role.id}> creado y puesto a <@${interaction.user.id}>. Cambia de color solo, cada ${Math.round(RAINBOW_INTERVAL_MS / 1000)} segundos (a propósito no más seguido, para que Discord no frene al bot).\n` +
        `Solo tú y quien tú autorices con \`/rainbow dar\` pueden tenerlo: si se lo ponen a otra persona a mano, el bot se lo quita.\n` +
        positionText(role, pos)
      )] });
    }

    // ---------------- dar / quitar / subir ----------------
    const role = await currentRole(guild, guildData);
    if (!role) {
      return interaction.reply({ embeds: [errorEmbed('Todavía no hay rol rainbow. Créalo con `/rainbow crear`.')], ephemeral: true });
    }

    if (sub === 'estado') {
      let status = getStatus(interaction.guildId);
      let restarted = false;
      if (!status) { startRainbow(interaction.client, interaction.guildId); restarted = true; status = getStatus(interaction.guildId); }
      const botTop = guild.members.me?.roles?.highest;
      const lines = [
        `Rol: <@&${role.id}> (posición ${role.position}${botTop ? `; mi rol **${botTop.name}** está en la ${botTop.position}` : ''})`,
        `Cambiando de color: ${restarted ? '**estaba parado — lo reinicié ahora**' : (status?.lastError ? '⚠️ con problemas' : '✅ sí')}`,
        `Último cambio de color: ${status?.lastOk ? `<t:${Math.floor(status.lastOk / 1000)}:R>` : 'todavía ninguno'}`,
        `Espera entre cambios: ${Math.round((status?.delay || RAINBOW_INTERVAL_MS) / 1000)} s`,
        `Último error: ${status?.lastError || 'ninguno'}`,
        `Personas con el rol: ${(guildData.rainbow.holders || []).length}`
      ];
      if (botTop && role.position >= botTop.position) {
        lines.push('', '⚠️ El 🌈 está **igual o más arriba que mi rol**: así no puedo cambiarle el color. Sube mi rol por encima en *Ajustes del servidor → Roles*.');
      }
      return interaction.reply({ embeds: [(status?.lastError ? errorEmbed : successEmbed)(lines.join('\n'))], ephemeral: true });
    }

    if (sub === 'subir') {
      await interaction.deferReply({ ephemeral: true });
      const pos = await placeOnTop(guild, role);
      const body = `<@&${role.id}>: ${positionText(role, pos)}`;
      return interaction.editReply({ embeds: [pos.atTop && !pos.blockers.length ? successEmbed(body) : errorEmbed(body)] });
    }
    const target = interaction.options.getUser('usuario');
    const member = await guild.members.fetch(target.id).catch(() => null);
    guildData.rainbow.holders = guildData.rainbow.holders || [];

    if (sub === 'dar') {
      if (!member) return interaction.reply({ embeds: [errorEmbed('Esa persona no está en el servidor.')], ephemeral: true });
      if (!guildData.rainbow.holders.includes(target.id)) guildData.rainbow.holders.push(target.id);
      saveGuild(interaction.guildId, guildData); // antes de ponerlo: así el vigilante no se lo saca
      const ok = await member.roles.add(role, `/rainbow dar por ${interaction.user.tag}`).then(() => true).catch(() => false);
      if (!ok) {
        return interaction.reply({ embeds: [errorEmbed('No pude ponerle el rol: mi rol tiene que estar por encima del 🌈 en la lista de roles.')], ephemeral: true });
      }
      return interaction.reply({ embeds: [successEmbed(`<@${target.id}> ahora tiene <@&${role.id}>.`)] });
    }

    // quitar
    guildData.rainbow.holders = guildData.rainbow.holders.filter(id => id !== target.id);
    saveGuild(interaction.guildId, guildData);
    if (member) await member.roles.remove(role, `/rainbow quitar por ${interaction.user.tag}`).catch(() => {});
    return interaction.reply({ embeds: [successEmbed(`<@${target.id}> ya no tiene <@&${role.id}>.`)] });
  }
};

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed, initWelcomeEmbed, initWelcomeButtons } = require('../utils/embeds');
const { CATEGORY_NAME, ADMIN_CATEGORY_NAME, ADMIN_ROLE_NAME, CHANNEL_KEYS } = require('../config');
const { isBotOwner } = require('../utils/vip');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('install')
    .setDescription('Elo Admin: instala el bot en este servidor (crea canales y el rol Elo Admin).'),

  async execute(interaction) {
    const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const hasEloAdminRole = interaction.member.roles.cache.some(r => r.name === ADMIN_ROLE_NAME);
    const owner = await isBotOwner(interaction);

    if (!isAdministrator && !hasEloAdminRole && !owner) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Administrador del servidor, alguien con el rol "Elo Admin", o el dueño del bot puede instalarlo.')], ephemeral: true });
    }

    const existing = getGuild(interaction.guildId);
    if (existing.channels && existing.channels.init) {
      return interaction.reply({
        embeds: [errorEmbed('Este servidor ya tiene el bot instalado. Si querés reinstalarlo desde cero, primero usá `/uninstall`.')],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const guild = interaction.guild;
      const guildData = getGuild(guild.id);

      // Rol Elo Admin: si ya existe uno con ese nombre lo reutiliza, si no lo crea.
      let role = guild.roles.cache.find(r => r.name === ADMIN_ROLE_NAME);
      if (!role) {
        role = await guild.roles.create({ name: ADMIN_ROLE_NAME, mentionable: true, reason: 'Instalación de Elo de Doskuith' });
      }
      guildData.adminRoleId = role.id;

      // A quien instala el bot se le da el rol Elo Admin automáticamente,
      // si todavía no lo tenía.
      if (!interaction.member.roles.cache.has(role.id)) {
        await interaction.member.roles.add(role).catch(() => null);
      }

      // Categoría de las colas de los modos (Elo Queues) — se crea recién
      // cuando se arma el primer modo, no hace falta acá.
      // Categoría de administración (Elo Admin): agrupa init/info_chat/submit/
      // game_announcement/bans, que antes quedaban sueltos sin categoría.
      let adminCategory = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === ADMIN_CATEGORY_NAME);
      if (!adminCategory) {
        adminCategory = await guild.channels.create({ name: ADMIN_CATEGORY_NAME, type: ChannelType.GuildCategory });
      }
      guildData.adminCategoryId = adminCategory.id;

      const ensureChannel = async (name, key, parentId) => {
        let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText && (!parentId || c.parentId === parentId));
        if (!ch) {
          ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId || null });
        } else if (parentId && ch.parentId !== parentId) {
          await ch.setParent(parentId, { lockPermissions: false }).catch(() => null);
        }
        guildData.channels[key] = ch.id;
        return ch;
      };

      const initChannel = await ensureChannel(CHANNEL_KEYS.INIT, CHANNEL_KEYS.INIT, adminCategory.id);

      // init: privado, solo Elo Admin/admins/el bot (sin cambios de antes).
      await initChannel.permissionOverwrites.set([
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]).catch(() => null);

      if (!guildData.initMessage) {
        const msg = await initChannel.send({ embeds: [initWelcomeEmbed()], components: initWelcomeButtons() });
        guildData.initMessage = { channelId: initChannel.id, messageId: msg.id };
      }

      // info_chat: se puede ver y escribir normal, pero nadie (aparte de
      // Elo Admin/admins) puede abrir hilos ahí.
      const infoChatChannel = await ensureChannel(CHANNEL_KEYS.INFO_CHAT, CHANNEL_KEYS.INFO_CHAT, adminCategory.id);
      await infoChatChannel.permissionOverwrites.set([
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
        { id: role.id, allow: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads] }
      ]).catch(() => null);

      // submit: no es privado (se puede ver), pero solo Elo Admin/admins
      // pueden escribir ahí.
      const submitChannel = await ensureChannel(CHANNEL_KEYS.SUBMIT, CHANNEL_KEYS.SUBMIT, adminCategory.id);
      await submitChannel.permissionOverwrites.set([
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]).catch(() => null);

      // game_announcement: de solo lectura para todos, nada más (ni escribir
      // ni hilos ni reacciones).
      const announceChannel = await ensureChannel(CHANNEL_KEYS.GAME_ANNOUNCEMENT, CHANNEL_KEYS.GAME_ANNOUNCEMENT, adminCategory.id);
      await announceChannel.permissionOverwrites.set([
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AddReactions]
        },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]).catch(() => null);

      // bans: se puede ver, pero solo Elo Admin/admins pueden escribir ahí.
      const bansChannel = await ensureChannel(CHANNEL_KEYS.BANS, CHANNEL_KEYS.BANS, adminCategory.id);
      await bansChannel.permissionOverwrites.set([
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]).catch(() => null);

      // anuncios: donde el bot avisa cuando alguien desbloquea un rol/logro
      // (/crear_rol). De solo lectura para todos, igual que game_announcement
      // — nadie escribe ahí, ni abre hilos, solo el bot publica.
      const anunciosChannel = await ensureChannel(CHANNEL_KEYS.ANUNCIOS, CHANNEL_KEYS.ANUNCIOS, adminCategory.id);
      await anunciosChannel.permissionOverwrites.set([
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AddReactions]
        },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]).catch(() => null);
      // El canal de anuncios queda ARRIBA DE TODO de la categoría Elo Admin
      // (por encima de init), para que sea lo primero que se ve.
      await anunciosChannel.setPosition(0).catch(() => null);

      // Ya NO se crea automáticamente la cola por defecto (4v4-solo). El admin
      // decide qué modos crear desde el canal init. Si ya tenías una cola por
      // defecto de una instalación vieja, usá /removequeue para sacarla.

      saveGuild(guild.id, guildData);

      await interaction.editReply({
        embeds: [successEmbed(
          `Instalación completa.\n` +
          `Rol: <@&${role.id}> (te lo asigné a vos también)\n` +
          `Canales: <#${guildData.channels.init}>, <#${guildData.channels.info_chat}>, ` +
          `<#${guildData.channels.submit}>, <#${guildData.channels.game_announcement}>, ` +
          `<#${guildData.channels.bans}>, <#${guildData.channels.anuncios}>\n\n` +
          `Ahora creá tus modos/colas desde <#${guildData.channels.init}>. ` +
          `Si algún canal ya existía con ese nombre, lo reutilicé en vez de crear uno duplicado.`
        )]
      });
    } catch (err) {
      console.error('[install] La instalación falló:', err);
      await interaction.editReply({
        embeds: [errorEmbed(
          `No pude terminar la instalación: ${err.message}\n\n` +
          'Revisa que mi rol tenga los permisos **Gestionar roles** y **Gestionar canales**, y que esté ARRIBA del rol Elo Admin en la lista de roles del servidor. ' +
          'Después usa `/install` otra vez: lo que ya se creó se reutiliza.'
        )]
      }).catch(() => {});
    }
  }
};
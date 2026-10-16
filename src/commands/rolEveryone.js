const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const { resolveQueueOptions, resolveModeKeyFromInput, autocompleteModo, storeForModeKey } = require('../utils/queueScope');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rol_everyone')
    .setDescription('Elo Admin: hace que el bot mencione @everyone en anuncios cuando alguien consiga un rol.')
    .addStringOption(o => o.setName('rol').setDescription('Rol de logro (normal o negativo)').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('activar').setDescription('true = menciona @everyone al conseguirlo, false = deja de hacerlo').setRequired(true))
    .addStringOption(o => o.setName('modo').setDescription('En qué cola/modo (si hay más de una)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focusedOpt = interaction.options.getFocused(true);

    if (focusedOpt.name === 'modo') return autocompleteModo(interaction, guildData);

    const focused = String(focusedOpt.value || '').toLowerCase();
    const modoInput = interaction.options.getString('modo');
    let entries = [];

    const label = a => `${a.negative ? '💀 ' : ''}${a.pingEveryone ? '📢 ' : ''}${a.name}`;
    if (modoInput) {
      const resolved = resolveModeKeyFromInput(guildData, modoInput);
      if (resolved.ok) {
        const store = storeForModeKey(guildData, resolved.modeKey);
        entries = Object.values(store.roleAchievements || {}).map(a => ({ name: label(a), value: a.key }));
      }
    } else {
      for (const opt of resolveQueueOptions(guildData)) {
        const store = storeForModeKey(guildData, opt.key === 'default' ? null : opt.key);
        for (const a of Object.values(store.roleAchievements || {})) {
          entries.push({ name: `${label(a)} (${opt.label})`.slice(0, 100), value: a.key });
        }
      }
    }

    return interaction.respond(
      entries.filter(e => e.name.toLowerCase().includes(focused) || e.value.includes(focused)).slice(0, 25)
    );
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'rol_everyone'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const resolved = resolveModeKeyFromInput(guildData, interaction.options.getString('modo'));
    if (!resolved.ok) {
      return interaction.reply({ embeds: [errorEmbed(resolved.message)], ephemeral: true });
    }

    const store = storeForModeKey(guildData, resolved.modeKey);
    const ach = store.roleAchievements?.[interaction.options.getString('rol')];
    if (!ach) {
      return interaction.reply({ embeds: [errorEmbed(`No encontré ese rol en **${resolved.label}**. Mira la lista con \`/ver_roles\`.`)], ephemeral: true });
    }

    const activar = interaction.options.getBoolean('activar');
    ach.pingEveryone = activar;
    saveGuild(interaction.guildId, guildData);

    // Aviso si el bot no puede mencionar @everyone en el canal de anuncios.
    let warning = '';
    if (activar) {
      const channel = guildData.channels.anuncios
        ? await interaction.client.channels.fetch(guildData.channels.anuncios).catch(() => null)
        : null;
      const me = interaction.guild.members.me;
      if (!channel) {
        warning = '\n\n⚠️ No encuentro el canal de anuncios, así que por ahora no se podrá anunciar.';
      } else if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) {
        warning = `\n\n⚠️ Me falta el permiso **Mencionar @everyone, @here y todos los roles** en <#${channel.id}>: sin eso, el anuncio sale pero sin mencionar a todos.`;
      }
    }

    const roleTag = ach.roleId ? `<@&${ach.roleId}>` : `**${ach.name}**`;
    await interaction.reply({
      embeds: [successEmbed(
        activar
          ? `Listo: cuando alguien consiga ${roleTag} en **${resolved.label}**, el bot mencionará **@everyone** en <#${guildData.channels.anuncios || '???'}>.${warning}`
          : `Listo: ${roleTag} ya no menciona @everyone al conseguirlo.`
      )],
      ephemeral: true
    });
  }
};

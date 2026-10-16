const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild } = require('../database');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');

const UNIT_MS = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000, semanas: 604_800_000 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Elo Admin: banea a un jugador.')
    .addUserOption(o => o.setName('mencion').setDescription('Jugador a banear').setRequired(true))
    .addIntegerOption(o => o.setName('tiempo').setDescription('Duración (0 = permanente)').setRequired(true))
    .addStringOption(o => o.setName('unidad').setDescription('Unidad de tiempo').setRequired(true)
      .addChoices(
        { name: 'minutos', value: 'minutos' },
        { name: 'horas', value: 'horas' },
        { name: 'dias', value: 'dias' },
        { name: 'semanas', value: 'semanas' }
      ))
    .addStringOption(o => o.setName('razon').setDescription('Razón del ban').setRequired(true))
    .addStringOption(o => o.setName('modo').setDescription('Si lo dejas vacío, banea de TODOS los modos/colas').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = [];
    if (guildData.channels.queue && 'default'.includes(focused)) {
      choices.push({ name: 'Cola por defecto (4v4-solo)', value: 'default' });
    }
    for (const mode of Object.values(guildData.modes || {})) {
      if (mode.key.includes(focused) || mode.name.toLowerCase().includes(focused)) {
        choices.push({ name: `${mode.name} (${mode.key})`.slice(0, 100), value: mode.key });
      }
    }
    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'ban'))) return;
    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede banear.')], ephemeral: true });
    }

    const target = interaction.options.getUser('mencion');
    const tiempo = interaction.options.getInteger('tiempo');
    const unidad = interaction.options.getString('unidad');
    const razon = interaction.options.getString('razon');
    const modo = interaction.options.getString('modo'); // null = todos los modos/colas

    if (modo && modo !== 'default' && !guildData.modes[modo]) {
      return interaction.reply({ embeds: [errorEmbed('Ese modo no existe. Dejalo vacío para banear de todos, o elegí uno de la lista.')], ephemeral: true });
    }

    const until = tiempo > 0 ? Date.now() + tiempo * UNIT_MS[unidad] : null;
    guildData.bans[target.id] = { bannedBy: interaction.user.id, until, reason: razon, mode: modo || 'all' };

    // Sacarlo de la(s) cola(s) correspondiente(s) si estaba esperando ahí.
    if (!modo || modo === 'all') {
      guildData.queue = guildData.queue.filter(q => q.userId !== target.id);
      for (const mode of Object.values(guildData.modes || {})) {
        if (mode.queue) mode.queue = mode.queue.filter(q => q.userId !== target.id);
      }
    } else if (modo === 'default') {
      guildData.queue = guildData.queue.filter(q => q.userId !== target.id);
    } else {
      const mode = guildData.modes[modo];
      if (mode?.queue) mode.queue = mode.queue.filter(q => q.userId !== target.id);
    }

    saveGuild(interaction.guildId, guildData);

    const untilText = until ? `<t:${Math.floor(until / 1000)}:F>` : 'permanentemente';
    const scopeText = !modo || modo === 'all'
      ? 'en TODOS los modos/colas'
      : modo === 'default' ? 'en la cola por defecto' : `en el modo \`${guildData.modes[modo].name}\``;
    await interaction.reply({
      embeds: [successEmbed(`<@${target.id}> ha sido baneado por <@${interaction.user.id}> hasta ${untilText} (${scopeText}).\nRazón: ${razon}`)]
    });
  }
};
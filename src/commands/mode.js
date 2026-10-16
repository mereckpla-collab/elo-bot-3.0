const { SlashCommandBuilder } = require('discord.js');
const { getGuild } = require('../database');
const { errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');
const { isEloAdmin } = require('../handlers/resultManager');
const modeWizard = require('../handlers/modeWizard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mode')
    .setDescription('Elo Admin: crea o consulta los modos (colas) de este servidor.')
    .addSubcommandGroup(g => g
      .setName('setup')
      .setDescription('Crear un modo nuevo')
      .addSubcommand(sc => sc
        .setName('add')
        .setDescription('Arranca el asistente para crear un modo nuevo')
        .addStringOption(o => o
          .setName('type')
          .setDescription('Tipo de cola')
          .setRequired(true)
          .addChoices(
            { name: 'Solo', value: 'solo' },
            { name: 'Team', value: 'team' },
            { name: 'FFA', value: 'ffa' }
          ))))
    .addSubcommandGroup(g => g
      .setName('settings')
      .setDescription('Editar la configuración de un modo ya creado')
      .addSubcommand(sc => sc
        .setName('pickstyle')
        .setDescription('Elige cómo pickean los capitanes en este modo')
        .addStringOption(o => o
          .setName('mode')
          .setDescription('El modo a editar')
          .setRequired(true)
          .setAutocomplete(true))
        .addStringOption(o => o
          .setName('style')
          .setDescription('Sistema de pick')
          .setRequired(true)
          .addChoices(
            { name: 'Clásico (snake, con dobles picks) — el de siempre', value: 'classic' },
            { name: 'Pick único (1 jugador por turno, sin dobles)', value: 'single' }
          ))))
    .addSubcommand(sc => sc.setName('list').setDescription('Muestra todos los modos creados en este servidor')),

  async autocomplete(interaction) {
    const guildData = getGuild(interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.values(guildData.modes || {})
      .filter(m => m.key.includes(focused) || m.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(m => ({ name: `${m.name} (${m.key})`.slice(0, 100), value: m.key }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'mode'))) return;

    if (!isEloAdmin(interaction, guildData)) {
      return interaction.reply({ embeds: [errorEmbed('Solo un Elo Admin puede usar este comando.')], ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'setup' && sub === 'add') {
      const type = interaction.options.getString('type');
      return modeWizard.start(interaction, type);
    }

    if (group === 'settings' && sub === 'pickstyle') {
      const key = interaction.options.getString('mode');
      const style = interaction.options.getString('style');
      const mode = guildData.modes[key];
      if (!mode) {
        return interaction.reply({ embeds: [errorEmbed('Ese modo ya no existe. Usá `/mode list` para ver los actuales.')], ephemeral: true });
      }
      mode.pickSystem = style;
      require('../database').saveGuild(interaction.guildId, guildData);
      const styleLabel = style === 'single' ? 'Pick único (1 jugador por turno)' : 'Clásico (snake, con dobles picks)';
      return interaction.reply({
        embeds: [require('../utils/embeds').successEmbed(`El modo \`${mode.name}\` ahora usa el sistema: **${styleLabel}**.`)],
        ephemeral: true
      });
    }

    if (sub === 'list') {
      return modeWizard.viewModes(interaction, guildData);
    }
  }
};
const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild, getOrCreatePlayer } = require('../database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Cambia el nombre con el que apareces en el bot.')
    .addStringOption(o => o.setName('nombre').setDescription('Tu nuevo nombre').setRequired(true).setMaxLength(32)),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'rename'))) return;

    const nuevoNombre = interaction.options.getString('nombre').trim();
    if (!nuevoNombre) {
      return interaction.reply({ embeds: [errorEmbed('El nombre no puede estar vacío.')], ephemeral: true });
    }

    const userId = interaction.user.id;

    // El elo/nombre de cada modo vive en su propio store, totalmente
    // separado del de la cola de siempre — por eso antes /rename solo
    // "pegaba" en una cola y en el resto seguías viendo el nombre viejo.
    // Ahora se actualiza en TODAS las colas donde ya tengas un registro.
    const stores = [guildData, ...Object.values(guildData.modes || {})];
    for (const store of stores) {
      if (!store.players) continue;
      if (store.players[userId]) {
        store.players[userId].name = nuevoNombre;
      }
    }
    // Por las dudas de que no exista todavía en la cola de siempre (ej. un
    // admin que nunca jugó pero quiere fijar su nombre de una), se crea ahí.
    getOrCreatePlayer(guildData, userId, nuevoNombre);
    guildData.players[userId].name = nuevoNombre;

    // Se guarda como el nombre "de referencia" del jugador en todo el
    // servidor: si más adelante se une a una cola/modo nuevo en el que
    // todavía no tiene registro, arranca ahí con este nombre en vez de su
    // apodo de Discord — así se ve igual en todos lados.
    guildData.preferredNames = guildData.preferredNames || {};
    guildData.preferredNames[userId] = nuevoNombre;

    saveGuild(interaction.guildId, guildData);

    await interaction.reply({ embeds: [successEmbed(`Tu nombre en el bot ahora es **${nuevoNombre}** — se actualizó en todas las colas/modos donde ya jugaste.`)] });
  }
};
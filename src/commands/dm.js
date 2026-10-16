const { SlashCommandBuilder } = require('discord.js');
const { getGuild, saveGuild, getOrCreatePlayer } = require('../database');
const { successEmbed } = require('../utils/embeds');
const { assertChannel } = require('../utils/channelGuard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Activa o desactiva los mensajes privados que te manda el bot cuando te toca pickear.')
    .addSubcommand(sc => sc.setName('off').setDescription('Deja de recibir DM del bot cuando te toca pickear.'))
    .addSubcommand(sc => sc.setName('on').setDescription('Vuelve a recibir DM del bot cuando te toca pickear.')),

  async execute(interaction) {
    const guildData = getGuild(interaction.guildId);
    if (!(await assertChannel(interaction, guildData, 'dm'))) return;

    const sub = interaction.options.getSubcommand();
    const fallbackName = interaction.member?.nickname || interaction.user.globalName || interaction.user.username;
    const player = getOrCreatePlayer(guildData, interaction.user.id, fallbackName);

    if (sub === 'off') {
      player.dmTagDisabled = true;
      saveGuild(interaction.guildId, guildData);
      return interaction.reply({
        embeds: [successEmbed('🔕 Ya no vas a recibir DM del bot cuando te toque pickear. Igual te van a taggear en el hilo del draft.')],
        ephemeral: true
      });
    }

    // sub === 'on'
    player.dmTagDisabled = false;
    saveGuild(interaction.guildId, guildData);
    return interaction.reply({
      embeds: [successEmbed('🔔 Vas a volver a recibir DM del bot cuando te toque pickear.')],
      ephemeral: true
    });
  }
};
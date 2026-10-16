const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLOR_PRIMARY, COLOR_WARN } = require('../config');
const { getRooms, getLastFetch } = require('../utils/mrhost');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sala')
    .setDescription('Busca una sala de HaxBall (MrHOST) que esté vacía y manda el link para que se unan.'),

  async execute(interaction) {
    const rooms = getRooms();

    if (!rooms.length) {
      return interaction.reply({
        content: '⚠️ Todavía no tengo datos de las salas (puede que falte configurar `MRHOST_API_KEY` en el `.env`, o que recién esté arrancando). Probá de nuevo en un ratito.',
        ephemeral: true
      });
    }

    // Solo cuentan las que están realmente vacías y se pueden entrar sin
    // contraseña — no tiene sentido mandar el link de una que está trabada.
    const candidates = rooms.filter(r => !r.passworded && r.players === 0 && !r.inProgress);
    if (!candidates.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLOR_WARN).setDescription('❌ No hay ninguna sala vacía ahora mismo — todas tienen gente, están en juego, o con contraseña.')],
        ephemeral: true
      });
    }

    candidates.sort((a, b) => a.number - b.number);
    const room = candidates[0];

    const secondsAgo = Math.max(0, Math.round((Date.now() - getLastFetch()) / 1000));

    const embed = new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(`🎮 ${room.name}`)
      .setDescription(`**¡Esta sala está sola!** Únete antes de que se llene.\n${room.url}`)
      .addFields(
        { name: 'Jugadores', value: `${room.players} / ${room.maxPlayers}`, inline: true },
        { name: 'Mapa', value: room.map || '—', inline: true }
      )
      .setFooter({ text: `Datos actualizados hace ${secondsAgo}s` });

    return interaction.reply({ embeds: [embed] });
  }
};

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`✅ Elo de Doskuith conectado como ${client.user.tag}`);
    client.user.setActivity('4v4 Haxball | /help');
    // Retoma el rol rainbow de los servidores que ya lo tienen.
    require('../utils/rainbowRole').startAll(client);
  }
};
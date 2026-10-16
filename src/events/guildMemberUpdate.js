const { getGuild } = require('../database');
const { isAllowed } = require('../utils/rainbowRole');

// Vigilante del rol rainbow: solo lo puede tener el dueño del bot y quien él
// autorice con /rainbow dar. Si a otra persona se lo ponen a mano, se lo saca.
module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    const guildData = getGuild(newMember.guild.id);
    const roleId = guildData.rainbow?.roleId;
    if (!roleId || !newMember.roles.cache.has(roleId)) return;
    if (isAllowed(guildData, newMember.id)) return;
    await newMember.roles.remove(roleId, 'El rol rainbow es solo para el dueño o quien él autorice (/rainbow dar)').catch(() => {});
  }
};
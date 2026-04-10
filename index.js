const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// 🔒 أنت (ما ينلمسك)
const WHITELIST = ['1125609597613375629'];

function isSafe(id) {
  return WHITELIST.includes(id);
}

async function punish(guild, user) {
  try {
    const member = await guild.members.fetch(user.id);

    if (!member || member.user.bot) return;
    if (isSafe(user.id)) return;

    // ما يقدر يلمس اللي أعلى منه
    if (member.roles.highest.position >= guild.members.me.roles.highest.position) return;

    await member.kick('Anti-Nuke Protection');
    console.log(`Kicked: ${member.user.tag}`);
  } catch (e) {
    console.log(e);
  }
}

// 🔥 حماية الرومات
client.on('channelUpdate', async (oldCh, newCh) => {
  try {
    const logs = await newCh.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelUpdate,
      limit: 5
    });

    const entry = logs.entries.find(e =>
      Date.now() - e.createdTimestamp < 5000
    );

    if (!entry || !entry.executor) return;

    await punish(newCh.guild, entry.executor);

  } catch (e) {
    console.log(e);
  }
});

// 🔥 حماية حذف الروم
client.on('channelDelete', async (channel) => {
  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 5
    });

    const entry = logs.entries.find(e =>
      Date.now() - e.createdTimestamp < 5000
    );

    if (!entry || !entry.executor) return;

    await punish(channel.guild, entry.executor);

  } catch (e) {
    console.log(e);
  }
});

// 🔥 حماية الرتب
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    const logs = await newRole.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleUpdate,
      limit: 5
    });

    const entry = logs.entries.find(e =>
      Date.now() - e.createdTimestamp < 5000
    );

    if (!entry || !entry.executor) return;

    await punish(newRole.guild, entry.executor);

  } catch (e) {
    console.log(e);
  }
});

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.TOKEN);

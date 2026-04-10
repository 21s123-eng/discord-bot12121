const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;

// 👑 الحسابات المسموح لها (أنت)
const WHITELIST = ['1125609597613375629'];

// 📌 روم اللوق
const LOG_CHANNEL_ID = '1492108809618063432';

// ================= BACKUPS =================
const roleBackup = new Map();
const channelBackup = new Map();
const channelPositionBackup = new Map();

// ================= SAFE CHECK =================
function isSafe(id) {
  return WHITELIST.includes(id);
}

// ================= LOG =================
async function log(guild, msg) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send(`📌 **ANTI-NUKE LOG**\n\n${msg}`).catch(() => {});
}

// ================= PUNISH =================
async function punish(guild, user, reason = "Nuke Protection Triggered") {
  if (!user || isSafe(user.id)) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  member.roles.cache.forEach(role => {
    if (role.permissions.has(PermissionsBitField.Flags.Administrator)) {
      member.roles.remove(role).catch(() => {});
    }
  });

  await log(guild,
`🚨 PUNISHMENT
👤 User: ${user.tag}
🆔 ID: ${user.id}
📌 Reason: ${reason}`);
}

// ================= ROLE CREATE =================
client.on('roleCreate', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleCreate,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await role.delete().catch(() => {});
  await punish(role.guild, user, "Created Role");

  await log(role.guild,
`🚨 ROLE CREATED BLOCKED
👤 User: ${user.tag}
🎭 Role: ${role.name}`);
});

// ================= ROLE DELETE =================
client.on('roleDelete', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleDelete,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await role.guild.roles.create({
    name: role.name,
    color: role.color,
    permissions: role.permissions
  });

  await punish(role.guild, user, "Deleted Role");

  await log(role.guild,
`🚨 ROLE RESTORED
👤 User: ${user.tag}
🎭 Role: ${role.name}`);
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', (oldRole, newRole) => {
  roleBackup.set(newRole.id, {
    name: oldRole.name,
    color: oldRole.color,
    permissions: oldRole.permissions.bitfield.toString(),
    position: oldRole.position
  });
});

client.on('roleUpdate', async (oldRole, newRole) => {
  const logs = await newRole.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleUpdate,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  const backup = roleBackup.get(newRole.id);
  if (!backup) return;

  await newRole.setName(backup.name).catch(() => {});
  await newRole.setColor(backup.color).catch(() => {});
  await newRole.setPosition(backup.position).catch(() => {});

  await punish(newRole.guild, user, "Edited Role");
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async (channel) => {
  const logs = await channel.guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelDelete,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await channel.guild.channels.create({
    name: channel.name,
    type: channel.type
  });

  await punish(channel.guild, user, "Deleted Channel");

  await log(channel.guild,
`🚨 CHANNEL RESTORED
👤 User: ${user.tag}
📁 Channel: ${channel.name}`);
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', (oldCh, newCh) => {
  channelBackup.set(newCh.id, {
    name: oldCh.name,
    perms: oldCh.permissionOverwrites.cache.map(p => ({
      id: p.id,
      allow: p.allow.bitfield.toString(),
      deny: p.deny.bitfield.toString(),
      type: p.type
    }))
  });
});

client.on('channelUpdate', async (oldCh, newCh) => {
  const logs = await newCh.guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelUpdate,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  const backup = channelBackup.get(newCh.id);
  if (!backup) return;

  await newCh.setName(oldCh.name).catch(() => {});
  await newCh.permissionOverwrites.set(
    backup.perms.map(p => ({
      id: p.id,
      allow: p.allow,
      deny: p.deny,
      type: p.type
    }))
  ).catch(() => {});

  await punish(newCh.guild, user, "Edited Channel");
});

// ================= CHANNEL POSITION =================
client.on('channelUpdate', (oldCh, newCh) => {
  channelPositionBackup.set(newCh.guild.id,
    newCh.guild.channels.cache.map(c => ({
      id: c.id,
      position: c.rawPosition
    }))
  );
});

client.on('channelUpdate', async (oldCh, newCh) => {
  const logs = await newCh.guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelUpdate,
    limit: 5
  });

  const entry = logs.entries.find(e => Date.now() - e.createdTimestamp < 5000);
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  const backup = channelPositionBackup.get(newCh.guild.id);
  if (!backup) return;

  for (const ch of backup) {
    const channel = newCh.guild.channels.cache.get(ch.id);
    if (channel) {
      await channel.setPosition(ch.position).catch(() => {});
    }
  }

  await punish(newCh.guild, user, "Moved Channels");

  await log(newCh.guild,
`📌 CHANNEL ORDER RESTORED
👤 User: ${user.tag}`);
});

// ================= READY =================
client.once('ready', () => {
  console.log(`🔥 ANTI-NUKE ONLINE: ${client.user.tag}`);
});

// ================= LOGIN =================
client.login(TOKEN);

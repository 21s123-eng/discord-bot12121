const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;

const WHITELIST = ['1125609597613375629'];
const LOG_CHANNEL_ID = '1492108809618063432';

// ================= SAFE =================
function isSafe(id) {
  return WHITELIST.includes(id);
}

// ================= LOG (ANTI SPAM) =================
let logCooldown = new Set();

async function log(guild, user, reason) {
  const key = `${guild.id}-${user.id}-${reason}`;
  if (logCooldown.has(key)) return;

  logCooldown.add(key);
  setTimeout(() => logCooldown.delete(key), 5000);

  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send(
`@here
person : ${user}
the reason : ${reason}
ID : ${user.id}`
  ).catch(() => {});
}

// ================= STRIP ALL ROLES (NEW IMPORTANT PART) =================
async function stripAllRoles(member) {
  if (!member || isSafe(member.id)) return;

  const roles = member.roles.cache.filter(r => r.name !== "@everyone");

  for (const role of roles.values()) {
    await member.roles.remove(role).catch(() => {});
  }
}

// ================= PUNISH =================
async function punish(member, reason) {
  if (!member || isSafe(member.id)) return;

  await stripAllRoles(member);

  await log(member.guild, member.user, reason);
}

// ================= ROLE CREATE =================
client.on('roleCreate', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleCreate,
    limit: 1
  });

  const entry = logs.entries.first();
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await role.delete().catch(() => {});

  const member = await role.guild.members.fetch(user.id).catch(() => null);
  await punish(member, "Created Role");
});

// ================= ROLE DELETE =================
client.on('roleDelete', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleDelete,
    limit: 1
  });

  const entry = logs.entries.first();
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await role.guild.roles.create({
    name: role.name,
    color: role.color,
    permissions: role.permissions
  }).catch(() => {});

  const member = await role.guild.members.fetch(user.id).catch(() => null);
  await punish(member, "Deleted Role");
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldRole, newRole) => {
  const logs = await newRole.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleUpdate,
    limit: 1
  });

  const entry = logs.entries.first();
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await newRole.setName(oldRole.name).catch(() => {});
  await newRole.setColor(oldRole.color).catch(() => {});

  const member = await newRole.guild.members.fetch(user.id).catch(() => null);
  await punish(member, "Modified Role");
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async (channel) => {
  const logs = await channel.guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelDelete,
    limit: 1
  });

  const entry = logs.entries.first();
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await channel.guild.channels.create({
    name: channel.name,
    type: channel.type
  }).catch(() => {});

  const member = await channel.guild.members.fetch(user.id).catch(() => null);
  await punish(member, "Deleted Channel");
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', async (oldCh, newCh) => {
  const logs = await newCh.guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelUpdate,
    limit: 1
  });

  const entry = logs.entries.first();
  if (!entry) return;

  const user = entry.executor;
  if (!user || isSafe(user.id)) return;

  await newCh.setName(oldCh.name).catch(() => {});

  const member = await newCh.guild.members.fetch(user.id).catch(() => null);
  await punish(member, "Modified Channel");
});

// ================= READY =================
client.once('ready', () => {
  console.log(`🔥 ULTIMATE ANTI-NUKE ONLINE: ${client.user.tag}`);
});

// ================= LOGIN =================
client.login(TOKEN);

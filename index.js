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

// ================= ANTI SPAM CONTROL =================
const actionCooldown = new Map();

// ================= LOG (ONE TIME ONLY FIXED) =================
async function log(guild, user, reason) {
  const key = `${guild.id}-${user.id}-${reason}`;
  const now = Date.now();

  if (actionCooldown.has(key) && now - actionCooldown.get(key) < 7000) return;
  actionCooldown.set(key, now);

  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  // ❌ لا نعمل منشن لنفس البوت نهائياً
  ch.send(
`@here
person : <@${user.id}>
the reason : ${reason}
ID : ${user.id}`
  ).catch(() => {});
}

// ================= STRIP ROLES (FIXED 100%) =================
async function stripRoles(member) {
  if (!member || isSafe(member.id)) return;

  const roles = member.roles.cache.filter(r => r.id !== member.guild.id);

  for (const role of roles.values()) {
    await member.roles.remove(role).catch(() => {});
  }
}

// ================= PUNISH =================
async function punish(guild, user, reason) {
  if (!user || isSafe(user.id)) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  await stripRoles(member);
  await log(guild, user, reason);
}

// ================= GET EXECUTOR (FIXED AUDIT LOG) =================
async function getExecutor(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;

  if (isSafe(user.id)) return null;

  return user;
}

// ================= ROLE CREATE =================
client.on('roleCreate', async (role) => {
  const user = await getExecutor(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(() => {});
  await punish(role.guild, user, "Created Role");
});

// ================= ROLE DELETE =================
client.on('roleDelete', async (role) => {
  const user = await getExecutor(role.guild, AuditLogEvent.RoleDelete);
  if (!user) return;

  await role.guild.roles.create({
    name: role.name,
    color: role.color,
    permissions: role.permissions
  }).catch(() => {});

  await punish(role.guild, user, "Deleted Role");
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldRole, newRole) => {
  const user = await getExecutor(newRole.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  await newRole.setName(oldRole.name).catch(() => {});
  await newRole.setColor(oldRole.color).catch(() => {});

  await punish(newRole.guild, user, "Modified Role");
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async (channel) => {
  const user = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await channel.guild.channels.create({
    name: channel.name,
    type: channel.type
  }).catch(() => {});

  await punish(channel.guild, user, "Deleted Channel");
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', async (oldCh, newCh) => {
  const user = await getExecutor(newCh.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  await newCh.setName(oldCh.name).catch(() => {});
  await punish(newCh.guild, user, "Modified Channel");
});

// ================= READY =================
client.once('ready', () => {
  console.log(`🔥 FIXED ANTI-NUKE ONLINE: ${client.user.tag}`);
});

// ================= LOGIN =================
client.login(TOKEN);

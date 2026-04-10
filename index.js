const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const lock = new Map();

// ========= UTIL =========
function isOwner(id) {
  return id === OWNER_ID;
}

async function sendLog(guild, member, reason) {
  const key = `${guild.id}-${member.id}-${reason}`;
  if (lock.has(key)) return;

  lock.set(key, true);
  setTimeout(() => lock.delete(key), 5000);

  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  await ch.send(
`person : <@${member.id}>

the reason : ${reason}

ID : ${member.id}

@here`
  ).catch(() => {});
}

async function getExecutor(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;
  if (isOwner(user.id)) return null;

  return user;
}

async function stripRoles(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || isOwner(member.id)) return;

  const roles = member.roles.cache.filter(r => r.id !== guild.id);
  for (const role of roles.values()) {
    await member.roles.remove(role).catch(() => {});
  }
}

// ========= ROLE CREATE =========
client.on('roleCreate', async (role) => {
  const user = await getExecutor(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(() => {});
  await stripRoles(role.guild, user.id);
  await sendLog(role.guild, user, 'Created Role');
});

// ========= ROLE DELETE =========
client.on('roleDelete', async (role) => {
  const user = await getExecutor(role.guild, AuditLogEvent.RoleDelete);
  if (!user) return;

  await role.guild.roles.create({
    name: role.name,
    color: role.color,
    permissions: role.permissions
  }).catch(() => {});

  await stripRoles(role.guild, user.id);
  await sendLog(role.guild, user, 'Deleted Role');
});

// ========= ROLE UPDATE =========
client.on('roleUpdate', async (oldRole, newRole) => {
  const user = await getExecutor(newRole.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  await newRole.setName(oldRole.name).catch(() => {});
  await newRole.setColor(oldRole.color).catch(() => {});
  await newRole.setPermissions(oldRole.permissions).catch(() => {});

  await stripRoles(newRole.guild, user.id);
  await sendLog(newRole.guild, user, 'Modified Role');
});

// ========= CHANNEL UPDATE =========
client.on('channelUpdate', async (oldCh, newCh) => {
  const user = await getExecutor(newCh.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  try {
    await newCh.setName(oldCh.name).catch(() => {});
    await newCh.setPosition(oldCh.position).catch(() => {});

    await newCh.permissionOverwrites.set(oldCh.permissionOverwrites.cache).catch(() => {});
  } catch {}

  await stripRoles(newCh.guild, user.id);
  await sendLog(newCh.guild, user, 'Modified Channel');
});

// ========= CHANNEL DELETE =========
client.on('channelDelete', async (channel) => {
  const user = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await channel.guild.channels.create({
    name: channel.name,
    type: channel.type
  }).catch(() => {});

  await stripRoles(channel.guild, user.id);
  await sendLog(channel.guild, user, 'Deleted Channel');
});

// ========= CHANNEL CREATE (optional safety) =========
client.on('channelCreate', async (channel) => {
  const user = await getExecutor(channel.guild, AuditLogEvent.ChannelCreate);
  if (!user) return;

  await channel.delete().catch(() => {});
  await stripRoles(channel.guild, user.id);
  await sendLog(channel.guild, user, 'Created Channel');
});

// ========= READY =========
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);
});

client.login(TOKEN);

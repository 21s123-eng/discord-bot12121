const { Client, GatewayIntentBits, AuditLogEvent, ChannelType, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

// ================= BACKUP STORAGE =================
const backup = {
  roles: new Map(),
  channels: new Map()
};

const cooldown = new Map();

function logSend(guild, text) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send(text + "\n@here").catch(()=>{});
}

// ================= SAVE ROLE =================
function saveRoles(guild) {
  const roles = guild.roles.cache.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    permissions: r.permissions.bitfield,
    position: r.position
  }));
  backup.roles.set(guild.id, roles);
}

// ================= SAVE CHANNEL =================
function saveChannels(guild) {
  const channels = guild.channels.cache.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId,
    position: c.position,
    permissionOverwrites: c.permissionOverwrites.cache.map(p => ({
      id: p.id,
      allow: p.allow.bitfield,
      deny: p.deny.bitfield
    }))
  }));
  backup.channels.set(guild.id, channels);
}

// ================= PUNISH =================
async function punish(member) {
  if (!member || member.id === OWNER_ID) return;

  const roles = member.roles.cache.filter(r => r.id !== member.guild.id);
  for (const r of roles.values()) {
    await member.roles.remove(r).catch(()=>{});
  }
}

// ================= RESTORE ROLES =================
async function restoreRoles(guild) {
  const roles = backup.roles.get(guild.id);
  if (!roles) return;

  for (const r of roles) {
    if (!guild.roles.cache.get(r.id)) {
      await guild.roles.create({
        name: r.name,
        color: r.color,
        permissions: new PermissionsBitField(r.permissions)
      }).catch(()=>{});
    }
  }
}

// ================= RESTORE CHANNELS =================
async function restoreChannels(guild) {
  const channels = backup.channels.get(guild.id);
  if (!channels) return;

  for (const c of channels) {
    if (!guild.channels.cache.get(c.id)) {
      await guild.channels.create({
        name: c.name,
        type: c.type,
        parent: c.parentId
      }).catch(()=>{});
    }
  }
}

// ================= GET EXECUTOR =================
async function getUser(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(()=>null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;

  if (user.id === client.user.id) return null;
  if (user.id === OWNER_ID) return null;

  if (Date.now() - entry.createdTimestamp > 4000) return null;

  return user;
}

// ================= READY =================
client.once('ready', async () => {
  console.log(`ONLINE: ${client.user.tag}`);

  client.guilds.cache.forEach(guild => {
    saveRoles(guild);
    saveChannels(guild);
  });
});

// ================= ROLE CREATE =================
client.on('roleCreate', async role => {
  const user = await getUser(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(()=>{});

  const member = await role.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  restoreRoles(role.guild);

  logSend(role.guild, `person : <@${user.id}>\n\nthe reason : created role\n\nID : ${user.id}`);
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldRole, newRole) => {
  const user = await getUser(newRole.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  await newRole.setName(oldRole.name).catch(()=>{});
  await newRole.setColor(oldRole.color).catch(()=>{});
  await newRole.setPermissions(oldRole.permissions).catch(()=>{});

  const member = await newRole.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  restoreRoles(newRole.guild);

  logSend(newRole.guild, `person : <@${user.id}>\n\nthe reason : role update\n\nID : ${user.id}`);
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', async (oldCh, newCh) => {
  const user = await getUser(newCh.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  await newCh.setName(oldCh.name).catch(()=>{});
  await newCh.setParent(oldCh.parentId).catch(()=>{});

  const member = await newCh.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  restoreChannels(newCh.guild);

  logSend(newCh.guild, `person : <@${user.id}>\n\nthe reason : channel update\n\nID : ${user.id}`);
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async channel => {
  const user = await getUser(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await restoreChannels(channel.guild);

  const member = await channel.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  logSend(channel.guild, `person : <@${user.id}>\n\nthe reason : channel delete\n\nID : ${user.id}`);
});

client.login(TOKEN);

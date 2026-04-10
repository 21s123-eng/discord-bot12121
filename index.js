const { Client, GatewayIntentBits, AuditLogEvent, ChannelType } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const cooldown = new Map();
const ignore = new Set();

function isOwner(id) {
  return id === OWNER_ID;
}

// ================= LOG =================
async function log(guild, user, reason) {
  const key = guild.id + user.id;
  if (cooldown.has(key)) return;

  cooldown.set(key, true);
  setTimeout(() => cooldown.delete(key), 4000);

  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send(
`person : <@${user.id}>

the reason : ${reason}

ID : ${user.id}

@here`
  ).catch(()=>{});
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
  if (isOwner(user.id)) return null;

  if (Date.now() - entry.createdTimestamp > 3000) return null;

  return user;
}

// ================= STRIP ROLES =================
async function punish(guild, userId) {
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (!member) return;

  const roles = member.roles.cache.filter(r => r.id !== guild.id);
  for (const r of roles.values()) {
    await member.roles.remove(r).catch(()=>{});
  }
}

// ================= ROLE CREATE =================
client.on('roleCreate', async role => {
  const user = await getUser(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  ignore.add(role.guild.id);

  await role.delete().catch(()=>{});
  await punish(role.guild, user.id);
  await log(role.guild, user, 'اضاف رتبه جديده');

  setTimeout(()=>ignore.delete(role.guild.id),3000);
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldRole, newRole) => {
  if (ignore.has(newRole.guild.id)) return;

  const user = await getUser(newRole.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  ignore.add(newRole.guild.id);

  let reason = 'عدل على خواص رتبه';

  if (oldRole.name !== newRole.name) reason = 'غير اسم رتبه';
  else if (oldRole.color !== newRole.color) reason = 'غير لون رتبه';
  else if (oldRole.position !== newRole.position) reason = 'عدل على خواص رتبه';

  await newRole.setName(oldRole.name).catch(()=>{});
  await newRole.setColor(oldRole.color).catch(()=>{});
  await newRole.setPermissions(oldRole.permissions).catch(()=>{});
  await newRole.setPosition(oldRole.position).catch(()=>{});

  await punish(newRole.guild, user.id);
  await log(newRole.guild, user, reason);

  setTimeout(()=>ignore.delete(newRole.guild.id),3000);
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', async (oldCh, newCh) => {
  if (ignore.has(newCh.guild.id)) return;

  const user = await getUser(newCh.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  ignore.add(newCh.guild.id);

  let reason = 'عدل على روم';

  if (oldCh.name !== newCh.name) reason = 'غير اسم روم';
  else if (oldCh.position !== newCh.position) reason = 'سحب روم';
  else if (oldCh.parentId !== newCh.parentId) reason = 'سحب روم';
  else reason = 'عدل على روم';

  await newCh.setName(oldCh.name).catch(()=>{});
  await newCh.setPosition(oldCh.position).catch(()=>{});
  await newCh.setParent(oldCh.parentId).catch(()=>{});
  await newCh.permissionOverwrites.set(oldCh.permissionOverwrites.cache).catch(()=>{});

  await punish(newCh.guild, user.id);
  await log(newCh.guild, user, reason);

  setTimeout(()=>ignore.delete(newCh.guild.id),3000);
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async channel => {
  if (ignore.has(channel.guild.id)) return;

  const user = await getUser(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  ignore.add(channel.guild.id);

  if (channel.type === ChannelType.GuildCategory) {
    const newCat = await channel.guild.channels.create({
      name: channel.name,
      type: ChannelType.GuildCategory
    }).catch(()=>null);

    await punish(channel.guild, user.id);
    await log(channel.guild, user, 'حذف كاتقري');

  } else {
    await channel.guild.channels.create({
      name: channel.name,
      type: channel.type,
      parent: channel.parentId
    }).catch(()=>{});

    await punish(channel.guild, user.id);
    await log(channel.guild, user, 'حذف روم');
  }

  setTimeout(()=>ignore.delete(channel.guild.id),3000);
});

// ================= READY =================
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);
});

client.login(TOKEN);

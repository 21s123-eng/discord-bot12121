const { Client, GatewayIntentBits, AuditLogEvent, ChannelType, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

// ================= CACHE BACKUP =================
const backup = {
  roles: new Map(),
  channels: new Map()
};

// ================= ANTI FLOOD =================
const cooldown = new Map();
const raidTracker = new Map();

function isOwner(id) {
  return id === OWNER_ID;
}

// ================= LOG SYSTEM =================
async function log(guild, user, reason) {
  const key = guild.id + user.id;
  if (cooldown.has(key)) return;

  cooldown.set(key, true);
  setTimeout(() => cooldown.delete(key), 5000);

  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send(
`person : <@${user.id}>

the reason : ${reason}

ID : ${user.id}

@here`
  ).catch(()=>{});
}

// ================= RAID DETECTOR =================
function checkRaid(userId, guildId) {
  const key = guildId + userId;

  const now = Date.now();
  const data = raidTracker.get(key) || { count: 0, time: now };

  if (now - data.time < 5000) {
    data.count++;
  } else {
    data.count = 1;
    data.time = now;
  }

  raidTracker.set(key, data);

  return data.count >= 3; // 3 عمليات خلال 5 ثواني = رايد
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

  if (Date.now() - entry.createdTimestamp > 4000) return null;

  return user;
}

// ================= STRIP ROLES =================
async function punish(member) {
  if (!member) return;

  const roles = member.roles.cache.filter(r => r.id !== member.guild.id);
  for (const r of roles.values()) {
    await member.roles.remove(r).catch(()=>{});
  }
}

// ================= BACKUP =================
function saveGuild(guild) {
  backup.roles.set(guild.id, guild.roles.cache.map(r => ({
    name: r.name,
    color: r.color,
    permissions: r.permissions.bitfield,
    position: r.position
  })));

  backup.channels.set(guild.id, guild.channels.cache.map(c => ({
    name: c.name,
    type: c.type,
    parentId: c.parentId
  })));
}

// ================= RESTORE =================
async function restore(guild) {
  const roles = backup.roles.get(guild.id);
  const channels = backup.channels.get(guild.id);

  if (roles) {
    for (const r of roles) {
      if (!guild.roles.cache.find(x => x.name === r.name)) {
        await guild.roles.create({
          name: r.name,
          color: r.color,
          permissions: new PermissionsBitField(r.permissions)
        }).catch(()=>{});
      }
    }
  }

  if (channels) {
    for (const c of channels) {
      if (!guild.channels.cache.find(x => x.name === c.name)) {
        await guild.channels.create({
          name: c.name,
          type: c.type,
          parent: c.parentId
        }).catch(()=>{});
      }
    }
  }
}

// ================= READY =================
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);

  client.guilds.cache.forEach(saveGuild);
});

// ================= ROLE CREATE =================
client.on('roleCreate', async role => {
  const user = await getUser(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(()=>{});

  const member = await role.guild.members.fetch(user.id).catch(()=>null);

  await punish(member);
  await restore(role.guild);

  log(role.guild, user, 'created role');
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldRole, newRole) => {
  const user = await getUser(newRole.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  await newRole.setName(oldRole.name).catch(()=>{});
  await newRole.setPermissions(oldRole.permissions).catch(()=>{});

  const member = await newRole.guild.members.fetch(user.id).catch(()=>null);

  await punish(member);
  await restore(newRole.guild);

  log(newRole.guild, user, 'role update');
});

// ================= CHANNEL UPDATE =================
client.on('channelUpdate', async (oldCh, newCh) => {
  const user = await getUser(newCh.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  await newCh.setName(oldCh.name).catch(()=>{});
  await newCh.setParent(oldCh.parentId).catch(()=>{});

  const member = await newCh.guild.members.fetch(user.id).catch(()=>null);

  await punish(member);
  await restore(newCh.guild);

  log(newCh.guild, user, 'channel update');
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async channel => {
  const user = await getUser(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await restore(channel.guild);

  const member = await channel.guild.members.fetch(user.id).catch(()=>null);

  await punish(member);

  log(channel.guild, user, 'channel delete');
});

// ================= RAID MASS JOIN =================
client.on('guildMemberAdd', async member => {
  if (checkRaid(member.id, member.guild.id)) {
    await punish(member).catch(()=>{});
  }
});

client.login(TOKEN);

require('dotenv').config();

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

// ================= ANTI RAID MEMORY =================
const actions = new Map();

// ================= LOG =================
function log(guild, text) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;
  ch.send(`${text}\n@here`).catch(()=>{});
}

// ================= TRACK =================
function track(userId) {
  const now = Date.now();

  if (!actions.has(userId)) actions.set(userId, []);

  const arr = actions.get(userId);
  arr.push(now);

  const filtered = arr.filter(t => now - t < 5000);
  actions.set(userId, filtered);

  return filtered.length;
}

// ================= GET EXECUTOR =================
async function getExecutor(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(()=>null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;

  if (user.id === client.user.id) return null;
  if (user.id === OWNER_ID) return null;

  return user;
}

// ================= PUNISH =================
async function punish(member) {
  if (!member) return;

  await member.roles.set([]).catch(()=>{});
  await member.timeout?.(60 * 60 * 1000).catch(()=>{});
}

// ================= LOCKDOWN =================
function lockGuild(guild) {
  const everyone = guild.roles.everyone;

  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(everyone, {
      SendMessages: false,
      ManageChannels: false,
      CreateInstantInvite: false
    }).catch(()=>{});
  });
}

// ================= UNLOCK =================
function unlockGuild(guild) {
  const everyone = guild.roles.everyone;

  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(everyone, {
      SendMessages: null,
      ManageChannels: null,
      CreateInstantInvite: null
    }).catch(()=>{});
  });
}

// ================= BACKUP SIMPLE =================
let backup = new Map();

function saveBackup(guild) {
  backup.set(guild.id, {
    roles: guild.roles.cache.map(r => ({
      name: r.name,
      color: r.color,
      permissions: r.permissions.bitfield.toString()
    })),
    channels: guild.channels.cache.map(c => ({
      name: c.name,
      type: Number(c.type),
      parentId: c.parentId
    }))
  });
}

// ================= RESTORE =================
async function restore(guild) {
  const data = backup.get(guild.id);
  if (!data) return;

  for (const r of data.roles) {
    if (!guild.roles.cache.find(x => x.name === r.name)) {
      await guild.roles.create({
        name: r.name,
        color: r.color,
        permissions: new PermissionsBitField(BigInt(r.permissions))
      }).catch(()=>{});
    }
  }

  for (const c of data.channels) {
    if (!guild.channels.cache.find(x => x.name === c.name)) {
      await guild.channels.create({
        name: c.name,
        type: Number(c.type),
        parent: c.parentId
      }).catch(()=>{});
    }
  }
}

// ================= CORE SECURITY =================
async function handle(guild, type, action) {
  const user = await getExecutor(guild, type);
  if (!user) return;

  const member = await guild.members.fetch(user.id).catch(()=>null);

  const speed = track(user.id);

  // 🚨 هجوم سريع
  if (speed >= 3) {
    lockGuild(guild);
  }

  await punish(member);
  lockGuild(guild);
  await restore(guild);

  log(guild, `🚨 BLOCKED: <@${user.id}>`);

  if (action) action();
}

// ================= EVENTS =================
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);
  client.guilds.cache.forEach(saveBackup);
});

// 🧨 رتب
client.on('roleCreate', role =>
  handle(role.guild, AuditLogEvent.RoleCreate, () =>
    role.delete().catch(()=>{})
  )
);

client.on('roleUpdate', (oldR, newR) =>
  handle(newR.guild, AuditLogEvent.RoleUpdate, () => {
    newR.setName(oldR.name).catch(()=>{});
    newR.setPermissions(oldR.permissions).catch(()=>{});
  })
);

// 🧨 رومات
client.on('channelUpdate', (oldC, newC) =>
  handle(newC.guild, AuditLogEvent.ChannelUpdate, () => {
    newC.setName(oldC.name).catch(()=>{});
    newC.setParent(oldC.parentId).catch(()=>{});
  })
);

client.on('channelDelete', channel =>
  handle(channel.guild, AuditLogEvent.ChannelDelete, () =>
    restore(channel.guild)
  )
);

// 🧨 سحب رتب الأعضاء
client.on('guildMemberUpdate', async (oldM, newM) => {
  const user = await getExecutor(newM.guild, AuditLogEvent.MemberRoleUpdate);
  if (!user) return;

  const member = await newM.guild.members.fetch(user.id).catch(()=>null);

  await punish(member);
  lockGuild(newM.guild);
  await restore(newM.guild);

  log(newM.guild, `🚨 ROLE CHANGE: <@${user.id}>`);
});

client.login(TOKEN);

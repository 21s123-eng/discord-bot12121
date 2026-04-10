require('dotenv').config();

const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');
const db = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

// ================= RATE SYSTEM =================
const actionsMap = new Map();

// ================= LOG =================
function log(guild, text) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  // منع السبام
  if (actionsMap.has(guild.id)) return;

  actionsMap.set(guild.id, true);
  setTimeout(() => actionsMap.delete(guild.id), 3000);

  ch.send(`${text}\n@here`).catch(()=>{});
}

// ================= SAVE =================
function saveBackup(guild) {
  const roles = guild.roles.cache.map(r => ({
    name: r.name,
    color: r.color,
    permissions: r.permissions.bitfield.toString()
  }));

  const channels = guild.channels.cache.map(c => ({
    name: c.name,
    type: Number(c.type),
    parentId: c.parentId
  }));

  db.prepare(`DELETE FROM roles WHERE guildId=?`).run(guild.id);
  db.prepare(`DELETE FROM channels WHERE guildId=?`).run(guild.id);

  db.prepare(`INSERT INTO roles VALUES (?,?)`).run(guild.id, JSON.stringify(roles));
  db.prepare(`INSERT INTO channels VALUES (?,?)`).run(guild.id, JSON.stringify(channels));
}

// ================= RESTORE =================
async function restore(guild) {
  const rolesRow = db.prepare(`SELECT data FROM roles WHERE guildId=?`).get(guild.id);
  const channelsRow = db.prepare(`SELECT data FROM channels WHERE guildId=?`).get(guild.id);

  if (rolesRow) {
    const roles = JSON.parse(rolesRow.data);

    for (const r of roles) {
      if (!guild.roles.cache.find(x => x.name === r.name)) {
        await guild.roles.create({
          name: r.name,
          color: r.color,
          permissions: new PermissionsBitField(BigInt(r.permissions))
        }).catch(()=>{});
      }
    }
  }

  if (channelsRow) {
    const channels = JSON.parse(channelsRow.data);

    for (const c of channels) {
      if (!guild.channels.cache.find(x => x.name === c.name)) {
        await guild.channels.create({
          name: c.name,
          type: Number(c.type),
          parent: c.parentId
        }).catch(()=>{});
      }
    }
  }
}

// ================= EXECUTOR =================
async function getUser(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(()=>null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;

  if (user.id === OWNER_ID || user.id === client.user.id) return null;

  if (Date.now() - entry.createdTimestamp > 5000) return null;

  return user;
}

// ================= PUNISH =================
async function punish(member) {
  if (!member) return;

  const roles = member.roles.cache.filter(r => r.id !== member.guild.id);

  for (const r of roles.values()) {
    await member.roles.remove(r).catch(()=>{});
  }

  // timeout قوي بدل كيك
  await member.timeout?.(60 * 60 * 1000).catch(()=>{});
}

// ================= LOCKDOWN =================
async function lockGuild(guild) {
  const everyone = guild.roles.everyone;

  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(everyone, {
      SendMessages: false,
      CreateInstantInvite: false,
      ManageChannels: false
    }).catch(()=>{});
  });

  setTimeout(() => unlockGuild(guild), 10000); // يفتح بعد 10 ثواني
}

async function unlockGuild(guild) {
  const everyone = guild.roles.everyone;

  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(everyone, {
      SendMessages: null,
      CreateInstantInvite: null,
      ManageChannels: null
    }).catch(()=>{});
  });
}

// ================= DETECT =================
async function handleAction(type, guild, callback) {
  const user = await getUser(guild, type);
  if (!user) return;

  const member = await guild.members.fetch(user.id).catch(()=>null);

  await punish(member);
  await lockGuild(guild);

  await restore(guild);

  log(guild, `🚨 ACTION BLOCKED by <@${user.id}>`);
  if (callback) callback();
}

// ================= EVENTS =================
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);
  client.guilds.cache.forEach(saveBackup);
});

client.on('roleCreate', role => handleAction(AuditLogEvent.RoleCreate, role.guild, () => role.delete().catch(()=>{})));
client.on('roleUpdate', (oldR, newR) => handleAction(AuditLogEvent.RoleUpdate, newR.guild, () => {
  newR.setName(oldR.name).catch(()=>{});
  newR.setPermissions(oldR.permissions).catch(()=>{});
}));

client.on('channelUpdate', (oldC, newC) => handleAction(AuditLogEvent.ChannelUpdate, newC.guild, () => {
  newC.setName(oldC.name).catch(()=>{});
  newC.setParent(oldC.parentId).catch(()=>{});
}));

client.on('channelDelete', channel => handleAction(AuditLogEvent.ChannelDelete, channel.guild, () => {
  restore(channel.guild);
}));

client.login(TOKEN);

require('dotenv').config();

const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');
const db = require('./db');

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

const cooldown = new Map();

// ================= LOG =================
function log(guild, text) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;

  if (cooldown.has(guild.id)) return;
  cooldown.set(guild.id, true);
  setTimeout(() => cooldown.delete(guild.id), 3000);

  ch.send(text + "\n@here").catch(()=>{});
}

// ================= SAVE BACKUP =================
function saveBackup(guild) {
  const roles = guild.roles.cache.map(r => ({
    name: r.name,
    color: r.color,
    permissions: r.permissions.bitfield
  }));

  const channels = guild.channels.cache.map(c => ({
    name: c.name,
    type: c.type,
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
          permissions: new PermissionsBitField(r.permissions)
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
          type: c.type,
          parent: c.parentId
        }).catch(()=>{});
      }
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
  if (!user || user.id === client.user.id) return null;
  if (user.id === OWNER_ID) return null;

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
}

// ================= READY =================
client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);

  client.guilds.cache.forEach(saveBackup);
});

// ================= ROLE CREATE =================
client.on('roleCreate', async role => {
  const user = await getUser(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(()=>{});

  const member = await role.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  await restore(role.guild);

  log(role.guild, `role created by <@${user.id}>`);
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

  log(newRole.guild, `role updated by <@${user.id}>`);
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

  log(newCh.guild, `channel updated by <@${user.id}>`);
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async channel => {
  const user = await getUser(channel.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await restore(channel.guild);

  const member = await channel.guild.members.fetch(user.id).catch(()=>null);
  await punish(member);

  log(channel.guild, `channel deleted by <@${user.id}>`);
});

client.login(TOKEN);

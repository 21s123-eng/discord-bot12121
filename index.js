require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  AuditLogEvent,
  PermissionsBitField
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const WHITELIST = new Set([OWNER_ID]);

// ================= STATE =================
const lockState = new Map();
const actionMap = new Map();

// ================= LOG =================
function log(guild, msg) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!ch) return;
  ch.send(`🧩 ${msg}`).catch(()=>{});
}

// ================= LOCK =================
function isLocked(guildId) {
  return lockState.get(guildId);
}

function lock(guildId, reason) {
  lockState.set(guildId, reason);
}

function unlock(guildId) {
  lockState.delete(guildId);
}

// ================= TRACK =================
function track(userId) {
  const now = Date.now();
  const arr = actionMap.get(userId) || [];

  const filtered = arr.filter(t => now - t < 10000);
  filtered.push(now);

  actionMap.set(userId, filtered);
  return filtered.length;
}

// ================= EXECUTOR =================
async function getExecutor(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(()=>null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;

  if (user.id === client.user.id) return null;
  if (WHITELIST.has(user.id)) return null;

  return { user, entry };
}

// ================= 🔥 PUNISH (FINAL) =================
async function punish(guild, userId, reason) {
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (!member) return;

  try {
    // 🔴 حذف كل الرتب
    const roles = member.roles.cache.filter(r => r.id !== guild.id);
    await member.roles.remove(roles).catch(()=>{});

    // 🔇 ميوت 1 ساعة
    await member.timeout(60 * 60 * 1000, reason).catch(()=>{});

  } catch {}
}

// ================= CHANNEL PROTECTION =================
client.on('channelUpdate', async (oldC, newC) => {
  if (isLocked(newC.guild.id)) return;

  const data = await getExecutor(newC.guild, AuditLogEvent.ChannelUpdate);
  if (!data) return;

  const { user, entry } = data;

  if (Date.now() - entry.createdTimestamp > 5000) return;

  // 🔥 رجوع فوري للتغييرات
  await newC.setParent(oldC.parentId).catch(()=>{});
  await newC.setPosition(oldC.position).catch(()=>{});
  await newC.setName(oldC.name).catch(()=>{});

  await punish(newC.guild, user.id, 'CHANNEL EDIT');

  const hits = track(user.id);
  if (hits >= 5) {
    lock(newC.guild.id, 'ANTI RAID TRIGGERED');
    log(newC.guild, `🚨 AUTO LOCK ACTIVATED`);
  }

  log(newC.guild, `❌ Channel edited by: <@${user.id}>`);
});

// ================= ROLE UPDATE =================
client.on('roleUpdate', async (oldR, newR) => {
  if (isLocked(newR.guild.id)) return;

  const data = await getExecutor(newR.guild, AuditLogEvent.RoleUpdate);
  if (!data) return;

  const { user, entry } = data;

  if (Date.now() - entry.createdTimestamp > 5000) return;

  await newR.setPermissions(oldR.permissions).catch(()=>{});
  await newR.setName(oldR.name).catch(()=>{});

  await punish(newR.guild, user.id, 'ROLE EDIT');

  log(newR.guild, `❌ Role edited by: <@${user.id}>`);
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async (ch) => {
  const data = await getExecutor(ch.guild, AuditLogEvent.ChannelDelete);
  if (!data) return;

  const { user } = data;

  await punish(ch.guild, user.id, 'DELETE CHANNEL');
  log(ch.guild, `🚨 Channel deleted by: <@${user.id}>`);
});

// ================= ROLE CREATE =================
client.on('roleCreate', async (role) => {
  const data = await getExecutor(role.guild, AuditLogEvent.RoleCreate);
  if (!data) return;

  const { user } = data;

  await role.delete().catch(()=>{});
  await punish(role.guild, user.id, 'ROLE CREATE');

  log(role.guild, `🚨 Role created by: <@${user.id}>`);
});

// ================= COMMANDS =================
client.on('messageCreate', async (msg) => {
  if (!msg.guild) return;
  if (!WHITELIST.has(msg.author.id)) return;

  const args = msg.content.split(' ');
  const cmd = args[0];

  if (cmd === '/lock') {
    lock(msg.guild.id, 'MANUAL');
    return msg.reply('🔒 مقفل');
  }

  if (cmd === '/unlock') {
    unlock(msg.guild.id);
    return msg.reply('🔓 مفتوح');
  }

  if (cmd === '/status') {
    return msg.reply(isLocked(msg.guild.id) ? '🔴 مقفل' : '🟢 آمن');
  }
});

// ================= READY =================
client.once('ready', () => {
  console.log(`🏛️ SYSTEM ONLINE: ${client.user.tag}`);
});

client.login(TOKEN);

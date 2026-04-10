require('dotenv').config();
const { Client, GatewayIntentBits, AuditLogEvent, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const TOKEN = process.env.TOKEN;
const OWNER_ID = '1125609597613375629';

const LOG_CHANNEL_ID = '1492108809618063432';

// ================= LOG =================
function log(guild, msg) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (ch) ch.send(`${msg}\n@here`).catch(()=>{});
}

// ================= GET EXECUTOR =================
async function getExec(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(()=>null);
  if (!logs) return null;

  const entry = logs.entries.first();
  if (!entry) return null;

  const user = entry.executor;
  if (!user) return null;
  if (user.id === client.user.id || user.id === OWNER_ID) return null;

  return user;
}

// ================= PUNISH =================
async function punish(guild, userId) {
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (!member) return;

  // سحب كل الرتب
  await member.roles.set([]).catch(()=>{});

  // تايم أوت قوي
  await member.timeout(60 * 60 * 1000).catch(()=>{});
}

// ================= ROLE PROTECTION =================
client.on('roleUpdate', async (oldR, newR) => {
  const user = await getExec(newR.guild, AuditLogEvent.RoleUpdate);
  if (!user) return;

  await newR.setPermissions(oldR.permissions).catch(()=>{});
  await newR.setName(oldR.name).catch(()=>{});

  await punish(newR.guild, user.id);
  log(newR.guild, `ROLE CHANGE BLOCKED: ${user.tag}`);
});

// ================= CHANNEL PROTECTION =================
client.on('channelUpdate', async (oldC, newC) => {
  const user = await getExec(newC.guild, AuditLogEvent.ChannelUpdate);
  if (!user) return;

  // رجّع الاسم والمكان
  await newC.setName(oldC.name).catch(()=>{});
  await newC.setParent(oldC.parentId).catch(()=>{});

  await punish(newC.guild, user.id);
  log(newC.guild, `CHANNEL MOVE/EDIT BLOCKED: ${user.tag}`);
});

// ================= CHANNEL DELETE =================
client.on('channelDelete', async (ch) => {
  const user = await getExec(ch.guild, AuditLogEvent.ChannelDelete);
  if (!user) return;

  await punish(ch.guild, user.id);
  log(ch.guild, `CHANNEL DELETE BLOCKED: ${user.tag}`);
});

// ================= ROLE CREATE =================
client.on('roleCreate', async (role) => {
  const user = await getExec(role.guild, AuditLogEvent.RoleCreate);
  if (!user) return;

  await role.delete().catch(()=>{});
  await punish(role.guild, user.id);

  log(role.guild, `ROLE CREATE BLOCKED: ${user.tag}`);
});

// ================= MEMBER ROLE CHANGE =================
client.on('guildMemberUpdate', async (oldM, newM) => {
  const user = await getExec(newM.guild, AuditLogEvent.MemberRoleUpdate);
  if (!user) return;

  await punish(newM.guild, user.id);
  log(newM.guild, `MEMBER ROLE CHANGE BLOCKED`);
});

client.once('ready', () => {
  console.log(`ONLINE: ${client.user.tag}`);
});

client.login(TOKEN);

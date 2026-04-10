import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
} from 'discord.js';

const TOKEN = process.env.TOKEN;
const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

const recentPunishments = new Map();
const COOLDOWN_MS = 3000;

function isPunishmentOnCooldown(guildId, executorId, reason) {
    const key = `${guildId}:${executorId}:${reason}`;
    const last = recentPunishments.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return true;
    recentPunishments.set(key, Date.now());
    return false;
}

function isIgnored(userId) {
    return userId === OWNER_ID || userId === client.user?.id;
}

async function getAuditExecutor(guild, auditLogEvent, targetId = null, delayMs = 1500) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
        const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 5 });
        let entry = targetId
            ? logs.entries.find((e) => e.target?.id === targetId)
            : null;
        if (!entry) entry = logs.entries.first();
        if (!entry) return null;
        const age = Math.round((Date.now() - entry.createdTimestamp) / 1000);
        if (age > 30) return null;
        return entry.executor ?? null;
    } catch {
        return null;
    }
}

async function removeAllRoles(member) {
    const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .map((r) => r.id);
    if (roles.length === 0) return;
    await member.roles.remove(roles, 'Protection system: unauthorized action').catch(() => {});
}

async function sendLog(guild, user, reason) {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(
        `@here\n\nperson : <@${user.id}>\n\nthe reason : ${reason}\n\nID : ${user.id}`
    ).catch(() => {});
}

async function punish(guild, executor, reason) {
    if (isIgnored(executor.id)) return;
    if (isPunishmentOnCooldown(guild.id, executor.id, reason)) return;
    try {
        const member = await guild.members.fetch(executor.id);
        await Promise.all([removeAllRoles(member), sendLog(guild, executor, reason)]);
    } catch {}
}

client.on('roleCreate', async (role) => {
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        if (!executor || isIgnored(executor.id)) return;
        await role.delete('Protection: reverting unauthorized role creation').catch(() => {});
        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch {}
});

client.on('roleDelete', async (role) => {
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        if (!executor || isIgnored(executor.id)) return;
        await role.guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
            reason: 'Protection: reverting unauthorized role deletion',
        }).catch(() => {});
        await punish(role.guild, executor, 'حذف رتبه');
    } catch {}
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const positionChanged = oldRole.rawPosition !== newRole.rawPosition;
        if (!nameChanged && !colorChanged && !positionChanged) return;
        let reason;
        if (nameChanged) reason = 'تغيير اسم رتبه';
        else if (colorChanged) reason = 'تغيير لون رتبه';
        else reason = 'تغيرر مكان رتبه';
        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        if (!executor || isIgnored(executor.id)) return;
        if (nameChanged) await newRole.setName(oldRole.name).catch(() => {});
        if (colorChanged) await newRole.setColor(oldRole.color).catch(() => {});
        if (positionChanged) await newRole.guild.roles.setPositions([{ role: newRole.id, position: oldRole.rawPosition }]).catch(() => {});
        await punish(newRole.guild, executor, reason);
    } catch {}
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    try {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        const reason = isCategory ? 'حذف كاتوقري' : 'حذف روم';
        const overwrites = channel.permissionOverwrites?.cache?.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })) ?? [];
        const createOptions = { name: channel.name, type: channel.type, position: channel.rawPosition, permissionOverwrites: overwrites, reason: 'Protection: reverting unauthorized deletion' };
        if (!isCategory) {
            if (channel.parentId) createOptions.parent = channel.parentId;
            if (channel.topic) createOptions.topic = channel.topic;
            if (channel.nsfw !== undefined) createOptions.nsfw = channel.nsfw;
            if (channel.rateLimitPerUser) createOptions.rateLimitPerUser = channel.rateLimitPerUser;
            if (channel.type === ChannelType.GuildVoice) {
                if (channel.bitrate) createOptions.bitrate = channel.bitrate;
                if (channel.userLimit) createOptions.userLimit = channel.userLimit;
            }
        }
        await channel.guild.channels.create(createOptions).catch(() => {});
        await punish(channel.guild, executor, reason);
    } catch {}
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    try {
        const isCategory = newChannel.type === ChannelType.GuildCategory;
        const nameChanged = oldChannel.name !== newChannel.name;
        const positionChanged = oldChannel.rawPosition !== newChannel.rawPosition || oldChannel.position !== newChannel.position;
        const oldPerms = oldChannel.permissionOverwrites?.cache;
        const newPerms = newChannel.permissionOverwrites?.cache;
        let permChanged = false, permAdded = false;
        if (oldPerms && newPerms) {
            if (newPerms.size > oldPerms.size) { permChanged = true; permAdded = true; }
            else if (newPerms.size < oldPerms.size) { permChanged = true; }
            else {
                for (const [id, newOw] of newPerms) {
                    const oldOw = oldPerms.get(id);
                    if (!oldOw || oldOw.allow.bitfield !== newOw.allow.bitfield || oldOw.deny.bitfield !== newOw.deny.bitfield) { permChanged = true; break; }
                }
            }
        }
        if (!nameChanged && !positionChanged && !permChanged) return;
        let reason;
        if (nameChanged) reason = 'غير اسم روم او شات';
        else if (positionChanged) reason = isCategory ? 'حرك كاتوقري' : 'حرك روم';
        else if (permChanged) {
            if (isCategory) reason = permAdded ? 'اضاف رتبه في كاتوقري' : 'حذف رتبه في كاتوقري';
            else reason = permAdded ? 'اضاف رتبه في روم او شات' : 'حذف رتبه في روم او شات';
        } else return;
        const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        if (!executor || isIgnored(executor.id)) return;
        if (nameChanged) await newChannel.setName(oldChannel.name).catch(() => {});
        if (positionChanged) await newChannel.setPosition(oldChannel.rawPosition).catch(() => {});
        if (permChanged && oldPerms) await newChannel.permissionOverwrites.set(oldPerms.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))).catch(() => {});
        await punish(newChannel.guild, executor, reason);
    } catch {}
});

client.once('clientReady', () => {
    console.log(`[Bot] Online as ${client.user.tag}`);
    console.log(`[Bot] Protection system active`);
});

client.login(process.env.TOKEN);

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
const COOLDOWN_MS = 5000;

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

async function getAuditExecutor(guild, auditLogEvent, targetId = null) {
    const startTime = Date.now();
    for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
            const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 10 });

            let entry = null;

            if (targetId) {
                entry = logs.entries.find(
                    (e) => e.target?.id === targetId && !isIgnored(e.executor?.id ?? '')
                );
            }

            if (!entry) {
                entry = logs.entries.find(
                    (e) =>
                        e.createdTimestamp >= startTime - 5000 &&
                        !isIgnored(e.executor?.id ?? '')
                );
            }

            if (entry) return entry.executor ?? null;
        } catch {}
    }
    return null;
}

async function removeAllRoles(member) {
    const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .map((r) => r.id);
    if (roles.length === 0) return;
    await member.roles.remove(roles, 'Protection system').catch(() => {});
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
    const savedPosition = role.rawPosition;
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        if (!executor || isIgnored(executor.id)) return;
        const recreated = await role.guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
            reason: 'Protection: reverting unauthorized role deletion',
        }).catch(() => null);
        if (recreated && savedPosition > 0) {
            await recreated.setPosition(savedPosition, { relative: false }).catch(() => {});
        }
        await punish(role.guild, executor, 'حذف رتبه');
    } catch {}
});

const handledPositionChanges = new Map();

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const positionChanged = oldRole.rawPosition !== newRole.rawPosition;
        if (!nameChanged && !colorChanged && !positionChanged) return;

        const oldName = oldRole.name;
        const oldColor = oldRole.color;
        const oldPosition = oldRole.rawPosition;

        let reason;
        if (nameChanged) reason = 'تغيير اسم رتبه';
        else if (colorChanged) reason = 'تغيير لون رتبه';
        else reason = 'تغيرر مكان رتبه';

        if (positionChanged) {
            const batchKey = `${newRole.guild.id}:${Math.floor(Date.now() / 3000)}`;
            const alreadyHandled = handledPositionChanges.has(batchKey);

            await newRole.setPosition(oldPosition, { relative: false }).catch(() => {});

            if (alreadyHandled) return;

            handledPositionChanges.set(batchKey, true);
            setTimeout(() => handledPositionChanges.delete(batchKey), 6000);

            const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
            if (!executor || isIgnored(executor.id)) return;

            await punish(newRole.guild, executor, reason);
            return;
        }

        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        if (!executor || isIgnored(executor.id)) return;

        if (nameChanged) await newRole.setName(oldName).catch(() => {});
        if (colorChanged) await newRole.setColor(oldColor).catch(() => {});

        await punish(newRole.guild, executor, reason);
    } catch {}
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    try {
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        await channel.delete('Protection: reverting unauthorized channel creation').catch(() => {});
        await punish(channel.guild, executor, 'حذف روم');
    } catch {}
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    try {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        const reason = isCategory ? 'حذف كاتوقري' : 'حذف روم';
        const overwrites = channel.permissionOverwrites?.cache?.map((o) => ({
            id: o.id, type: o.type, allow: o.allow, deny: o.deny,
        })) ?? [];
        const createOptions = {
            name: channel.name,
            type: channel.type,
            position: channel.rawPosition,
            permissionOverwrites: overwrites,
            reason: 'Protection: reverting unauthorized deletion',
        };
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

const handledChannelPositionChanges = new Map();

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    try {
        const isCategory = newChannel.type === ChannelType.GuildCategory;
        const nameChanged = oldChannel.name !== newChannel.name;
        const positionChanged =
            oldChannel.rawPosition !== newChannel.rawPosition ||
            oldChannel.position !== newChannel.position;

        const oldName = oldChannel.name;
        const oldPosition = oldChannel.rawPosition;

        const oldPerms = oldChannel.permissionOverwrites?.cache;
        const newPerms = newChannel.permissionOverwrites?.cache;
        let permChanged = false;
        let permAdded = false;

        if (oldPerms && newPerms) {
            if (newPerms.size > oldPerms.size) { permChanged = true; permAdded = true; }
            else if (newPerms.size < oldPerms.size) { permChanged = true; }
            else {
                for (const [id, newOw] of newPerms) {
                    const oldOw = oldPerms.get(id);
                    if (!oldOw ||
                        oldOw.allow.bitfield !== newOw.allow.bitfield ||
                        oldOw.deny.bitfield !== newOw.deny.bitfield) {
                        permChanged = true;
                        break;
                    }
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

        if (positionChanged) {
            const batchKey = `${newChannel.guild.id}:${Math.floor(Date.now() / 3000)}`;
            const alreadyHandled = handledChannelPositionChanges.has(batchKey);

            await newChannel.setPosition(oldPosition).catch(() => {});

            if (alreadyHandled) return;

            handledChannelPositionChanges.set(batchKey, true);
            setTimeout(() => handledChannelPositionChanges.delete(batchKey), 6000);

            const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
            if (!executor || isIgnored(executor.id)) return;

            await punish(newChannel.guild, executor, reason);
            return;
        }

        const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        if (!executor || isIgnored(executor.id)) return;

        if (nameChanged) await newChannel.setName(oldName).catch(() => {});
        if (permChanged && oldPerms) {
            await newChannel.permissionOverwrites.set(
                oldPerms.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
            ).catch(() => {});
        }

        await punish(newChannel.guild, executor, reason);
    } catch {}
});

client.once('clientReady', () => {
    console.log(`[Bot] Online as ${client.user.tag}`);
    console.log(`[Bot] Protection system active`);
});

client.login(process.env.TOKEN);

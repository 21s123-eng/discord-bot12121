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
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences,
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

async function debugLog(guild, msg) {
    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
        if (channel) await channel.send(`🔍 DEBUG: ${msg}`).catch(() => {});
    } catch {}
}

async function getAuditEntry(guild, auditLogEvent) {
    const startTime = Date.now();
    for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
            const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 10 });
            const entry = logs.entries.find(
                (e) =>
                    e.createdTimestamp >= startTime - 8000 &&
                    e.executor?.id !== client.user?.id
            );
            if (entry) {
                return { executor: entry.executor ?? null, targetId: entry.target?.id ?? null };
            }
        } catch {}
    }
    return null;
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
                    (e) =>
                        e.target?.id === targetId &&
                        e.executor?.id !== client.user?.id &&
                        e.createdTimestamp >= startTime - 8000
                );
            }
            if (!entry) {
                entry = logs.entries.find(
                    (e) =>
                        e.createdTimestamp >= startTime - 8000 &&
                        e.executor?.id !== client.user?.id
                );
            }
            if (entry) return entry.executor ?? null;
        } catch {}
    }
    return null;
}

async function removeAllRoles(member) {
    const botMember = member.guild.members.me;
    const botHighestPosition = botMember?.roles?.highest?.position ?? 0;
    const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id && r.position < botHighestPosition)
        .map((r) => r.id);
    if (roles.length === 0) return 'no_removable_roles';
    await member.roles.remove(roles, 'Protection system');
    return `removed_${roles.length}`;
}

async function sendLog(guild, user, reason) {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(
        `@here\n\nperson : <@${user.id}>\n\nthe reason : ${reason}\n\nID : ${user.id}`
    ).catch(() => {});
}

async function punish(guild, executor, reason) {
    if (isIgnored(executor.id)) {
        await debugLog(guild, `IGNORED executor: ${executor.id}`);
        return;
    }
    if (isPunishmentOnCooldown(guild.id, executor.id, reason)) {
        await debugLog(guild, `COOLDOWN for: ${executor.id}`);
        return;
    }
    try {
        await debugLog(guild, `Punishing <@${executor.id}> reason: ${reason}`);
        const member = await guild.members.fetch(executor.id);
        const result = await removeAllRoles(member);
        await debugLog(guild, `removeAllRoles: ${result}`);
        await sendLog(guild, executor, reason);
    } catch (err) {
        await debugLog(guild, `punish ERROR: ${err?.message ?? err}`);
    }
}

const storedRolePositions = new Map();
const guildRoleAuditPromises = new Map();
const botRestoringRoleGuilds = new Set();

client.once('clientReady', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);
    for (const [, guild] of client.guilds.cache) {
        try {
            const roles = await guild.roles.fetch();
            for (const [, role] of roles) {
                storedRolePositions.set(`${guild.id}:${role.id}`, role.rawPosition);
            }
        } catch {}
    }
    console.log(`[Bot] Tracking ${storedRolePositions.size} role positions`);
    console.log(`[Bot] Protection system active`);
});

client.on('roleCreate', async (role) => {
    storedRolePositions.set(`${role.guild.id}:${role.id}`, role.rawPosition);
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        if (!executor || isIgnored(executor.id)) return;
        await role.delete('Protection: reverting unauthorized role creation').catch(() => {});
        storedRolePositions.delete(`${role.guild.id}:${role.id}`);
        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch {}
});

client.on('roleDelete', async (role) => {
    const savedPosition = role.rawPosition;
    storedRolePositions.delete(`${role.guild.id}:${role.id}`);
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
        if (recreated) {
            storedRolePositions.set(`${role.guild.id}:${recreated.id}`, savedPosition);
            if (savedPosition > 0) {
                await recreated.setPosition(savedPosition, { relative: false }).catch(() => {});
            }
        }
        await punish(role.guild, executor, 'حذف رتبه');
    } catch {}
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const storedKey = `${newRole.guild.id}:${newRole.id}`;
        const storedPosition = storedRolePositions.get(storedKey);
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const positionChanged =
            storedPosition !== undefined && storedPosition !== newRole.rawPosition;

        if (!nameChanged && !colorChanged && !positionChanged) return;

        if (positionChanged) {
            if (botRestoringRoleGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            let auditPromise = guildRoleAuditPromises.get(newRole.guild.id);
            if (!auditPromise) {
                auditPromise = getAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate);
                guildRoleAuditPromises.set(newRole.guild.id, auditPromise);
                setTimeout(() => guildRoleAuditPromises.delete(newRole.guild.id), 10000);
            }

            const auditResult = await auditPromise;

            if (botRestoringRoleGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (!auditResult) {
                await debugLog(newRole.guild, `No audit entry for position change of ${newRole.name}`);
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            const { executor, targetId } = auditResult;

            if (targetId && targetId !== newRole.id) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (!executor || isIgnored(executor.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            const oldPosition = storedPosition;
            botRestoringRoleGuilds.add(newRole.guild.id);
            setTimeout(() => botRestoringRoleGuilds.delete(newRole.guild.id), 8000);

            await debugLog(
                newRole.guild,
                `Role moved: ${newRole.name} | executor: <@${executor.id}> | restoring to ${oldPosition}`
            );

            await newRole.setPosition(oldPosition, { relative: false }).catch(() => {});
            await punish(newRole.guild, executor, 'تغيير مكان رتبه');
            return;
        }

        let reason;
        if (nameChanged) reason = 'تغيير اسم رتبه';
        else reason = 'تغيير لون رتبه';

        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        if (!executor || isIgnored(executor.id)) return;
        if (nameChanged) await newRole.setName(oldRole.name).catch(() => {});
        if (colorChanged) await newRole.setColor(oldRole.color).catch(() => {});
        await punish(newRole.guild, executor, reason);
    } catch {}
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    try {
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        await channel.delete('Protection: reverting unauthorized channel creation').catch(() => {});
        await punish(channel.guild, executor, 'اضافة روم');
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

const storedChannelPositions = new Map();
const guildChannelAuditPromises = new Map();
const botRestoringChannelGuilds = new Set();

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    try {
        const isCategory = newChannel.type === ChannelType.GuildCategory;
        const nameChanged = oldChannel.name !== newChannel.name;
        const storedKey = `${newChannel.guild.id}:${newChannel.id}`;
        const storedPosition = storedChannelPositions.get(storedKey) ?? oldChannel.rawPosition;
        const positionChanged = storedPosition !== newChannel.rawPosition;

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

        if (positionChanged && !nameChanged && !permChanged) {
            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            let auditPromise = guildChannelAuditPromises.get(newChannel.guild.id);
            if (!auditPromise) {
                auditPromise = getAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate);
                guildChannelAuditPromises.set(newChannel.guild.id, auditPromise);
                setTimeout(() => guildChannelAuditPromises.delete(newChannel.guild.id), 10000);
            }

            const auditResult = await auditPromise;

            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            if (!auditResult) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            const { executor, targetId } = auditResult;

            if (targetId && targetId !== newChannel.id) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            if (!executor || isIgnored(executor.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            const oldPosition = storedPosition;
            botRestoringChannelGuilds.add(newChannel.guild.id);
            setTimeout(() => botRestoringChannelGuilds.delete(newChannel.guild.id), 8000);

            const reason = isCategory ? 'حرك كاتوقري' : 'حرك روم';
            await newChannel.setPosition(oldPosition).catch(() => {});
            await punish(newChannel.guild, executor, reason);
            return;
        }

        let reason;
        if (nameChanged) reason = 'غير اسم روم او شات';
        else if (permChanged) {
            if (isCategory) reason = permAdded ? 'اضاف رتبه في كاتوقري' : 'حذف رتبه في كاتوقري';
            else reason = permAdded ? 'اضاف رتبه في روم او شات' : 'حذف رتبه في روم او شات';
        } else return;

        const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        if (!executor || isIgnored(executor.id)) return;
        if (nameChanged) await newChannel.setName(oldChannel.name).catch(() => {});
        if (permChanged && oldPerms) {
            await newChannel.permissionOverwrites.set(
                oldPerms.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
            ).catch(() => {});
        }
        await punish(newChannel.guild, executor, reason);
    } catch {}
});

client.login(TOKEN);

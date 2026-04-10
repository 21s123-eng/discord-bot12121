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

// --- Our own position tracking to bypass Discord.js cache issues ---
const storedRolePositions = new Map(); // `${guildId}:${roleId}` -> rawPosition

// --- Deduplication for bulk role position events ---
// All concurrent roleUpdate events for the same guild share one executor lookup
const guildPositionChangePromises = new Map(); // guildId -> Promise<executor|null>

// --- Prevent infinite loop when bot restores roles ---
const botRestoringGuilds = new Set(); // guildId

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
    console.log(`[Bot] Protection system active — tracking ${storedRolePositions.size} role positions`);
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

        // Use OUR stored position for comparison — Discord.js cache may already be updated
        const positionChanged =
            storedPosition !== undefined && storedPosition !== newRole.rawPosition;

        if (!nameChanged && !colorChanged && !positionChanged) return;

        const oldName = oldRole.name;
        const oldColor = oldRole.color;
        const oldPosition = storedPosition;

        if (positionChanged) {
            // If the bot is currently restoring this guild's roles, update our record and skip
            if (botRestoringGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            // Share a single executor lookup across all concurrent events for this guild
            let executorPromise = guildPositionChangePromises.get(newRole.guild.id);
            if (!executorPromise) {
                executorPromise = getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, null);
                guildPositionChangePromises.set(newRole.guild.id, executorPromise);
                setTimeout(() => guildPositionChangePromises.delete(newRole.guild.id), 10000);
            }

            const executor = await executorPromise;

            // Re-check after async wait — another event may have started restoration
            if (botRestoringGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (!executor || isIgnored(executor.id)) {
                // Owner or bot moved this role — accept the new position as legitimate
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            // First event past this point handles restoration and punishment
            // Subsequent events (from the same batch) will see botRestoringGuilds is set
            botRestoringGuilds.add(newRole.guild.id);
            setTimeout(() => botRestoringGuilds.delete(newRole.guild.id), 6000);

            // Restore the moved role to its original position
            // Cascade from Discord will automatically restore other affected roles
            await newRole.setPosition(oldPosition, { relative: false }).catch(() => {});
            await punish(newRole.guild, executor, 'تغيرر مكان رتبه');
            return;
        }

        // Name or color change
        let reason;
        if (nameChanged) reason = 'تغيير اسم رتبه';
        else reason = 'تغيير لون رتبه';

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

const storedChannelPositions = new Map();
const guildChannelPositionChangePromises = new Map();
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

        const oldName = oldChannel.name;
        const oldPosition = storedPosition;

        if (positionChanged && !nameChanged && !permChanged) {
            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            let executorPromise = guildChannelPositionChangePromises.get(newChannel.guild.id);
            if (!executorPromise) {
                executorPromise = getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, null);
                guildChannelPositionChangePromises.set(newChannel.guild.id, executorPromise);
                setTimeout(() => guildChannelPositionChangePromises.delete(newChannel.guild.id), 10000);
            }

            const executor = await executorPromise;

            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            if (!executor || isIgnored(executor.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition);
                return;
            }

            botRestoringChannelGuilds.add(newChannel.guild.id);
            setTimeout(() => botRestoringChannelGuilds.delete(newChannel.guild.id), 6000);

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

        if (nameChanged) await newChannel.setName(oldName).catch(() => {});
        if (permChanged && oldPerms) {
            await newChannel.permissionOverwrites.set(
                oldPerms.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
            ).catch(() => {});
        }

        await punish(newChannel.guild, executor, reason);
    } catch {}
});

client.login(TOKEN);

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

async function log(guild, msg) {
    console.log(`[LOG] ${msg}`);
    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
        if (channel) {
            await channel.send(`🔍 ${msg}`).catch((e) => console.log(`[LOG SEND ERR] ${e.message}`));
        } else {
            console.log(`[LOG] channel not found in cache: ${LOG_CHANNEL_ID}`);
        }
    } catch (e) {
        console.log(`[LOG ERR] ${e.message}`);
    }
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
            if (entry) {
                console.log(`[AUDIT] attempt ${attempt} — found executor: ${entry.executor?.id}`);
                return entry.executor ?? null;
            }
            console.log(`[AUDIT] attempt ${attempt} — no entry found yet`);
        } catch (e) {
            console.log(`[AUDIT ERR] ${e.message}`);
        }
    }
    console.log(`[AUDIT] gave up after 4 attempts`);
    return null;
}

async function removeAllRoles(member) {
    const botMember = member.guild.members.me;
    const botHighestPosition = botMember?.roles?.highest?.position ?? 0;
    console.log(`[PUNISH] bot highest pos: ${botHighestPosition}`);

    const removable = member.roles.cache.filter(
        (r) => r.id !== member.guild.id && r.position < botHighestPosition
    );
    const notRemovable = member.roles.cache.filter(
        (r) => r.id !== member.guild.id && r.position >= botHighestPosition
    );

    console.log(`[PUNISH] removable: ${removable.map((r) => r.name).join(', ') || 'none'}`);
    console.log(`[PUNISH] NOT removable (too high): ${notRemovable.map((r) => r.name).join(', ') || 'none'}`);

    if (removable.size === 0) return 'no_removable_roles';

    await member.roles.remove([...removable.keys()], 'Protection system');
    return `removed_${removable.size}`;
}

async function sendLog(guild, user, reason) {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) { console.log(`[SENDLOG] channel not found`); return; }
    await channel.send(
        `@here\n\nperson : <@${user.id}>\n\nthe reason : ${reason}\n\nID : ${user.id}`
    ).catch((e) => console.log(`[SENDLOG ERR] ${e.message}`));
}

async function punish(guild, executor, reason) {
    console.log(`[PUNISH] called — executor: ${executor.id} reason: ${reason}`);
    if (isIgnored(executor.id)) { console.log(`[PUNISH] ignored`); return; }
    if (isPunishmentOnCooldown(guild.id, executor.id, reason)) { console.log(`[PUNISH] cooldown`); return; }
    try {
        await log(guild, `Punishing <@${executor.id}> — ${reason}`);
        console.log(`[PUNISH] fetching member...`);
        const member = await guild.members.fetch(executor.id);
        console.log(`[PUNISH] fetched: ${member.user.tag}`);
        const result = await removeAllRoles(member);
        console.log(`[PUNISH] result: ${result}`);
        await log(guild, `Done: ${result}`);
        await sendLog(guild, executor, reason);
    } catch (err) {
        console.log(`[PUNISH ERR] ${err?.message ?? err}`);
        await log(guild, `ERROR: ${err?.message ?? err}`);
    }
}

const storedRolePositions = new Map();
const guildPositionChangePromises = new Map();
const botRestoringRoleGuilds = new Set();

client.once('clientReady', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);
    for (const [, guild] of client.guilds.cache) {
        try {
            const roles = await guild.roles.fetch();
            for (const [, role] of roles) {
                storedRolePositions.set(`${guild.id}:${role.id}`, role.rawPosition);
            }
            console.log(`[Bot] ${guild.name}: tracked ${roles.size} roles`);
        } catch (e) {
            console.log(`[Bot] Failed roles fetch: ${e.message}`);
        }
    }
    console.log(`[Bot] Total: ${storedRolePositions.size} positions stored`);
    console.log(`[Bot] Protection active`);
});

client.on('roleCreate', async (role) => {
    storedRolePositions.set(`${role.guild.id}:${role.id}`, role.rawPosition);
    console.log(`[roleCreate] ${role.name}`);
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        if (!executor) { console.log(`[roleCreate] no executor`); return; }
        if (isIgnored(executor.id)) { console.log(`[roleCreate] ignored`); return; }
        await role.delete('Protection').catch(() => {});
        storedRolePositions.delete(`${role.guild.id}:${role.id}`);
        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch (e) { console.log(`[roleCreate ERR] ${e.message}`); }
});

client.on('roleDelete', async (role) => {
    const savedPosition = role.rawPosition;
    storedRolePositions.delete(`${role.guild.id}:${role.id}`);
    console.log(`[roleDelete] ${role.name}`);
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        if (!executor) { console.log(`[roleDelete] no executor`); return; }
        if (isIgnored(executor.id)) { console.log(`[roleDelete] ignored`); return; }
        const recreated = await role.guild.roles.create({
            name: role.name, color: role.color, hoist: role.hoist,
            permissions: role.permissions, mentionable: role.mentionable,
            reason: 'Protection',
        }).catch((e) => { console.log(`[roleDelete create ERR] ${e.message}`); return null; });
        if (recreated) {
            storedRolePositions.set(`${role.guild.id}:${recreated.id}`, savedPosition);
            if (savedPosition > 0) await recreated.setPosition(savedPosition, { relative: false }).catch(() => {});
        }
        await punish(role.guild, executor, 'حذف رتبه');
    } catch (e) { console.log(`[roleDelete ERR] ${e.message}`); }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const storedKey = `${newRole.guild.id}:${newRole.id}`;
        const storedPosition = storedRolePositions.get(storedKey);
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const positionChanged = storedPosition !== undefined && storedPosition !== newRole.rawPosition;

        if (!nameChanged && !colorChanged && !positionChanged) return;

        console.log(`[roleUpdate] ${newRole.name} | name:${nameChanged} color:${colorChanged} pos:${positionChanged} stored:${storedPosition} new:${newRole.rawPosition}`);

        if (positionChanged) {
            if (botRestoringRoleGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            let executorPromise = guildPositionChangePromises.get(newRole.guild.id);
            if (!executorPromise) {
                console.log(`[roleUpdate] starting audit lookup...`);
                executorPromise = getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, null);
                guildPositionChangePromises.set(newRole.guild.id, executorPromise);
                setTimeout(() => guildPositionChangePromises.delete(newRole.guild.id), 10000);
            }

            const executor = await executorPromise;

            if (botRestoringRoleGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (!executor) {
                console.log(`[roleUpdate] no executor — updating stored`);
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (isIgnored(executor.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }

            if (botRestoringRoleGuilds.has(newRole.guild.id)) {
                storedRolePositions.set(storedKey, newRole.rawPosition);
                return;
            }
            botRestoringRoleGuilds.add(newRole.guild.id);
            setTimeout(() => botRestoringRoleGuilds.delete(newRole.guild.id), 8000);

            const oldPosition = storedPosition;
            console.log(`[roleUpdate] restoring ${newRole.name} → ${oldPosition}`);
            await log(newRole.guild, `Role moved: ${newRole.name} by <@${executor.id}> — restoring`);
            await newRole.setPosition(oldPosition, { relative: false }).catch((e) =>
                console.log(`[roleUpdate setPosition ERR] ${e.message}`)
            );
            await punish(newRole.guild, executor, 'تغيير مكان رتبه');
            return;
        }

        const reason = nameChanged ? 'تغيير اسم رتبه' : 'تغيير لون رتبه';
        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        if (!executor) { console.log(`[roleUpdate] no executor name/color`); return; }
        if (isIgnored(executor.id)) return;
        if (nameChanged) await newRole.setName(oldRole.name).catch(() => {});
        if (colorChanged) await newRole.setColor(oldRole.color).catch(() => {});
        await punish(newRole.guild, executor, reason);
    } catch (e) { console.log(`[roleUpdate ERR] ${e.message}`); }
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    console.log(`[channelCreate] ${channel.name}`);
    try {
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        await channel.delete('Protection').catch(() => {});
        await punish(channel.guild, executor, 'اضافة روم');
    } catch (e) { console.log(`[channelCreate ERR] ${e.message}`); }
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    console.log(`[channelDelete] ${channel.name}`);
    try {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        if (!executor || isIgnored(executor.id)) return;
        const reason = isCategory ? 'حذف كاتوقري' : 'حذف روم';
        const overwrites = channel.permissionOverwrites?.cache?.map((o) => ({
            id: o.id, type: o.type, allow: o.allow, deny: o.deny,
        })) ?? [];
        const createOptions = {
            name: channel.name, type: channel.type, position: channel.rawPosition,
            permissionOverwrites: overwrites, reason: 'Protection',
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
        await channel.guild.channels.create(createOptions).catch((e) => console.log(`[channelDelete create ERR] ${e.message}`));
        await punish(channel.guild, executor, reason);
    } catch (e) { console.log(`[channelDelete ERR] ${e.message}`); }
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
                    if (!oldOw || oldOw.allow.bitfield !== newOw.allow.bitfield || oldOw.deny.bitfield !== newOw.deny.bitfield) {
                        permChanged = true; break;
                    }
                }
            }
        }

        if (!nameChanged && !positionChanged && !permChanged) return;

        if (positionChanged && !nameChanged && !permChanged) {
            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition); return;
            }
            let executorPromise = guildChannelPositionChangePromises.get(newChannel.guild.id);
            if (!executorPromise) {
                executorPromise = getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, null);
                guildChannelPositionChangePromises.set(newChannel.guild.id, executorPromise);
                setTimeout(() => guildChannelPositionChangePromises.delete(newChannel.guild.id), 10000);
            }
            const executor = await executorPromise;
            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition); return;
            }
            if (!executor || isIgnored(executor.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition); return;
            }
            if (botRestoringChannelGuilds.has(newChannel.guild.id)) {
                storedChannelPositions.set(storedKey, newChannel.rawPosition); return;
            }
            botRestoringChannelGuilds.add(newChannel.guild.id);
            setTimeout(() => botRestoringChannelGuilds.delete(newChannel.guild.id), 8000);
            const reason = isCategory ? 'حرك كاتوقري' : 'حرك روم';
            await newChannel.setPosition(storedPosition).catch((e) => console.log(`[channelUpdate setPos ERR] ${e.message}`));
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
    } catch (e) { console.log(`[channelUpdate ERR] ${e.message}`); }
});

client.login(TOKEN);

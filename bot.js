import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
} from 'discord.js';

// ─── Config ────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

// ─── Client ────────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

// ─── Cooldown map (per guild) to avoid duplicate punishments ───────────────
const recentPunishments = new Map();
const COOLDOWN_MS = 3000;

function isPunishmentOnCooldown(guildId, executorId, reason) {
    const key = `${guildId}:${executorId}:${reason}`;
    const last = recentPunishments.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return true;
    recentPunishments.set(key, Date.now());
    return false;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isIgnored(userId) {
    return userId === OWNER_ID || userId === client.user?.id;
}

async function getAuditExecutor(guild, auditLogEvent, targetId = null, delayMs = 1500) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
        const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 5 });
        // Try exact target match first
        let entry = targetId
            ? logs.entries.find((e) => e.target?.id === targetId)
            : null;
        // Fall back to the most recent entry (no time restriction)
        if (!entry) {
            entry = logs.entries.first();
        }
        if (!entry) {
            console.log(`[audit] Audit log empty for event ${auditLogEvent}`);
            return null;
        }
        const age = Math.round((Date.now() - entry.createdTimestamp) / 1000);
        console.log(`[audit] Most recent entry — executor: ${entry.executor?.tag} (${entry.executor?.id}), age: ${age}s`);
        if (age > 30) {
            console.log(`[audit] Entry too old (${age}s), ignoring`);
            return null;
        }
        return entry.executor ?? null;
    } catch (err) {
        console.error(`[audit] Failed to fetch logs:`, err.message);
        return null;
    }
}

async function removeAllRoles(member) {
    const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .map((r) => r.id);
    if (roles.length === 0) {
        console.log(`[roles] ${member.user.tag} has no roles to remove`);
        return;
    }
    console.log(`[roles] Removing ${roles.length} roles from ${member.user.tag}`);
    await member.roles.remove(roles, 'Protection system: unauthorized action').catch((err) => {
        console.error(`[roles] Failed to remove roles:`, err.message);
    });
}

async function sendLog(guild, user, reason) {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) {
        console.error(`[log] Log channel ${LOG_CHANNEL_ID} not found in cache`);
        return;
    }
    const message =
        `@here\n\nperson : <@${user.id}>\n\nthe reason : ${reason}\n\nID : ${user.id}`;
    await channel.send(message).catch((err) => {
        console.error(`[log] Failed to send log message:`, err.message);
    });
}

async function punish(guild, executor, reason) {
    if (isIgnored(executor.id)) {
        console.log(`[punish] Ignoring user ${executor.id} (owner or bot)`);
        return;
    }
    if (isPunishmentOnCooldown(guild.id, executor.id, reason)) {
        console.log(`[punish] Cooldown active for ${executor.id} / ${reason}`);
        return;
    }
    console.log(`[punish] Punishing ${executor.tag} (${executor.id}) for: ${reason}`);
    try {
        const member = await guild.members.fetch(executor.id);
        await Promise.all([
            removeAllRoles(member),
            sendLog(guild, executor, reason),
        ]);
        console.log(`[punish] Done for ${executor.tag}`);
    } catch (err) {
        console.error(`[punish] Error for ${executor.id}:`, err.message);
    }
}

// ─── Role Events ───────────────────────────────────────────────────────────

client.on('roleCreate', async (role) => {
    console.log(`[roleCreate] Role created: ${role.name}`);
    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        if (!executor || isIgnored(executor.id)) return;
        await role.delete('Protection: reverting unauthorized role creation').catch(() => {});
        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch (err) {
        console.error('[roleCreate]', err.message);
    }
});

client.on('roleDelete', async (role) => {
    console.log(`[roleDelete] Role deleted: ${role.name}`);
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
    } catch (err) {
        console.error('[roleDelete]', err.message);
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const positionChanged = oldRole.rawPosition !== newRole.rawPosition;

        if (!nameChanged && !colorChanged && !positionChanged) return;

        console.log(`[roleUpdate] Role "${newRole.name}" changed — name:${nameChanged} color:${colorChanged} pos:${positionChanged}`);

        let reason;
        if (nameChanged) reason = 'تغيير اسم رتبه';
        else if (colorChanged) reason = 'تغيير لون رتبه';
        else reason = 'تغيرر مكان رتبه';

        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        if (!executor || isIgnored(executor.id)) return;

        if (nameChanged) await newRole.setName(oldRole.name, 'Protection: reverting name change').catch(() => {});
        if (colorChanged) await newRole.setColor(oldRole.color, 'Protection: reverting color change').catch(() => {});
        if (positionChanged) {
            await newRole.guild.roles.setPositions([
                { role: newRole.id, position: oldRole.rawPosition },
            ]).catch(() => {});
        }

        await punish(newRole.guild, executor, reason);
    } catch (err) {
        console.error('[roleUpdate]', err.message);
    }
});

// ─── Channel Events ────────────────────────────────────────────────────────

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    console.log(`[channelDelete] Channel deleted: #${channel.name} (${channel.type})`);
    try {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        if (!executor || isIgnored(executor.id)) return;

        const reason = isCategory ? 'حذف كاتوقري' : 'حذف روم';

        const overwrites = channel.permissionOverwrites?.cache?.map((o) => ({
            id: o.id,
            type: o.type,
            allow: o.allow,
            deny: o.deny,
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

        await channel.guild.channels.create(createOptions).catch((err) => {
            console.error('[channelDelete] Failed to recreate channel:', err.message);
        });
        await punish(channel.guild, executor, reason);
    } catch (err) {
        console.error('[channelDelete]', err.message);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    try {
        const isCategory = newChannel.type === ChannelType.GuildCategory;

        const nameChanged = oldChannel.name !== newChannel.name;
        // Use both rawPosition and position to catch all move events
        const positionChanged =
            oldChannel.rawPosition !== newChannel.rawPosition ||
            oldChannel.position !== newChannel.position;

        const oldPerms = oldChannel.permissionOverwrites?.cache;
        const newPerms = newChannel.permissionOverwrites?.cache;
        let permChanged = false;
        let permAdded = false;

        if (oldPerms && newPerms) {
            if (newPerms.size > oldPerms.size) {
                permChanged = true;
                permAdded = true;
            } else if (newPerms.size < oldPerms.size) {
                permChanged = true;
                permAdded = false;
            } else {
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

        console.log(`[channelUpdate] #${newChannel.name} — name:${nameChanged} pos:${positionChanged} perm:${permChanged} category:${isCategory}`);

        let reason;
        if (nameChanged) {
            reason = 'غير اسم روم او شات';
        } else if (positionChanged) {
            reason = isCategory ? 'حرك كاتوقري' : 'حرك روم';
        } else if (permChanged) {
            if (isCategory) {
                reason = permAdded ? 'اضاف رتبه في كاتوقري' : 'حذف رتبه في كاتوقري';
            } else {
                reason = permAdded ? 'اضاف رتبه في روم او شات' : 'حذف رتبه في روم او شات';
            }
        } else {
            return;
        }

        const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        if (!executor || isIgnored(executor.id)) return;

        if (nameChanged) {
            await newChannel.setName(oldChannel.name, 'Protection: reverting name change').catch(() => {});
        }
        if (positionChanged) {
            await newChannel.setPosition(oldChannel.rawPosition, { reason: 'Protection: reverting position change' }).catch((err) => {
                console.error('[channelUpdate] Failed to revert position:', err.message);
            });
        }
        if (permChanged && oldPerms) {
            const oldOverwrites = oldPerms.map((o) => ({
                id: o.id,
                type: o.type,
                allow: o.allow,
                deny: o.deny,
            }));
            await newChannel.permissionOverwrites.set(oldOverwrites, 'Protection: reverting permission change').catch(() => {});
        }

        await punish(newChannel.guild, executor, reason);
    } catch (err) {
        console.error('[channelUpdate]', err.message);
    }
});

// ─── Ready ─────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);
    console.log(`[Bot] Protection system active`);

    // Check required permissions on startup
    for (const guild of client.guilds.cache.values()) {
        const me = await guild.members.fetchMe().catch(() => null);
        if (!me) continue;
        const perms = me.permissions;
        const checks = {
            'VIEW_AUDIT_LOG': perms.has('ViewAuditLog'),
            'MANAGE_ROLES': perms.has('ManageRoles'),
            'MANAGE_CHANNELS': perms.has('ManageChannels'),
            'SEND_MESSAGES': perms.has('SendMessages'),
        };
        console.log(`[Bot] Permissions in "${guild.name}":`, checks);
        const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length > 0) {
            console.warn(`[Bot] ⚠️  MISSING PERMISSIONS: ${missing.join(', ')}`);
        } else {
            console.log(`[Bot] All required permissions present ✓`);
        }
    }
});

// ─── Login ─────────────────────────────────────────────────────────────────

client.login(TOKEN).catch((err) => {
    console.error('[Bot] Login failed:', err.message);
    process.exit(1);
});

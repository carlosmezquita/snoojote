import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { config } from '../../config.js';

/**
 * Checks if a member has administrative or moderation privileges.
 * Privileges include having the Administrator permission, the Mod role, or the Support role.
 */
export function isStaff(member: GuildMember): boolean {
    return (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.roles.cache.has(config.roles.mod) ||
        member.roles.cache.has(config.roles.support)
    );
}

/**
 * Checks if a member is a high-level administrator.
 */
export function isAdmin(member: GuildMember): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator);
}

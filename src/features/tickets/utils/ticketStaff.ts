import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { config } from '../../../config.js';
import { isPlaceholderValue } from '../../../configLoader.js';

export function getTicketStaffRoleIds(extraRoleIds: string[] = []): string[] {
    return uniqueRoleIds([
        config.roles.support,
        config.roles.mod,
        config.roles.ticketManager,
        ...extraRoleIds,
    ]);
}

export function isTicketStaff(member: GuildMember): boolean {
    return (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        getTicketStaffRoleIds().some((roleId) => member.roles.cache.has(roleId))
    );
}

function uniqueRoleIds(roleIds: string[]): string[] {
    return [...new Set(roleIds.filter(isConfiguredRoleId))];
}

function isConfiguredRoleId(roleId: string | undefined): roleId is string {
    if (!roleId) return false;
    return !isPlaceholderValue(roleId);
}

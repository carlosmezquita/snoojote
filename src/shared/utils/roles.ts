import { PermissionFlagsBits, type Role } from 'discord.js';
import { config } from '../../config.js';

// Grant only ordinary participation permissions. New Discord permission flags fail closed.
const participationPermissions =
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.ReadMessageHistory |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.SendMessagesInThreads |
    PermissionFlagsBits.AddReactions |
    PermissionFlagsBits.EmbedLinks |
    PermissionFlagsBits.AttachFiles |
    PermissionFlagsBits.UseExternalEmojis |
    PermissionFlagsBits.UseExternalStickers |
    PermissionFlagsBits.UseApplicationCommands |
    PermissionFlagsBits.Connect |
    PermissionFlagsBits.Speak |
    PermissionFlagsBits.UseVAD |
    PermissionFlagsBits.Stream;

/** Self-service must never grant a configured staff/verification role, even with zero guild permissions. */
export function isSafeSelfAssignableRole(
    role: Pick<Role, 'id' | 'managed' | 'editable' | 'permissions'> | null,
): boolean {
    if (
        !role ||
        role.managed ||
        !role.editable ||
        (role.permissions.bitfield & ~participationPermissions) !== 0n
    )
        return false;
    return ![
        config.guildId,
        config.roles.mod,
        config.roles.support,
        config.roles.ticketManager,
        config.roles.suspect,
    ].includes(role.id);
}

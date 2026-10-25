import { describe, expect, test } from 'bun:test';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { config } from '../src/config.js';
import { isSafeSelfAssignableRole } from '../src/shared/utils/roles.js';

describe('self-service role boundary', () => {
    test('rejects powerful roles and configured staff roles even if the bot could assign them', () => {
        for (const permission of [
            PermissionFlagsBits.Administrator,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ViewAuditLog,
            PermissionFlagsBits.ModerateMembers,
            PermissionFlagsBits.ManageNicknames,
            PermissionFlagsBits.MentionEveryone,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageEvents,
        ]) {
            expect(
                isSafeSelfAssignableRole({
                    id: 'public-role',
                    managed: false,
                    editable: true,
                    permissions: new PermissionsBitField(permission),
                }),
            ).toBe(false);
        }
        expect(
            isSafeSelfAssignableRole({
                id: config.roles.support,
                managed: false,
                editable: true,
                permissions: new PermissionsBitField(0n),
            }),
        ).toBe(false);
        expect(
            isSafeSelfAssignableRole({
                id: 'public-role',
                managed: false,
                editable: true,
                permissions: new PermissionsBitField(0n),
            }),
        ).toBe(true);
    });
});

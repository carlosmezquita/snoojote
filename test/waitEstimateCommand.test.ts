import { describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    ApplicationCommandOptionType,
    Collection,
    PermissionsBitField,
    type EmbedBuilder,
} from 'discord.js';
import db from '../src/database/db.js';
import { ticketWaitEstimateSnapshots } from '../src/database/schema.js';
import { data as ticketCommand, execute } from '../src/features/tickets/commands/ticket.js';
import {
    data as adminCommand,
    execute as executeAdmin,
} from '../src/features/admin/commands/admin.js';
import responseTimeService, {
    ResponseTimeService,
    type WaitEstimateStatus,
} from '../src/features/tickets/services/responseTimeService.js';
import { estimateWaitTime } from '../src/features/tickets/services/waitTimeEstimator.js';
import { createWaitEstimateReport } from '../src/features/tickets/utils/waitEstimateReport.js';

function status(): WaitEstimateStatus {
    return {
        estimate: estimateWaitTime({
            recentTickets: [],
            temporalTickets: [],
            allTickets: [],
            now: new Date(),
            queueLength: 3,
        }),
        queueLength: 3,
        statusBreakdown: {
            online: 0,
            idle: 0,
            dnd: 0,
            busy: 0,
            offline: 0,
            invisible: 0,
            unknown: 0,
        },
        staffProfiles: [],
        missingRoleIds: [],
        staffFetchedAt: Date.now(),
        fromCache: false,
        membershipReady: true,
    };
}

function interaction(admin = true, command = 'wait', details = false) {
    const replies: { content?: string; ephemeral?: boolean }[] = [];
    const edits: ({ embeds?: EmbedBuilder[]; allowedMentions?: { parse: string[] } } | string)[] =
        [];
    let deferredPrivately = false;
    const member = {
        user: { bot: false },
        permissions: new PermissionsBitField(admin ? 8n : 0n),
        roles: { cache: new Collection() },
    };
    const value = {
        guild: { id: randomUUID() },
        member,
        memberPermissions: member.permissions,
        inGuild: () => true,
        channel: null,
        options: { getSubcommand: () => command, getBoolean: () => details },
        reply: async (message: (typeof replies)[number]) => {
            replies.push(message);
        },
        deferReply: async (options: { ephemeral: boolean }) => {
            deferredPrivately = options.ephemeral;
        },
        editReply: async (message: (typeof edits)[number]) => {
            edits.push(message);
        },
    };
    return { value, replies, edits, isPrivate: () => deferredPrivately };
}
const client = { logger: { error: () => {} } };

describe('one wait estimate command', () => {
    test('registers one diagnostic with an optional detailed view, removing both old names', () => {
        const options = ticketCommand.toJSON().options!;
        expect(options.some((option) => option.name === 'waitdebug')).toBe(false);
        const wait = options.find((option) => option.name === 'wait');
        expect(wait?.type).toBe(ApplicationCommandOptionType.Subcommand);
        if (!wait || wait.type !== ApplicationCommandOptionType.Subcommand)
            throw new Error('Expected wait subcommand');
        expect(wait.options).toMatchObject([
            { name: 'details', type: ApplicationCommandOptionType.Boolean, required: false },
        ]);
        expect(
            adminCommand.toJSON().options!.some((option) => option.name === 'ticket-availability'),
        ).toBe(false);
    });

    test('admin preview works outside a ticket and stays private without mass mentions', async () => {
        const report = spyOn(responseTimeService, 'getWaitEstimateStatus').mockResolvedValue(
            status(),
        );
        try {
            for (const details of [false, true]) {
                const i = interaction(true, 'wait', details);
                await execute(i.value as never, client as never);
                expect(i.isPrivate()).toBe(true);
                expect(i.edits[0]).toMatchObject({ allowedMentions: { parse: [] } });
                const result = i.edits[0];
                expect(typeof result === 'object' && result.embeds?.length).toBe(details ? 2 : 1);
            }
            expect(report).toHaveBeenCalledTimes(2);
            expect(report.mock.calls[0][1]).toEqual({ forceRefresh: true });
        } finally {
            report.mockRestore();
        }
    });

    test('non-admin and missing permission snapshots fail closed before loading any diagnostics', async () => {
        const report = spyOn(responseTimeService, 'getWaitEstimateStatus');
        try {
            for (const permissions of [new PermissionsBitField(0n), undefined]) {
                const i = interaction(true); // A stale cached member must not override current interaction permissions.
                Object.assign(i.value, { memberPermissions: permissions });
                await execute(i.value as never, client as never);
                expect(i.replies[0]).toMatchObject({ ephemeral: true });
                expect(i.replies[0].content).toContain('Solo administradores');
                expect(i.edits).toHaveLength(0);
            }
            expect(report).not.toHaveBeenCalled();
        } finally {
            report.mockRestore();
        }
    });

    test('legacy registered names redirect without running duplicate reports', async () => {
        const report = spyOn(responseTimeService, 'getWaitEstimateStatus');
        try {
            const ticket = interaction(true, 'waitdebug');
            const admin = interaction(true, 'ticket-availability');
            await execute(ticket.value as never, client as never);
            await executeAdmin(admin.value as never, client as never);
            for (const i of [ticket, admin]) {
                expect(i.replies[0].content).toContain('/ticket wait');
                expect(i.replies[0].ephemeral).toBe(true);
            }
            expect(report).not.toHaveBeenCalled();
        } finally {
            report.mockRestore();
        }
    });

    test('service errors finish the deferred interaction with a useful response', async () => {
        const report = spyOn(responseTimeService, 'getWaitEstimateStatus').mockRejectedValue(
            new Error('Unavailable'),
        );
        try {
            const i = interaction();
            await execute(i.value as never, client as never);
            expect(i.isPrivate()).toBe(true);
            expect(i.edits).toEqual(['No se pudo consultar el estimador.']);
        } finally {
            report.mockRestore();
        }
    });
});

describe('wait report meaning and bounds', () => {
    test('explains the target, queue and fallback without claiming that presence guarantees availability', () => {
        const value = status();
        value.membershipReady = false;
        value.missingRoleIds = ['123'];
        const [summary, details] = createWaitEstimateReport(value, true).map((embed) =>
            embed.toJSON(),
        );
        expect(summary.description).toContain('primera respuesta');
        expect(summary.description).toContain('ticket ya abierto');
        expect(summary.description).toContain('predeterminada');
        expect(summary.description).toContain('presencias están incompletas');
        expect(summary.description).toContain('roles de staff');
        expect(
            summary.fields!.find((field) => field.name === 'Solicitudes sin respuesta')!.value,
        ).toBe('3');
        expect(
            details.fields!.find((field) => field.name === 'Presencias del gateway')!.value,
        ).toContain('no consulta la disponibilidad real');
    });

    test('large guild lists cannot hide essential factors or exceed Discord embed limits', () => {
        const value = status();
        value.staffProfiles = Array.from({ length: 3000 }, (_, id) => ({
            staffId: `1000000000000${id}`,
            status: 'offline',
        }));
        value.statusBreakdown.offline = 3000;
        value.missingRoleIds = Array.from({ length: 1000 }, (_, id) => `2000000000000${id}`);
        const embeds = createWaitEstimateReport(value, true).map((embed) => embed.toJSON());
        let total = 0;
        for (const embed of embeds) {
            total +=
                (embed.title?.length ?? 0) +
                (embed.description?.length ?? 0) +
                (embed.footer?.text.length ?? 0);
            for (const field of embed.fields ?? []) {
                expect(field.value.length).toBeLessThanOrEqual(1024);
                total += field.name.length + field.value.length;
            }
        }
        expect(total).toBeLessThanOrEqual(6000);
        expect(
            embeds[1].fields!.find((field) => field.name === 'Staff detectado y ponderación')!
                .value,
        ).toContain('más.');
        expect(
            embeds[1].fields!.find((field) => field.name === 'Cálculo y carga')!.value,
        ).toContain('Multiplicador');
    });

    test('sample counts match the valid samples actually used, including the recent cap and temporal minimum', () => {
        const now = new Date();
        const valid = Array.from({ length: 25 }, (_, i) => ({
            createdAt: new Date(now.getTime() - (i + 1) * 10000),
            firstResponseAt: now,
        }));
        const invalid = { createdAt: now, firstResponseAt: now };
        const estimate = estimateWaitTime({
            recentTickets: [...valid, invalid],
            temporalTickets: [valid[0], valid[1], invalid],
            allTickets: [...valid, invalid],
            now,
            queueLength: 0,
        });
        expect(estimate.factors.sampleCounts).toEqual({ recent: 20, temporal: 2, global: 25 });
        expect(estimate.factors.temporalMedianMs).toBeNull();
    });
});

describe('consistent diagnostic inputs', () => {
    test('uses exactly one capacity and queue snapshot and never records an issued forecast', async () => {
        const service = new ResponseTimeService();
        const members = new Collection([
            [
                'staff',
                {
                    id: 'staff',
                    user: { bot: false },
                    permissions: new PermissionsBitField(8n),
                    roles: { cache: new Collection() },
                    presence: { status: 'online' },
                },
            ],
        ]);
        const guild = {
            id: randomUUID(),
            roles: { cache: new Collection() },
            presences: { cache: new Collection() },
            members: { cache: members, fetch: async () => members },
        };
        const capacity = await service.getStaffCapacity(guild as never);
        const staff = spyOn(service, 'getStaffCapacity').mockResolvedValue(capacity);
        const queue = spyOn(service, 'getUnansweredQueueLength').mockResolvedValue(3);
        const before = db.select().from(ticketWaitEstimateSnapshots).all().length;
        try {
            const report = await service.getWaitEstimateStatus(guild as never, {
                forceRefresh: true,
            });
            expect(staff).toHaveBeenCalledTimes(1);
            expect(staff).toHaveBeenCalledWith(guild, { forceRefresh: true });
            expect(queue).toHaveBeenCalledTimes(1);
            expect(report.queueLength).toBe(3);
            expect(report.estimate.factors.currentStaffCapacity).toBe(1);
            expect(report.estimate.factors.currentLoad).toBe(4);
            expect(report.staffFetchedAt).toBe(capacity.fetchedAt);
            expect(report.membershipReady).toBe(true);
            expect(db.select().from(ticketWaitEstimateSnapshots).all().length).toBe(before);
        } finally {
            staff.mockRestore();
            queue.mockRestore();
            service.invalidateGuild(guild.id);
        }
    });

    test('failed membership bootstrap is explicitly reported and cached backoff remains visible', async () => {
        const service = new ResponseTimeService();
        let fetches = 0;
        const guild = {
            id: randomUUID(),
            members: {
                fetch: async () => {
                    fetches++;
                    throw new Error('Unavailable');
                },
            },
        };
        try {
            const first = await service.getWaitEstimateStatus(guild as never, {
                forceRefresh: true,
            });
            const second = await service.getWaitEstimateStatus(guild as never, {
                forceRefresh: true,
            });
            expect(first.membershipReady).toBe(false);
            expect(second.membershipReady).toBe(false);
            expect(second.fromCache).toBe(true);
            expect(fetches).toBe(1);
        } finally {
            service.invalidateGuild(guild.id);
        }
    });
});

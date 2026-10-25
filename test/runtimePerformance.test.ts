import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { Collection } from 'discord.js';
import { config } from '../src/config.js';
import { Cooldown } from '../src/shared/services/Cooldown.js';
import { SingleFlight } from '../src/shared/services/SingleFlight.js';
import { SerialQueue } from '../src/shared/services/SerialQueue.js';
import { ResponseTimeService } from '../src/features/tickets/services/responseTimeService.js';

describe('bounded async work', () => {
    test('cooldowns reserve synchronously and memory stays bounded', () => {
        const cooldown = new Cooldown(2);
        expect(cooldown.acquire('a', 1000, 0)).toBe(true);
        expect(cooldown.acquire('a', 1000, 0)).toBe(false);
        expect(cooldown.acquire('b', 1000, 0)).toBe(true);
        expect(cooldown.acquire('c', 1000, 0)).toBe(false);
        expect(cooldown.size).toBe(2);
        expect(cooldown.acquire('c', 1000, 1000)).toBe(true);
        expect(cooldown.size).toBe(1);
    });

    test('single-flight coalesces requests and permits retries after failures', async () => {
        const flight = new SingleFlight<string, number>();
        let calls = 0;
        const results = await Promise.all(
            Array.from({ length: 100 }, () => flight.run('guild', async () => ++calls)),
        );
        expect(calls).toBe(1);
        expect(results.every((result) => result === 1)).toBe(true);
        await expect(
            flight.run('guild', async () => {
                throw new Error('temporary');
            }),
        ).rejects.toThrow();
        expect(await flight.run('guild', async () => ++calls)).toBe(2);
    });

    test('per-key mutations are ordered and rejection does not poison the queue', async () => {
        const queue = new SerialQueue();
        const order: number[] = [];
        const jobs = Array.from({ length: 100 }, (_, i) =>
            queue.run('resource', async () => {
                await Promise.resolve();
                order.push(i);
                if (i === 5) throw new Error('test failure');
            }),
        );
        await Promise.allSettled(jobs);
        expect(order).toEqual(Array.from({ length: 100 }, (_, i) => i));
        expect(queue.size).toBe(0);
        expect(await queue.run('resource', async () => 'recovered')).toBe('recovered');
    });
});

const supportRole = config.roles.support;
afterEach(() => {
    config.roles.support = supportRole;
});
describe('staff availability in a 3,000-member guild', () => {
    test('100 concurrent requests bootstrap membership once and refresh presence without refetching', async () => {
        config.roles.support = '100000000000000001';
        const members = new Collection<string, any>();
        let checks = 0;
        for (let i = 0; i < 3000; i++)
            members.set(String(i), {
                id: String(i),
                user: { bot: false },
                roles: { cache: new Collection(i < 30 ? [[config.roles.support, {}]] : []) },
                permissions: {
                    has: () => {
                        checks++;
                        return false;
                    },
                },
                presence: { status: 'online' },
            });
        let fetches = 0;
        const guild = {
            id: randomUUID(),
            roles: { cache: new Collection([[config.roles.support, {}]]) },
            presences: { cache: new Collection() },
            members: {
                cache: members,
                fetch: async () => {
                    fetches++;
                    await Promise.resolve();
                    return members;
                },
            },
        };
        const service = new ResponseTimeService();
        const results = await Promise.all(
            Array.from({ length: 100 }, () =>
                service.getStaffCapacity(guild as never, { forceRefresh: true }),
            ),
        );
        expect(fetches).toBe(1);
        expect(results.every((result) => result.activeCount === 30)).toBe(true);
        expect(checks).toBe(3000);
        members.get('0').presence.status = 'offline';
        expect(
            (await service.getStaffCapacity(guild as never, { forceRefresh: true })).activeCount,
        ).toBe(29);
        expect(fetches).toBe(1);
    });

    test('failed bootstraps back off even when refresh is requested', async () => {
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
        const service = new ResponseTimeService();
        await Promise.all(
            Array.from({ length: 50 }, () =>
                service.getStaffCapacity(guild as never, { forceRefresh: true }),
            ),
        );
        await service.getStaffCapacity(guild as never, { forceRefresh: true });
        expect(fetches).toBe(1);
    });
});

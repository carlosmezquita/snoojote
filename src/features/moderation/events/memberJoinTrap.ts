import { sqlite } from '../../../database/db.js';
import { membershipKey } from '../services/verificationJournal.js';
import { serveOnce } from '../../../core/restartDispatch.js';
import { Events, type GuildMember, Collection } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';
import verificationService from '../services/VerificationService.js';

import { youngAccountMs } from '../services/standbyQuarantine.js';

export const name = Events.GuildMemberAdd;
export const once = false;

export const execute = async (member: GuildMember, client: DiscordBot) => {
    await observeJoin(member, client);
    const accountAgeMs = (member.joinedTimestamp ?? Date.now()) - member.user.createdTimestamp;
    if (accountAgeMs <= youngAccountMs)
        await verificationService.handleMemberJoin(member, client, accountAgeMs);
};

export const observeJoin = async (member: GuildMember, client: DiscordBot) =>
    serveOnce('join:' + membershipKey(member), async () => {
        const guild = member.guild;
        // Invite attribution is optional; a missing ManageGuild permission must not bypass verification.
        let usedInvite: { code: string } | undefined;
        try {
            const newInvites = await guild.invites.fetch();
            sqlite
                .transaction(() => {
                    const cachedInvites = inviteCache.get(guild.id);
                    const changed = cachedInvites
                        ? newInvites.filter(
                              (inv) => (inv.uses ?? 0) > (cachedInvites.get(inv.code) ?? 0),
                          )
                        : null;
                    const candidate = changed?.size === 1 ? changed.first() : undefined;
                    if (
                        candidate &&
                        cachedInvites?.has(candidate.code) &&
                        candidate.uses === cachedInvites.get(candidate.code)! + 1
                    )
                        usedInvite = candidate;
                    inviteCache.set(
                        guild.id,
                        new Collection(
                            newInvites.map((inv) => [
                                inv.code,
                                Math.max(cachedInvites?.get(inv.code) ?? 0, inv.uses ?? 0),
                            ]),
                        ),
                    );
                })
                .immediate();
        } catch (error) {
            client.logger.warn('Invite attribution unavailable', { guildId: guild.id, error });
        }

        client.logger.info('Guild member joined', {
            userId: member.id,
            userTag: member.user.tag,
            guildId: guild.id,
            guildName: guild.name,
            inviteCode: usedInvite?.code ?? 'unknown',
        });

        const accountAgeMs = (member.joinedTimestamp ?? Date.now()) - member.user.createdTimestamp;
        if (accountAgeMs > youngAccountMs) {
            client.emit('guildMemberVerified', member);
            return;
        }
    });

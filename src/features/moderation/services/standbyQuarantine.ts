import type { GuildMember } from 'discord.js';
import { config } from '../../../config.js';
import { membershipKey, readVerification, reserveVerification } from './verificationJournal.js';

export const youngAccountMs = 90 * 86_400_000;

export async function quarantineJoin(member: GuildMember) {
    const joined = member.joinedTimestamp;
    if (!joined || joined - member.user.createdTimestamp > youngAccountMs) return;
    const key = membershipKey(member);
    // Never replace a main-owned challenge or reopen a completed membership.
    if (!reserveVerification(key)) {
        const row = readVerification(key);
        if (
            row?.status !== 'pending' ||
            row.challenge ||
            member.roles.cache.has(config.roles.suspect)
        )
            return;
    }
    await member.roles.add(config.roles.suspect);
    // A delayed REST response may overlap a completed CAPTCHA on the primary.
    if (readVerification(key)?.status === 'completed') {
        const current = await member.guild.members.fetch({ user: member.id, force: true });
        if (membershipKey(current) === key && readVerification(key)?.status === 'completed')
            await current.roles.remove(config.roles.suspect);
    }
}

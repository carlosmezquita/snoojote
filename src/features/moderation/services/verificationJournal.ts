import { eq } from 'drizzle-orm';
import type { GuildMember } from 'discord.js';
import db from '../../../database/db.js';
import { verificationCheckpoint, verificationJournal } from '../../../database/schema.js';
import type { VerificationState } from '../types/verification.js';

export function membershipKey(member: GuildMember) {
    return JSON.stringify([member.guild.id, member.id, member.joinedTimestamp]);
}

export function pendingMemberships() {
    return new Set(
        db
            .select({ key: verificationJournal.membership })
            .from(verificationJournal)
            .where(eq(verificationJournal.status, 'pending'))
            .all()
            .map((row) => row.key),
    );
}

export function discardVerification(key: string) {
    db.delete(verificationJournal).where(eq(verificationJournal.membership, key)).run();
}

export function readVerification(key: string) {
    return db
        .select()
        .from(verificationJournal)
        .where(eq(verificationJournal.membership, key))
        .get();
}

export function saveVerification(key: string, state?: VerificationState, completed = false) {
    const status = completed ? ('completed' as const) : ('pending' as const);
    const challenge = state
        ? JSON.stringify({
              guildId: state.guildId,
              channelId: state.channelId,
              mainMsgId: state.mainMsgId,
              challengeId: state.challengeId,
              answer: state.answer,
              expiresAt: state.expiresAt,
              attempts: state.attempts,
              warningMsgId: state.warningMsgId,
          })
        : null;
    db.insert(verificationJournal)
        .values({ membership: key, status, challenge })
        .onConflictDoUpdate({ target: verificationJournal.membership, set: { status, challenge } })
        .run();
}

export function lastObserved(guildId: string) {
    return db
        .select()
        .from(verificationCheckpoint)
        .where(eq(verificationCheckpoint.guildId, guildId))
        .get()?.observedAt;
}

export function checkpoint(guildId: string, observedAt: number) {
    db.insert(verificationCheckpoint)
        .values({ guildId, observedAt })
        .onConflictDoUpdate({ target: verificationCheckpoint.guildId, set: { observedAt } })
        .run();
}

import {
    Events,
    type Client,
    type MessageReaction,
    type PartialMessageReaction,
    type User,
    type PartialUser,
} from 'discord.js';
import { sqlite } from '../../../database/db.js';
import { config } from '../../../config.js';
import logger from '../../../utils/logger.js';
import { StarboardService } from './StarboardService.js';

export function queueReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) {
    const source = reaction.message;
    if (
        user.bot ||
        source.guildId !== config.guildId ||
        !config.starboard.emojis.includes(reaction.emoji.name ?? '')
    )
        return;
    sqlite.run(
        'INSERT INTO starboard_refresh(message_id,channel_id,revision,due) VALUES(?,?,1,?) ON CONFLICT(message_id) DO UPDATE SET revision=revision+1,due=excluded.due',
        [source.id, source.channelId, Date.now()],
    );
}
export function listenForReactions(client: Client) {
    client.on(Events.MessageReactionAdd, queueReaction);
    client.on(Events.MessageReactionRemove, queueReaction);
}
export function startStarboardRefresh(client: Client) {
    let busy = false;
    const tick = async () => {
        if (busy || !client.isReady()) return;
        busy = true;
        try {
            await flushStarboard(client);
        } finally {
            busy = false;
        }
    };
    const run = () =>
        void tick().catch((error) => logger.error('Starboard queue failed', { error }));
    run();
    setInterval(run, 1000).unref();
}

export async function flushStarboard(client: Client) {
    const rows = sqlite
        .query<{ message_id: string; channel_id: string; revision: number }, [number]>(
            'SELECT message_id,channel_id,revision FROM starboard_refresh WHERE due<=? ORDER BY due LIMIT 25',
        )
        .all(Date.now());
    for (const row of rows) {
        try {
            const channel = await client.channels.fetch(row.channel_id);
            if (
                channel &&
                'guildId' in channel &&
                channel.guildId === config.guildId &&
                channel.isTextBased()
            ) {
                const msg = await channel.messages.fetch({
                    message: row.message_id,
                    force: true,
                    cache: false,
                });
                await StarboardService.handleReactionUpdate(msg);
            }
        } catch (error) {
            const missing =
                error &&
                typeof error === 'object' &&
                'code' in error &&
                [10003, 10008].includes(Number(error.code));
            if (!missing) {
                sqlite.run('UPDATE starboard_refresh SET due=? WHERE message_id=? AND revision=?', [
                    Date.now() + 60_000,
                    row.message_id,
                    row.revision,
                ]);
                logger.warn('Starboard refresh will retry', {
                    messageId: row.message_id,
                    error,
                });
                continue;
            }
        }
        sqlite.run('DELETE FROM starboard_refresh WHERE message_id=? AND revision=?', [
            row.message_id,
            row.revision,
        ]);
    }
}

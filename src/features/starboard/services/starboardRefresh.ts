import {
    Events,
    Routes,
    type APIMessage,
    type Message,
    type PartialMessage,
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
    queueMessage(source);
}

export function queueMessage(source: Message | PartialMessage) {
    if (source.guildId !== config.guildId || source.channelId === config.channels.starboard) return;
    sqlite.run(
        'INSERT INTO starboard_refresh(message_id,channel_id,revision,due) VALUES(?,?,1,?) ON CONFLICT(message_id) DO UPDATE SET revision=revision+1,due=excluded.due',
        [source.id, source.channelId, Date.now()],
    );
}
export function listenForReactions(client: Client) {
    client.on(Events.MessageReactionAdd, queueReaction);
    client.on(Events.MessageReactionRemove, queueReaction);
    client.on(Events.MessageReactionRemoveAll, queueMessage);
    client.on(Events.MessageReactionRemoveEmoji, queueRemovedEmoji);
}
export function queueRemovedEmoji(reaction: MessageReaction | PartialMessageReaction) {
    if (config.starboard.emojis.includes(reaction.emoji.name ?? '')) queueMessage(reaction.message);
}
export function queueMappedMessages() {
    sqlite.run(
        'INSERT INTO starboard_refresh(message_id,channel_id,revision,due) SELECT original_message_id,original_channel_id,1,0 FROM starboard_messages WHERE true ON CONFLICT(message_id) DO NOTHING',
    );
}
export function startStarboardRefresh(client: Client) {
    queueMappedMessages();
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
        let readingSource = true;
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
                // A cache:false fetch can inherit the old ReactionManager when
                // Discord omits reactions after the last removal. Check the raw
                // response in that case instead of publishing its cached count.
                const counts =
                    msg.reactions && msg.reactions.message !== msg
                        ? ((
                              (await client.rest.get(
                                  Routes.channelMessage(row.channel_id, row.message_id),
                              )) as APIMessage
                          ).reactions ?? [])
                        : undefined;
                readingSource = false;
                await StarboardService.handleReactionUpdate(msg, counts);
            }
        } catch (error) {
            const missing =
                error &&
                typeof error === 'object' &&
                'code' in error &&
                [10003, 10008].includes(Number(error.code));
            if (!readingSource || !missing) {
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

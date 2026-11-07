import { serveOnce } from '../../../core/restartDispatch.js';
import { membershipKey } from '../../moderation/services/verificationJournal.js';
import { type GuildMember, EmbedBuilder, type TextChannel } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

import { config } from '../../../config.js';

const WELCOME_CHANNEL_ID = config.channels.welcome;

export const name = 'guildMemberVerified';
export const once = false;

export const execute = async (member: GuildMember, client: DiscordBot) =>
    serveOnce(
        'welcome:' + membershipKey(member),
        async () => {
            const { user, guild } = member;
            const username = user.username.replace(/_/g, '\\_'); // Escape underscores

            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x8386ff)
                .setAuthor({
                    name: `Nuevo Usuario (${guild.memberCount})`,
                    iconURL:
                        'https://raw.githubusercontent.com/carlosmezquita/open-ticket/137b27f6b3b8a4a1fc34119ab001ed704d8a3ca4/storage/media/new_user.png',
                })
                .setTitle('¡Bienvenido al servidor de r/Spain!')
                .setDescription(
                    `Damos la bienvenida a **${username}** al Discord de r/Spain, ¡gracias por unirte!\n_We welcome **${username}** to the r/Spain Discord, thanks for joining!_`,
                )
                .setThumbnail(user.displayAvatarURL())
                .setFooter({
                    text: 'Staff',
                    iconURL:
                        'https://media.discordapp.net/attachments/298140651676237824/1051478405897527316/rspainupscaled.png',
                })
                .setTimestamp();

            try {
                const channel = (await client.channels.fetch(WELCOME_CHANNEL_ID)) as TextChannel;
                if (channel) {
                    const msg = await channel.send({
                        embeds: [welcomeEmbed],
                        nonce:
                            'w:' +
                            BigInt(member.id).toString(36) +
                            ':' +
                            (member.joinedTimestamp ?? 0).toString(36),
                        enforceNonce: true,
                    });
                    await msg.react('👋');
                }
            } catch (error) {
                client.logger.error(`Welcome Error: ${error}`);
            }
        },
        { followup: true },
    );

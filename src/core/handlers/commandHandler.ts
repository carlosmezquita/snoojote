import { glob } from 'glob';
import { type DiscordBot } from '../client.js';
import { type ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { type Command } from '../contracts.js';
import { config } from '../../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (client: DiscordBot) => {
    const handlerPath = path.join(__dirname, '../../features');
    // Use forward slashes for glob pattern to ensure cross-platform compatibility
    const pattern = `${handlerPath.replace(/\\/g, '/')}/**/commands/*.{ts,js}`;
    const commandFiles = await glob(pattern);

    for (const file of commandFiles) {
        const fileUrl = pathToFileURL(file).href;
        const command = await import(fileUrl);
        // Handle both default export and named export, or just default
        const cmd = command.default || command;

        if (
            typeof cmd.data?.name === 'string' &&
            typeof cmd.data.toJSON === 'function' &&
            typeof cmd.execute === 'function'
        ) {
            if (
                cmd.permissionLevel !== undefined &&
                !['admin', 'staff'].includes(cmd.permissionLevel)
            )
                throw new Error(`Invalid command permission level: ${file}`);
            if (client.commands.has(cmd.data.name))
                throw new Error(`Duplicate command: ${cmd.data.name}`);
            client.commands.set(cmd.data.name, cmd as Command);
            client.logger.debug('Loaded command handler', { command: cmd.data.name });

            if (cmd.aliases && Array.isArray(cmd.aliases)) {
                for (const alias of cmd.aliases) {
                    if (client.commands.has(alias))
                        throw new Error(`Duplicate command alias: ${alias}`);
                    client.commands.set(alias, cmd as Command);
                    client.logger.debug('Loaded command alias', { alias, original: cmd.data.name });
                }
            }
        } else {
            throw new Error(`Invalid command module: ${file}`);
        }
    }

    client.on('interactionCreate', (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        void executeCommand(interaction, client);
    });
};

export async function executeCommand(
    interaction: ChatInputCommandInteraction,
    client: DiscordBot,
): Promise<void> {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
        if (!interaction.inGuild() || (config.guildId && interaction.guildId !== config.guildId)) {
            await interaction.reply({
                content: 'Este comando solo está disponible en el servidor configurado.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const administrator =
            interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
        const roles = interaction.member?.roles;
        const roleIds = Array.isArray(roles) ? roles : [...(roles?.cache.keys() ?? [])];
        const staff =
            administrator ||
            [config.roles.mod, config.roles.support].some((roleId) => roleIds.includes(roleId));
        if (
            (command.permissionLevel === 'admin' && !administrator) ||
            (command.permissionLevel === 'staff' && !staff)
        ) {
            await interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await command.execute(interaction, client);
    } catch (error) {
        client.logger.error('Command execution failed', {
            command: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            error,
        });
        try {
            if (interaction.deferred)
                await interaction.editReply({
                    content: 'No se pudo completar la acción.',
                    components: [],
                    embeds: [],
                });
            else if (interaction.replied)
                await interaction.followUp({
                    content: 'No se pudo completar la acción.',
                    flags: MessageFlags.Ephemeral,
                });
            else
                await interaction.reply({
                    content: 'No se pudo completar la acción.',
                    flags: MessageFlags.Ephemeral,
                });
        } catch (replyError) {
            client.logger.warn('Failed to send command error response', {
                command: interaction.commandName,
                error: replyError,
            });
        }
    }
}

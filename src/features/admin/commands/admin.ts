import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { postDailyWord } from '../../dailyWord/events/dailyWord.js';

export const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Comandos administrativos')
    .addStringOption(option =>
        option.setName('accion')
            .setDescription('Selecciona la acción a realizar')
            .setRequired(true)
            .addChoices(
                { name: 'Forzar Palabra del Día', value: 'force-daily-word' }
            )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // Check for admin roles (Mod or Support as defined in config)
    const rolesCache = (interaction.member?.roles as any).cache;
    const hasRole = rolesCache.has(config.roles.mod) || rolesCache.has(config.roles.support);

    if (!hasRole && !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({
            content: 'No tienes permiso para usar este comando.',
            ephemeral: true
        });
        return;
    }

    const action = interaction.options.getString('accion', true);

    if (action === 'force-daily-word') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const word = await postDailyWord(client);
            await interaction.editReply({
                content: `✅ Se ha publicado la Palabra del Día: **${word}**`
            });
        } catch (error) {
            client.logger.error(`Admin Force Word Error: ${error}`);
            await interaction.editReply({
                content: `❌ Error al publicar la Palabra del Día. Revisa los logs.`
            });
        }
    }
};

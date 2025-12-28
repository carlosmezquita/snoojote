import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DMService } from '../../../shared/services/DMService.js';

export const data = new SlashCommandBuilder()
    .setName('testwelcome')
    .setDescription('Test the Welcome DM');

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const username = interaction.user.username.replace(/_/g, "\\_");

    const sent = await DMService.sendGift(
        interaction.user,
        "Welcome to r/Spain!",
        `Damos la bienvenida a **${username}** al Discord de r/Spain, ¡gracias por unirte!\n_We welcome **${username}** to the r/Spain Discord, thanks for joining!_`
    );

    if (sent) {
        await interaction.editReply(`✅ Welcome DM sent!`);
    } else {
        await interaction.editReply(`❌ Failed to send DM.`);
    }
}

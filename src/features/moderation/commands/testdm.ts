import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DMService, DMType } from '../../../shared/services/DMService.js';

export const data = new SlashCommandBuilder()
    .setName('testdm')
    .setDescription('Test the DM Service')
    .addStringOption(option =>
        option.setName('type')
            .setDescription('The type of DM to send')
            .setRequired(true)
            .addChoices(
                { name: 'Info', value: DMType.Info },
                { name: 'Success', value: DMType.Success },
                { name: 'Warning', value: DMType.Warning },
                { name: 'Sanction', value: DMType.Sanction },
                { name: 'Gift', value: DMType.Gift },
                { name: 'Neutral', value: DMType.Neutral }
            )
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const type = interaction.options.getString('type') as DMType;

    await interaction.deferReply({ ephemeral: true });

    const sent = await DMService.send({
        user: interaction.user,
        type: type,
        title: `Test DM: ${type}`,
        description: `This is a test message for the **${type}** notification type.`,
        footer: 'Snoojote Test System'
    });

    if (sent) {
        await interaction.editReply(`✅ Sent a **${type}** DM to you! Check your direct messages.`);
    } else {
        await interaction.editReply(`❌ Failed to send DM. Your DMs might be closed.`);
    }
}

import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';

export const data = new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Transfiere pesetas a otro usuario.')
    .addUserOption((option) =>
        option.setName('user').setDescription('Usuario al que quieres pagar').setRequired(true),
    )
    .addIntegerOption((option) =>
        option
            .setName('amount')
            .setDescription('Cantidad que quieres pagar')
            .setMinValue(1)
            .setRequired(true),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (!target || !amount) return;

    if (target.id === interaction.user.id) {
        await interaction.reply({ content: 'No puedes pagarte a ti mismo.', ephemeral: true });
        return;
    }

    if (target.bot) {
        await interaction.reply({ content: 'No puedes pagar a bots.', ephemeral: true });
        return;
    }

    const success = await economyService.transfer(interaction.user.id, target.id, amount);

    if (success) {
        await interaction.reply(`✅ Has transferido **${amount}** ₧ a ${target.toString()}.`);
    } else {
        await interaction.reply({ content: '❌ No tienes suficientes pesetas.', ephemeral: true });
    }
};

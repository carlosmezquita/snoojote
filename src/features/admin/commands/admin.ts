import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    PermissionsBitField,
    type GuildMember,
    type User,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { postDailyWord } from '../../dailyWord/events/dailyWord.js';
import economyService from '../../economy/services/economyService.js';

import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Comandos administrativos')
    .addSubcommand((subcommand) =>
        subcommand.setName('force-daily-word').setDescription('Publica la Palabra del Día ahora.'),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('pay')
            .setDescription('Añade pesetas a un usuario.')
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Usuario que recibirá las pesetas')
                    .setRequired(true),
            )
            .addIntegerOption((option) =>
                option
                    .setName('amount')
                    .setDescription('Cantidad de pesetas a añadir')
                    .setMinValue(1)
                    .setRequired(true),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('charge')
            .setDescription('Quita pesetas a un usuario.')
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription('Usuario al que se le quitarán pesetas')
                    .setRequired(true),
            )
            .addIntegerOption((option) =>
                option
                    .setName('amount')
                    .setDescription('Cantidad de pesetas a quitar')
                    .setMinValue(1)
                    .setRequired(true),
            ),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: 'Este comando solo puede usarse en un servidor.',
            ephemeral: true,
        });
        return;
    }

    const member =
        (interaction.member as GuildMember) ||
        (await interaction.guild!.members.fetch(interaction.user.id));

    if (!isStaff(member)) {
        await interaction.reply({
            content: 'No tienes permiso para usar este comando.',
            ephemeral: true,
        });
        return;
    }

    const action = interaction.options.getSubcommand(true);

    if (action === 'force-daily-word') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const word = await postDailyWord(client);
            await interaction.editReply({
                content: `✅ Se ha publicado la Palabra del Día: **${word}**`,
            });
        } catch (error) {
            client.logger.error(`Admin Force Word Error: ${error}`);
            await interaction.editReply({
                content: `❌ Error al publicar la Palabra del Día. Revisa los logs.`,
            });
        }
        return;
    }

    if (action === 'pay') {
        await handleAdminPay(interaction);
        return;
    }

    if (action === 'charge') {
        await handleAdminCharge(interaction);
    }
};

async function handleAdminPay(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    if (await rejectInvalidEconomyTarget(interaction, target)) return;

    await economyService.addBalance(target.id, amount);
    const balance = await economyService.getBalance(target.id);

    await interaction.reply({
        content: `✅ Se han añadido **${amount}** ₧ a ${target.toString()}. Saldo actual: **${balance}** ₧.`,
        ephemeral: true,
    });
}

async function handleAdminCharge(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    if (await rejectInvalidEconomyTarget(interaction, target)) return;

    const success = await economyService.spendBalance(target.id, amount);
    if (!success) {
        const balance = await economyService.getBalance(target.id);
        await interaction.reply({
            content: `❌ ${target.toString()} no tiene suficientes pesetas. Saldo actual: **${balance}** ₧.`,
            ephemeral: true,
        });
        return;
    }

    const balance = await economyService.getBalance(target.id);
    await interaction.reply({
        content: `✅ Se han quitado **${amount}** ₧ a ${target.toString()}. Saldo actual: **${balance}** ₧.`,
        ephemeral: true,
    });
}

async function rejectInvalidEconomyTarget(
    interaction: ChatInputCommandInteraction,
    target: User,
): Promise<boolean> {
    if (target.bot) {
        await interaction.reply({
            content: 'No puedes modificar el saldo de bots.',
            ephemeral: true,
        });
        return true;
    }

    return false;
}

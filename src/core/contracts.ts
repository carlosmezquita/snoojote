import {
    type ChatInputCommandInteraction,
    type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { type DiscordBot } from './client.js';

export interface Command {
    data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
    execute(interaction: ChatInputCommandInteraction, client: DiscordBot): unknown;
    aliases?: string[];
    permissionLevel?: 'admin' | 'staff';
}

export interface BotEvent {
    name: string;
    once?: boolean;
    // Runtime validation is required at the dynamic import boundary.
    execute: (...args: unknown[]) => unknown;
}

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const shopItemSchema = z.object({
    name: z.string().min(1).max(60),
    description: z.string().min(1).max(120),
    price: z.number().int().positive(),
    type: z.enum(['ROLE', 'COLLECTIBLE', 'CONSUMABLE']),
    value: z.string().min(1),
    emoji: z.string().min(1).max(16).optional(),
    rankOrder: z.number().int().positive().optional(),
});

const botConfigSchema = z.object({
    discord: z.object({
        clientId: z.string().min(1),
        guildId: z.string().min(1).optional(),
    }),
    channels: z.object({
        main: z.string().min(1),
        alerts: z.string().min(1),
        streaks: z.string().min(1),
        bot: z.string().min(1),
        logs: z.string().min(1),
        welcome: z.string().min(1),
        verifierCategory: z.string().min(1),
        ticketCategory: z.string().min(1),
        starboard: z.string().min(1),
        ai: z.string().min(1),
        wordOfTheDay: z.string().min(1),
        transcripts: z.string().min(1).optional(),
    }),
    roles: z.object({
        dailyPing: z.string().min(1),
        suspect: z.string().min(1),
        mod: z.string().min(1),
        support: z.string().min(1),
        ticketManager: z.string().min(1),
        rPlace: z.string().min(1),
        linkWhitelist: z.array(z.string().min(1)),
    }),
    links: z.object({
        whitelist: z.array(z.string().min(1)),
    }),
    starboard: z.object({
        emojis: z.array(z.string().min(1)).min(1),
        minReactions: z.number().int().positive(),
    }),
    tickets: z.object({
        maxOpenPerUser: z.number().int().positive(),
    }),
    streaks: z.object({
        channelIds: z.array(z.string().min(1)).min(1),
        gracePeriodHours: z.number().positive(),
    }),
    ai: z.object({
        model: z.string().min(1),
        maxTokens: z.number().int().positive(),
        temperature: z.number().min(0).max(2),
        systemPrompt: z.string().min(1),
        cooldownSeconds: z.number().int().min(5).max(3600).default(30),
        maxConcurrent: z.number().int().min(1).max(10).default(2),
        timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
        contextCharacters: z.number().int().min(2000).max(32_000).default(12_000),
    }),
    economy: z.object({
        messageRewards: z.object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
            cooldownSeconds: z.number().int().positive(),
            dailyCap: z.number().int().positive(),
        }),
        voiceRewards: z.object({
            perMinute: z.number().int().positive(),
            dailyCap: z.number().int().positive(),
        }),
        questExcludedChannelIds: z.array(z.string().min(1)).default([]),
        dailyReward: z.object({
            base: z.number().int().nonnegative(),
            perStreakDay: z.number().int().nonnegative(),
            max: z.number().int().positive(),
        }),
        milestoneBonuses: z.record(z.string(), z.number().int().nonnegative()),
        shopCatalog: z.array(shopItemSchema).min(1).max(25),
    }),
});

export type RuntimeBotConfig = z.infer<typeof botConfigSchema>;
export type RuntimeShopItemConfig = z.infer<typeof shopItemSchema>;

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'bot.config.json');
export const DEFAULT_EXAMPLE_CONFIG_PATH = path.join(
    process.cwd(),
    'config',
    'bot.config.example.json',
);

interface LoadBotConfigOptions {
    configPath?: string;
    examplePath?: string;
    validatePlaceholders?: boolean;
}

export function loadBotConfig(options: LoadBotConfigOptions = {}): RuntimeBotConfig {
    const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
    const examplePath = options.examplePath ?? DEFAULT_EXAMPLE_CONFIG_PATH;
    const validatePlaceholders = options.validatePlaceholders ?? true;

    ensureConfigFile(configPath, examplePath);

    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    const parsed = botConfigSchema
        .superRefine((config, ctx) => {
            const names = config.economy.shopCatalog.map((item) => item.name);
            const ranks = config.economy.shopCatalog
                .filter((item) => item.type === 'ROLE')
                .map((item) => item.rankOrder)
                .sort((a, b) => (a ?? 0) - (b ?? 0));
            if (
                new Set(names).size !== names.length ||
                ranks.some((rank, index) => rank !== index + 1)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['economy', 'shopCatalog'],
                    message:
                        'Catalog names must be unique and role ranks must be consecutive starting at 1',
                });
            }
            if (validatePlaceholders && !config.discord.guildId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['discord', 'guildId'],
                    message: 'guildId is required for this single-guild bot',
                });
            }
            if (config.economy.messageRewards.max < config.economy.messageRewards.min) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['economy', 'messageRewards', 'max'],
                    message:
                        'messageRewards.max must be greater than or equal to messageRewards.min',
                });
            }

            if (config.economy.dailyReward.max < config.economy.dailyReward.base) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['economy', 'dailyReward', 'max'],
                    message: 'dailyReward.max must be greater than or equal to dailyReward.base',
                });
            }

            const rankOrders = config.economy.shopCatalog
                .filter((item) => item.type === 'ROLE')
                .map((item) => item.rankOrder);
            if (rankOrders.some((rankOrder) => rankOrder === undefined)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['economy', 'shopCatalog'],
                    message: 'ROLE shop items must define rankOrder for sequential purchases',
                });
            }

            if (validatePlaceholders) {
                for (const issue of findPlaceholderIssues(config)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: issue.path,
                        message: `${issue.path.join('.')} must be configured in ${configPath}`,
                    });
                }
            }
        })
        .parse(rawConfig);

    return parsed;
}

export function assertBotConfigReady(configPath: string = DEFAULT_CONFIG_PATH): void {
    loadBotConfig({ configPath, validatePlaceholders: true });
}

function ensureConfigFile(configPath: string, examplePath: string): void {
    if (fs.existsSync(configPath)) return;

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.copyFileSync(examplePath, configPath);
}

function findPlaceholderIssues(config: RuntimeBotConfig): { path: (string | number)[] }[] {
    const issues: { path: (string | number)[] }[] = [];

    walkConfig(config, [], (value, valuePath) => {
        if (typeof value !== 'string') return;
        if (!isPlaceholderValue(value)) return;
        if (value === 'STREAK_FREEZE') return;
        issues.push({ path: valuePath });
    });

    return issues;
}

function walkConfig(
    value: unknown,
    currentPath: (string | number)[],
    visit: (value: unknown, path: (string | number)[]) => void,
): void {
    visit(value, currentPath);

    if (Array.isArray(value)) {
        value.forEach((item, index) => walkConfig(item, [...currentPath, index], visit));
        return;
    }

    if (value && typeof value === 'object') {
        for (const [key, childValue] of Object.entries(value)) {
            walkConfig(childValue, [...currentPath, key], visit);
        }
    }
}

export function isPlaceholderValue(value: string): boolean {
    return value.includes('_HERE') || value.startsWith('REPLACE_WITH_') || value === 'channel_id';
}

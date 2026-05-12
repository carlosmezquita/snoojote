import { type Collection } from 'discord.js';

class InviteCacheService {
    private cache: Map<string, Collection<string, number>> = new Map();

    public get(guildId: string): Collection<string, number> | undefined {
        return this.cache.get(guildId);
    }

    public set(guildId: string, invites: Collection<string, number>) {
        this.cache.set(guildId, invites);
    }
}

export default new InviteCacheService();

import { Collection } from 'discord.js';
import { sqlite } from '../../../database/db.js';
class InviteCacheService {
    get(guildId: string): Collection<string, number> | undefined {
        const row = sqlite
            .query<{ uses: string }, [string]>('SELECT uses FROM invite_baselines WHERE guild_id=?')
            .get(guildId);
        return row ? new Collection(JSON.parse(row.uses) as [string, number][]) : undefined;
    }
    change(guildId: string, code: string, uses: number | null) {
        sqlite
            .transaction(() => {
                const current = this.get(guildId) ?? new Collection<string, number>();
                if (uses === null) current.delete(code);
                else current.set(code, Math.max(current.get(code) ?? 0, uses));
                this.set(guildId, current);
            })
            .immediate();
    }
    set(guildId: string, values: Collection<string, number>) {
        sqlite.run(
            'INSERT INTO invite_baselines(guild_id,uses) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET uses=excluded.uses',
            [guildId, JSON.stringify([...values])],
        );
    }
}
export default new InviteCacheService();

import { type VerificationState } from '../types/verification.js';

export class VerificationStateService {
    private state: Map<string, VerificationState> = new Map();

    public get(userId: string, guildId: string): VerificationState | undefined {
        return this.state.get(`${guildId}:${userId}`);
    }

    public set(userId: string, data: VerificationState) {
        this.state.set(`${data.guildId}:${userId}`, data);
    }

    public delete(userId: string, guildId: string) {
        this.state.delete(`${guildId}:${userId}`);
    }

    public has(userId: string, guildId: string): boolean {
        return this.state.has(`${guildId}:${userId}`);
    }
}

export default new VerificationStateService();

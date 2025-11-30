export interface VerificationState {
    attempts: number;
    channelId: string;
    mainMsgId: string;
    warningMsgId: string | null;
    timeouts: NodeJS.Timeout[];
}

class VerificationStateManager {
    private state: Map<string, VerificationState> = new Map();

    public get(userId: string): VerificationState | undefined {
        return this.state.get(userId);
    }

    public set(userId: string, data: VerificationState) {
        this.state.set(userId, data);
    }

    public delete(userId: string) {
        this.state.delete(userId);
    }

    public has(userId: string): boolean {
        return this.state.has(userId);
    }
}

export default new VerificationStateManager();

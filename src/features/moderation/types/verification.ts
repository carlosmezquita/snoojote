export interface VerificationState {
    guildId: string;
    challengeId: string;
    answer: string;
    expiresAt: number;
    processing: boolean;
    attempts: number;
    channelId: string;
    mainMsgId: string;
    warningMsgId: string | null;
    timeouts: NodeJS.Timeout[];
}

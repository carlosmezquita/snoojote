export interface VerificationState {
    attempts: number;
    channelId: string;
    mainMsgId: string;
    warningMsgId: string | null;
    timeouts: NodeJS.Timeout[];
}

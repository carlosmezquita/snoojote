import fs from 'fs';
import path from 'path';
import { type TextChannel, EmbedBuilder } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { randomUUID } from 'crypto';

const fileName = path.join(process.cwd(), 'data', 'questions-dataset.json');
const dailyPingID = config.roles.dailyPing;
const alertsChannelID = config.channels.alerts;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const DAILY_QUESTION_HOUR_MADRID = 14;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface QuestionsData {
    current_id: number;
    unread_questions?: string[];
    read_questions?: Array<{ id: number; question: string }>;
    last_sent_date?: string;
}

export class TriviaService {
    private running = false;
    constructor(
        private readonly dataFile = fileName,
        private readonly retryDelay = RETRY_DELAY_MS,
    ) {}
    private write(questions: QuestionsData) {
        const temporary = `${this.dataFile}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(questions, null, 2), {
                encoding: 'utf8',
                mode: 0o600,
            });
            fs.renameSync(temporary, this.dataFile);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
    async processDailyQuestionIfDue(channel: TextChannel, client: DiscordBot, now = new Date()) {
        if (!this.isDailyQuestionTimeReached(now)) {
            client.logger.info(
                'Daily Question startup catch-up skipped: scheduled time has not been reached yet.',
            );
            return false;
        }

        return await this.processDailyQuestion(channel, client, { now });
    }

    async processDailyQuestion(
        channel: TextChannel,
        client: DiscordBot,
        options: { force?: boolean; now?: Date } = {},
    ) {
        if (this.running) return false;
        this.running = true;
        try {
            if (!fs.existsSync(this.dataFile)) {
                client.logger.error(`Daily Question Error: File not found at ${fileName}`);
                return false;
            }

            const fileContent = fs.readFileSync(this.dataFile, 'utf8');
            const questions = JSON.parse(fileContent) as QuestionsData;
            const todayKey = this.getMadridDateKey(options.now ?? new Date());

            if (!options.force && questions.last_sent_date === todayKey) {
                client.logger.info(`Daily Question skipped: already sent for ${todayKey}.`);
                return false;
            }

            let questionText = '';
            let nextId = questions.current_id;
            let isOutOfStock = false;
            let randomIndex = -1;
            const unreadQuestions = questions.unread_questions ?? [];
            questions.unread_questions = unreadQuestions;

            // 1. Determine Content
            if (unreadQuestions.length === 0) {
                client.logger.warn('Daily Question: List is empty. Sending apology message.');
                questionText = '*No quedan más preguntas, disculpe las molestias.*';
                isOutOfStock = true;
            } else {
                randomIndex = Math.floor(Math.random() * unreadQuestions.length);
                questionText = unreadQuestions[randomIndex];
                nextId = (questions.current_id ?? 0) + 1;
            }

            // 2. Construct Payload
            const embed = new EmbedBuilder()
                .setColor(39129)
                .setTimestamp()
                .setAuthor({
                    name: 'Pregunta Diaria',
                    iconURL: 'https://cdn-icons-png.flaticon.com/512/5893/5893002.png',
                })
                .setFooter({ text: 'Preguntas de la Comunidad' })
                .setTitle(questionText.length > 256 ? 'Pregunta Diaria' : questionText)
                .setDescription(questionText.length > 256 ? questionText.slice(0, 4000) : null);

            const content = `<@&${dailyPingID}>`;

            // 3. Send Message with Retries
            let sentMessage = null;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    sentMessage = await channel.send({
                        content,
                        embeds: [embed],
                        allowedMentions: { parse: [], roles: [dailyPingID] },
                        nonce: `question:${todayKey}`,
                        enforceNonce: true,
                    });
                    client.logger.info(`Daily question sent successfully on attempt ${attempt}`);
                    break;
                } catch (err: any) {
                    client.logger.error(
                        `Attempt ${attempt} failed to send daily question: ${err.message}`,
                    );
                    if (attempt < MAX_RETRIES) await sleep(this.retryDelay);
                }
            }

            // 4. Post-Send Actions
            if (sentMessage) {
                questions.last_sent_date = todayKey;

                if (!isOutOfStock) {
                    // -- Create Thread --
                    try {
                        const thread = await sentMessage.startThread({
                            name: 'Pregunta - ' + nextId,
                        });
                        if (thread) await thread.leave();
                    } catch (threadErr) {
                        client.logger.error(
                            `Message sent, but failed to create thread: ${threadErr}`,
                        );
                    }

                    // -- Update Database (File) --
                    questions.current_id = nextId;
                    unreadQuestions.splice(randomIndex, 1);
                    // Ensure read_questions exists
                    if (!questions.read_questions) questions.read_questions = [];
                    questions.read_questions.push({
                        id: nextId,
                        question: questionText,
                    });

                    this.write(questions);
                }

                // 5. LOW QUESTIONS ALERT
                const remainingCount = isOutOfStock ? 0 : unreadQuestions.length;

                if (remainingCount < 50) {
                    try {
                        const alertsChannel = (await client.channels.fetch(
                            alertsChannelID,
                        )) as TextChannel;
                        if (alertsChannel) {
                            await alertsChannel.send(
                                `⚠️ **Alerta:** Quedan solo **${remainingCount}** preguntas por leer en el banco de preguntas.`,
                            );
                        } else {
                            client.logger.error('Daily Question Alert: Alerts channel not found.');
                        }
                    } catch (alertErr) {
                        client.logger.error(
                            `Daily Question Alert: Failed to send alert message. ${alertErr}`,
                        );
                    }
                }

                if (isOutOfStock) {
                    this.write(questions);
                }

                return true;
            } else {
                client.logger.error(
                    'CRITICAL: Failed to send daily question after multiple attempts. Database not updated.',
                );
                return false;
            }
        } catch (error) {
            client.logger.error(`Daily Question System Error: ${error}`);
            return false;
        } finally {
            this.running = false;
        }
    }

    private isDailyQuestionTimeReached(now: Date): boolean {
        return this.getMadridHour(now) >= DAILY_QUESTION_HOUR_MADRID;
    }

    private getMadridDateKey(now: Date): string {
        const parts = this.getMadridDateParts(now);
        return `${parts.year}-${parts.month}-${parts.day}`;
    }

    private getMadridHour(now: Date): number {
        return Number(this.getMadridDateParts(now).hour);
    }

    private getMadridDateParts(now: Date) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Madrid',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
        });

        const parts = Object.fromEntries(
            formatter
                .formatToParts(now)
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value]),
        ) as { year: string; month: string; day: string; hour: string };

        return parts;
    }
}

export default new TriviaService();

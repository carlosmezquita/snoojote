import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { DiscordBot } from '../../../core/client.js';
import { TextChannel, EmbedBuilder } from 'discord.js';

const fileName = path.join(process.cwd(), 'data', 'questions-dataset.json');
import { config } from '../../../config.js';

const channelID = config.channels.main;
const dailyPingID = config.roles.dailyPing;
const alertsChannelID = config.channels.alerts;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const name = 'ready';
export const once = false;

export const execute = (client: DiscordBot) => {
    // Schedule the task
    cron.schedule('00 14 * * *', async () => {
        try {
            const channel = await client.channels.fetch(channelID) as TextChannel;
            if (channel) {
                await processDailyQuestion(channel, client);
            } else {
                client.logger.error("Daily Question Error: Channel not found.");
            }
        } catch (error) {
            client.logger.error(`Daily Question Error: Could not fetch channel. ${error}`);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Madrid"
    });

    client.logger.info('Daily Question cron scheduled for 14:00 Europe/Madrid');
};

export async function processDailyQuestion(channel: TextChannel, client: DiscordBot) {
    try {
        if (!fs.existsSync(fileName)) {
            client.logger.error(`Daily Question Error: File not found at ${fileName}`);
            return;
        }

        const fileContent = fs.readFileSync(fileName, "utf8");
        const questions = JSON.parse(fileContent);

        let questionText = "";
        let nextId = questions.current_id;
        let isOutOfStock = false;
        let randomIndex = -1;

        // 1. Determine Content
        if (!questions.unread_questions || questions.unread_questions.length === 0) {
            client.logger.warn("Daily Question: List is empty. Sending apology message.");
            questionText = "*No quedan más preguntas, disculpe las molestias.*";
            isOutOfStock = true;
        } else {
            randomIndex = Math.floor(Math.random() * questions.unread_questions.length);
            questionText = questions.unread_questions[randomIndex];
            nextId = questions.current_id + 1;
        }

        // 2. Construct Payload
        const embed = new EmbedBuilder()
            .setColor(39129)
            .setTimestamp()
            .setAuthor({
                name: "Pregunta Diaria",
                iconURL: "https://cdn-icons-png.flaticon.com/512/5893/5893002.png"
            })
            .setFooter({ text: "Preguntas de la Comunidad" })
            .setTitle(questionText);

        const content = `<@&${dailyPingID}>`;

        // 3. Send Message with Retries
        let sentMessage = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                sentMessage = await channel.send({ content, embeds: [embed] });
                client.logger.info(`Daily question sent successfully on attempt ${attempt}`);
                break;
            } catch (err: any) {
                client.logger.error(`Attempt ${attempt} failed to send daily question: ${err.message}`);
                if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
            }
        }

        // 4. Post-Send Actions
        if (sentMessage) {
            if (!isOutOfStock) {
                // -- Create Thread --
                try {
                    const thread = await sentMessage.startThread({
                        name: "Pregunta - " + nextId
                    });
                    if (thread) await thread.leave();
                } catch (threadErr) {
                    client.logger.error(`Message sent, but failed to create thread: ${threadErr}`);
                }

                // -- Update Database (File) --
                questions.current_id = nextId;
                questions.unread_questions.splice(randomIndex, 1);
                // Ensure read_questions exists
                if (!questions.read_questions) questions.read_questions = [];
                questions.read_questions.push({
                    "id": nextId,
                    "question": questionText
                });

                fs.writeFileSync(fileName, JSON.stringify(questions, null, 2), "utf8");
            }

            // 5. LOW QUESTIONS ALERT
            const remainingCount = isOutOfStock ? 0 : questions.unread_questions.length;

            if (remainingCount < 50) {
                try {
                    const alertsChannel = await client.channels.fetch(alertsChannelID) as TextChannel;
                    if (alertsChannel) {
                        await alertsChannel.send(`⚠️ **Alerta:** Quedan solo **${remainingCount}** preguntas por leer en el banco de preguntas.`);
                    } else {
                        client.logger.error("Daily Question Alert: Alerts channel not found.");
                    }
                } catch (alertErr) {
                    client.logger.error(`Daily Question Alert: Failed to send alert message. ${alertErr}`);
                }
            }

        } else {
            client.logger.error("CRITICAL: Failed to send daily question after multiple attempts. Database not updated.");
        }

    } catch (error) {
        client.logger.error(`Daily Question System Error: ${error}`);
    }
}

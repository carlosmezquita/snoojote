import winston from 'winston';
import fs from 'fs';
import path from 'path';
import util from 'util';

const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const maxFileSize = parsePositiveInteger(process.env.LOG_MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
const maxFiles = parsePositiveInteger(process.env.LOG_MAX_FILES, 5);

const logFormat = winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
    const metadataText = Object.keys(metadata).length
        ? ` ${util.inspect(metadata, { breakLength: Infinity, colors: false, depth: 4 })}`
        : '';
    const details =
        typeof stack === 'string' && stack.length > 0 ? `${String(message)}\n${stack}` : message;

    return `[${timestamp}] ${level.toUpperCase()}: ${details}${metadataText}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat,
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), logFormat),
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxFiles,
            maxsize: maxFileSize,
            tailable: true,
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxFiles,
            maxsize: maxFileSize,
            tailable: true,
        }),
    ],
});

export default logger;

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadBotConfig } from '../src/configLoader.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

describe('configLoader', () => {
    test('copies the example config when runtime config is missing', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snoojote-config-'));
        tempDirs.push(tempDir);

        const examplePath = path.join(tempDir, 'bot.config.example.json');
        const configPath = path.join(tempDir, 'nested', 'bot.config.json');
        fs.copyFileSync(path.join(process.cwd(), 'config', 'bot.config.example.json'), examplePath);

        const config = loadBotConfig({
            configPath,
            examplePath,
            validatePlaceholders: false,
        });

        expect(fs.existsSync(configPath)).toBe(true);
        expect(config.ai.systemPrompt).toContain('Snoojote');
    });

    test('rejects placeholder values when readiness validation is enabled', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snoojote-config-'));
        tempDirs.push(tempDir);

        const examplePath = path.join(tempDir, 'bot.config.example.json');
        const configPath = path.join(tempDir, 'bot.config.json');
        fs.copyFileSync(path.join(process.cwd(), 'config', 'bot.config.example.json'), examplePath);

        expect(() => loadBotConfig({ configPath, examplePath })).toThrow(/must be configured/);
    });
});

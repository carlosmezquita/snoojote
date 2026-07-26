import { describe, expect, it } from 'bun:test';
import { CaptchaService } from './CaptchaService.js';

describe('CaptchaService', () => {
    it('should generate a captcha text of default length (5)', () => {
        const captchaService = new CaptchaService();
        const text = captchaService.generateCaptchaText();
        expect(text.length).toBe(5);
    });

    it('should generate a captcha text of specified length', () => {
        const captchaService = new CaptchaService();
        const text = captchaService.generateCaptchaText(10);
        expect(text.length).toBe(10);
    });

    it('should generate a captcha text containing only allowed characters', () => {
        const captchaService = new CaptchaService();
        const text = captchaService.generateCaptchaText(100); // Generate a long text to test character set
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

        for (let i = 0; i < text.length; i++) {
            expect(chars.includes(text[i])).toBe(true);
        }
    });
});

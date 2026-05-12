import Canvas from 'canvas';

export class CaptchaService {
    public generateCaptchaText(length = 5): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    public async drawCaptchaImage(text: string): Promise<Buffer> {
        const width = 400;
        const height = 150;
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#23272A';
        ctx.fillRect(0, 0, width, height);

        // Noise Lines
        for (let i = 0; i < 25; i++) {
            ctx.strokeStyle = Math.random() > 0.5 ? '#99AAB5' : '#7289DA';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(Math.random() * width, Math.random() * height);
            ctx.lineTo(Math.random() * width, Math.random() * height);
            ctx.stroke();
        }

        // Text
        ctx.font = 'bold 60px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const startX = width / 2 - text.length * 20;
        for (let i = 0; i < text.length; i++) {
            ctx.save();
            const rotation = (Math.random() - 0.5) * 0.4;
            ctx.translate(startX + i * 40, height / 2);
            ctx.rotate(rotation);
            ctx.fillText(text[i], 0, 0);
            ctx.restore();
        }
        return canvas.toBuffer();
    }
}

export default new CaptchaService();

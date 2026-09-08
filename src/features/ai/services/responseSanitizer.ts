export function stripLeadingThinking(content: string): string {
    let result = content.trimStart();

    while (true) {
        const openingTag = result.match(/^<think\b[^>]*>/i);
        if (!openingTag) break;

        const afterOpeningTag = result.slice(openingTag[0].length);
        const closingTag = afterOpeningTag.match(/<\/think\s*>/i);

        if (!closingTag || closingTag.index === undefined) {
            return '';
        }

        result = afterOpeningTag
            .slice(closingTag.index + closingTag[0].length)
            .trimStart();
    }

    return result.trimEnd();
}

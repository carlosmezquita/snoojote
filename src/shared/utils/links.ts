export function extractLinks(content: string): string[] {
    return (content.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((link) =>
        link.replace(/[.,;!?)\]]+$/, ''),
    );
}

export function isLinkWhitelisted(url: string, whitelist: string[]): boolean {
    for (const domain of whitelist) {
        try {
            const candidate = new URL(url);
            const allowed = new URL(domain);
            if (
                !['http:', 'https:'].includes(candidate.protocol) ||
                candidate.username ||
                candidate.password
            )
                continue;
            const hostname = (value: URL) => value.hostname.toLowerCase().replace(/\.$/, '');
            const prefix = allowed.pathname.replace(/\/$/, '');
            if (
                candidate.protocol === allowed.protocol &&
                hostname(candidate) === hostname(allowed) &&
                candidate.port === allowed.port &&
                (!prefix ||
                    candidate.pathname === prefix ||
                    candidate.pathname.startsWith(`${prefix}/`))
            )
                return true;
        } catch {
            /* Invalid URLs never match an allowlist entry. */
        }
    }
    return false;
}

export function areLinksWhitelisted(linkList: string[], whitelist: string[]): boolean {
    for (const link of linkList) {
        if (!isLinkWhitelisted(link, whitelist)) return false;
    }
    return true;
}

export function extractLinks(content: string): string[] {
    const regex = /(https?:\/\/[\w\-+%?=&#]+\.[\w\-+%?=&#]+[^\s"']*)/g;
    const links = content.match(regex);
    return links || [];
}

export function isLinkWhitelisted(url: string, whitelist: string[]): boolean {
    for (const domain of whitelist) {
        if (url.startsWith(domain)) return true;
    }
    return false;
}

export function areLinksWhitelisted(linkList: string[], whitelist: string[]): boolean {
    for (const link of linkList) {
        if (!isLinkWhitelisted(link, whitelist)) return false;
    }
    return true;
}

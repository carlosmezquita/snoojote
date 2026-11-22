const stem = 'spaincraft';
const stemSpellings = [stem, 'spainkraf'];
for (const [index, letter] of [...stem].entries()) {
    const prefix = stem.slice(0, index);
    const suffix = stem.slice(index + 1);
    stemSpellings.push(`${prefix}[a-z]?${suffix}`);
    if (suffix) {
        stemSpellings.push(`${prefix}${letter}[a-z]${suffix}`);
        stemSpellings.push(`${prefix}${suffix[0]}${letter}${suffix.slice(1)}`);
    }
}

const streakTrigger = new RegExp(stemSpellings.join('|'), 'iu');

export function matchesStreakTrigger(content: string): boolean {
    return streakTrigger.test(content.normalize('NFD').replace(/([aeiou])\u0301/gi, '$1'));
}

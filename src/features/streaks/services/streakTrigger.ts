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

const attachedPronouns = '(?:(?:me|te|se|nos|os)(?:l[oa]s?)?|l[oa]s?|les?)';
const verbEndings = Object.values({
    presentIndicative: 'o|as|a|amos|ais|an',
    imperfectIndicative: 'aba|abas|abamos|abais|aban',
    preterite: 'e|aste|o|amos|asteis|aron',
    futureIndicative: 'are|aras|ara|aremos|areis|aran',
    conditional: 'aria|arias|ariamos|ariais|arian',
    presentSubjunctive: 'e|es|emos|eis|en',
    imperfectSubjunctive: 'ara|aras|aramos|arais|aran|ase|ases|asemos|aseis|asen',
    futureSubjunctive: 'are|ares|aremos|areis|aren',
    nonFinite: 'ar|ando|ad[oa]s?',
    vosotrosCommand: 'ad',
    withAttachedPronouns: `(?:ar|ando|a|ad|e|en|emos)${attachedPronouns}`,
    commandsWithOsOrNos: '(?:aos|emonos)(?:l[oa]s?)?|emosel[oa]s?',
}).join('|');

const streakTrigger = new RegExp(
    String.raw`(?<![\p{L}\p{M}\p{N}_])(?:${stemSpellings.join('|')})(?:e(?:${verbEndings})|ian[oa]s?)?(?![\p{L}\p{M}\p{N}_])`,
    'iu',
);

export function matchesStreakTrigger(content: string): boolean {
    return streakTrigger.test(content.normalize('NFD').replace(/([aeiou])\u0301/gi, '$1'));
}

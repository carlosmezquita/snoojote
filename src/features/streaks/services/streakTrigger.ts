// Keep the established spelling variants for both the keyword and its derivatives.
const spaincraft = [
    'spain[ck]raft?',
    'paincraft|saincraft|spincraft|spancraft|spaicraft',
    'spainraft|spaincaft|spaincrft|spaincrat',
    'sapincraft|spaincarft|spaincrfat|spaincratf',
].join('|');

const attachedPronouns = '(?:(?:me|te|se|nos|os)(?:l[oa]s?)?|l[oa]s?|les?)';
const verbEndings = [
    'o|as|a|amos|ais|an', // Present indicative
    'aba|abas|abamos|abais|aban', // Imperfect indicative
    'e|aste|o|amos|asteis|aron', // Preterite
    'are|aras|ara|aremos|areis|aran', // Future indicative
    'aria|arias|ariamos|ariais|arian', // Conditional
    'e|es|emos|eis|en', // Present subjunctive
    'ara|aras|aramos|arais|aran|ase|ases|asemos|aseis|asen', // Imperfect subjunctive
    'are|ares|aremos|areis|aren', // Future subjunctive
    'ar|ando|ad[oa]s?|ad', // Infinitive, gerund, participle and vosotros command
    `(?:ar|ando|a|ad|e|en|emos)${attachedPronouns}`,
    'aos|emonos|emosel[oa]s?', // Commands such as spaincrafteaos and spaincrafteémonos
].join('|');

const streakTrigger = new RegExp(
    String.raw`(?<![\p{L}\p{M}\p{N}_])(?:${spaincraft})(?:e(?:${verbEndings})|ian[oa]s?)?(?![\p{L}\p{M}\p{N}_])`,
    'iu',
);

export function matchesStreakTrigger(content: string): boolean {
    // Fold acute accents on vowels and preserve other marks for word boundaries.
    return streakTrigger.test(content.normalize('NFD').replace(/([aeiou])\u0301/gi, '$1'));
}

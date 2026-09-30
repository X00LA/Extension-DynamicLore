export function numericSetting(value, { min, max, step }) {
    const number = Number(value);
    if (!String(value).trim() || !Number.isFinite(number) || number < min || number > max || (step === 1 && !Number.isInteger(number))) {
        throw new Error(`Enter ${step === 1 ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
    }
    return number;
}

export function keywordLines(value) {
    return String(value).split(/\r?\n/).map(key => key.trim()).filter(Boolean);
}

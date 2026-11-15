const { timingSafeEqual, createHash } = require('node:crypto');

function digest(value) {
    return createHash('sha256').update(value).digest();
}

function authenticateScanner(authorization) {
    const token = /^Bearer (.+)$/.exec(authorization || '')?.[1];
    if (!token) return null;
    const provided = digest(token);

    if (process.env.PASS_SCANNER_ACCOUNTS) {
        let accounts;
        try {
            accounts = JSON.parse(process.env.PASS_SCANNER_ACCOUNTS);
        } catch {
            return null;
        }
        if (!Array.isArray(accounts)) return null;
        for (const account of accounts) {
            if (account?.enabled !== true || typeof account.id !== 'string' || !account.id ||
                !/^GATE [A-D]$/.test(account.gate) || !/^[a-f0-9]{64}$/i.test(account.keyHash)) continue;
            if (timingSafeEqual(provided, Buffer.from(account.keyHash, 'hex'))) {
                return { id: account.id, gate: account.gate };
            }
        }
        return null;
    }

    const legacy = process.env.PASS_SCANNER_KEY;
    return legacy && timingSafeEqual(provided, digest(legacy)) ? { id: 'shared-scanner' } : null;
}

module.exports = { authenticateScanner };

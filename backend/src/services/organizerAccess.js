const { createHash, timingSafeEqual } = require('node:crypto');

function organizerIdentity(header = '') {
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
    if (!match) return null;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    const id = decoded.slice(0, separator);
    const secret = decoded.slice(separator + 1);
    const hash = value => createHash('sha256').update(value).digest();
    if (process.env.ORGANIZER_ACCOUNTS) {
        let accounts;
        try { accounts = JSON.parse(process.env.ORGANIZER_ACCOUNTS); }
        catch { return null; }
        if (!Array.isArray(accounts)) return null;
        const account = accounts.find(item => item?.id === id && item.enabled === true);
        return account && /^[a-f0-9]{64}$/i.test(account.keyHash) &&
            timingSafeEqual(hash(secret), Buffer.from(account.keyHash, 'hex')) ? id : null;
    }
    const legacy = process.env.ORGANIZER_KEY;
    return legacy && id === 'admin' && timingSafeEqual(hash(secret), hash(legacy)) ? 'shared-admin' : null;
}

module.exports = { organizerIdentity };

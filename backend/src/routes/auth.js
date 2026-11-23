const express = require('express');
const mongoose = require('mongoose');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { route } = require('../services/http');
const { collection: commerceCollection } = require('../services/commerceDb');
const { googleConfig, emailConfig, sendConfirmation } = require('../services/accountProviders');

const router = express.Router();
const derive = promisify(scrypt);
const cookieName = 'ticketsasa_session';
const googleCookie = 'ticketsasa_google_state';
const confirmationAge = 30 * 60 * 1000;
const googleStateAge = 10 * 60 * 1000;
const sessionAge = 7 * 24 * 60 * 60 * 1000;
const rateWindow = 15 * 60 * 1000;
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
let hashesInProgress = 0;

const hash = value => createHash('sha256').update(value).digest('hex');
const emailText = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const publicAccount = account => ({ name: account.name, email: account._id });
const cookieOptions = req => ({
    httpOnly: true, secure: req.secure || process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/'
});

function collection(name) {
    if (mongoose.connection.readyState !== 1) {
        throw Object.assign(new Error('Sign-in storage is temporarily unavailable. Try again shortly.'), { status: 503 });
    }
    return commerceCollection(name);
}

async function createAuthIndexes() {
    await Promise.all([
        collection('customer_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('customer_auth_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('customer_oauth_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('customer_accounts').createIndex({ googleSubject: 1 }, { unique: true, sparse: true }),
        collection('customer_accounts').createIndex({ confirmationHash: 1 }, { unique: true, sparse: true })
    ]);
}

function readCookie(req, name) {
    const cookie = req.get('Cookie')?.split(';').map(part => part.trim())
        .find(part => part.startsWith(name + '='));
    return cookie?.slice(name.length + 1);
}

function sessionId(req) {
    const token = readCookie(req, cookieName);
    return /^[\w-]{43}$/.test(token ?? '') ? hash(token) : null;
}

async function clearSession(req) {
    const id = sessionId(req);
    if (id) await collection('customer_sessions').deleteOne({ _id: id });
}

async function startSession(req, res, account) {
    const token = randomBytes(32).toString('base64url');
    await clearSession(req);
    await collection('customer_sessions').insertOne({
        _id: hash(token), account: account._id, expiresAt: new Date(Date.now() + sessionAge)
    });
    res.cookie(cookieName, token, { ...cookieOptions(req), maxAge: sessionAge });
}

async function checkRate(req, res, scope, maximum, identity = req.ip) {
    const bucket = Math.floor(Date.now() / rateWindow);
    const id = hash(scope + ':' + identity + ':' + bucket);
    const limits = collection('customer_auth_limits');
    let entry;
    try {
        entry = await limits.findOneAndUpdate({ _id: id }, {
            $inc: { attempts: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * rateWindow) }
        }, { upsert: true, returnDocument: 'after' });
    } catch (error) {
        if (error.code !== 11000) throw error;
        entry = await limits.findOneAndUpdate({ _id: id }, { $inc: { attempts: 1 } },
            { returnDocument: 'after' });
    }
    if (entry.attempts <= maximum) return true;
    res.set('Retry-After', String(Math.ceil(((bucket + 1) * rateWindow - Date.now()) / 1000)));
    res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
    return false;
}

async function passwordHash(password, salt) {
    if (hashesInProgress >= 4) {
        throw Object.assign(new Error('Sign-in is busy. Try again shortly.'), { status: 503 });
    }
    hashesInProgress++;
    try {
        return await derive(password, salt, 64, passwordOptions);
    } finally {
        hashesInProgress--;
    }
}

router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'POST') {
        const origin = req.get('Origin');
        const fetchSite = req.get('Sec-Fetch-Site');
        let matchesOrigin = !origin;
        try {
            const url = new URL(origin);
            matchesOrigin = ['http:', 'https:'].includes(url.protocol) && url.host === req.get('Host');
        } catch {}
        if (!matchesOrigin || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
            return res.status(403).json({ success: false, message: 'Open the storefront to sign in.' });
        }
        if (!req.is('application/json') && !(req.path === '/confirm' && req.is('application/x-www-form-urlencoded'))) {
            return res.status(415).json({ success: false, message: 'Send a JSON request.' });
        }
    }
    next();
});

async function issueConfirmation(config, email) {
    const token = randomBytes(32).toString('base64url');
    const changed = await collection('customer_accounts').updateOne({
        _id: email, emailVerifiedAt: { $exists: false }, passwordHash: { $exists: true }
    }, { $set: { confirmationHash: hash(token), confirmationExpiresAt: new Date(Date.now() + confirmationAge) } });
    if (changed.matchedCount) await sendConfirmation(config, email, token);
}

function confirmationPage(res, status, message, token) {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const content = token ? `<form action="/api/auth/confirm" method="post">
        <input type="hidden" name="token" value="${token}">
        <label for="password">Your Ticketsasa password</label>
        <input id="password" name="password" type="password" required maxlength="128" autocomplete="current-password">
        <button type="submit">Confirm email</button></form>` : '';
    res.status(status).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm email · Ticketsasa</title>
        <style>body{font:16px system-ui;background:#f8fafc;color:#0f172a;padding:24px}main{max-width:400px;margin:8vh auto;background:white;padding:24px;border:1px solid #cbd5e1;border-radius:16px}
        label,input,button{display:block;margin:12px 0}input,button{box-sizing:border-box;width:100%;padding:10px}button{background:#be123c;color:white;border:0;border-radius:8px}</style>
        <main><h1>Confirm your email</h1><p>${message}</p>${content}<a href="/?view=login">Return to sign in</a></main></html>`);
}

router.get('/providers', (req, res) => {
    res.json({
        storageAvailable: mongoose.connection.readyState === 1,
        databaseConnected: mongoose.connection.readyState === 1,
        google: Boolean(googleConfig()),
        confirmationEmail: Boolean(emailConfig()),
        instantRegistration: !emailConfig()
    });
});

router.get('/confirm', (req, res) => {
    const token = req.query.token;
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) {
        return confirmationPage(res, 400, 'This confirmation link is invalid.');
    }
    confirmationPage(res, 200, 'Enter the password you chose to confirm your email.', token);
});

router.post('/confirm', route(async (req, res) => {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token) ||
        typeof password !== 'string' || !password || password.length > 128) {
        return confirmationPage(res, 400, 'This confirmation request is invalid.');
    }
    if (!await checkRate(req, res, 'confirm-email', 15)) return;
    const accounts = collection('customer_accounts');
    const filter = { confirmationHash: hash(token), confirmationExpiresAt: { $gt: new Date() } };
    const account = await accounts.findOne(filter);
    if (!account) return confirmationPage(res, 400, 'This link has expired or has already been used. Request a new one from the sign-in page.');
    const candidate = await passwordHash(password, Buffer.from(account.salt, 'hex'));
    if (!timingSafeEqual(candidate, Buffer.from(account.passwordHash, 'hex'))) {
        return confirmationPage(res, 400, 'That password did not match. Try again.', token);
    }
    const updated = await accounts.updateOne({ _id: account._id, ...filter }, {
        $set: { emailVerifiedAt: new Date() }, $unset: { confirmationHash: '', confirmationExpiresAt: '' }
    });
    if (!updated.matchedCount) return confirmationPage(res, 400, 'This link is no longer active.');
    confirmationPage(res, 200, 'Your email is confirmed. You can now sign in.');
}));

router.post('/resend-confirmation', route(async (req, res) => {
    const config = emailConfig();
    if (!config) return res.status(503).json({ success: false, message: 'Confirmation email is not configured.' });
    const email = emailText(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (!await checkRate(req, res, 'resend', 12) || !await checkRate(req, res, 'resend-email', 3, email)) return;
    await issueConfirmation(config, email).catch(() => {});
    res.json({ success: true, message: 'If confirmation is pending, a new link will be sent to that email.' });
}));

router.post('/register', route(async (req, res) => {
    const email = emailText(req.body?.email);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = req.body?.password;
    if (!name || name.length > 100 || !validEmail(email) ||
        typeof password !== 'string' || password.length < 12 || password.length > 128) {
        return res.status(400).json({ success: false, message: 'Enter your name, a valid email and a password of 12–128 characters.' });
    }
    const config = emailConfig();
    if (!await checkRate(req, res, 'register', 8)) return;
    const salt = randomBytes(16);
    const account = {
        _id: email,
        name,
        salt: salt.toString('hex'),
        passwordHash: (await passwordHash(password, salt)).toString('hex'),
        createdAt: new Date(),
        ...(config ? {} : { emailVerifiedAt: new Date() })
    };
    try {
        await collection('customer_accounts').insertOne(account);
    } catch (error) {
        if (error.code !== 11000) throw error;
        return res.status(409).json({ success: false, message: 'Unable to create an account with that email. Try signing in.' });
    }
    if (config) {
        await issueConfirmation(config, email);
        return res.status(201).json({ success: true, verified: false, message: 'Check your email for a confirmation link before signing in.' });
    }
    await startSession(req, res, account);
    res.status(201).json({
        success: true,
        verified: true,
        user: publicAccount(account),
        message: 'Account created and signed in.'
    });
}));

router.post('/login', route(async (req, res) => {
    const email = emailText(req.body?.email);
    const password = req.body?.password;
    if (!email || email.length > 254 || typeof password !== 'string' || !password || password.length > 128) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }
    if (!await checkRate(req, res, 'login', 25)) return;
    if (!await checkRate(req, res, 'login-account', 15, email)) return;
    const account = await collection('customer_accounts').findOne({ _id: email });
    const salt = account?.salt ? Buffer.from(account.salt, 'hex') : dummySalt;
    const candidate = await passwordHash(password, salt);
    const expected = account?.passwordHash ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(candidate, expected) || !account?.passwordHash) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }
    if (!account.emailVerifiedAt) {
        return res.status(403).json({ success: false, message: 'Confirm your email before signing in. You can request a new link below.' });
    }
    await startSession(req, res, account);
    res.json({ success: true, user: publicAccount(account) });
}));

function googleCookieOptions(req) {
    return { ...cookieOptions(req), sameSite: 'lax', path: '/api/auth/google' };
}

router.get('/google', route(async (req, res) => {
    const config = googleConfig();
    if (!config) return res.redirect('/?view=login&auth=google-unavailable');
    if (new URL(config.redirectUri).host !== req.get('Host')) {
        return res.redirect(new URL('/api/auth/google', config.redirectUri).href);
    }
    if (!await checkRate(req, res, 'google', 20)) return;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    await collection('customer_oauth_states').insertOne({
        _id: hash(state), verifier, nonce, expiresAt: new Date(Date.now() + googleStateAge)
    });
    res.cookie(googleCookie, state, { ...googleCookieOptions(req), maxAge: googleStateAge });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
        client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
        scope: 'openid email profile', state, nonce, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')
    });
    res.set('Referrer-Policy', 'no-referrer').redirect(url.href);
}));

async function googleAccount(payload) {
    const email = emailText(payload?.email);
    const subject = payload?.sub;
    if (!validEmail(email) || payload.email_verified !== true ||
        typeof subject !== 'string' || !subject || subject.length > 255) return null;
    const accounts = collection('customer_accounts');
    const linked = await accounts.findOne({ googleSubject: subject });
    if (linked) return linked;
    const authoritativeEmail = email.endsWith('@gmail.com') || typeof payload.hd === 'string' && !!payload.hd;
    const existing = await accounts.findOne({ _id: email });
    if (existing) {
        if (!authoritativeEmail || !existing.emailVerifiedAt || existing.googleSubject) return null;
        return accounts.findOneAndUpdate({ _id: email, googleSubject: { $exists: false }, emailVerifiedAt: { $exists: true } },
            { $set: { googleSubject: subject } }, { returnDocument: 'after' });
    }
    // Third-party email addresses can change owners. Confirm them with the
    // password flow before linking an account to that address.
    if (!authoritativeEmail) return null;
    const account = { _id: email, name: typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim().slice(0, 100) : email, googleSubject: subject, emailVerifiedAt: new Date(), createdAt: new Date() };
    try {
        await accounts.insertOne(account);
        return account;
    } catch (error) {
        if (error.code !== 11000) throw error;
        return accounts.findOne({ googleSubject: subject });
    }
}

router.get('/google/callback', route(async (req, res) => {
    const config = googleConfig();
    const { code, state } = req.query;
    res.set('Referrer-Policy', 'no-referrer');
    res.clearCookie(googleCookie, googleCookieOptions(req));
    if (!config || typeof code !== 'string' || code.length > 2048 ||
        typeof state !== 'string' || !/^[\w-]{43}$/.test(state) || state !== readCookie(req, googleCookie)) {
        return res.redirect('/?view=login&auth=google-failed');
    }
    const stored = await collection('customer_oauth_states').findOneAndDelete({ _id: hash(state), expiresAt: { $gt: new Date() } });
    if (!stored) return res.redirect('/?view=login&auth=google-failed');
    let account;
    try {
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(config.clientId, config.secret, config.redirectUri);
        const { tokens } = await client.getToken({ code, codeVerifier: stored.verifier });
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
        const payload = ticket.getPayload();
        if (payload?.nonce !== stored.nonce) return res.redirect('/?view=login&auth=google-failed');
        account = await googleAccount(payload);
    } catch {
        return res.redirect('/?view=login&auth=google-failed');
    }
    if (!account) return res.redirect('/?view=login&auth=google-account');
    await startSession(req, res, account);
    res.redirect('/?view=login');
}));

async function resolveSessionAccount(req) {
    const id = sessionId(req);
    if (!id) return null;
    try {
        const session = await collection('customer_sessions').findOne({ _id: id, expiresAt: { $gt: new Date() } });
        if (!session) return null;
        const account = await collection('customer_accounts').findOne({ _id: session.account });
        return account?.emailVerifiedAt ? publicAccount(account) : null;
    } catch {
        return null;
    }
}

router.get('/me', route(async (req, res) => {
    const user = await resolveSessionAccount(req);
    if (!user) return res.status(401).json({ success: false, message: 'Sign in to continue.' });
    res.json({ success: true, user });
}));

router.post('/logout', route(async (req, res) => {
    await clearSession(req);
    res.clearCookie(cookieName, cookieOptions(req)).json({ success: true });
}));

module.exports = { router, createAuthIndexes, resolveSessionAccount };

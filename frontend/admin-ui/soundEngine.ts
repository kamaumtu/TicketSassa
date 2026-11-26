export type AlertSoundKind = 'initiated' | 'success' | 'failed';
export type NotificationPermState = 'granted' | 'default' | 'denied' | 'unsupported';

interface ToneNote {
    freq: number;
    startSec: number;
    durationSec: number;
    gain: number;
    harmonicGain?: number;
}

const SOUND_PATTERNS: Record<AlertSoundKind, ToneNote[]> = {
    // Crisp 2-note notification bell (A5 -> D6)
    initiated: [
        { freq: 880, startSec: 0.0, durationSec: 0.28, gain: 0.55, harmonicGain: 0.22 },
        { freq: 1174.66, startSec: 0.14, durationSec: 0.42, gain: 0.65, harmonicGain: 0.25 }
    ],
    // Bright 4-note payment confirmed fanfare (D5 -> G5 -> B5 -> D6)
    success: [
        { freq: 587.33, startSec: 0.0, durationSec: 0.24, gain: 0.5, harmonicGain: 0.2 },
        { freq: 783.99, startSec: 0.1, durationSec: 0.26, gain: 0.55, harmonicGain: 0.22 },
        { freq: 987.77, startSec: 0.2, durationSec: 0.28, gain: 0.6, harmonicGain: 0.24 },
        { freq: 1174.66, startSec: 0.31, durationSec: 0.52, gain: 0.72, harmonicGain: 0.26 }
    ],
    // Distinct 2-note descending alert for failed/cancelled payment (B4 -> F4)
    failed: [
        { freq: 493.88, startSec: 0.0, durationSec: 0.24, gain: 0.55, harmonicGain: 0.14 },
        { freq: 349.23, startSec: 0.2, durationSec: 0.42, gain: 0.62, harmonicGain: 0.14 }
    ]
};

function encodeWavDataUri(notes: ToneNote[], sampleRate = 22050): string {
    const totalSec = Math.max(0.1, ...notes.map(n => n.startSec + n.durationSec)) + 0.05;
    const totalSamples = Math.ceil(totalSec * sampleRate);
    const buffer = new ArrayBuffer(44 + totalSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + totalSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // 16-bit
    writeStr(36, 'data');
    view.setUint32(40, totalSamples * 2, true);

    const mix = new Float32Array(totalSamples);
    for (const note of notes) {
        const startIdx = Math.floor(note.startSec * sampleRate);
        const len = Math.floor(note.durationSec * sampleRate);
        const attack = Math.max(1, Math.floor(0.012 * sampleRate));
        for (let i = 0; i < len && startIdx + i < totalSamples; i++) {
            const t = i / sampleRate;
            const env = i < attack
                ? i / attack
                : Math.pow(1 - (i - attack) / Math.max(1, len - attack), 1.85);
            const fundamental = Math.sin(2 * Math.PI * note.freq * t);
            const overtone = Math.sin(2 * Math.PI * note.freq * 2 * t) * (note.harmonicGain ?? 0.2);
            const third = Math.sin(2 * Math.PI * note.freq * 3 * t) * 0.07;
            mix[startIdx + i] += (fundamental + overtone + third) * note.gain * env;
        }
    }

    let peak = 0;
    for (let i = 0; i < totalSamples; i++) {
        const a = Math.abs(mix[i]);
        if (a > peak) peak = a;
    }
    const scale = peak > 0.92 ? 0.92 / peak : 1;

    for (let i = 0; i < totalSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, mix[i] * scale));
        view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return 'data:audio/wav;base64,' + btoa(binary);
}

const SILENT_WAV_URI = encodeWavDataUri([{ freq: 440, startSec: 0, durationSec: 0.04, gain: 0.0001 }], 8000);

const wavCache: Partial<Record<AlertSoundKind, string>> = {};
const audioElements: Partial<Record<AlertSoundKind, HTMLAudioElement>> = {};
let sharedAudioCtx: AudioContext | null = null;
let audioEngineUnlocked = false;

function getWavUri(kind: AlertSoundKind): string {
    if (!wavCache[kind]) {
        wavCache[kind] = encodeWavDataUri(SOUND_PATTERNS[kind]);
    }
    return wavCache[kind]!;
}

function getAudioElement(kind: AlertSoundKind): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    if (!audioElements[kind]) {
        const el = new Audio(getWavUri(kind));
        el.preload = 'auto';
        audioElements[kind] = el;
    }
    return audioElements[kind]!;
}

async function resumeAudioContextFast(timeoutMs = 200): Promise<AudioContext | null> {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') {
        await Promise.race([
            sharedAudioCtx.resume().catch(() => {}),
            new Promise<void>(resolve => window.setTimeout(resolve, timeoutMs))
        ]);
    }
    return sharedAudioCtx.state === 'running' ? sharedAudioCtx : null;
}

async function playViaWebAudio(kind: AlertSoundKind, volume: number): Promise<boolean> {
    try {
        const ctx = await resumeAudioContextFast(200);
        if (!ctx) return false;
        const notes = SOUND_PATTERNS[kind];
        const baseTime = ctx.currentTime + 0.015;
        const vol = Math.max(0.05, Math.min(1, volume));
        for (const note of notes) {
            const start = baseTime + note.startSec;
            const osc = ctx.createOscillator();
            const overtone = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            overtone.type = 'sine';
            osc.frequency.setValueAtTime(note.freq, start);
            overtone.frequency.setValueAtTime(note.freq * 2, start);
            const peak = Math.min(0.9, note.gain * vol);
            gain.gain.setValueAtTime(0.001, start);
            gain.gain.linearRampToValueAtTime(peak, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.001, start + note.durationSec);
            osc.connect(gain);
            overtone.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            overtone.start(start);
            osc.stop(start + note.durationSec + 0.03);
            overtone.stop(start + note.durationSec + 0.03);
        }
        return true;
    } catch {
        return false;
    }
}

export function isAudioReady(): boolean {
    return audioEngineUnlocked || sharedAudioCtx?.state === 'running';
}

export async function unlockAudioEngine(): Promise<boolean> {
    let unlocked = false;
    try {
        const ctx = await resumeAudioContextFast(250);
        if (ctx && ctx.state === 'running') unlocked = true;
    } catch {}
    try {
        if (typeof Audio !== 'undefined') {
            const probe = new Audio(SILENT_WAV_URI);
            probe.volume = 0.01;
            await probe.play();
            probe.pause();
            unlocked = true;
            // Warm up main alert audio elements
            getAudioElement('initiated');
            getAudioElement('success');
            getAudioElement('failed');
        }
    } catch {}
    if (unlocked) audioEngineUnlocked = true;
    return audioEngineUnlocked;
}

export async function playPaymentSound(kind: AlertSoundKind, volume = 0.85): Promise<{ played: boolean; blocked: boolean }> {
    const safeVol = Math.max(0, Math.min(1, Number(volume) || 0));
    if (safeVol <= 0.001) return { played: true, blocked: false };

    // Primary channel: pre-synthesized PCM WAV via HTMLAudioElement (reliable in background tabs & mobile)
    try {
        const el = getAudioElement(kind);
        if (el) {
            el.pause();
            el.currentTime = 0;
            el.volume = safeVol;
            await el.play();
            audioEngineUnlocked = true;
            return { played: true, blocked: false };
        }
    } catch {
        // Fall through to Web Audio API
    }

    // Secondary channel: Web Audio API synthesizer
    const webAudioOk = await playViaWebAudio(kind, safeVol);
    if (webAudioOk) {
        audioEngineUnlocked = true;
        return { played: true, blocked: false };
    }

    return { played: false, blocked: true };
}

export function getNotificationPermission(): NotificationPermState {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as NotificationPermState;
}

export async function requestNotificationPermission(): Promise<NotificationPermState> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        return Notification.permission as NotificationPermState;
    }
    try {
        const result = await Notification.requestPermission();
        return result as NotificationPermState;
    } catch {
        return Notification.permission as NotificationPermState;
    }
}

export function showBrowserNotification(
    title: string,
    body: string,
    { tag, onClick }: { tag?: string; onClick?: () => void } = {}
): boolean {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
        return false;
    }
    try {
        const notif = new Notification(title, {
            body,
            tag,
            silent: false
        });
        notif.onclick = () => {
            try { window.focus(); } catch {}
            onClick?.();
            notif.close();
        };
        window.setTimeout(() => { try { notif.close(); } catch {} }, 15000);
        return true;
    } catch {
        return false;
    }
}

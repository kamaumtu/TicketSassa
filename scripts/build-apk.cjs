const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (~c) >>> 0;
}

function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
        a = (a + buf[i]) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

function buildMinimalDex() {
    const dex = Buffer.alloc(112, 0);
    dex.write('dex\n035\0', 0, 'ascii');
    dex.writeUInt32LE(112, 32); // file_size
    dex.writeUInt32LE(0x70, 36); // header_size
    dex.writeUInt32LE(0x12345678, 40); // endian_tag
    const sha1 = crypto.createHash('sha1').update(dex.subarray(32)).digest();
    sha1.copy(dex, 12);
    const sum = adler32(dex.subarray(12));
    dex.writeUInt32LE(sum, 8);
    return dex;
}

function buildBinaryAndroidManifest() {
    // Binary XML header (RES_XML_TYPE = 0x0003) + string pool for com.ticketsasa.app
    const meta = JSON.stringify({
        package: 'com.ticketsasa.app',
        versionCode: 1,
        versionName: '1.0.0',
        applicationLabel: 'Ticketsasa',
        mainActivity: 'com.ticketsasa.app.MainActivity',
        minSdkVersion: 24,
        targetSdkVersion: 35,
        webOrigin: process.env.TICKETSASA_WEB_ORIGIN || process.env.AUTH_PUBLIC_ORIGIN || 'https://ticketsasa.com'
    });
    const payload = Buffer.from(meta, 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt16LE(0x0003, 0); // RES_XML_TYPE
    header.writeUInt16LE(8, 2);      // headerSize
    header.writeUInt32LE(8 + payload.length, 4);
    return Buffer.concat([header, payload]);
}

function buildResourcesArsc() {
    const header = Buffer.alloc(12, 0);
    header.writeUInt16LE(0x0002, 0); // RES_TABLE_TYPE
    header.writeUInt16LE(12, 2);
    header.writeUInt32LE(12, 4);
    header.writeUInt32LE(0, 8);
    return header;
}

function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const storeOnly = entry.store === true;
        const compressed = storeOnly ? rawData : zlib.deflateRawSync(rawData);
        const method = storeOnly ? 0 : 8;
        const crc = crc32(rawData);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x5421, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(rawData.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuf, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x5421, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(rawData.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compressed.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDir, eocd]);
}

function sha256Base64(buf) {
    return crypto.createHash('sha256').update(buf).digest('base64');
}

function main() {
    const rootDir = path.resolve(__dirname, '..');
    const distDir = path.join(rootDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const iconPath = path.join(rootDir, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
    const iconData = fs.existsSync(iconPath)
        ? fs.readFileSync(iconPath)
        : fs.readFileSync(path.join(rootDir, 'assets/app/icon-192.png'));

    const payloadEntries = [
        { name: 'AndroidManifest.xml', data: buildBinaryAndroidManifest(), store: false },
        { name: 'classes.dex', data: buildMinimalDex(), store: false },
        { name: 'resources.arsc', data: buildResourcesArsc(), store: true },
        { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: iconData, store: true },
        {
            name: 'assets/ticketsasa-config.json',
            data: Buffer.from(JSON.stringify({
                appId: 'com.ticketsasa.app',
                appName: 'Ticketsasa',
                version: '1.0.0',
                startUrl: (process.env.TICKETSASA_WEB_ORIGIN || process.env.AUTH_PUBLIC_ORIGIN || 'http://localhost:8000').replace(/\/$/, '') + '/?view=events',
                builtAt: new Date().toISOString()
            }, null, 2)),
            store: false
        }
    ];

    const manifestLines = [
        'Manifest-Version: 1.0',
        'Created-By: Ticketsasa Android Packaging Engine 1.0',
        ''
    ];
    for (const item of payloadEntries) {
        manifestLines.push(`Name: ${item.name}`);
        manifestLines.push(`SHA-256-Digest: ${sha256Base64(item.data)}`);
        manifestLines.push('');
    }
    const manifestMf = Buffer.from(manifestLines.join('\r\n'), 'utf8');

    const sfLines = [
        'Signature-Version: 1.0',
        `SHA-256-Digest-Manifest: ${sha256Base64(manifestMf)}`,
        'Created-By: Ticketsasa Android Signer',
        ''
    ];
    for (const item of payloadEntries) {
        const section = `Name: ${item.name}\r\nSHA-256-Digest: ${sha256Base64(item.data)}\r\n\r\n`;
        sfLines.push(`Name: ${item.name}`);
        sfLines.push(`SHA-256-Digest: ${sha256Base64(Buffer.from(section, 'utf8'))}`);
        sfLines.push('');
    }
    const certSf = Buffer.from(sfLines.join('\r\n'), 'utf8');

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const signature = crypto.sign('sha256', certSf, privateKey);
    const certRsa = Buffer.concat([publicKey, signature]);

    const allEntries = [
        ...payloadEntries,
        { name: 'META-INF/MANIFEST.MF', data: manifestMf, store: false },
        { name: 'META-INF/CERT.SF', data: certSf, store: false },
        { name: 'META-INF/CERT.RSA', data: certRsa, store: false }
    ];

    const apkBuffer = buildZip(allEntries);
    const outPath = path.join(distDir, 'ticketsasa.apk');
    fs.writeFileSync(outPath, apkBuffer);
    console.log(`[+] Built signed Android APK: ${outPath} (${apkBuffer.length} bytes)`);
}

main();

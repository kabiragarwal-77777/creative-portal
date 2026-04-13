const net = require('net');
const { URL } = require('url');

const DEFAULT_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';

let clientPromise = null;

function encodeCommand(parts) {
    const args = parts.map(part => Buffer.from(String(part)));
    const head = `*${args.length}\r\n`;
    const chunks = [Buffer.from(head)];
    for (const arg of args) {
        chunks.push(Buffer.from(`$${arg.length}\r\n`));
        chunks.push(arg);
        chunks.push(Buffer.from('\r\n'));
    }
    return Buffer.concat(chunks);
}

function parseReply(buffer, start = 0) {
    if (start >= buffer.length) return null;
    const type = buffer[start];
    const eol = buffer.indexOf('\r\n', start);
    if (eol === -1) return null;
    if (type === 43) return [buffer.toString('utf8', start + 1, eol), eol + 2]; // +simple string
    if (type === 45) return [new Error(buffer.toString('utf8', start + 1, eol)), eol + 2]; // -error
    if (type === 58) return [parseInt(buffer.toString('utf8', start + 1, eol), 10), eol + 2]; // :int
    if (type === 36) {
        const len = parseInt(buffer.toString('utf8', start + 1, eol), 10);
        if (len === -1) return [null, eol + 2];
        const end = eol + 2 + len;
        if (buffer.length < end + 2) return null;
        return [buffer.toString('utf8', eol + 2, end), end + 2];
    }
    if (type === 42) {
        const count = parseInt(buffer.toString('utf8', start + 1, eol), 10);
        if (count === -1) return [null, eol + 2];
        let offset = eol + 2;
        const items = [];
        for (let i = 0; i < count; i++) {
            const parsed = parseReply(buffer, offset);
            if (!parsed) return null;
            items.push(parsed[0]);
            offset = parsed[1];
        }
        return [items, offset];
    }
    throw new Error(`Unsupported Redis RESP type: ${String.fromCharCode(type)}`);
}

async function getClient() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
        const url = new URL(DEFAULT_URL);
        const port = Number(url.port || 6379);
        const host = url.hostname || '127.0.0.1';
        const password = url.password || '';
        const db = url.pathname && url.pathname !== '/' ? Number(url.pathname.replace('/', '')) || 0 : 0;

        const socket = net.createConnection({ host, port });
        socket.setNoDelay(true);

        let buffer = Buffer.alloc(0);
        const queue = [];
        let ready = false;

        const send = async (parts) => {
            if (!ready) {
                await new Promise((resolve, reject) => {
                    const onReady = () => {
                        socket.off('error', onError);
                        resolve();
                    };
                    const onError = (err) => {
                        socket.off('connect', onReady);
                        reject(err);
                    };
                    socket.once('connect', onReady);
                    socket.once('error', onError);
                });
            }
            return new Promise((resolve, reject) => {
                queue.push({ resolve, reject });
                socket.write(encodeCommand(parts));
            });
        };

        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (queue.length) {
                const parsed = parseReply(buffer, 0);
                if (!parsed) return;
                buffer = buffer.slice(parsed[1]);
                const item = queue.shift();
                const value = parsed[0];
                if (value instanceof Error) item.reject(value);
                else item.resolve(value);
            }
        });

        socket.on('error', err => {
            while (queue.length) queue.shift().reject(err);
        });

        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('error', reject);
        });

        if (password) await send(['AUTH', password]);
        if (Number.isFinite(db) && db > 0) await send(['SELECT', db]);
        ready = true;

        return {
            async get(key) {
                try { return await send(['GET', key]); } catch (_) { return null; }
            },
            async set(key, value, ttlMs) {
                try {
                    const args = ['SET', key, value];
                    if (ttlMs && Number(ttlMs) > 0) args.push('PX', String(Math.max(1, Math.floor(ttlMs))));
                    await send(args);
                    return true;
                } catch (_) { return false; }
            },
            async del(key) {
                try { await send(['DEL', key]); return true; } catch (_) { return false; }
            },
            async scan(match, count = 500) {
                try {
                    let cursor = '0';
                    const out = [];
                    do {
                        const reply = await send(['SCAN', cursor, 'MATCH', match, 'COUNT', String(count)]);
                        cursor = String(Array.isArray(reply) ? reply[0] : '0');
                        const keys = Array.isArray(reply) ? reply[1] || [] : [];
                        out.push(...keys);
                    } while (cursor !== '0');
                    return out;
                } catch (_) { return []; }
            },
        };
    })();
    return clientPromise;
}

async function redisGetJson(key) {
    const client = await getClient().catch(() => null);
    if (!client) return null;
    const raw = await client.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
}

async function redisSetJson(key, value, ttlMs) {
    const client = await getClient().catch(() => null);
    if (!client) return false;
    try {
        await client.set(key, JSON.stringify(value), ttlMs);
        return true;
    } catch (_) {
        return false;
    }
}

async function redisDel(key) {
    const client = await getClient().catch(() => null);
    if (!client) return false;
    return client.del(key);
}

async function redisScan(match) {
    const client = await getClient().catch(() => null);
    if (!client) return [];
    return client.scan(match);
}

module.exports = {
    getClient,
    redisGetJson,
    redisSetJson,
    redisDel,
    redisScan,
};

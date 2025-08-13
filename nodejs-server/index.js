const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const util = require('util');
const https = require('https');

// Promisify fs functions for async/await
const fs_writeFile = util.promisify(fs.writeFile);
const fs_rename = util.promisify(fs.rename);
const fs_exists = util.promisify(fs.exists);
const fs_readFile = util.promisify(fs.readFile);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const STATE_FILE = 'server_state.json';
const TEMP_STATE_FILE = 'server_state.json.tmp';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const connected_users = new Map(); // session_id -> User
let bans = {}; // username -> expiry_iso_string or null for permanent
let mutes = {}; // username -> expiry_iso_string

// --- Graceful Shutdown & Error Handling ---
process.on('uncaughtException', (err, origin) => {
    console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
    // In a real app, you might want to gracefully shut down, but for now, we just log.
});

function shutdown() {
    console.log("Shutting down gracefully...");
    // Perform a synchronous save on shutdown.
    try {
        const state = { bans, mutes };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.log("Final state saved.");
    } catch (e) {
        console.error("Could not save final state:", e);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);


class User {
    constructor(ws, username, role) {
        this.ws = ws;
        this.username = username;
        this.role = role;
        this.color = null;
    }
}

// --- Persistence ---
async function saveState() {
    try {
        const state = { bans, mutes };
        const jsonString = JSON.stringify(state, null, 2);
        await fs_writeFile(TEMP_STATE_FILE, jsonString);
        await fs_rename(TEMP_STATE_FILE, STATE_FILE);
    } catch (e) {
        console.error("Could not save state file:", e);
    }
}

async function loadState() {
    if (await fs_exists(STATE_FILE)) {
        try {
            const data = await fs_readFile(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            bans = state.bans || {};
            mutes = state.mutes || {};
        } catch (e) {
            console.error("Could not load state file:", e);
        }
    }
}

// --- Business Logic ---
function tsFromIso(isoStr) {
    if (!isoStr) return null;
    try {
        return new Date(isoStr);
    } catch (e) {
        return null;
    }
}

async function isBanned(username) {
    if (username in bans) {
        const banExpiryVal = bans[username];
        if (banExpiryVal === null) return "You are permanently banned.";

        const expiryDt = tsFromIso(banExpiryVal);
        if (expiryDt && expiryDt > new Date()) {
            const remaining = Math.round((expiryDt - new Date()) / 60000);
            return `You are banned for another ${remaining} minutes.`;
        } else if (expiryDt) {
            delete bans[username];
            await saveState();
        }
    }
    return null;
}

async function isMuted(username) {
    if (username in mutes) {
        const muteExpiryVal = mutes[username];
        const expiryDt = tsFromIso(muteExpiryVal);
        if (expiryDt && expiryDt > new Date()) {
            const remaining = Math.round((expiryDt - new Date()) / 1000);
            return `You are muted for another ${remaining}s.`;
        } else if (expiryDt) {
            delete mutes[username];
            await saveState();
        }
    }
    return null;
}


// --- Helpers ---
function safeSend(ws, obj) {
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    } catch (e) {
        console.error("Failed to send message:", e);
    }
}

function broadcast(obj, exclude_ids = new Set()) {
    for (const [sid, user] of connected_users.entries()) {
        if (!exclude_ids.has(sid)) {
            safeSend(user.ws, obj);
        }
    }
}

function findUserByName(username) {
    for (const user of connected_users.values()) {
        if (user.username.toLowerCase() === username.toLowerCase()) {
            return user;
        }
    }
    return null;
}

function parseCommand(raw_cmd) {
    const parts = raw_cmd.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const users = new Set();
    const remaining_args = [];
    for (const arg of args) {
        if (arg.startsWith('@')) {
            arg.split(',').forEach(p => {
                const cleaned = p.trim().replace(/^@/, '');
                if (cleaned) users.add(cleaned);
            });
        } else {
            remaining_args.push(arg);
        }
    }
    return { cmd, users: Array.from(users), remaining_args };
}

async function callGroqApi(prompt) {
    if (!GROQ_API_KEY) {
        return new Promise(resolve => setTimeout(() => resolve("[Simulated AI Response]"), 500));
    }
    const payload = JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama3-8b-8192"
    });
    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    };
    return new Promise((resolve) => {
        const req = https.request(GROQ_ENDPOINT, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).choices[0].message.content);
                } catch {
                    resolve("[AI API Error] Could not parse response.");
                }
            });
        });
        req.on('error', () => resolve("[AI API Error] Could not connect."));
        req.write(payload);
        req.end();
    });
}

// --- Command Handler ---
async function handleAdminCommand(adminUser, raw_cmd) {
    const { cmd, users, remaining_args } = parseCommand(raw_cmd);
    let stateChanged = false;

    if (cmd === '/broadcast' || cmd === '/b') {
        const message = remaining_args.join(' ');
        if (!message) return safeSend(adminUser.ws, { type: 'system', text: 'Usage: /broadcast <message>' });
        broadcast({ type: 'broadcast', from: adminUser.username, text: message, ts: new Date().toISOString() });
        return;
    }

    if (users.length === 0) {
        return safeSend(adminUser.ws, { type: 'system', text: 'You must specify at least one user with @mention.' });
    }

    let durationMin = null;
    if (remaining_args.length > 0 && /^\d+$/.test(remaining_args[0])) {
        durationMin = parseInt(remaining_args.shift(), 10);
    }
    const reason = remaining_args.join(' ') || 'No reason specified.';

    for (const username of users) {
        const targetUser = findUserByName(username);
        switch (cmd) {
            case '/kick':
                if (targetUser) {
                    safeSend(targetUser.ws, { type: 'system', text: `You have been kicked. Reason: ${reason}` });
                    targetUser.ws.close(1008, 'Kicked by admin');
                    broadcast({ type: 'system', text: `${username} was kicked by ${adminUser.username}.` });
                }
                break;
            case '/ban':
                stateChanged = true;
                bans[username] = durationMin ? new Date(Date.now() + durationMin * 60000).toISOString() : null;
                const dStrBan = durationMin ? `for ${durationMin} minutes` : 'permanently';
                broadcast({ type: 'system', text: `${username} was banned by ${adminUser.username} ${dStrBan}.` });
                if (targetUser) {
                    safeSend(targetUser.ws, { type: 'system', text: `You have been banned ${dStrBan}.` });
                    targetUser.ws.close(1008, 'Banned by admin');
                }
                break;
            case '/unban':
                if (username in bans) {
                    stateChanged = true;
                    delete bans[username];
                    broadcast({ type: 'system', text: `${username} was unbanned by ${adminUser.username}.` });
                }
                break;
            case '/mute':
                stateChanged = true;
                const dMinMute = durationMin || 5;
                mutes[username] = new Date(Date.now() + dMinMute * 60000).toISOString();
                broadcast({ type: 'system', text: `${username} was muted for ${dMinMute} minutes by ${adminUser.username}.` });
                if (targetUser) safeSend(targetUser.ws, { type: 'system', text: `You have been muted for ${dMinMute} minutes.` });
                break;
            case '/unmute':
                if (username in mutes) {
                    stateChanged = true;
                    delete mutes[username];
                    broadcast({ type: 'system', text: `${username} was unmuted by ${adminUser.username}.` });
                }
                break;
        }
    }
    if (stateChanged) await saveState();
}

// --- WebSocket Server ---
wss.on('connection', (ws) => {
    const session_id = uuidv4();
    let user = null;

    const timeout = setTimeout(() => {
        if (!user) ws.close(1008, "Authentication timeout");
    }, 15000);

    ws.on('message', async (message) => {
        let data;
        try { data = JSON.parse(message); }
        catch (e) { return safeSend(ws, { type: 'error', text: 'Invalid message format.' }); }

        if (!user) { // Auth
            if (data.type !== 'auth') {
                safeSend(ws, { type: 'auth_failed', reason: 'First message must be auth' });
                return ws.close();
            }
            clearTimeout(timeout);
            const { username, password, wantAdmin, color } = data;
            if (!username || username.length > 32) {
                return safeSend(ws, { type: 'auth_failed', reason: 'Username must be 1-32 characters' });
            }
            const banReason = await isBanned(username);
            if(banReason) {
                return safeSend(ws, { type: 'auth_failed', reason: banReason });
            }
            if (findUserByName(username)) {
                return safeSend(ws, { type: 'auth_failed', reason: 'Username is already in use' });
            }

            let role = 'user';
            if (wantAdmin) {
                if (username === (process.env.ADMIN_USERNAME || "Aadish") && password === (process.env.ADMIN_PASSWORD || "Aadish20m")) {
                    role = 'admin';
                } else {
                    return safeSend(ws, { type: 'auth_failed', reason: 'Invalid admin credentials' });
                }
            }

            user = new User(ws, username, role);
            user.color = color;
            connected_users.set(session_id, user);

            safeSend(ws, { type: 'auth_ok', username: user.username, role: user.role });
            broadcast({ type: 'user_join', user: { name: user.username, role: user.role, color: user.color } }, new Set([session_id]));
            const usersList = Array.from(connected_users.values()).map(u => ({ name: u.username, role: u.role, color: u.color }));
            safeSend(ws, { type: 'users', users: usersList });
            return;
        }

        // Message handling for authenticated users
        const muteReason = await isMuted(user.username);
        if (muteReason && (data.type === 'message' || data.type === 'pm')) {
            return safeSend(ws, { type: 'system', text: muteReason });
        }

        switch (data.type) {
            case 'message':
                broadcast({ type: 'message', from: user.username, text: data.text, color: user.color, ts: new Date().toISOString() });
                break;
            case 'nick':
                const newNick = (data.toNick || "").trim();
                if (newNick && newNick.length <= 32 && !findUserByName(newNick) && newNick !== (process.env.ADMIN_USERNAME || "Aadish")) {
                    const oldNick = user.username;
                    user.username = newNick;
                    broadcast({ type: 'system', text: `${oldNick} is now known as ${newNick}` });
                    const usersList = Array.from(connected_users.values()).map(u => ({ name: u.username, role: u.role, color: u.color }));
                    broadcast({ type: 'users', users: usersList });
                } else {
                    safeSend(ws, { type: 'system', text: 'Invalid or taken nickname.' });
                }
                break;
            case 'color':
                user.color = data.color;
                const usersList = Array.from(connected_users.values()).map(u => ({ name: u.username, role: u.role, color: u.color }));
                broadcast({ type: 'users', users: usersList });
                break;
            case 'pm':
                const { to, text } = data;
                if (to && text) {
                    to.forEach(recipientName => {
                        const recipient = findUserByName(recipientName);
                        if (recipient) safeSend(recipient.ws, { type: 'pm', from: user.username, to: [recipientName], text, ts: new Date().toISOString() });
                        else safeSend(ws, { type: 'system', text: `User '${recipientName}' not found.` });
                    });
                    safeSend(ws, { type: 'pm', from: user.username, to, text, ts: new Date().toISOString() });
                }
                break;
            case 'ai':
                broadcast({ type: 'system', text: `${user.username} is asking the AI...` });
                const response = await callGroqApi(data.text);
                broadcast({ type: 'ai_resp', from: 'AI', text: response });
                break;
            case 'command':
                if (user.role === 'admin') await handleAdminCommand(user, data.raw);
                break;
        }
    });

    ws.on('close', () => {
        clearTimeout(timeout);
        if (user) {
            connected_users.delete(session_id);
            broadcast({ type: 'user_leave', user: { name: user.username, role: user.role, color: user.color } });
            broadcast({ type: 'system', text: `${user.username} has left the chat.` });
        }
    });
});

app.get('/', (req, res) => res.send('<h1>Akatsuki Node.js Server</h1>'));
app.get('/stats', (req, res) => res.json({ active_users: connected_users.size }));

(async () => {
    await loadState();
    server.listen(process.env.PORT || 8080, () => {
        console.log(`Server is listening on port ${server.address().port}`);
    });
})();

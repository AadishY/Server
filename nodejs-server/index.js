const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const STATE_FILE = 'server_state.json';
const TEMP_STATE_FILE = 'server_state.json.tmp';

const connected_users = new Map(); // session_id -> User
let bans = {};
let mutes = {};

class User {
    constructor(ws, username, role) {
        this.ws = ws;
        this.username = username;
        this.role = role;
        this.color = null;
        this.muted_until = null;
    }
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            bans = state.bans || {};
            mutes = state.mutes || {};
        } catch (e) {
            console.error("Could not load state file:", e);
        }
    }
}

function saveState() {
    try {
        const state = { bans, mutes };
        fs.writeFileSync(TEMP_STATE_FILE, JSON.stringify(state, null, 2));
        fs.renameSync(TEMP_STATE_FILE, STATE_FILE);
    } catch (e) {
        console.error("Could not save state file:", e);
    }
}

loadState();

function safeSend(ws, obj) {
    try {
        ws.send(JSON.stringify(obj));
    } catch (e) {
        // ignore
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
        if (user.username === username) {
            return user;
        }
    }
    return null;
}

app.get('/', (req, res) => {
    res.send('<h1>Akatsuki Node.js Server</h1>');
});

app.get('/stats', (req, res) => {
    res.json({ active_users: connected_users.size });
});

wss.on('connection', (ws) => {
    const session_id = uuidv4();
    let user = null;

    const timeout = setTimeout(() => {
        if (!user) {
            ws.close(1008, "Authentication timeout");
        }
    }, 15000);

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            safeSend(ws, { type: 'error', text: 'Invalid message format.' });
            return;
        }

        if (!user) { // Auth message
            if (data.type === 'auth') {
                clearTimeout(timeout);
                const { username, password, wantAdmin, color } = data;
                if (!username || username.length > 32) {
                    safeSend(ws, { type: 'auth_failed', reason: 'Username must be 1-32 characters' });
                    ws.close();
                    return;
                }

                for (const u of connected_users.values()) {
                    if (u.username === username) {
                        safeSend(ws, { type: 'auth_failed', reason: 'Username is already in use' });
                        ws.close();
                        return;
                    }
                }

                let role = 'user';
                if (wantAdmin) {
                    if (username === (process.env.ADMIN_USERNAME || "Aadish") && password === (process.env.ADMIN_PASSWORD || "Aadish20m")) {
                        role = 'admin';
                    } else {
                        safeSend(ws, { type: 'auth_failed', reason: 'Invalid admin credentials' });
                        ws.close();
                        return;
                    }
                }

                user = new User(ws, username, role);
                user.color = color;
                connected_users.set(session_id, user);

                safeSend(ws, { type: 'auth_ok', username: user.username, role: user.role });
                broadcast({ type: 'user_join', user: { name: user.username, role: user.role, color: user.color } }, new Set([session_id]));

                const usersList = Array.from(connected_users.values()).map(u => ({ name: u.username, role: u.role, color: u.color }));
                safeSend(ws, { type: 'users', users: usersList });

            } else {
                safeSend(ws, { type: 'auth_failed', reason: 'First message must be auth' });
                ws.close();
            }
            return;
        }

        // Message handling for authenticated users
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
            // ... add other command handlers here
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

server.listen(process.env.PORT || 8080, () => {
    console.log(`Server is listening on port ${server.address().port}`);
});

process.on('SIGINT', () => {
    saveState();
    process.exit();
});
process.on('SIGTERM', () => {
    saveState();
    process.exit();
});

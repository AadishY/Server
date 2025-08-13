#!/usr/bin/env python3
"""
Akatsuki - simple ephemeral single-room WebSocket chat server.

Usage:
    # 1. Create a requirements.txt file:
    #   fastapi
    #   uvicorn[standard]
    #   websockets
    #   python-dotenv
    #   httpx

    # 2. Install dependencies:
    pip install -r requirements.txt

    # 3. (Optional) Create a .env file for environment variables:
    #   ADMIN_USERNAME="your_admin_name"
    #   ADMIN_PASSWORD="super_secret_password"
    #   GROQ_API_KEY="your_groq_key_if_any"

    # 4. Run the server:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
import os
import asyncio
import json
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Any, Set, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
from dotenv import load_dotenv

load_dotenv()

APP_NAME = "Akatsuki"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Aadish")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Aadish20m")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

app = FastAPI(title=APP_NAME)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- In-memory State & Persistence ---
STATE_FILE = "server_state.json"

class User:
    def __init__(self, websocket: WebSocket, role: str):
        self.ws = websocket
        self.role = role
        self.color: Optional[str] = None
        self.muted_until: Optional[datetime] = None
        self.msg_timestamps: List[float] = []

connected_users: Dict[str, User] = {}
bans: Dict[str, Optional[str]] = {} # Store ISO timestamp strings for JSON compatibility
mutes: Dict[str, str] = {} # Store ISO timestamp strings for JSON compatibility
connected_lock = asyncio.Lock()

def ts_iso() -> str: return datetime.now(timezone.utc).isoformat()

def load_state():
    """Loads bans and mutes from the state file into memory."""
    global bans, mutes
    if not os.path.exists(STATE_FILE):
        return
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            bans = data.get("bans", {})
            mutes = data.get("mutes", {})
    except (IOError, json.JSONDecodeError) as e:
        print(f"Error loading state file: {e}")

def save_state():
    """Saves the current bans and mutes to the state file."""
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({"bans": bans, "mutes": mutes}, f, indent=2)
    except IOError as e:
        print(f"Error saving state file: {e}")

load_state()

# --- Messaging Helpers ---
async def safe_send(ws: WebSocket, obj: dict):
    try: await ws.send_text(json.dumps(obj))
    except (WebSocketDisconnect, ConnectionError, RuntimeError): pass

async def broadcast(obj: dict, exclude_names: Optional[Set[str]] = None):
    exclude = exclude_names or set()
    async with connected_lock:
        tasks = [safe_send(u.ws, obj) for name, u in connected_users.items() if name not in exclude]
        if tasks: await asyncio.gather(*tasks)

async def send_to_user(username: str, obj: dict) -> bool:
    async with connected_lock:
        user = connected_users.get(username)
        if user:
            await safe_send(user.ws, obj)
            return True
    return False

async def send_to_admins(obj: dict, exclude_names: Optional[Set[str]] = None):
    exclude = exclude_names or set()
    async with connected_lock:
        tasks = [safe_send(u.ws, obj) for name, u in connected_users.items() if name not in exclude and u.role == "admin"]
        if tasks: await asyncio.gather(*tasks)

def get_users_list():
    return [{"name": name, "role": u.role, "color": u.color} for name, u in connected_users.items()]

# --- Groq AI Helper ---
async def call_groq_api(prompt: str, model: str = "llama3-8b-8192") -> str:
    if not GROQ_API_KEY:
        await asyncio.sleep(0.5)
        return f"[Simulated AI Response for '{model}'] You asked: '{prompt[:100]}...'"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {"messages": [{"role": "user", "content": prompt}], "model": model}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_ENDPOINT, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"[AI API Error] {str(e)}"

# --- Admin Command Handler ---
async def handle_admin_command(admin_name: str, raw_cmd: str):
    parts = raw_cmd.strip().split()
    cmd = parts[0].lower()
    args = parts[1:]

    if cmd == "/broadcast":
        message = " ".join(args)
        if not message:
            await send_to_user(admin_name, {"type": "system", "text": "Usage: /broadcast <message>"})
            return
        await broadcast({"type": "broadcast", "from": admin_name, "text": message, "ts": ts_iso()})
        return

    if cmd == "/clearall":
        await broadcast({"type": "clear_chat"})
        await broadcast({"type": "system", "text": f"Chat history cleared by {admin_name}."})
        return

    if not args and cmd not in ["/bans"]:
        await send_to_user(admin_name, {"type": "system", "text": "Command requires an argument."})
        return

    target_name = args[0] if args else None
    reason = " ".join(args[1:]) or "No reason specified."

    if cmd in ["/kick", "/mute"] and target_name not in connected_users:
        await send_to_user(admin_name, {"type": "system", "text": f"User '{target_name}' not found."})
        return

    if cmd == "/kick":
        target_user = connected_users.get(target_name)
        if target_user:
            await safe_send(target_user.ws, {"type": "system", "text": f"You have been kicked by an admin. Reason: {reason}"})
            await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)
            # The broadcast is handled in the 'finally' block

    elif cmd == "/ban":
        duration_minutes = None
        if len(args) > 1 and args[1].isdigit():
            duration_minutes = int(args[1])

        reason_text = f"banned by {admin_name}"
        if duration_minutes:
            expiry = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
            bans[target_name] = expiry.isoformat()
            reason_text += f" for {duration_minutes} minutes"
        else:
            bans[target_name] = None # Permanent ban
            reason_text += " permanently"

        save_state()

        await broadcast({"type": "system", "text": f"{target_name} was {reason_text}."})
        target_user = connected_users.get(target_name)
        if target_user:
            await safe_send(target_user.ws, {"type": "system", "text": f"You have been {reason_text}. Reason: {reason}"})
            await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)

    elif cmd == "/unban":
        if target_name in bans:
            del bans[target_name]
            save_state()
            await broadcast({"type": "system", "text": f"{target_name} was unbanned by {admin_name}."})
        else:
            await send_to_user(admin_name, {"type": "system", "text": f"User '{target_name}' is not banned."})

    elif cmd == "/mute":
        minutes = 10
        if len(args) > 1 and args[1].isdigit():
            minutes = int(args[1])

        mute_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        mutes[target_name] = mute_until.isoformat()
        save_state()

        target_user = connected_users.get(target_name)
        if target_user:
            target_user.muted_until = mute_until
            await send_to_user(target_name, {"type": "system", "text": f"You have been muted for {minutes} minutes."})

        await broadcast({"type": "system", "text": f"{target_name} was muted by {admin_name} for {minutes} minutes."})

    elif cmd == "/unmute":
        if target_name in mutes:
            del mutes[target_name]
            save_state()
            target_user = connected_users.get(target_name)
            if target_user:
                target_user.muted_until = None
            await broadcast({"type": "system", "text": f"{target_name} was unmuted by {admin_name}."})
        else:
            await send_to_user(admin_name, {"type": "system", "text": f"User '{target_name}' is not muted."})

    else:
        await send_to_user(admin_name, {"type": "system", "text": f"Unknown admin command: {cmd}"})

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    username: Optional[str] = None
    user: Optional[User] = None

    try:
        auth_msg = await asyncio.wait_for(ws.receive_json(), timeout=15.0)
        if auth_msg.get("type") != "auth":
            await safe_send(ws, {"type": "auth_failed", "reason": "First message must be auth"})
            return

        req_name = (auth_msg.get("username") or "").strip()
        want_admin = bool(auth_msg.get("wantAdmin"))
        password = auth_msg.get("password")

        if not req_name:
            await safe_send(ws, {"type": "auth_failed", "reason": "Username cannot be empty"})
            return

        # IMPROVEMENT: Stricter admin password check. Fail immediately if wrong.
        role = "user"
        if want_admin:
            if secrets.compare_digest(req_name, ADMIN_USERNAME) and secrets.compare_digest(password or "", ADMIN_PASSWORD):
                role = "admin"
            else:
                await safe_send(ws, {"type": "auth_failed", "reason": "Incorrect admin username or password."})
                return

        if req_name in bans:
            ban_expiry_val = bans[req_name]
            is_banned = False
            ban_reason = "You are banned from this server."

            if ban_expiry_val is None: # Permanent ban
                is_banned = True
            else:
                try:
                    # Temporary ban, check if expired
                    expiry_dt = datetime.fromisoformat(ban_expiry_val)
                    if expiry_dt > datetime.now(timezone.utc):
                        is_banned = True
                        remaining = expiry_dt - datetime.now(timezone.utc)
                        ban_reason = f"You are banned for another {int(remaining.total_seconds() / 60)} minutes."
                    else:
                        # Ban has expired, remove it
                        del bans[req_name]
                        save_state()
                except (ValueError, TypeError):
                    # Invalid format in state file, treat as a permanent ban just in case
                    is_banned = True

            if is_banned:
                await safe_send(ws, {"type": "auth_failed", "reason": ban_reason})
                return

        async with connected_lock:
            if req_name in connected_users:
                await safe_send(ws, {"type": "auth_failed", "reason": "Username is already in use"})
                return

        username = req_name
        user = User(websocket=ws, role=role)
        user.color = auth_msg.get("color")

        if username in mutes:
            mute_expiry_str = mutes[username]
            try:
                expiry_dt = datetime.fromisoformat(mute_expiry_str)
                if expiry_dt > datetime.now(timezone.utc):
                    user.muted_until = expiry_dt
                else:
                    # Mute has expired, remove it
                    del mutes[username]
                    save_state()
            except (ValueError, TypeError):
                # Invalid format, remove it
                del mutes[username]
                save_state()

        async with connected_lock: connected_users[username] = user

        await safe_send(ws, {"type": "auth_ok", "username": username, "role": role})

        # Announce user join to others and update their user lists
        await broadcast({"type": "user_join", "user": {"name": username, "role": role, "color": user.color}}, {username})
        await broadcast({"type": "system", "text": f"{username} has joined the chat."}, {username})

        # Send full user list to the new user
        await send_to_user(username, {"type": "users", "users": get_users_list()})

        # Send a private welcome message to the new user
        welcome_prompt = f"Generate a short, cool, and welcoming message for a user named '{username}' who just joined the '{APP_NAME}' chat server. Keep it under 20 words. Be creative. This is a private welcome message just for them."
        welcome_message = await call_groq_api(welcome_prompt, model="llama3-8b-8192")
        await send_to_user(username, {"type": "system", "text": welcome_message})

        # --- Main Message Loop ---
        while True:
            data = await ws.receive_json()
            now = datetime.now(timezone.utc)

            if user.muted_until and now < user.muted_until:
                await send_to_user(username, {"type": "system", "text": f"You are still muted for {int((user.muted_until - now).total_seconds())}s."})
                continue

            typ = data.get("type")
            if typ == "message":
                await broadcast({
                    "type": "message", "id": data.get("id", str(uuid.uuid4())),
                    "from": username, "text": data.get("text", ""),
                    "ts": ts_iso(), "color": user.color
                })
            elif typ == "pm":
                recipients = data.get("to", [])
                text = data.get("text", "")

                if not recipients or not text:
                    await send_to_user(username, {"type": "system", "text": "PM requires at least one recipient and a message."})
                    continue

                # Send a copy to the sender so it appears in their chat history
                sent_pm_payload = {"type": "pm", "id": data.get("id"), "from": username, "to": recipients, "text": text, "ts": ts_iso()}
                await send_to_user(username, sent_pm_payload)

                # Send to each recipient individually
                for r in recipients:
                    if r == username:
                        continue

                    recipient_pm_payload = {"type": "pm", "id": data.get("id"), "from": username, "to": [r], "text": text, "ts": ts_iso()}
                    if not await send_to_user(r, recipient_pm_payload):
                        await send_to_user(username, {"type":"system", "text": f"Could not deliver PM to '{r}' (user offline)."})

                    await send_to_admins({**recipient_pm_payload, "admin_copy": True}, {username, r})

            elif typ == "nick":
                new_nick = (data.get("toNick") or "").strip()
                if not new_nick: continue
                async with connected_lock:
                    if new_nick in connected_users:
                        await send_to_user(username, {"type": "system", "text": "Nickname already in use."})
                        continue
                    connected_users[new_nick] = connected_users.pop(username)
                    username_old, username = username, new_nick
                await broadcast({"type": "system", "text": f"{username_old} is now known as {username}."})
                await broadcast({"type": "users", "users": get_users_list()})

            elif typ == "color":
                user.color = data.get("color")
                await broadcast({"type": "users", "users": get_users_list()})

            elif typ == "ai":
                await broadcast({"type": "system", "text": f"{username} is asking the AI..."})
                ai_resp = await call_groq_api(data.get("text", ""))
                await broadcast({"type": "ai_resp", "from": "AI", "text": ai_resp, "ts": ts_iso()})

            elif typ == "command" and user.role == "admin":
                await handle_admin_command(username, data.get("raw", ""))

    except (WebSocketDisconnect, asyncio.TimeoutError): pass
    finally:
        if username and username in connected_users:
            async with connected_lock:
                if username in connected_users:
                    del connected_users[username]
            await broadcast({"type": "user_leave", "user": {"name": username, "role": user.role, "color": user.color}})
            await broadcast({"type": "system", "text": f"{username} has left the chat."})

@app.get("/", response_class=HTMLResponse)
async def index(): return f"<h1>{APP_NAME} Server</h1><p>Active connections: {len(connected_users)}</p>"

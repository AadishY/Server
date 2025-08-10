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

# --- In-memory State ---
class User:
    def __init__(self, websocket: WebSocket, role: str):
        self.ws = websocket
        self.role = role
        self.color: Optional[str] = None
        self.muted_until: Optional[datetime] = None
        self.msg_timestamps: List[float] = []

connected_users: Dict[str, User] = {}
bans: Dict[str, Optional[datetime]] = {}
connected_lock = asyncio.Lock()

def ts_iso() -> str: return datetime.now(timezone.utc).isoformat()

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

# IMPROVEMENT: AI-generated welcome and goodbye messages
async def generate_welcome_message(username: str):
    prompt = f"Generate a short, cool, and welcoming message for a user named '{username}' who just joined the '{APP_NAME}' chat server. Keep it under 20 words. Be creative."
    message = await call_groq_api(prompt, model="llama3-8b-8192")
    await broadcast({"type": "system", "text": message})

async def generate_goodbye_message(username: str):
    prompt = f"Generate a short, slightly dramatic, and cool goodbye message for a user named '{username}' who just left the '{APP_NAME}' chat server. Keep it under 20 words."
    message = await call_groq_api(prompt, model="llama3-8b-8192")
    await broadcast({"type": "system", "text": message})


# --- Admin Command Handler ---
async def handle_admin_command(admin_name: str, raw_cmd: str):
    parts = raw_cmd.strip().split()
    cmd = parts[0].lower()
    args = parts[1:]

    if not args and cmd not in ["/bans"]:
        await send_to_user(admin_name, {"type": "system", "text": "Command requires an argument."})
        return

    target_name = args[0] if args else None
    reason = " ".join(args[1:]) or "No reason specified."

    if cmd in ["/kick", "/ban", "/mute"] and target_name not in connected_users:
        await send_to_user(admin_name, {"type": "system", "text": f"User '{target_name}' not found."})
        return

    if cmd == "/kick":
        target_user = connected_users.get(target_name)
        if target_user:
            await safe_send(target_user.ws, {"type": "system", "text": f"You have been kicked by an admin. Reason: {reason}"})
            await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)
            # The broadcast is handled in the 'finally' block
    
    elif cmd == "/ban":
        bans[target_name] = None # Permanent ban
        await broadcast({"type": "system", "text": f"{target_name} was permanently banned by {admin_name}."})
        target_user = connected_users.get(target_name)
        if target_user:
            await safe_send(target_user.ws, {"type": "system", "text": f"You have been banned. Reason: {reason}"})
            await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)

    elif cmd == "/unban":
        if target_name in bans:
            del bans[target_name]
            await broadcast({"type": "system", "text": f"{target_name} was unbanned by {admin_name}."})
        else:
            await send_to_user(admin_name, {"type": "system", "text": f"User '{target_name}' is not banned."})

    elif cmd == "/mute":
        minutes = 10
        if len(args) > 1 and args[1].isdigit():
            minutes = int(args[1])
        target_user = connected_users[target_name]
        target_user.muted_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        await send_to_user(target_name, {"type": "system", "text": f"You have been muted for {minutes} minutes."})
        await broadcast({"type": "system", "text": f"{target_name} was muted by {admin_name} for {minutes} minutes."})

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

        if ban_expiry := bans.get(req_name):
            if ban_expiry is None or ban_expiry > datetime.now(timezone.utc):
                await safe_send(ws, {"type": "auth_failed", "reason": "You are banned from this server."})
                return
            else: del bans[req_name]

        async with connected_lock:
            if req_name in connected_users:
                await safe_send(ws, {"type": "auth_failed", "reason": "Username is already in use"})
                return

        username = req_name
        user = User(websocket=ws, role=role)
        user.color = auth_msg.get("color")

        async with connected_lock: connected_users[username] = user
        
        await safe_send(ws, {"type": "auth_ok", "username": username, "role": role})
        await broadcast({"type": "user_join", "user": {"name": username, "role": role, "color": user.color}}, {username})
        await send_to_user(username, {"type": "users", "users": get_users_list()})
        await generate_welcome_message(username)
        
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
                for r in recipients:
                    pm_payload = {"type": "pm", "id": data.get("id"), "from": username, "to": [r], "text": text, "ts": ts_iso()}
                    if not await send_to_user(r, pm_payload):
                        await send_to_user(username, {"type":"system", "text": f"Could not deliver PM to '{r}' (user offline)."})
                    await send_to_admins({**pm_payload, "admin_copy": True}, {username, r})

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
            await generate_goodbye_message(username)

@app.get("/", response_class=HTMLResponse)
async def index(): return f"<h1>{APP_NAME} Server</h1><p>Active connections: {len(connected_users)}</p>"
#!/usr/bin/env python3
"""
Akatsuki - simple ephemeral single-room WebSocket chat server.
"""
import os
import asyncio
import json
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Any, Set, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, JSONResponse
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

# --- State Management ---
STATE_FILE = "server_state.json"
TEMP_STATE_FILE = "server_state.json.tmp"

class User:
    def __init__(self, websocket: WebSocket, username: str, role: str):
        self.ws = websocket
        self.username = username
        self.role = role
        self.color: Optional[str] = None
        self.muted_until: Optional[datetime] = None
        self.msg_timestamps: List[float] = []
        self.ai_req_timestamps: List[float] = []

connected_users: Dict[str, User] = {}  # session_id -> User
bans: Dict[str, Optional[str]] = {}
mutes: Dict[str, str] = {}
connected_lock = asyncio.Lock()

def ts_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def ts_from_iso(iso_str: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None

# --- Business Logic Helpers ---
def is_banned(username: str) -> Optional[str]:
    if username in bans:
        ban_expiry_val = bans[username]
        if ban_expiry_val is None:
            return "You are permanently banned."

        expiry_dt = ts_from_iso(ban_expiry_val)
        if expiry_dt and expiry_dt > datetime.now(timezone.utc):
            remaining = expiry_dt - datetime.now(timezone.utc)
            return f"You are banned for another {int(remaining.total_seconds() / 60)} minutes."
        elif expiry_dt:
            # Ban has expired
            del bans[username]
            save_state()
    return None

def is_muted(user: User) -> Optional[str]:
    if user.muted_until and user.muted_until > datetime.now(timezone.utc):
        remaining = user.muted_until - datetime.now(timezone.utc)
        return f"You are still muted for {int(remaining.total_seconds())}s."
    return None

# --- Persistence ---
def cleanup_expired_state():
    now = datetime.now(timezone.utc)

    expired_bans = [u for u, exp_str in bans.items() if exp_str and (expiry := ts_from_iso(exp_str)) and expiry <= now]
    for u in expired_bans:
        del bans[u]

    expired_mutes = [u for u, exp_str in mutes.items() if (expiry := ts_from_iso(exp_str)) and expiry <= now]
    for u in expired_mutes:
        del mutes[u]

    if expired_bans or expired_mutes:
        save_state()

def load_state():
    global bans, mutes
    if not os.path.exists(STATE_FILE):
        return
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            bans = data.get("bans", {})
            mutes = data.get("mutes", {})
            cleanup_expired_state()
    except (IOError, json.JSONDecodeError):
        pass

def save_state():
    try:
        with open(TEMP_STATE_FILE, "w") as f:
            json.dump({"bans": bans, "mutes": mutes}, f, indent=2)
        os.replace(TEMP_STATE_FILE, STATE_FILE)
    except (IOError, os.error):
        pass

async def state_cleanup_task():
    while True:
        await asyncio.sleep(60 * 5) # Run every 5 minutes
        cleanup_expired_state()

# --- User & Session Helpers ---
async def find_user_by_name(username: str) -> Optional[User]:
    async with connected_lock:
        for user in connected_users.values():
            if user.username == username:
                return user
    return None

async def is_username_in_use(username: str) -> bool:
    return await find_user_by_name(username) is not None

# --- Messaging Helpers ---
async def safe_send(ws: WebSocket, obj: dict):
    try:
        await ws.send_text(json.dumps(obj))
    except (WebSocketDisconnect, ConnectionError, RuntimeError):
        pass

async def broadcast(obj: dict, exclude_ids: Optional[Set[str]] = None):
    exclude = exclude_ids or set()
    async with connected_lock:
        tasks = [safe_send(u.ws, obj) for sid, u in connected_users.items() if sid not in exclude]
        if tasks:
            await asyncio.gather(*tasks)

async def send_to_user(username: str, obj: dict) -> bool:
    user = await find_user_by_name(username)
    if user:
        await safe_send(user.ws, obj)
        return True
    return False

async def send_to_admins(obj: dict, exclude_ids: Optional[Set[str]] = None):
    exclude = exclude_ids or set()
    async with connected_lock:
        tasks = [safe_send(u.ws, obj) for sid, u in connected_users.items() if sid not in exclude and u.role == "admin"]
        if tasks: await asyncio.gather(*tasks)

def get_users_list() -> List[Dict[str, Any]]:
    return [{"name": u.username, "role": u.role, "color": u.color} for u in connected_users.values()]

# --- Groq AI Helper ---
async def call_groq_api(user_prompt: str, system_prompt: Optional[str] = None, model: str = "llama3-8b-8192") -> str:
    if not GROQ_API_KEY:
        await asyncio.sleep(0.5)
        return f"[Simulated AI Response for '{model}'] You asked: '{user_prompt[:100]}...'"

    system_prompt = system_prompt or "You are a helpful assistant in a terminal-based chat application. Keep your answers concise and use markdown for formatting."

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "model": model
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_ENDPOINT, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:
        return f"[AI API Error] Received status {e.response.status_code}"
    except Exception:
        return "[AI API Error] Could not connect to AI service."

# --- Command Handlers ---
async def handle_admin_command(admin_user: User, raw_cmd: str):
    # ...
    pass

async def handle_message(user: User, data: dict):
    # ...
    pass

@app.get("/stats")
async def get_stats():
    return JSONResponse({"active_users": len(connected_users)})

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    session_id = uuid.uuid4().hex
    user: Optional[User] = None
    await ws.accept()

    try:
        auth_msg = await asyncio.wait_for(ws.receive_json(), timeout=15.0)
        if auth_msg.get("type") != "auth":
            await safe_send(ws, {"type": "auth_failed", "reason": "First message must be auth"})
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        req_name = (auth_msg.get("username") or "").strip()
        password = auth_msg.get("password")
        want_admin = bool(auth_msg.get("wantAdmin"))

        if not req_name or len(req_name) > 32:
            await safe_send(ws, {"type": "auth_failed", "reason": "Username must be 1-32 characters"})
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if ban_reason := is_banned(req_name):
            await safe_send(ws, {"type": "auth_failed", "reason": ban_reason})
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if await is_username_in_use(req_name):
            await safe_send(ws, {"type": "auth_failed", "reason": "Username is already in use"})
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        role = "user"
        if want_admin:
            if secrets.compare_digest(req_name, ADMIN_USERNAME) and secrets.compare_digest(password or "", ADMIN_PASSWORD):
                role = "admin"
            else:
                await safe_send(ws, {"type": "auth_failed", "reason": "Invalid admin credentials"})
                await ws.close(code=status.WS_1008_POLICY_VIOLATION)
                return

        user = User(websocket=ws, username=req_name, role=role)
        user.color = auth_msg.get("color")

        async with connected_lock:
            connected_users[session_id] = user

        await safe_send(ws, {"type": "auth_ok", "username": user.username, "role": user.role})
        await broadcast({"type": "user_join", "user": {"name": user.username, "role": user.role, "color": user.color}}, exclude_ids={session_id})
        await send_to_user(user.username, {"type": "users", "users": get_users_list()})

        welcome_prompt = f"Generate a short, cool, and welcoming message for a user named '{user.username}' who just joined the '{APP_NAME}' chat server. Keep it under 20 words. Be creative and welcoming. Your response will be displayed in a terminal."
        welcome_message = await call_groq_api(welcome_prompt, system_prompt="You are a helpful and friendly assistant in a terminal-based chat application.", model="llama3-8b-8192")
        await send_to_user(user.username, {"type": "system", "text": welcome_message})

        while True:
            try:
                data = await ws.receive_json()
                await handle_message(user, data)
            except json.JSONDecodeError:
                await safe_send(ws, {"type": "error", "text": "Invalid message format."})
                continue

    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        async with connected_lock:
            if session_id in connected_users:
                user = connected_users.pop(session_id)
                await broadcast({"type": "user_leave", "user": {"name": user.username, "role": user.role, "color": user.color}})
                await broadcast({"type": "system", "text": f"{user.username} has left the chat."})

@app.on_event("startup")
async def startup_event():
    load_state()
    asyncio.create_task(state_cleanup_task())

@app.on_event("shutdown")
def shutdown_event():
    save_state()

@app.get("/")
async def root():
    return HTMLResponse("<h1>Akatsuki Server</h1>")

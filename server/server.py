#!/usr/bin/env python3
"""
Akatsuki - simple ephemeral single-room WebSocket chat server.
"""
import os
import asyncio
import json
import uuid
import secrets
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Any, Set, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
from dotenv import load_dotenv

load_dotenv()

# --- Basic Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

APP_NAME = "Akatsuki"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Aadish")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Aadish20m")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

# --- AI Model Configuration ---
MODEL_ALIASES = {
    "gpt": "openai/gpt-oss-120b",
    "llama": "meta-llama/llama-4-maverick-17b-128e-instruct",
    "deepseek": "deepseek-r1-distill-llama-70b",
    "qwen": "qwen/qwen3-32b",
    "compound": "compound-beta-oss",
}
DEFAULT_MODEL = "compound-beta-oss"

# --- Whitelist Configuration ---
WHITELISTED_USERS = {"Prakhar", "Priyanshu", "Summit", "Aditya", "Yuvraj", "Yash"}
TEMPORARY_WHITELIST = set()

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
        self.session_id = uuid.uuid4().hex

connected_users: Dict[str, User] = {}
bans: Dict[str, Optional[str]] = {}
mutes: Dict[str, str] = {}
connected_lock = asyncio.Lock()
state_lock = asyncio.Lock()

def ts_iso(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.isoformat()

def ts_from_iso(iso_str: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None

# --- Persistence ---
def save_state():
    logging.info("Attempting to save state to disk...")
    try:
        with open(TEMP_STATE_FILE, "w") as f:
            json.dump({"bans": bans, "mutes": mutes}, f, indent=2)
        os.replace(TEMP_STATE_FILE, STATE_FILE)
        logging.info("State saved successfully.")
    except (IOError, os.error) as e:
        logging.error(f"Failed to save state: {e}")

async def async_save_state():
    async with state_lock:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, save_state)

def cleanup_expired_state():
    now = datetime.now(timezone.utc)
    changed = False
    for u, exp_str in list(bans.items()):
        if exp_str and (expiry := ts_from_iso(exp_str)) and expiry <= now:
            del bans[u]
            changed = True
    for u, exp_str in list(mutes.items()):
        if (expiry := ts_from_iso(exp_str)) and expiry <= now:
            del mutes[u]
            changed = True
    if changed: save_state()

def load_state():
    global bans, mutes
    if not os.path.exists(STATE_FILE): return
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            bans = data.get("bans", {})
            mutes = data.get("mutes", {})
            cleanup_expired_state()
            logging.info("Server state loaded successfully.")
    except (IOError, json.JSONDecodeError) as e:
        logging.error(f"Failed to load state: {e}")

async def state_cleanup_task():
    while True:
        await asyncio.sleep(60 * 5)
        logging.info("Running periodic state cleanup task...")
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, cleanup_expired_state)
        except Exception as e:
            logging.error(f"Error in state_cleanup_task: {e}", exc_info=True)

# --- Business Logic Helpers ---
async def is_banned(username: str) -> Optional[str]:
    username_lower = username.lower()
    for ban_user, ban_expiry_val in bans.items():
        if ban_user.lower() == username_lower:
            if ban_expiry_val is None: return "You are permanently banned."
            expiry_dt = ts_from_iso(ban_expiry_val)
            if expiry_dt and expiry_dt > datetime.now(timezone.utc):
                remaining = expiry_dt - datetime.now(timezone.utc)
                return f"You are banned for another {int(remaining.total_seconds() / 60)} minutes."
            elif expiry_dt:
                del bans[ban_user]
                await async_save_state()
                return None
    return None

async def is_muted(username: str) -> Optional[str]:
    username_lower = username.lower()
    for mute_user, mute_expiry_val in mutes.items():
        if mute_user.lower() == username_lower:
            expiry_dt = ts_from_iso(mute_expiry_val)
            if expiry_dt and expiry_dt > datetime.now(timezone.utc):
                remaining = expiry_dt - datetime.now(timezone.utc)
                return f"You are muted for another {int(remaining.total_seconds())}s."
            elif expiry_dt:
                del mutes[mute_user]
                await async_save_state()
                return None
    return None

# --- User & Session Helpers ---
async def find_user_by_name(username: str) -> Optional[User]:
    username_lower = username.lower()
    async with connected_lock:
        for user in connected_users.values():
            if user.username.lower() == username_lower:
                return user
    return None

async def is_username_in_use(username: str) -> bool:
    return await find_user_by_name(username) is not None

# --- Messaging Helpers ---
async def safe_send(ws: WebSocket, obj: dict):
    try: await ws.send_text(json.dumps(obj))
    except (WebSocketDisconnect, ConnectionError, RuntimeError): pass

async def broadcast(obj: dict, exclude_ids: Optional[Set[str]] = None):
    exclude = exclude_ids or set()
    async with connected_lock:
        tasks = [safe_send(u.ws, obj) for sid, u in connected_users.items() if sid not in exclude]
        if tasks: await asyncio.gather(*tasks)

async def send_to_user(username: str, obj: dict) -> bool:
    user = await find_user_by_name(username)
    if user:
        await safe_send(user.ws, obj)
        return True
    return False

def get_users_list() -> List[Dict[str, Any]]:
    return [{"name": u.username, "role": u.role} for u in connected_users.values()]

# --- Groq AI Helper ---
async def call_groq_api(user_prompt: str, system_prompt: Optional[str] = None, model: str = DEFAULT_MODEL) -> str:
    if not GROQ_API_KEY:
        await asyncio.sleep(0.5)
        return f"[Simulated AI Response for {model}] You asked: '{user_prompt[:100]}...'"

    system_prompt = system_prompt or "You are a helpful assistant."
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    payload = {
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        "model": model
    }

    if model == "openai/gpt-oss-120b":
        payload["tools"] = [{"type": "browser_search"}, {"type": "code_interpreter"}]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(GROQ_ENDPOINT, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e: return f"[AI API Error] Status {e.response.status_code}"
    except Exception as e: return f"[AI API Error] Could not connect: {e}"

# --- Command Handlers ---
def parse_command_args(args: List[str]) -> (Set[str], List[str]):
    users, remaining_args = set(), []
    for arg in args:
        if arg.startswith('@'): users.add(arg[1:])
        else: remaining_args.append(arg)
    return users, remaining_args

async def handle_admin_command(admin_user: User, raw_cmd: str):
    parts = raw_cmd.strip().split()
    cmd, args = parts[0].lower(), parts[1:]
    changed_state = False

    if cmd == "/login":
        target_users, _ = parse_command_args(args)
        if not target_users:
            return await safe_send(admin_user.ws, {"type": "system", "text": "Usage: /login @username"})
        for username in target_users:
            TEMPORARY_WHITELIST.add(username.lower())
            await safe_send(admin_user.ws, {"type": "system", "text": f"User '{username}' has been temporarily whitelisted to join."})
        return

    if cmd == "/clearall":
        await broadcast({"type": "clear_chat"})
        await broadcast({"type": "system", "text": f"Chat history cleared by {admin_user.username}."})
        return

    if cmd in ("/broadcast", "/b"):
        message = " ".join(args)
        if not message: await safe_send(admin_user.ws, {"type": "system", "text": "Usage: /broadcast <message>"})
        else: await broadcast({"type": "broadcast", "from": admin_user.username, "text": message, "ts": ts_iso()})
        return

    if cmd == "/clearbroadcast":
        await broadcast({"type": "clear_broadcast"})
        return

    target_users, remaining_args = parse_command_args(args)
    if not target_users:
        return await safe_send(admin_user.ws, {"type": "system", "text": "You must specify at least one user with @mention."})

    duration_min = int(remaining_args.pop(0)) if remaining_args and remaining_args[0].isdigit() else None
    reason = " ".join(remaining_args) or "No reason specified."

    for username in target_users:
        target_user = await find_user_by_name(username)
        if cmd == "/kick" and target_user:
            await safe_send(target_user.ws, {"type": "system", "text": f"Kicked by admin. Reason: {reason}"})
            await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)
            await broadcast({"type": "system", "text": f"{username} was kicked by {admin_user.username}."})
        elif cmd == "/ban":
            changed_state = True
            bans[username] = ts_iso(datetime.now(timezone.utc) + timedelta(minutes=duration_min)) if duration_min else None
            d_str = f"for {duration_min} minutes" if duration_min else "permanently"
            await broadcast({"type": "system", "text": f"{username} was banned {d_str} by {admin_user.username}."})
            if target_user:
                await safe_send(target_user.ws, {"type": "system", "text": f"You have been banned {d_str}."})
                await target_user.ws.close(code=status.WS_1008_POLICY_VIOLATION)
        elif cmd == "/unban":
            user_to_unban = next((u for u in bans if u.lower() == username.lower()), None)
            if user_to_unban:
                del bans[user_to_unban]
                changed_state = True
                await broadcast({"type": "system", "text": f"{username} was unbanned by {admin_user.username}."})
        elif cmd == "/mute":
            changed_state = True
            d_min = duration_min or 5
            mutes[username] = ts_iso(datetime.now(timezone.utc) + timedelta(minutes=d_min))
            await broadcast({"type": "system", "text": f"{username} was muted for {d_min} min by {admin_user.username}."})
            if target_user: await send_to_user(username, {"type": "system", "text": f"You are muted for {d_min} min."})
        elif cmd == "/unmute":
            user_to_unmute = next((u for u in mutes if u.lower() == username.lower()), None)
            if user_to_unmute:
                del mutes[user_to_unmute]
                changed_state = True
                await broadcast({"type": "system", "text": f"{username} was unmuted by {admin_user.username}."})

    if changed_state: await async_save_state()

async def handle_message(user: User, data: dict):
    typ = data.get("type")

    if typ in ("message", "pm"):
        if mute_reason := await is_muted(user.username):
            await safe_send(user.ws, {"type": "system", "text": mute_reason})
            return

    if typ == "message":
        await broadcast({"type": "message", "id": data.get("id", str(uuid.uuid4())), "from": user.username, "text": data.get("text", ""), "ts": ts_iso()})
    elif typ == "command":
        if user.role == "admin": await handle_admin_command(user, data.get("raw", ""))
        else: await safe_send(user.ws, {"type": "system", "text": "You do not have permission to use admin commands."})
    elif typ == "nick":
        new_nick = (data.get("toNick") or "").strip()
        if new_nick and 1 <= len(new_nick) <= 32 and not await is_username_in_use(new_nick) and new_nick.lower() != ADMIN_USERNAME.lower():
            old_nick, user.username = user.username, new_nick
            await broadcast({"type": "system", "text": f"{old_nick} is now known as {new_nick}."})
            async with connected_lock: await broadcast({"type": "users", "users": get_users_list()})
        else: await safe_send(user.ws, {"type": "system", "text": "Invalid or taken nickname."})
    elif typ == "pm":
        recipients, text = data.get("to", []), data.get("text", "")
        if recipients and text:
            pm_payload = {**data, "from": user.username}
            for r_name in recipients:
                if not await send_to_user(r_name, pm_payload):
                    await safe_send(user.ws, {"type": "system", "text": f"User '{r_name}' not found."})
            await safe_send(user.ws, pm_payload)
    elif typ == "ai":
        prompt_parts = data.get("text", "").split()
        model_alias = "compound"
        final_prompt_list = []

        if len(prompt_parts) > 2 and prompt_parts[0] == "--model":
            model_alias = prompt_parts[1].lower()
            final_prompt_list = prompt_parts[2:]
        else:
            final_prompt_list = prompt_parts

        model_id = MODEL_ALIASES.get(model_alias, DEFAULT_MODEL)
        prompt_text = " ".join(final_prompt_list)

        if not prompt_text:
            return await safe_send(user.ws, {"type": "system", "text": "Usage: /ai [--model <name>] <prompt>"})

        await broadcast({"type": "system", "text": f"{user.username} is asking the AI ({model_alias})..."})
        response = await call_groq_api(prompt_text, model=model_id)
        await broadcast({"type": "ai_resp", "id": str(uuid.uuid4()), "from": "AI", "text": response, "ts": ts_iso()})

@app.get("/stats")
async def get_stats(): return JSONResponse({"active_users": len(connected_users)})

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    user: Optional[User] = None
    await ws.accept()
    try:
        auth_msg = await asyncio.wait_for(ws.receive_json(), timeout=15.0)
        if auth_msg.get("type") != "auth":
            return await safe_send(ws, {"type": "auth_failed", "reason": "First message must be auth"})

        req_name = (auth_msg.get("username") or "").strip()
        req_name_lower = req_name.lower()

        if not req_name or len(req_name) > 32:
            return await safe_send(ws, {"type": "auth_failed", "reason": "Username must be 1-32 characters"})
        if ban_reason := await is_banned(req_name):
            return await safe_send(ws, {"type": "auth_failed", "reason": ban_reason})
        if await is_username_in_use(req_name):
            return await safe_send(ws, {"type": "auth_failed", "reason": "Username is already in use"})

        is_whitelisted = any(u.lower() == req_name_lower for u in WHITELISTED_USERS)
        is_temp_whitelisted = req_name_lower in TEMPORARY_WHITELIST
        is_test_user = re.match(r'^test\d+$', req_name_lower) is not None
        is_admin_user = req_name_lower == ADMIN_USERNAME.lower()

        if not (is_whitelisted or is_temp_whitelisted or is_test_user or is_admin_user):
            return await safe_send(ws, {"type": "auth_failed", "reason": "You are not authorized to join this server."})

        role = "user"
        if is_admin_user:
            password = auth_msg.get("password")
            if secrets.compare_digest(password or "", ADMIN_PASSWORD):
                role = "admin"
            else: return await safe_send(ws, {"type": "auth_failed", "reason": "Invalid admin credentials"})

        user = User(websocket=ws, username=req_name, role=role)

        if req_name_lower in TEMPORARY_WHITELIST:
            TEMPORARY_WHITELIST.remove(req_name_lower)

        users_list = []
        async with connected_lock:
            connected_users[user.session_id] = user
            users_list = get_users_list()

        await safe_send(ws, {"type": "auth_ok", "username": user.username, "role": user.role})
        await broadcast({"type": "user_join", "user": {"name": user.username, "role": user.role}}, exclude_ids={user.session_id})
        await safe_send(ws, {"type": "users", "users": users_list})

        welcome_prompt = f"Generate a short, cool, welcoming message for '{user.username}' joining '{APP_NAME}' chat."
        welcome_message = await call_groq_api(welcome_prompt, model="llama3-8b-8192")
        await safe_send(ws, {"type": "system", "text": welcome_message})

        while True:
            data = await ws.receive_json()
            await handle_message(user, data)
    except (WebSocketDisconnect, asyncio.TimeoutError, json.JSONDecodeError): pass
    finally:
        if user:
            async with connected_lock:
                if user.session_id in connected_users: del connected_users[user.session_id]
            await broadcast({"type": "user_leave", "user": {"name": user.username, "role": user.role}})
            await broadcast({"type": "system", "text": f"{user.username} has left the chat."})

@app.on_event("startup")
async def startup_event():
    load_state()
    asyncio.create_task(state_cleanup_task())
@app.on_event("shutdown")
def shutdown_event(): save_state()
@app.get("/")
async def root(): return HTMLResponse("<h1>Akatsuki Server</h1>")

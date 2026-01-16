#!/usr/bin/env python3
import socket
import ssl
import json
import threading
import sys
import base64
import os
import struct
import time
import getpass

# Configuration (will be replaced by server when served)
HOST = "localhost"
PORT = 8000
SECURE = False
PATH = "/ws"
ADMIN_USERNAME_PLACEHOLDER = "Admin" # Replaced by server
ADMIN_USERNAME = ADMIN_USERNAME_PLACEHOLDER

# Handle piped execution (e.g. curl | python3)
if not sys.stdin.isatty():
    try:
        if sys.platform == "win32":
            sys.stdin = open("CONIN$", "r")
        else:
            current_tty = os.ctermid() if hasattr(os, 'ctermid') else "/dev/tty"
            sys.stdin = open(current_tty, "r")
    except Exception as e:
        # Fallback or ignore
        pass

# ANSI colors
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
WHITE = "\033[37m"

def create_ws_key():
    return base64.b64encode(os.urandom(16)).decode('utf-8')

def build_ws_frame(data, opcode=0x1):
    msg = data.encode('utf-8')
    length = len(msg)
    frame = bytearray()
    frame.append(0x80 | opcode)  # FIN + opcode
    mask_key = os.urandom(4)
    if length <= 125:
        frame.append(0x80 | length)
    elif length <= 65535:
        frame.append(0x80 | 126)
        frame.extend(struct.pack('!H', length))
    else:
        frame.append(0x80 | 127)
        frame.extend(struct.pack('!Q', length))
    frame.extend(mask_key)
    masked_msg = bytearray(length)
    for i in range(length):
        masked_msg[i] = msg[i] ^ mask_key[i % 4]
    frame.extend(masked_msg)
    return frame

def parse_ws_frame(sock):
    head1 = sock.recv(1)
    if not head1: return None
    b1 = head1[0]
    final = b1 & 0x80
    opcode = b1 & 0x0F
    
    head2 = sock.recv(1)
    if not head2: return None
    b2 = head2[0]
    masked = b2 & 0x80
    length = b2 & 0x7F
    
    if length == 126:
        data = sock.recv(2)
        length = struct.unpack('!H', data)[0]
    elif length == 127:
        data = sock.recv(8)
        length = struct.unpack('!Q', data)[0]
    
    if masked:
        mask_key = sock.recv(4)
        
    payload = b''
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk: break
        payload += chunk
        
    if masked:
        unmasked = bytearray(length)
        for i in range(length):
            unmasked[i] = payload[i] ^ mask_key[i % 4]
        payload = unmasked
        
    if opcode == 0x8: return None
    if opcode == 0x9: return "PING" # Ping
    try:
        if opcode == 0x1: return payload.decode('utf-8')
    except: pass
    return None

def connect():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if SECURE:
        ctx = ssl.create_default_context()
        s = ctx.wrap_socket(s, server_hostname=HOST)
    
    try:
        s.connect((HOST, PORT))
    except Exception as e:
        print(f"{RED}Connection failed: {e}{RESET}")
        sys.exit(1)
        
    key = create_ws_key()
    headers = [
        f"GET {PATH} HTTP/1.1",
        f"Host: {HOST}:{PORT}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
        "\r\n"
    ]
    s.sendall("\r\n".join(headers).encode('utf-8'))
    
    response_header = b""
    while b"\r\n\r\n" not in response_header:
        chunk = s.recv(1024)
        if not chunk:
            print(f"{RED}Server closed connection during handshake{RESET}")
            sys.exit(1)
        response_header += chunk
        
    if b"101 Switching Protocols" not in response_header:
        print(f"{RED}Handshake failed{RESET}")
        sys.exit(1)
    return s

def receive_loop(sock):
    while True:
        try:
            msg = parse_ws_frame(sock)
            if msg is None:
                print(f"\n{RED}Disconnected from server.{RESET}")
                os._exit(0)
            if msg == "PING": continue
            
            try:
                data = json.loads(msg)
                handle_server_message(data)
            except json.JSONDecodeError: pass
        except Exception as e:
            print(f"\n{RED}Error receiving: {e}{RESET}")
            os._exit(1)

def handle_server_message(data):
    typ = data.get("type")
    
    if typ == "message":
        sender = data.get("from", "Unknown")
        text = data.get("text", "")
        # Try to make message look distinct
        print(f"\r{CYAN}{BOLD}{sender}{RESET}: {text}")
        print_prompt()
        
    elif typ == "broadcast":
        sender = data.get("from", "System")
        text = data.get("text", "")
        print(f"\r{YELLOW}{BOLD}[BROADCAST] {sender}: {text}{RESET}")
        print_prompt()

    elif typ == "system":
        text = data.get("text", "")
        print(f"\r{MAGENTA}[SYSTEM] {text}{RESET}")
        print_prompt()
        
    elif typ == "users":
        users = data.get("users", [])
        if users:
            print(f"\r{GREEN}{BOLD}Online Users ({len(users)}):{RESET} {', '.join([u['name'] for u in users])}")
        print_prompt()
        
    elif typ == "user_join":
        # Optional: Print join message if you want client-side join notifications separate from system messages
        user_data = data.get("user", {})
        name = user_data.get("name", "Someone")
        print(f"\r{GREEN}+ {name} joined.{RESET}")
        print_prompt()
        
    elif typ == "ai_resp":
        sender = data.get("from", "AI")
        text = data.get("text", "")
        print(f"\r{BLUE}{BOLD}{sender}{RESET}: {text}")
        print_prompt()
        
    elif typ == "auth_ok":
        print(f"\r{GREEN}{BOLD}Authenticated as {data.get('username')}{RESET}")
        print_prompt()
        
    elif typ == "auth_failed":
        print(f"\r{RED}{BOLD}Auth Failed: {data.get('reason')}{RESET}")
        os._exit(1)

def print_prompt():
    sys.stdout.write(f"\r{BOLD}> {RESET}")
    sys.stdout.flush()

def main():
    print(f"{BOLD}{CYAN}Welcome to Akatsuki Terminal Client (Lite){RESET}")
    print(f"{DIM}Commands: /nick <name>, /pm <user> <msg>, /ai <prompt>{RESET}")
    
    username = input(f"{BOLD}Enter Username: {RESET}").strip()
    if not username:
        username = f"Guest{int(time.time())}"
    
    password = None
    if username.lower() == ADMIN_USERNAME.lower():
        prompt_text = f"{BOLD}Enter Admin Password: {RESET}"
        
        # Try a robust method for password input especially on Windows
        try:
            import msvcrt
            sys.stdout.write(prompt_text)
            sys.stdout.flush()
            chars = []
            while True:
                ch = msvcrt.getch()
                if ch in {b'\r', b'\n'}:
                    sys.stdout.write('\n')
                    sys.stdout.flush()
                    break
                elif ch == b'\x03': # Ctrl+C
                    raise KeyboardInterrupt
                elif ch == b'\x08': # Backspace
                    if chars:
                        chars.pop()
                        sys.stdout.write('\b \b')
                        sys.stdout.flush()
                else:
                    chars.append(ch.decode('utf-8'))
                    sys.stdout.write('*')
                    sys.stdout.flush()
            password = "".join(chars)
        except ImportError:
            # Unix-like or fallback
            try:
                import getpass
                password = getpass.getpass(prompt_text)
            except Exception:
                # Last resort
                print(f"{YELLOW}Warning: Input might be visible.{RESET}")
                sys.stdout.write(prompt_text)
                sys.stdout.flush()
                password = sys.stdin.readline().strip()

    s = connect()
    
    # Auth
    auth_payload = {"type": "auth", "username": username}
    if password:
        auth_payload["password"] = password
        
    s.sendall(build_ws_frame(json.dumps(auth_payload)))
    
    # Start receiver
    t = threading.Thread(target=receive_loop, args=(s,), daemon=True)
    t.start()
    
    # Input loop
    while True:
        try:
            print_prompt()
            line = sys.stdin.readline()
            if not line: break
            line = line.strip()
            if not line: continue
            
            if line.lower() == "/quit":
                break
                
            msg = {"type": "message", "text": line}
            # Basic client-side command parsing for things that need to be packaged differently?
            # Actually server handles raw text for most, except maybe 'pm' if the server expects specific structure. 
            # Looking at server.py:
            # - /nick -> typ="nick", toNick="..."
            # - /pm -> typ="pm", to=[], text="..."
            # - /ai -> typ="ai", text="..."
            # - /command (admin) -> typ="command", raw="..."
            
            # Let's map these simple client commands to the JSON structure the server expects
            # Server handles messages with type "message" properly
            
            parts = line.split(" ")
            cmd = parts[0].lower()
            
            payload = {}
            if cmd == "/nick" and len(parts) > 1:
                payload = {"type": "nick", "toNick": parts[1]}
            elif cmd == "/pm" and len(parts) > 2:
                # /pm user1,user2 message...
                targets = parts[1].split(",")
                content = " ".join(parts[2:])
                payload = {"type": "pm", "to": targets, "text": content}
            elif cmd == "/ai" and len(parts) > 1:
                content = " ".join(parts[1:])
                payload = {"type": "ai", "text": content}
            elif cmd.startswith("/"):
                # Treat other slash commands as admin commands or plain messages?
                # Server.py handle_message -> if typ == "command" -> handle_admin_command
                # But ordinary messages are just type="message"
                # Admin commands are checked in handle_message: "elif typ == 'command': ... await handle_admin_command..."
                # So we should send admin commands as "command" type.
                # Common admin commands in server.py: /login, /clearall, /broadcast, /tag, /kick, etc.
                if cmd in ["/login", "/clearall", "/broadcast", "/b", "/clearbroadcast", "/tag", "/removetag", "/kick", "/ban", "/unban", "/mute", "/unmute"]:
                    payload = {"type": "command", "raw": line}
                else:
                    # Unknown command, send as message or ignore? Send as message so server might handle or user sees it's text
                    payload = {"type": "message", "text": line}
            else:
                payload = {"type": "message", "text": line}
                
            s.sendall(build_ws_frame(json.dumps(payload)))
        except KeyboardInterrupt:
            break
            
    print(f"\n{YELLOW}Exiting...{RESET}")
    s.close()
    sys.exit(0)

if __name__ == "__main__":
    main()

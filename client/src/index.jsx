#!/usr/bin/env node
import React, { useEffect, useRef, useState, useCallback } from "react";
import { render, Box, Text, useApp, useStdout, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import WebSocket from "ws";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";
import process from "process";
import crypto from "crypto";

const SERVER_NAME = "Akatsuki";
const DEFAULT_WS = process.env.WS_URL || "ws://localhost:8000/ws";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Aadish";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Aadish20m";

// --- Helper Functions ---
const nowISO = () => new Date().toISOString();
const shortTime = (iso) => new Date(iso || Date.now()).toLocaleTimeString();
const md5hex = (s) => crypto.createHash("md5").update(s || "").digest("hex").slice(0, 6);
const defaultColorFor = (name) => `#${md5hex(name)}`;

const colorize = (name, color) => {
  if (!color) return chalk.bold(name);
  if (color === "auto") return chalk.hex(defaultColorFor(name))(name);
  if (/^#?[0-9a-f]{6}$/i.test(color)) return chalk.hex(color.startsWith("#") ? color : `#${color}`).bold(name);
  try { return chalk.keyword(color)(name); } catch { return chalk.bold(name); }
};

// --- WebSocket Hook ---
function useWs(url, onOpen, onMsg, onClose, onError) {
  const wsRef = useRef(null);
  const retryRef = useRef({ attempt: 0, timer: null });
  const [status, setStatus] = useState("closed");

  useEffect(() => {
    if (!url) return;
    let mounted = true;
    const connect = () => {
      if (!mounted) return;
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.on("open", () => {
        retryRef.current.attempt = 0;
        setStatus("open");
        if (mounted) onOpen?.();
      });
      ws.on("message", (raw) => {
        try { if (mounted) onMsg?.(JSON.parse(raw.toString())); } catch (e) { /* ignore */ }
      });
      ws.on("close", (code) => {
        if (!mounted) return;
        setStatus("closed");
        onClose?.(code);
        retryRef.current.attempt++;
        const delay = Math.min(10000, 500 + retryRef.current.attempt * 700);
        setStatus("reconnecting");
        retryRef.current.timer = setTimeout(connect, delay);
      });
      ws.on("error", (err) => {
        if (mounted) onError?.(err);
      });
    };

    connect();
    return () => {
      mounted = false;
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, [url, onOpen, onMsg, onClose, onError]);

  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }, []);

  const close = useCallback(() => wsRef.current?.close(), []);

  return { send, close, status };
}

// --- UI Components ---
const MessageItem = React.memo(({ m, me }) => {
  const ts = shortTime(m.ts);
  if (m.type === "system") {
    return <Text dimColor italic>{`[${ts}] `}{chalk.gray(m.text)}</Text>;
  }
  if (m.type === "pm") {
    const fromLabel = m.from === me ? chalk.magenta.bold(`${m.from} (you)`) : chalk.magenta.bold(m.from);
    return <Text>{chalk.dim(`[${ts}] `)}{fromLabel}{chalk.dim(" -> ")}{chalk.yellow(m.to.join(","))}: {m.text}</Text>;
  }
  const mentionMe = me && m.text && m.text.includes(`@${me}`);
  const fromName = m.from ? colorize(m.from, m.color) : chalk.dim("system");
  const body = <Text>{chalk.dim(`[${ts}] `)}{fromName}: {m.text}</Text>;
  return mentionMe ? <Text backgroundColor="yellow" color="black">{body}</Text> : body;
});

const LoginUI = ({ onLogin, status }) => {
  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [isAskingPwd, setIsAskingPwd] = useState(false);

  const handleSubmitName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === ADMIN_USERNAME) setIsAskingPwd(true);
    else onLogin({ username: trimmed });
  };

  const handleSubmitPwd = () => onLogin({ username: name.trim(), password: pwd, wantAdmin: true });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold cyan>{SERVER_NAME}</Text>
        <Text dimColor>Status: {status}</Text>
      </Box>
      <Box borderStyle="single" padding={1} flexDirection="column">
        <Text bold>{isAskingPwd ? `Enter password for ${ADMIN_USERNAME}` : "Enter a username to join"}</Text>
        <Box marginTop={1}>
          {isAskingPwd ? (
            <TextInput mask="*" value={pwd} onChange={setPwd} onSubmit={handleSubmitPwd} placeholder="Admin password..." />
          ) : (
            <TextInput value={name} onChange={setName} onSubmit={handleSubmitName} placeholder="Your name..." />
          )}
        </Box>
      </Box>
      <Box marginTop={1}><Text dimColor>Press Ctrl+C to exit.</Text></Box>
    </Box>
  );
};

function parseMentions(parts) {
  const recipients = new Set();
  let messageStartIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (token.startsWith("@")) {
      token.split(',').forEach(p => {
        const cleaned = p.trim().replace(/^@/, '');
        if (cleaned) recipients.add(cleaned);
      });
    } else {
      messageStartIndex = i;
      break;
    }
  }
  const message = messageStartIndex === -1 ? "" : parts.slice(messageStartIndex).join(" ");
  return { recipients: Array.from(recipients), message };
}

// --- Main Chat Component ---
const Chat = ({ initialWsUrl }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [authInfo, setAuthInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [input, setInput] = useState("");
  const [helpVisible, setHelpVisible] = useState(false);
  const [wsUrl, setWsUrl] = useState(null);

  const authInfoRef = useRef(authInfo);
  authInfoRef.current = authInfo;

  const pushSys = useCallback((text) => setMessages(m => [...m, { id: uuidv4(), type: "system", text, ts: nowISO() }]), []);

  const onOpen = useCallback(() => {
    pushSys("Connection open. Authenticating...");
    if (authInfoRef.current) ws.send({ type: "auth", ...authInfoRef.current });
  }, []);

  const onMsg = useCallback((data) => {
    if (!data?.type) return;
    switch (data.type) {
      case "auth_ok":
        setAuthInfo(auth => ({...auth, username: data.username, isAdmin: data.role === "admin" }));
        setMessages([]); // Clear auth messages
        pushSys(`Authenticated as ${data.username} (${data.role}). Welcome!`);
        break;
      case "auth_failed":
        pushSys(`Auth failed: ${data.reason}. Please restart.`);
        setWsUrl(null);
        break;
      case "users": setUsers(data.users || []); break;
      case "user_join":
        setUsers(u => [...u, data.user].sort((a, b) => a.name.localeCompare(b.name)));
        break;
      case "user_leave":
        setUsers(u => u.filter(x => x.name !== data.user.name));
        break;
      case "message": case "ai_resp": case "pm": case "reaction": case "system":
        setMessages(m => [...m, { id: data.id || uuidv4(), ...data }]);
        break;
      default: pushSys(`Received unknown message type: ${JSON.stringify(data)}`);
    }
  }, [pushSys]);

  const onClose = useCallback((code) => pushSys(`Disconnected (code: ${code}). Reconnecting...`), [pushSys]);
  const onError = useCallback((err) => pushSys(`Connection error: ${err.message || "Unknown"}`), [pushSys]);

  const ws = useWs(wsUrl, onOpen, onMsg, onClose, onError);

  const handleCommand = (text) => {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    let sent = false;

    switch(cmd) {
      case "/quit": case "/exit": ws.close(); exit(); return;
      case "/help": setHelpVisible(v => !v); return;
      case "/clear": setMessages([]); return;
      case "/nick":
        if (!args[0]) { pushSys("Usage: /nick <newname>"); return; }
        sent = ws.send({ type: "nick", toNick: args[0] });
        break;
      case "/color":
        if (!args[0]) { pushSys("Usage: /color <#RRGGBB|auto|off|colorname>"); return; }
        const c = args[0].toLowerCase() === "off" ? null : args[0];
        setAuthInfo(auth => ({...auth, color: c}));
        sent = ws.send({ type: "color", color: c });
        break;
      case "/pm": case "/dm": {
        const { recipients, message } = parseMentions(args);
        if (!recipients.length || !message) { pushSys("Usage: /pm @user message..."); return; }
        const payload = { type: "pm", id: uuidv4(), from: authInfo.username, to: recipients, text: message, ts: nowISO() };
        sent = ws.send(payload);
        break;
      }
      default:
        sent = ws.send({ type: "command", raw: text });
    }
    if (sent) setInput("");
    else if (cmd !== "/help" && cmd !== "/clear") pushSys("Command could not be sent. You may be disconnected.");
  };

  const submit = (text) => {
    const trimmed = text.trim();
    if (!trimmed || !authInfo) return;
    if (trimmed.startsWith("/")) return handleCommand(trimmed);
    const payload = { type: "message", id: uuidv4(), from: authInfo.username, text: trimmed, ts: nowISO(), color: authInfo.color };
    if (ws.send(payload)) setInput("");
    else pushSys("Message could not be sent. You may be disconnected.");
  };

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === "c") { ws.close(); exit(); }
    if (key.escape) setHelpVisible(false);
  }, { isActive: !!authInfo });

  const handleLogin = useCallback((loginData) => {
    setAuthInfo(loginData);
    setWsUrl(initialWsUrl);
  }, [initialWsUrl]);

  if (!authInfo) return <LoginUI onLogin={handleLogin} status={ws.status} />;

  // IMPROVEMENT: More accurate height calculation for more message space.
  const maxMsgLines = Math.max(8, (stdout?.rows || 24) - 8);
  const visibleMessages = messages.slice(-maxMsgLines);

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* --- HEADER (Fixed) --- */}
      <Box paddingX={2} flexShrink={0}>
        <Box justifyContent="space-between" width="100%">
          <Text bold color="cyan">{SERVER_NAME}</Text>
          <Text>{ws.status === "open" ? chalk.green("● Connected") : <><Spinner type="dots" /> <Text dimColor>{ws.status}</Text></>}</Text>
        </Box>
      </Box>

      {/* --- CONTENT (Scrollable) --- */}
      <Box flexGrow={1} flexShrink={1} paddingY={1} flexDirection="row">
        <Box flexGrow={1} borderStyle="round" paddingX={1} marginRight={1} flexDirection="column">
          {visibleMessages.map((m) => <MessageItem key={m.id} m={m} me={authInfo.username} />)}
        </Box>
        <Box width="25%" borderStyle="round" paddingX={1} flexDirection="column">
          <Text bold>Users ({users.length})</Text>
          {users.map((u) => (
            <Text key={u.name}>
              {/* IMPROVEMENT: Bolder admin tag */}
              {u.role === "admin" ? chalk.red.bold("A ") : "  "}
              {colorize(u.name, u.color)}
              {u.name === authInfo.username ? chalk.dim(" (you)") : ""}
            </Text>
          ))}
        </Box>
      </Box>

      {/* --- FOOTER (Fixed) --- */}
      <Box paddingX={2} flexDirection="column" flexShrink={0}>
        <Text dimColor>Logged in as: {colorize(authInfo.username, authInfo.color)}{authInfo.isAdmin && chalk.red(" (Admin)")}. Type /help for commands.</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Say something..." />
        {helpVisible && (
          <Box marginTop={1} borderStyle="round" padding={1} flexDirection="column">
            <Text bold>Commands</Text>
            <Text>/nick &lt;new&gt; — Change nickname</Text>
            <Text>/color &lt;name|#hex&gt; — Set username color</Text>
            <Text>/pm &lt;@user...&gt; &lt;msg&gt; — Send a private message</Text>
            <Text>/clear — Clear messages locally</Text>
            <Text>/help — Toggle this help panel</Text>
            <Text>/exit — Quit the application</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

render(<Chat initialWsUrl={DEFAULT_WS} />);

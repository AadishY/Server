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
import https from "https";

const SERVER_NAME = "Akatsuki";
// The client will use the 'wss' protocol for secure connections
// if it's running in a browser, but for a simple Node.js app
// a plain 'ws' connection might be sufficient on some hosts.
// It is best practice to use the secure protocol, 'wss'.
const RENDER_URL = "wss://server-19jl.onrender.com/ws";
const RENDER_STATS_URL = "https://server-19jl.onrender.com/stats";
const DEFAULT_WS = process.env.WS_URL || RENDER_URL;
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

const formatMessage = (text) => {
  const parts = text.split(/(\*[^*]+\*|~[^~]+~)/g);
  return parts.map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*")) {
      return <Text key={i} bold>{part.slice(1, -1)}</Text>;
    }
    if (part.startsWith("~") && part.endsWith("~")) {
      return <Text key={i} strikethrough>{part.slice(1, -1)}</Text>;
    }
    return part;
  });
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
  if (m.type === "broadcast") {
    return (
      <Box borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text color="magentaBright" bold>
          {`[BROADCAST from ${m.from} at ${ts}] `}
          {formatMessage(m.text)}
        </Text>
      </Box>
    );
  }
  if (m.type === "pm") {
    const fromLabel = m.from === me ? chalk.magenta.bold(`${m.from} (you)`) : chalk.magenta.bold(m.from);
    return <Text>{chalk.dim(`[${ts}] `)}{fromLabel}{chalk.dim(" -> ")}{chalk.yellow(m.to.join(","))}: {formatMessage(m.text)}</Text>;
  }
  if (m.from === "AI") {
    return <Text color="blueBright">{chalk.dim(`[${ts}] `)}{chalk.bold(m.from)}: {formatMessage(m.text)}</Text>;
  }
  const mentionMe = me && m.text && m.text.includes(`@${me}`);
  const fromName = m.from ? colorize(m.from, m.color) : chalk.dim("system");
  const body = <Text>{chalk.dim(`[${ts}] `)}{fromName}: {formatMessage(m.text)}</Text>;
  return mentionMe ? <Text backgroundColor="yellow" color="black">{body}</Text> : body;
});

const WAKING_MESSAGES = [
  "Waking the server up...",
  "Running Aadish's server...",
  "Fixing the bugs...",
  "Polishing the pixels...",
  "Reticulating splines...",
  "Almost there...",
];

const LoginUI = ({ onLogin, status, error }) => {
  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [isAskingPwd, setIsAskingPwd] = useState(false);
  const [wakingMessageIndex, setWakingMessageIndex] = useState(0);
  const [activeUsers, setActiveUsers] = useState(null);

  useEffect(() => {
    const fetchStats = () => {
      https.get(RENDER_STATS_URL, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const stats = JSON.parse(data);
            setActiveUsers(stats.active_users);
          } catch (e) { /* ignore */ }
        });
      }).on('error', () => { /* ignore */ });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") {
      const interval = setInterval(() => {
        setWakingMessageIndex((prevIndex) => (prevIndex + 1) % WAKING_MESSAGES.length);
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [status]);

  const handleSubmitName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === ADMIN_USERNAME) setIsAskingPwd(true);
    else onLogin({ username: trimmed });
  };

  const handleSubmitPwd = () => onLogin({ username: name.trim(), password: pwd, wantAdmin: true });

  if (status === "connecting" || status === "reconnecting") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" alignItems="center">
        <Spinner type="dots" />
        <Text bold cyan>{WAKING_MESSAGES[wakingMessageIndex]}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold cyan>{SERVER_NAME}</Text>
        <Text dimColor>
          {activeUsers !== null ? `${activeUsers} users online` : "..."}
        </Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      <Box borderStyle="round" padding={1} flexDirection="column">
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

const UserList = React.memo(({ users, me }) => {
  return (
    <Box width="25%" borderStyle="round" paddingX={1} flexDirection="column">
      <Text bold>Users ({users.length})</Text>
      {users.map((u) => (
        <Box key={u.name}>
          <Text>
            {u.role === "admin" ? <Text backgroundColor="red" color="whiteBright" bold> ADMIN </Text> : "       "}
          </Text>
          <Text>
            {' '}
            {colorize(u.name, u.color)}
            {u.name === me ? chalk.dim(" (you)") : ""}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [loginError, setLoginError] = useState(null);

  const authInfoRef = useRef(authInfo);
  authInfoRef.current = authInfo;

  const isScrolledUp = scrollOffset > 0;

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
        setLoginError(null);
        setMessages([]); // Clear auth messages
        pushSys(`Authenticated as ${data.username} (${data.role}). Welcome!`);
        break;
      case "auth_failed":
        setLoginError(data.reason);
        setAuthInfo(null);
        setWsUrl(null);
        break;
      case "users": setUsers(data.users || []); break;
      case "user_join":
        setUsers(u => [...u, data.user].sort((a, b) => a.name.localeCompare(b.name)));
        break;
      case "user_leave":
        setUsers(u => u.filter(x => x.name !== data.user.name));
        break;
      case "clear_chat":
        setMessages([]);
        break;
      case "message": case "ai_resp": case "pm": case "reaction": case "system": case "broadcast":
        setMessages(m => [...m, { id: data.id || uuidv4(), ...data }]);
        if (!isScrolledUp) {
          setScrollOffset(0);
        }
        break;
      default: pushSys(`Received unknown message type: ${JSON.stringify(data)}`);
    }
  }, [isScrolledUp]);

  const onClose = useCallback((code) => pushSys(`Disconnected (code: ${code}). Reconnecting...`), [pushSys]);
  const onError = useCallback((err) => pushSys(`Connection error: ${err.message || "Unknown"}`), [pushSys]);

  const ws = useWs(wsUrl, onOpen, onMsg, onClose, onError);

  useEffect(() => {
    if (helpVisible) {
      const timer = setTimeout(() => {
        setHelpVisible(false);
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [helpVisible]);

  const handleCommand = (text) => {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    let sent = false;

    switch(cmd) {
      case "/e":
      case "/quit":
      case "/exit":
        ws.close();
        exit();
        return;
      case "/help":
        setHelpVisible(v => !v);
        return;
      case "/clear":
        if (authInfo.isAdmin) {
          sent = ws.send({ type: "command", raw: "/clearall" });
        } else {
          setMessages([]);
        }
        return;
      case "/nick":
        if (!args[0]) { pushSys("Usage: /nick <newname>"); return; }
        sent = ws.send({ type: "nick", toNick: args[0] });
        break;
      case "/c":
      case "/color": {
        let c = args[0];
        if (!c) {
          c = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
        } else if (c.toLowerCase() === "off") {
          c = null;
        }
        setAuthInfo(auth => ({...auth, color: c}));
        sent = ws.send({ type: "color", color: c });
        break;
      }
      case "/pm": case "/dm": {
        const { recipients, message } = parseMentions(args);
        if (!recipients.length || !message) { pushSys("Usage: /pm @user message..."); return; }
        const payload = { type: "pm", id: uuidv4(), from: authInfo.username, to: recipients, text: message, ts: nowISO() };
        sent = ws.send(payload);
        break;
      }
      case "/ai": {
        const prompt = args.join(" ");
        if (!prompt) { pushSys("Usage: /ai <prompt...>"); return; }
        setMessages(m => [...m, { id: uuidv4(), type: "message", from: authInfo.username, text: `(to AI) ${prompt}`, ts: nowISO(), color: authInfo.color }]);
        sent = ws.send({ type: "ai", text: prompt });
        break;
      }
      case "/b": {
        if (!authInfo.isAdmin) {
          pushSys("Only admins can broadcast messages.");
          return;
        }
        const message = args.join(" ");
        if (!message) { pushSys("Usage: /b <message>"); return; }
        sent = ws.send({ type: "command", raw: `/broadcast ${message}` });
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

  useInput((input, key) => {
    if (key.ctrl && input === "c") { ws.close(); exit(); }
    if (key.escape) setHelpVisible(false);
    if (key.upArrow) setScrollOffset(o => Math.min(messages.length - 1, o + 1));
    if (key.downArrow) setScrollOffset(o => Math.max(0, o - 1));
  }, { isActive: !!authInfo });

  const handleLogin = useCallback((loginData) => {
    setLoginError(null);
    setAuthInfo(loginData);
    setWsUrl(initialWsUrl);
  }, [initialWsUrl]);

  if (!authInfo) return <LoginUI onLogin={handleLogin} status={ws.status} error={loginError} />;

  const maxMsgLines = Math.max(8, (stdout?.rows || 24) - 8);
  const endIndex = messages.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxMsgLines);
  const visibleMessages = messages.slice(startIndex, endIndex);

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
        <UserList users={users} me={authInfo.username} />
      </Box>

      {/* --- FOOTER (Fixed) --- */}
      <Box paddingX={2} flexDirection="column" flexShrink={0}>
        <Text dimColor>Logged in as: {colorize(authInfo.username, authInfo.color)}{authInfo.isAdmin && chalk.red(" (Admin)")}. Type /help for commands.</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Say something..." />
        {helpVisible && (
          <Box marginTop={1} borderStyle="round" padding={1} flexDirection="column">
            <Text bold>Commands</Text>
            <Text><Text color="cyan">/nick &lt;name&gt;</Text> - Change your nickname</Text>
            <Text><Text color="cyan">/color [color]</Text> - Set your color. No color picks a random one.</Text>
            <Text><Text color="cyan">/c [color]</Text> - Alias for /color.</Text>
            <Text><Text color="cyan">/pm &lt;@user...&gt; &lt;msg&gt;</Text> - Send a private message.</Text>
            <Text><Text color="cyan">/dm &lt;@user...&gt; &lt;msg&gt;</Text> - Alias for /pm.</Text>
            <Text><Text color="cyan">/ai &lt;prompt&gt;</Text> - Ask the AI a question.</Text>
            <Text><Text color="cyan">/clear</Text> - Clear your message view.</Text>
            <Text><Text color="cyan">/help</Text> - Toggle this help panel.</Text>
            <Text><Text color="cyan">/exit</Text> - Quit the application.</Text>
            <Text><Text color="cyan">/e</Text> - Alias for /exit.</Text>
            <Text>You can format messages with *bold* and ~strikethrough~.</Text>
            {authInfo.isAdmin && (
              <>
                <Box marginTop={1} />
                <Text bold>Admin Commands</Text>
                <Text><Text color="cyan">/kick &lt;user&gt; [reason]</Text> - Kick a user.</Text>
                <Text><Text color="cyan">/ban &lt;user&gt; [minutes] [reason]</Text> - Ban a user.</Text>
                <Text><Text color="cyan">/unban &lt;user&gt;</Text> - Unban a user.</Text>
                <Text><Text color="cyan">/mute &lt;user&gt; [minutes]</Text> - Mute a user.</Text>
                <Text><Text color="cyan">/unmute &lt;user&gt;</Text> - Unmute a user.</Text>
                <Text><Text color="cyan">/broadcast &lt;msg&gt;</Text> - Send a broadcast message.</Text>
                <Text><Text color="cyan">/b &lt;msg&gt;</Text> - Alias for /broadcast.</Text>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

render(<Chat initialWsUrl={DEFAULT_WS} />);

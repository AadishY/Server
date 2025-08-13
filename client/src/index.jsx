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
const RENDER_URL = "wss://server-19jl.onrender.com/ws";
const RENDER_STATS_URL = "https://server-19jl.onrender.com/stats";
const DEFAULT_WS = process.env.WS_URL || RENDER_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Aadish";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Aadish20m";

// --- Helper Functions ---
const nowISO = () => new Date().toISOString();
const shortTime = (iso) => new Date(iso || Date.now()).toLocaleTimeString();

// New color palette and selection logic
const DULL_COLORS = [
    '#8A2BE2', '#5F9EA0', '#D2691E', '#FF7F50', '#6495ED',
    '#DC143C', '#00FFFF', '#00008B', '#B8860B', '#006400',
    '#8B008B', '#556B2F', '#FF8C00', '#9932CC', '#8B0000'
];

const defaultColorFor = (name) => {
    const hash = crypto.createHash('md5').update(name || "").digest();
    return DULL_COLORS[hash[0] % DULL_COLORS.length];
};

const colorize = (name) => {
  if (!name) return chalk.bold("system");
  return chalk.hex(defaultColorFor(name)).bold(name);
};

const formatMessage = (text) => {
    const parts = text.split(/(\*[^*]+\*|~[^~]+~|_[^_]+_|__[^_]+__|\|[^|]+\||^>.*)/gm);
    return parts.map((part, i) => {
        if (part.startsWith("*") && part.endsWith("*")) return <Text key={i} bold>{part.slice(1, -1)}</Text>;
        if (part.startsWith("~") && part.endsWith("~")) return <Text key={i} strikethrough>{part.slice(1, -1)}</Text>;
        if (part.startsWith("_") && part.endsWith("_")) return <Text key={i} italic>{part.slice(1, -1)}</Text>;
        if (part.startsWith("__") && part.endsWith("__")) return <Text key={i} underline>{part.slice(2, -2)}</Text>;
        if (part.startsWith("|") && part.endsWith("|")) return <Text key={i} backgroundColor="black" color="black">{part.slice(1, -1)}</Text>;
        if (part.startsWith(">")) return <Text key={i} dimColor italic> {part}</Text>;
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
      const ws = new WebSocket(url, { rejectUnauthorized: false });
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
        if (code === 1008) {
            if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
            return;
        }
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
        <Text>
            <Text dimColor>{`[BCAST from ${m.from}] `}</Text>
            <Text color="magentaBright" bold>{formatMessage(m.text)}</Text>
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
  const fromName = m.from ? colorize(m.from) : chalk.dim("system");
  const body = <Text>{chalk.dim(`[${ts}] `)}{fromName}: {formatMessage(m.text)}</Text>;
  return mentionMe ? <Text backgroundColor="yellow" color="black">{body}</Text> : body;
});

const WAKING_MESSAGES = [
  "Waking the server up...", "Running Aadish's server...", "Fixing the bugs...",
  "Polishing the pixels...", "Reticulating splines...", "Almost there...",
];

const LoginUI = ({ onLogin, status, error }) => {
  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [isAskingPwd, setIsAskingPwd] = useState(false);
  const [wakingMessageIndex, setWakingMessageIndex] = useState(0);
  const [activeUsers, setActiveUsers] = useState(null);

  useEffect(() => {
    const fetchStats = () => {
      https.get(RENDER_STATS_URL, { rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { setActiveUsers(JSON.parse(data).active_users); } catch (e) { /* ignore */ }
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
    if (trimmed.toLowerCase() === ADMIN_USERNAME.toLowerCase()) setIsAskingPwd(true);
    else onLogin({ username: trimmed });
  };

  const handleSubmitPwd = () => onLogin({ username: name.trim(), password: pwd, wantAdmin: true });

  if (status === "connecting" || status === "reconnecting") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" alignItems="center">
        <Spinner type="dots" /><Text bold cyan>{WAKING_MESSAGES[wakingMessageIndex]}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold cyan>{SERVER_NAME}</Text>
        <Text dimColor>{activeUsers !== null ? `${activeUsers} users online` : "..."}</Text>
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
        <Box key={u.name} flexDirection="row" flexWrap="nowrap">
          <Box width={18} flexShrink={0} flexDirection="row">
            {u.role === "admin" && <><Text backgroundColor="red" color="whiteBright" bold> ADMIN </Text><Text> </Text></>}
            {u.tag && <Text backgroundColor="blue" color="whiteBright" bold> {u.tag.toUpperCase()} </Text>}
          </Box>
          <Box flexGrow={1}>
            <Text>{colorize(u.name)}{u.name === me ? chalk.dim(" (you)") : ""}</Text>
          </Box>
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
    } else { messageStartIndex = i; break; }
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
  const [pinnedMessage, setPinnedMessage] = useState(null);

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
        setMessages([]);
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
      case "user_update":
        setUsers(currentUsers =>
          currentUsers.map(u => (u.name === data.user.name ? data.user : u))
        );
        break;
      case "clear_chat":
        setMessages([]);
        setPinnedMessage(null);
        break;
      case "broadcast":
        setPinnedMessage(data);
        setMessages(m => [...m, { id: data.id || uuidv4(), ...data }]);
        break;
      case "clear_broadcast":
        setPinnedMessage(null);
        break;
      case "message": case "ai_resp": case "pm": case "reaction": case "system":
        setMessages(m => [...m, { id: data.id || uuidv4(), ...data }]);
        if (!isScrolledUp) setScrollOffset(0);
        break;
      default: pushSys(`Received unknown message type: ${JSON.stringify(data)}`);
    }
  }, [isScrolledUp]);

  const onClose = useCallback((code) => {
    if (code === 1008) {
      setLoginError("You have been disconnected by an admin or due to a policy violation.");
      setAuthInfo(null);
      setWsUrl(null);
    } else {
      pushSys(`Disconnected (code: ${code}). Reconnecting...`);
    }
  }, [pushSys]);

  const onError = useCallback((err) => {
    if (err.message?.includes("wrong version number")) {
        setLoginError("Connection failed: SSL/TLS version mismatch. Check ws:// vs wss://.");
        setAuthInfo(null);
        setWsUrl(null);
    } else {
        pushSys(`Connection error: ${err.message || "Unknown"}`);
    }
  }, [pushSys]);

  const ws = useWs(wsUrl, onOpen, onMsg, onClose, onError);

  useEffect(() => {
    if (helpVisible) {
      const timer = setTimeout(() => { setHelpVisible(false); }, 60000);
      return () => clearTimeout(timer);
    }
  }, [helpVisible]);

  const handleCommand = useCallback((text) => {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    let sent = false;
    const currentAuth = authInfoRef.current;
    if (!currentAuth) return;

    switch(cmd) {
      case "/e": case "/quit": case "/exit":
        ws.close();
        exit();
        return;
      case "/help":
        setHelpVisible(v => !v);
        return;
      case "/clear":
        setMessages([]);
        return;
      case "/nick":
        if (!args[0]) { pushSys("Usage: /nick <newname>"); return; }
        sent = ws.send({ type: "nick", toNick: args[0] });
        break;
      case "/pm": case "/dm": {
        const { recipients, message } = parseMentions(args);
        if (!recipients.length || !message) { pushSys("Usage: /pm @user message..."); return; }
        const payload = { type: "pm", id: uuidv4(), from: currentAuth.username, to: recipients, text: message, ts: nowISO() };
        sent = ws.send(payload);
        break;
      }
      case "/ai": {
        const prompt = args.join(" ");
        if (!prompt) { pushSys("Usage: /ai <prompt...>"); return; }
        setMessages(m => [...m, { id: uuidv4(), type: "message", from: currentAuth.username, text: `(to AI) ${prompt}`, ts: nowISO() }]);
        sent = ws.send({ type: "ai", text: prompt });
        break;
      }
      case "/b": {
        if (!currentAuth.isAdmin) { pushSys("Only admins can broadcast messages."); return; }
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
  }, [ws, exit, setHelpVisible, setMessages, pushSys, setInput]);

  const submit = useCallback((text) => {
    const trimmed = text.trim();
    const currentAuth = authInfoRef.current;
    if (!trimmed || !currentAuth) return;
    if (trimmed.startsWith("/")) return handleCommand(trimmed);
    const payload = { type: "message", id: uuidv4(), from: currentAuth.username, text: trimmed, ts: nowISO() };
    if (ws.send(payload)) setInput("");
    else pushSys("Message could not be sent. You may be disconnected.");
  }, [handleCommand, ws, setInput, pushSys]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") { ws.close(); exit(); }
    if (key.escape) setHelpVisible(false);
  }, { isActive: !!authInfo });

  const handleLogin = useCallback((loginData) => {
    setLoginError(null);
    setAuthInfo(loginData);
    setWsUrl(initialWsUrl);
  }, [initialWsUrl]);

  if (!authInfo) return <LoginUI onLogin={handleLogin} status={ws.status} error={loginError} />;

  const maxMsgLines = Math.max(8, (stdout?.rows || 24) - 8 - (pinnedMessage ? 3 : 0));
  const endIndex = messages.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxMsgLines);
  const visibleMessages = messages.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" height="100%" width="100%">
      <Box paddingX={2} flexShrink={0}>
        <Box justifyContent="space-between" width="100%">
          <Text bold color="cyan">{SERVER_NAME}</Text>
          <Text>{ws.status === "open" ? chalk.green("● Connected") : <><Spinner type="dots" /> <Text dimColor>{ws.status}</Text></>}</Text>
        </Box>
      </Box>
      {pinnedMessage && (
        <Box paddingX={1} flexShrink={0}>
            <MessageItem m={pinnedMessage} me={authInfo.username} />
        </Box>
      )}
      <Box flexGrow={1} flexShrink={1} paddingY={1} flexDirection="row">
        <Box flexGrow={1} borderStyle="round" paddingX={1} marginRight={1} flexDirection="column">
          {visibleMessages.map((m) => <MessageItem key={m.id} m={m} me={authInfo.username} />)}
        </Box>
        <UserList users={users} me={authInfo.username} />
      </Box>
      <Box paddingX={2} flexDirection="column" flexShrink={0}>
        <Text dimColor>Logged in as: {colorize(authInfo.username)}{authInfo.isAdmin && chalk.red(" (Admin)")}. Type /help for commands.</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Say something..." />
        {helpVisible && (
          <Box marginTop={1} borderStyle="round" padding={1} flexDirection="column">
            <Text bold>Commands</Text>
            <Text><Text color="cyan">/nick &lt;name&gt;</Text> - Change your nickname</Text>
            <Text><Text color="cyan">/pm, /dm &lt;@user...&gt; &lt;msg&gt;</Text> - Send a private message</Text>
            <Text><Text color="cyan">/ai [--&lt;model&gt;] &lt;prompt&gt;</Text> - Ask the AI a question</Text>
            <Text dimColor>  Models: gpt, llama, deepseek, qwen, compound (default)</Text>
            <Text><Text color="cyan">/clear</Text> - Clear your local message view</Text>
            <Text><Text color="cyan">/help</Text> - Toggle this help panel</Text>
            <Text><Text color="cyan">/exit, /e, /quit</Text> - Quit the application</Text>
            <Text>You can format messages with *bold*, _italic_, __underline__, ~strikethrough~, |obfuscated|, and > blockquote.</Text>
            {authInfo.isAdmin && (
              <>
                <Box marginTop={1} />
                <Text bold>Admin Commands</Text>
                <Text><Text color="cyan">/login &lt;@user&gt;</Text> - Allow a non-whitelisted user to join once</Text>
                <Text><Text color="cyan">/kick &lt;@user...&gt; [reason]</Text> - Kick users</Text>
                <Text><Text color="cyan">/ban &lt;@user...&gt; [min] [reason]</Text> - Ban users</Text>
                <Text><Text color="cyan">/unban &lt;@user...&gt;</Text> - Unban users</Text>
                <Text><Text color="cyan">/mute &lt;@user...&gt; [min]</Text> - Mute users</Text>
                <Text><Text color="cyan">/unmute &lt;@user...&gt;</Text> - Unmute users</Text>
                <Text><Text color="cyan">/tag &lt;@user&gt; --&lt;tag&gt;</Text> - Assign a custom tag to a user</Text>
                <Text><Text color="cyan">/removetag &lt;@user...&gt;</Text> - Remove a user's custom tag</Text>
                <Text><Text color="cyan">/broadcast, /b &lt;msg&gt;</Text> - Send a broadcast message</Text>
                <Text><Text color="cyan">/clearbroadcast</Text> - Clear the pinned broadcast message</Text>
                <Text><Text color="cyan">/clearall</Text> - Clear chat history for all users</Text>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

render(<Chat initialWsUrl={DEFAULT_WS} />);

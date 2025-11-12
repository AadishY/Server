import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto-js";

// --- Config ---
const SERVER_NAME = "Akatsuki";
const DEFAULT_WS = import.meta.env.VITE_DEFAULT_WS_URL || "wss://server-19jl.onrender.com/ws";
const RENDER_STATS_URL = "https://server-19jl.onrender.com/stats";
const ADMIN_USERNAME = "Aadish";

// --- Command List for Autocomplete ---
const COMMAND_LIST = [
  { cmd: "/nick", desc: "<name> - Change your nickname." },
  { cmd: "/pm", desc: "<@user...> <msg> - Send a private message." },
  { cmd: "/dm", desc: "<@user...> <msg> - (Alias for /pm)" },
  { cmd: "/ai", desc: "[--model] <prompt> - Ask the AI." },
  { cmd: "/clear", desc: "Clear your local message view." },
  { cmd: "/help", desc: "Toggle this help panel." },
  { cmd: "/exit", desc: "Disconnect from the server." },
  { cmd: "/e", desc: "(Alias for /exit)" },
  { cmd: "/quit", desc: "(Alias for /exit)" },
];

const ADMIN_COMMAND_LIST = [
  { cmd: "/login", desc: "<@user> - Allow a user to join once." },
  { cmd: "/kick", desc: "<@user...> [reason] - Kick users." },
  { cmd: "/ban", desc: "<@user...> [min] [reason] - Ban users." },
  { cmd: "/unban", desc: "<@user...> - Unban users." },
  { cmd: "/mute", desc: "<@user...> [min] - Mute users." },
  { cmd: "/unmute", desc: "<@user...> - Unmute users." },
  { cmd: "/tag", desc: "<@user> --<tag> - Assign a tag." },
  { cmd: "/removetag", desc: "<@user...> - Remove a tag." },
  { cmd: "/broadcast", desc: "<msg> - Send a pinned broadcast." },
  { cmd: "/b", desc: "(Alias for /broadcast)" },
  { cmd: "/clearbroadcast", desc: "Clear the pinned broadcast." },
  { cmd: "/clearall", desc: "Clear chat history for ALL users." },
];

// --- Helper Functions ---
const nowISO = () => new Date().toISOString();
const shortTime = (iso) => new Date(iso || Date.now()).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

const DULL_COLORS = [
    '#5F9EA0', '#D2691E', '#FF7F50', '#6495ED', '#00008B', '#B8860B', '#006400',
    '#8B008B', '#556B2F',   '#5E81AC', '#81A1C1', '#88C0D0', '#A3BE8C', '#8FBC8F',
    '#B4A07D', '#A89984', '#D08770', '#BF616A', '#A0655F', '#927E71', '#7B8B6F',
    '#6A8A82', '#A27B77', '#C4A484', '#9E7B9B', '#8A7F8D', '#8B6F4E', '#B9A06A',
    '#7F9E9D', '#A0A89F', '#9C8B73', '#8D847E', '#A9A0B2', '#7E8FA6'
];

const defaultColorFor = (name) => {
    const hash = crypto.MD5(name || "").toString();
    const hashByte = parseInt(hash.substring(0, 2), 16);
    return DULL_COLORS[hashByte % DULL_COLORS.length];
};

const colorize = (name) => {
  if (!name) return { fontWeight: '600' };
  return { color: defaultColorFor(name), fontWeight: '600' };
};

const formatMessage = (text) => {
    const parts = text.split(/(\*[^*]+\*|~[^~]+~|_[^_]+_|__[^_]+__|\|[^|]+\||^>.*)/gm);
    return parts.map((part, i) => {
        if (part.startsWith("*") && part.endsWith("*")) return <strong key={i}>{part.slice(1, -1)}</strong>;
        if (part.startsWith("~") && part.endsWith("~")) return <s key={i}>{part.slice(1, -1)}</s>;
        if (part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith("__") && part.endsWith("__")) return <u key={i}>{part.slice(2, -2)}</u>;
        if (part.startsWith("|") && part.endsWith("|")) return <span key={i} className="spoiler">{part.slice(1, -1)}</span>;
        if (part.startsWith(">")) return <span key={i} className="blockquote">{part}</span>;
        return part;
    });
};

// --- WebSocket Hook (for Browsers) ---
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

      ws.onopen = () => {
        retryRef.current.attempt = 0;
        setStatus("open");
        if (mounted) onOpen?.();
      };

      ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else if (mounted) {
                onMsg?.(data);
            }
        } catch (e) { /* ignore */ }
      };

      ws.onclose = (event) => {
        if (!mounted) return;
        setStatus("closed");
        onClose?.(event.code);
        if (event.code === 1008) {
            if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
            return;
        }
        retryRef.current.attempt++;
        const delay = Math.min(10000, 500 + retryRef.current.attempt * 700);
        setStatus("reconnecting");
        retryRef.current.timer = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        if (mounted) onError?.(err);
      };
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
    return <div className="message system-message"><span className="timestamp">{`[${ts}]`}</span> {m.text}</div>;
  }

  if (m.type === "broadcast") {
    return (
      <div className="broadcast-message">
        <span className="from">{`[📌${m.from}]`}</span>
        <span>{formatMessage(m.text)}</span>
      </div>
    );
  }

  if (m.type === "pm") {
    const fromLabel = m.from === me ? `${m.from} (you)` : m.from;
    return (
        <div className="message pm-message">
            <span className="timestamp">{`[${ts}]`}</span>
            <span className="from">{fromLabel}</span>
            <span className="arrow"> {'->'} </span>
            <span className="to">{m.to.join(",")}</span>: 
            <span className="message-body"> {formatMessage(m.text)}</span>
        </div>
    );
  }

  if (m.from === "AI") {
    return (
        <div className="message ai-message">
            <span className="timestamp">{`[${ts}]`}</span>
            <span className="from" style={colorize(m.from)}>AI</span>: 
            <span className="message-body"> {formatMessage(m.text)}</span>
        </div>
    );
  }
  
  const mentionMe = me && m.text && m.text.includes(`@${me}`);
  const fromName = m.from ? <span className="from" style={colorize(m.from)}>{m.from}</span> : <span className="from system">system</span>;
  
  return (
    <div className={`message ${mentionMe ? 'mention' : ''}`}>
        <span className="timestamp">{`[${ts}]`}</span>
        {fromName}: 
        <span className="message-body"> {formatMessage(m.text)}</span>
    </div>
  );
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
      fetch(RENDER_STATS_URL)
        .then(res => res.json())
        .then(data => setActiveUsers(data.active_users))
        .catch(() => {/* ignore */});
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

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (isAskingPwd) {
      onLogin({ username: trimmed, password: pwd, wantAdmin: true });
    } else if (trimmed.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
      setIsAskingPwd(true);
    } else {
      onLogin({ username: trimmed });
    }
  };
  
  if (status === "connecting" || status === "reconnecting") {
    return (
      <div className="login-ui">
        <div className="login-box waking-message">
          <div className="spinner" />
          <strong>{WAKING_MESSAGES[wakingMessageIndex]}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="login-ui">
      <div className="login-box">
        <div className="login-header">
          <h2>{SERVER_NAME}</h2>
          <span>{activeUsers !== null ? `${activeUsers} users online` : "..."}</span>
        </div>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit}>
          {!isAskingPwd ? (
            <>
              <label>Enter a username to join</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name..."
                autoFocus
              />
            </>
          ) : (
            <>
              <label>Enter password for {ADMIN_USERNAME}</label>
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Admin password..."
                autoFocus
              />
            </>
          )}
          <button type="submit">Join</button>
        </form>
        <p style={{color: 'var(--text-color-dim)', fontSize: '0.8rem', textAlign: 'center', marginTop: '16px'}}>
          {isAskingPwd && <a href="#" onClick={(e) => { e.preventDefault(); setIsAskingPwd(false); setPwd(''); }}>Back to username</a>}
        </p>
      </div>
    </div>
  );
};

const UserList = React.memo(({ users, me, onUserClick }) => {
  return (
    <div className="user-list">
      <h3>Users ({users.length})</h3>
      {users.map((u) => {
        let tagElement = null;
        if (u.tag) {
          tagElement = <span className="user-tag" style={{ backgroundColor: defaultColorFor(u.tag) }}> {u.tag.toUpperCase()} </span>;
        } else if (u.role === 'admin') {
          tagElement = <span className="user-tag admin"> ADMIN </span>;
        }

        return (
          <div key={u.name} className="user-list-item" onClick={() => onUserClick(u.name)}>
            {tagElement}
            <span style={colorize(u.name)}>{u.name}</span>
            {u.name === me && <span className="you">(you)</span>}
          </div>
        );
      })}
    </div>
  );
});

const AutocompletePanel = ({ suggestions, activeIndex, onSelect }) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="autocomplete-panel">
      {suggestions.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <div
            key={item.text}
            className={`autocomplete-item ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(item)}
            onMouseEnter={() => {}} // We'll let keyboard handle active state
          >
            {item.type === 'command' ? (
              <>
                <span className="command-name">{item.text}</span>
                <span className="command-desc">{item.desc}</span>
              </>
            ) : (
              <span style={colorize(item.text)}>{item.text}</span>
            )}
          </div>
        );
      })}
    </div>
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
    } else { messageStartIndex = i; break; }
  }
  const message = messageStartIndex === -1 ? "" : parts.slice(messageStartIndex).join(" ");
  return { recipients: Array.from(recipients), message };
}

// --- Main Chat Component ---
const Chat = ({ initialWsUrl }) => {
  const [authInfo, setAuthInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [input, setInput] = useState("");
  const [helpVisible, setHelpVisible] = useState(false);
  const [wsUrl, setWsUrl] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const [autocomplete, setAutocomplete] = useState({
    suggestions: [],
    activeIndex: 0,
    isVisible: false,
    query: "",
    type: null, // 'command' or 'user'
    prefix: "", // e.g., "/" or "/pm @Aadish @"
  });
  
  const authInfoRef = useRef(authInfo);
  authInfoRef.current = authInfo;
  
  const msgListRef = useRef(null);
  const inputRef = useRef(null);
  
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
        if (inputRef.current) inputRef.current.focus();
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
        break;
      case "clear_broadcast":
        setPinnedMessage(null);
        break;
      case "message": case "ai_resp": case "pm": case "reaction": case "system":
        setMessages(m => [...m, { id: data.id || uuidv4(), ...data }]);
        break;
      default: pushSys(`Received unknown message type: ${JSON.stringify(data)}`);
    }
  }, []);

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
      pushSys(`Connection error. Check console for details.`);
      console.error(err);
  }, [pushSys]);

  const ws = useWs(wsUrl, onOpen, onMsg, onClose, onError);
  
  useEffect(() => {
    if (msgListRef.current) {
        msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!authInfo) return;
    const timer = setInterval(() => {
      setMessages(currentMessages => {
        const messagesToKeep = 300;
        if (currentMessages.length > messagesToKeep) {
          return currentMessages.slice(-messagesToKeep);
        }
        return currentMessages;
      });
    }, 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [authInfo]);

  // --- Autocomplete Logic ---
  useEffect(() => {
    if (!input) {
      setAutocomplete(prev => ({ ...prev, isVisible: false }));
      return;
    }

    const fullCommandList = authInfo?.isAdmin ? [...COMMAND_LIST, ...ADMIN_COMMAND_LIST] : COMMAND_LIST;
    
    // Command autocomplete
    if (input.startsWith("/") && !input.includes(" ")) {
      const query = input.slice(1).toLowerCase();
      const suggestions = fullCommandList
        .filter(cmd => cmd.cmd.slice(1).startsWith(query))
        .map(cmd => ({ type: 'command', text: cmd.cmd, desc: cmd.desc }));
      
      setAutocomplete({
        suggestions,
        activeIndex: 0,
        isVisible: suggestions.length > 0,
        query,
        type: 'command',
        prefix: '/',
      });
      return;
    }

    // User autocomplete (e.g., @, /pm @, /kick @)
    const atIndex = input.lastIndexOf('@');
    if (atIndex > -1) {
        const query = input.slice(atIndex + 1).toLowerCase();
        // Prevent suggesting when there's a space after @
        if (query.includes(" ")) {
           setAutocomplete(prev => ({ ...prev, isVisible: false }));
           return;
        }

        const suggestions = users
            .filter(u => u.name.toLowerCase().startsWith(query) && u.name !== authInfo.username)
            .map(u => ({ type: 'user', text: u.name }));
        
        setAutocomplete({
            suggestions,
            activeIndex: 0,
            isVisible: suggestions.length > 0,
            query,
            type: 'user',
            prefix: input.slice(0, atIndex + 1), // e.g., "/pm @Aadish @"
        });
        return;
    }

    // No triggers, hide panel
    setAutocomplete(prev => ({ ...prev, isVisible: false }));

  }, [input, users, authInfo]);


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
        setAuthInfo(null);
        setWsUrl(null);
        pushSys("Disconnected.");
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
  }, [ws, pushSys]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    const currentAuth = authInfoRef.current;
    if (!trimmed || !currentAuth) return;
    
    if (trimmed.startsWith("/")) return handleCommand(trimmed);
    
    const payload = { type: "message", id: uuidv4(), from: currentAuth.username, text: trimmed, ts: nowISO() };
    if (ws.send(payload)) setInput("");
    else pushSys("Message could not be sent. You may be disconnected.");
  };

  const applySuggestion = (suggestion) => {
    if (!suggestion) return;
    
    let newValue = "";
    if (suggestion.type === 'command') {
      newValue = `${suggestion.text} `; // Add a space after command
    } else if (suggestion.type === 'user') {
      newValue = `${autocomplete.prefix}${suggestion.text} `; // Add a space after username
    }
    
    setInput(newValue);
    setAutocomplete(prev => ({ ...prev, isVisible: false }));
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (autocomplete.isVisible && autocomplete.suggestions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete(prev => ({
          ...prev,
          activeIndex: (prev.activeIndex - 1 + prev.suggestions.length) % prev.suggestions.length
        }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete(prev => ({
          ...prev,
          activeIndex: (prev.activeIndex + 1) % prev.suggestions.length
        }));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(autocomplete.suggestions[autocomplete.activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(prev => ({ ...prev, isVisible: false }));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
    }
  };

  const handleLogin = useCallback((loginData) => {
    setLoginError(null);
    setAuthInfo(loginData);
    setWsUrl(initialWsUrl);
  }, [initialWsUrl]);

  const handleUserClick = useCallback((username) => {
    if (username === authInfo.username) return;
    // Start a /pm command
    setInput(prev => `/pm @${username} `);
    if (inputRef.current) inputRef.current.focus();
  }, [authInfo]);

  if (!authInfo) return <LoginUI onLogin={handleLogin} status={ws.status} error={loginError} />;

  return (
    <div className="app-container">
      <header className="chat-header">
        <h1>{SERVER_NAME}</h1>
        <span className={ws.status === "open" ? "status-connected" : "status-other"}>
          {ws.status === "open" ? "● Connected" : `● ${ws.status}`}
        </span>
      </header>
      
      {pinnedMessage && (
        <MessageItem m={pinnedMessage} me={authInfo.username} />
      )}
      
      <main className="main-layout">
        <div className="message-list-container" ref={msgListRef}>
          {messages.map((m) => <MessageItem key={m.id} m={m} me={authInfo.username} />)}
        </div>
        <UserList users={users} me={authInfo.username} onUserClick={handleUserClick} />
      </main>
      
      <footer className="footer">
        {autocomplete.isVisible && (
          <AutocompletePanel
            suggestions={autocomplete.suggestions}
            activeIndex={autocomplete.activeIndex}
            onSelect={applySuggestion}
          />
        )}
        <div className="login-info">
          Logged in as: <span style={colorize(authInfo.username)}>{authInfo.username}</span>
          {authInfo.isAdmin && <span className="admin-tag"> (Admin)</span>}. 
          Type <a href="#" onClick={(e) => {e.preventDefault(); setHelpVisible(v => !v)}}> /help </a>
          for commands.
        </div>
        
        <form className="input-form" onSubmit={(e) => e.preventDefault()}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Say something..."
            autoFocus
            autoComplete="off"
          />
        </form>
        
        {helpVisible && (
          <div className="help-panel">
            <h4>Commands</h4>
            {COMMAND_LIST.slice(0, 7).map(cmd => <p key={cmd.cmd}><span className="command">{cmd.cmd}</span> {cmd.desc}</p>)}
            <p>Format: *bold*, _italic_, __underline__, ~strikethrough~, |obfuscated|, &gt; blockquote.</p>
            
            {authInfo.isAdmin && (
              <div className="admin-commands">
                <h4>Admin Commands</h4>
                {ADMIN_COMMAND_LIST.map(cmd => <p key={cmd.cmd}><span className="command">{cmd.cmd}</span> {cmd.desc}</p>)}
              </div>
            )}
          </div>
        )}
      </footer>
    </div>
  );
};

function App() {
  return <Chat initialWsUrl={DEFAULT_WS} />
}

export default App;
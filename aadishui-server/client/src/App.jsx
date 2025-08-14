import React, { useState, useEffect, useRef } from 'react';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism.css';
import EmojiPicker from 'emoji-picker-react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const COMMANDS = [
    { name: '/nick <name>', description: 'Change your nickname.' },
    { name: '/pm <@user> <message>', description: 'Send a private message.' },
    { name: '/dm <@user> <message>', description: 'Alias for /pm.' },
    { name: '/ai <prompt>', description: 'Ask the AI a question.' },
    { name: '/kick <@user>', description: 'Kick a user (admin only).' },
    { name: '/ban <@user> [minutes]', description: 'Ban a user (admin only).' },
    { name: '/unban <@user>', description: 'Unban a user (admin only).' },
    { name: '/mute <@user> [minutes]', description: 'Mute a user (admin only).' },
    { name: '/unmute <@user>', description: 'Unmute a user (admin only).' },
    { name: '/tag <@user> --<tag>', description: 'Assign a custom tag to a user (admin only).' },
    { name: '/removetag <@user>', description: 'Remove a tag from a user (admin only).' },
    { name: '/broadcast <message>', description: 'Send a broadcast message (admin only).' },
    { name: '/clearbroadcast', description: 'Clear the broadcast message (admin only).' },
    { name: '/clearall', description: 'Clear all messages (admin only).' },
    { name: '/login <@user>', description: 'Whitelist a user to join (admin only).' },
];

function App() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [inputText, setInputText] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (isAuthenticated && username) {
      const socket = new WebSocket('ws://localhost:8000/ws');
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', username, password }));
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'auth_ok': setWs(socket); break;
          case 'auth_failed':
            alert(`Authentication failed: ${data.reason}`);
            setIsAuthenticated(false);
            setUsername('');
            break;
          case 'message': case 'system': case 'user_join': case 'pm': case 'ai_resp':
            setMessages((prev) => [...prev, data]);
            break;
          case 'users': setUsers(data.users); break;
          default: break;
        }
      };
      socket.onclose = () => { setWs(null); setIsAuthenticated(false); };
      return () => socket.close();
    }
  }, [isAuthenticated, username, password]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) setIsAuthenticated(true);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && ws) {
      const text = inputText.trim();
      let message;
      if (text.startsWith('/')) {
          const [command] = text.split(' ');
          if (command === '/ai') {
              message = { type: 'ai', text: text.substring(4) };
          } else {
              message = { type: 'command', raw: text };
          }
      } else {
          message = { type: 'message', text };
      }
      ws.send(JSON.stringify(message));
      setInputText('');
      setSuggestions([]);
    }
  };

  const handleInputChange = (text) => {
    setInputText(text);
    const lastWord = text.split(' ').pop();
    if (lastWord.startsWith('/')) {
        setSuggestions(COMMANDS.filter(c => c.name.toLowerCase().startsWith(lastWord.toLowerCase())));
    } else if (lastWord.startsWith('@')) {
        const mention = lastWord.substring(1).toLowerCase();
        setSuggestions(users.filter(u => u.name.toLowerCase().startsWith(mention)).map(u => ({ name: `@${u.name}` })));
    } else {
        setSuggestions([]);
    }
    setSuggestionIndex(0);
  };

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const words = inputText.split(' ');
        words.pop();
        words.push(suggestions[suggestionIndex].name.split(' ')[0] + ' ');
        setInputText(words.join(' '));
        setSuggestions([]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'Escape') {
        setSuggestions([]);
      }
    }
  };

  const onEmojiClick = (emojiObject) => {
    setInputText(prevInput => prevInput + emojiObject.emoji);
    setShowEmojiPicker(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <form onSubmit={handleLogin}>
          <h1>Welcome to Akatsuki Chat</h1>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" required />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (if admin)" />
          <button type="submit">Join Chat</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="users-panel">
        <h2>Users</h2>
        <ul>{users.map((user, index) => <li key={index}>{user.name}</li>)}</ul>
      </div>
      <div className="chat-panel">
        <div className="messages-container">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.type}`}>
              {msg.from && <span className="message-from">{msg.from}: </span>}
              <ReactMarkdown children={msg.text} />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
            {suggestions.length > 0 && (
                <div className="suggestions-container">
                    {suggestions.map((s, i) => (
                        <div key={s.name} className={`suggestion ${i === suggestionIndex ? 'active' : ''}`}>
                            <strong>{s.name}</strong> - {s.description}
                        </div>
                    ))}
                </div>
            )}
            {showEmojiPicker && (
                <div className="emoji-picker-container">
                    <EmojiPicker onEmojiClick={onEmojiClick} />
                </div>
            )}
            <form className="message-form" onSubmit={handleSendMessage} onKeyDown={handleKeyDown}>
                <Editor
                    value={inputText}
                    onValueChange={handleInputChange}
                    highlight={code => highlight(code, languages.js)}
                    padding={10}
                    style={{
                        fontFamily: '"Fira code", "Fira Mono", monospace',
                        fontSize: 14,
                        backgroundColor: 'var(--input-bg-color)',
                        color: 'var(--text-color)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        flexGrow: 1,
                    }}
                />
                <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>😊</button>
                <button type="submit">Send</button>
            </form>
        </div>
      </div>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
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
];

const LoginScreen = ({ setUsername, setPassword, handleLogin, username, password }) => (
    <div className="login-container">
        <form onSubmit={handleLogin}>
            <h1>Welcome to Akatsuki Chat</h1>
            <p>Enter a username to join the chat</p>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (if admin)" />
            <button type="submit">Join Chat</button>
        </form>
    </div>
);

const ChatView = () => {
    const [ws, setWs] = useState(null);
    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [inputText, setInputText] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [suggestionIndex, setSuggestionIndex] = useState(0);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // This is a placeholder. In a real app, this would come from props or context.
    const { username, password } = { username: localStorage.getItem('username'), password: localStorage.getItem('password') };

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        if (username) {
            const socket = new WebSocket('ws://localhost:8000/ws');
            socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', username, password }));
            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                switch (data.type) {
                    case 'auth_ok': setWs(socket); break;
                    case 'auth_failed':
                        alert(`Authentication failed: ${data.reason}`);
                        localStorage.removeItem('username');
                        window.location.reload();
                        break;
                    case 'message': case 'system': case 'user_join': case 'pm': case 'ai_resp':
                        setMessages((prev) => [...prev, data]);
                        break;
                    case 'users': setUsers(data.users); break;
                    default: break;
                }
            };
            socket.onclose = () => { setWs(null); };
            return () => socket.close();
        }
    }, [username, password]);

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (inputText.trim() && ws) {
            const text = inputText.trim();
            let message;
            if (text.startsWith('/')) {
                const [command] = text.split(' ');
                message = (command === '/ai') ? { type: 'ai', text: text.substring(4) } : { type: 'command', raw: text };
            } else {
                message = { type: 'message', text };
            }
            ws.send(JSON.stringify(message));
            setInputText('');
            setSuggestions([]);
        }
    };

    const handleInputChange = (e) => {
        const text = e.target.value;
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
        } else if (e.key === 'Enter' && !e.shiftKey) {
            handleSendMessage(e);
        }
    };

    const onEmojiClick = (emojiObject) => {
        setInputText(prevInput => prevInput + emojiObject.emoji);
        setShowEmojiPicker(false);
        inputRef.current.focus();
    };

    return (
        <div className="chat-container">
            <div className="sidebar">
                <div className="server-list">
                    <div className="server-icon active">A</div>
                </div>
                <div className="channel-list">
                    <h2># general</h2>
                </div>
            </div>
            <div className="main-content">
                <header className="chat-header">
                    <h3># general</h3>
                </header>
                <div className="chat-area">
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
                                <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                            </div>
                        )}
                        <form className="message-form" onSubmit={handleSendMessage}>
                            <textarea
                                ref={inputRef}
                                value={inputText}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a message or command..."
                                rows="1"
                            />
                            <button type="button" className="emoji-button" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>😊</button>
                        </form>
                    </div>
                </div>
            </div>
            <div className="user-list-panel">
                <h2>Users</h2>
                <ul>{users.map((user, index) => <li key={index}>{user.name}</li>)}</ul>
            </div>
        </div>
    );
};

function App() {
  const [username, setUsername] = useState(localStorage.getItem('username') || '');
  const [password, setPassword] = useState(localStorage.getItem('password') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('username'));

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
        localStorage.setItem('username', username);
        localStorage.setItem('password', password);
        setIsAuthenticated(true);
    }
  };

  return (
    <div className="app">
      {isAuthenticated ? <ChatView /> : <LoginScreen setUsername={setUsername} setPassword={setPassword} handleLogin={handleLogin} username={username} password={password} />}
    </div>
  );
}

export default App;

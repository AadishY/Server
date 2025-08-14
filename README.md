# Akatsuki Chat UI

This project is a modern, web-based GUI for the Akatsuki chat server. It is built with React and provides a feature-rich user experience with a focus on aesthetics and usability.

## Features

- **Modern UI**: A beautiful glassmorphism-inspired design with smooth animations.
- **Real-time Messaging**: Instant messaging in a clean and intuitive interface.
- **Command Support**: Full support for all server commands.
- **Autocompletion**: Discord-style autocompletion for commands and @mentions.
- **Emoji Picker**: Easily add emojis to your messages.
- **AI Integration**: Chat with an AI using the `/ai` command.
- **Markdown Support**: Format your messages with markdown (`*bold*`, `_italic_`, etc.).
- **Custom Cursor**: A unique cursor for a distinct feel.

## Installation and Usage

This project consists of a Python-based server and a React-based client. You can run them from source for development or install the client as a package.

### 1. Server Setup

The server is built with FastAPI and Uvicorn.

1.  **Navigate to the server directory:**
    ```bash
    cd aadishui-server/server
    ```

2.  **Create a virtual environment (optional but recommended):**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the server:**
    ```bash
    uvicorn server:app --host 0.0.0.0 --port 8000
    ```

### 2. Client Setup

#### Option A: Run from Source (for development)

The client is a React application built with Vite.

1.  **Navigate to the client directory:**
    ```bash
    cd aadishui-server/client
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the client in development mode:**
    ```bash
    npm run dev
    ```
    This will open the chat client in your default browser, usually at `http://localhost:5173`.

#### Option B: Install and Run as a Command

You can also install the package globally to get the `aadishui` command.

1.  **Navigate to the `aadishui-server` directory:**
    ```bash
    cd aadishui-server
    ```
2.  **Install the package globally:**
    ```bash
    npm install -g .
    ```
3.  **Run the client from anywhere:**
    ```bash
    aadishui
    ```
    This will automatically serve the client and open it in your browser.

## Commands

### User Commands

| Command | Description |
| --- | --- |
| `/nick <name>` | Change your nickname. |
| `/pm <@user> <message>` | Send a private message to a user. |
| `/dm <@user> <message>` | Alias for `/pm`. |
| `/ai <prompt>` | Ask the AI a question. |

### Admin Commands

| Command | Description |
| --- | --- |
| `/kick <@user>` | Kick a user from the chat. |
| `/ban <@user> [minutes]` | Ban a user. If no duration, the ban is permanent. |
| `/unban <@user>` | Unban a user. |
| `/mute <@user> [minutes]` | Mute a user. Defaults to 5 minutes. |
| `/unmute <@user>` | Unmute a user. |
| `/tag <@user> --<tag>` | Assign a custom tag to a user. |
| `/removetag <@user>` | Remove a user's custom tag. |
| `/broadcast <message>` | Send a broadcast message. |
| `/clearbroadcast` | Clear the broadcast message. |
| `/clearall` | Clear the chat history for all users. |
| `/login <@user>` | Allow a non-whitelisted user to join. |

### Text Formatting

| Syntax | Example | Renders as |
| --- | --- | --- |
| `*text*` | `*bold*` | **bold** |
| `_text_` | `_italic_` | *italic* |
| `__text__` | `__underline__` | <u>underline</u> |
| `~text~` | `~strikethrough~` | ~~strikethrough~~ |
| \`code\` | \`console.log("Hello")\` | `console.log("Hello")` |
| \`\`\`js\ncode\n\`\`\` | \`\`\`js\nconsole.log("Hello")\n\`\`\` | Code block |
| `> text` | `> blockquote` | > blockquote |

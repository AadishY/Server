# Akatsuki Chat

Akatsuki is a simple, ephemeral, single-room WebSocket chat server written in Python with a terminal-based client built with React and Ink.

## Features

- Real-time messaging with colored usernames.
- Private messaging with multiple recipients (`/pm`, `/dm`).
- AI integration with Groq (`/ai`).
- Admin moderation tools: `/kick`, `/ban`, `/unban`, `/mute`, `/unmute`.
- Persistent bans and mutes.
- Admin broadcast functionality.
- Command shortcuts for ease of use.
- Terminal UI with a user list and "server waking up" animation.
- Markdown-like text formatting for `*bold*`, `~strikethrough~`, and more.

## Setup and Installation

### Server

The server is built with FastAPI and Uvicorn.

1.  **Create a virtual environment (optional but recommended):**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

2.  **Install dependencies:**
    The required dependencies are listed in `server/requirements.txt`.
    ```bash
    pip install -r server/requirements.txt
    ```

3.  **Configure Environment Variables (optional):**
    Create a `.env` file in the root directory to set admin credentials and the Groq API key.
    ```
    ADMIN_USERNAME="your_admin_name"
    ADMIN_PASSWORD="super_secret_password"
    GROQ_API_KEY="your_groq_key_if_any"
    ```
    If not set, the default admin credentials are `Aadish`/`Aadish20m`.

4.  **Run the server:**
    ```bash
    uvicorn server.server:app --host 0.0.0.0 --port 8000
    ```

### Client

The client is a terminal application built with React and Ink.

1.  **Navigate to the client directory:**
    ```bash
    cd client
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the client:**
    ```bash
    npm start
    ```

## Commands

### User Commands

| Command | Alias | Description | Example |
| --- | --- | --- | --- |
| `/nick <name>` | | Change your nickname. | `/nick satoshi` |
| `/color [color]` | `/c` | Set your username color. Supports hex codes or color names. If no color is provided, a random one is chosen. | `/color red`, `/c #ff00ff` |
| `/pm <@user...>` | `/dm` | Send a private message to one or more users. | `/pm @bob @alice hello!` |
| `/ai <prompt>` | | Ask the AI a question. | `/ai what is the meaning of life?` |
| `/clear` | | Clear the messages in your local view. | `/clear` |
| `/help` | | Toggle the help panel. | `/help` |
| `/exit` | `/e` | Quit the application. | `/e` |

### Admin Commands

| Command | Alias | Description | Example |
| --- | --- | --- | --- |
| `/kick <@user...>` | | Kick one or more users from the chat. | `/kick @mallory` |
| `/ban <@user...>` | | Ban one or more users. | `/ban @eve` |
| `/unban <@user...>` | | Unban one or more users. | `/unban @eve` |
| `/mute <@user...>` | | Mute one or more users for 10 minutes. | `/mute @bob` |
| `/unmute <@user...>` | | Unmute one or more users. | `/unmute @bob` |
| `/broadcast <message>` | `/b` | Send a broadcast message to all users. | `/b System will restart in 5 minutes.` |
| `/clearall` | | Clear the chat history for all users. | `/clearall` |

### Text Formatting

You can format your messages with the following markdown-like syntax:

| Format | Example | Renders as |
| --- | --- | --- |
| `*text*` | `*bold*` | **bold** |
| `_text_` | `_italic_` | *italic* |
| `__text__` | `__underline__` | <u>underline</u> |
| `~text~` | `~strikethrough~` | ~~strikethrough~~ |
| `|text|` | `|obfuscated|` | ██████████ |
| `> text` | `> blockquote` | > blockquote |

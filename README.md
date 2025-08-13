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
- Markdown-like text formatting for `*bold*` and `~strikethrough~`.

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

| Command | Alias | Description |
| --- | --- | --- |
| `/nick <name>` | | Change your nickname. |
| `/color [color]` | `/c` | Set your username color. Supports hex codes or color names. If no color is provided, a random one is chosen. |
| `/pm <@user...>` | `/dm` | Send a private message to one or more users. |
| `/ai <prompt>` | | Ask the AI a question. |
| `/clear` | | Clear the messages in your local view. |
| `/help` | | Toggle the help panel. |
| `/exit` | `/e` | Quit the application. |

### Admin Commands

| Command | Alias | Description |
| --- | --- | --- |
| `/kick <user> [reason]` | | Kick a user from the chat. |
| `/ban <user> [mins] [reason]` | | Ban a user. If `mins` is provided, it's a temporary ban. |
| `/unban <user>` | | Unban a user. |
| `/mute <user> [mins]` | | Mute a user. Default is 10 minutes. |
| `/unmute <user>` | | Unmute a user. |
| `/broadcast <message>` | `/b` | Send a broadcast message to all users. |
| `/clearall` | | Clear the chat history for all users. |

### Text Formatting

You can format your messages with the following markdown-like syntax:

-   `*text*` for **bold** text.
-   `~text~` for ~~strikethrough~~ text.

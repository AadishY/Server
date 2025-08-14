# Akatsuki Chat

Akatsuki is a simple, ephemeral, single-room WebSocket chat server written in Python with a feature-rich terminal client built with React and Ink.

## Key Features

- **Real-time Messaging:** Instant messaging with colored usernames in a terminal interface.
- **Advanced Admin Tools:** A full suite of moderation commands, including temporary or permanent bans and mutes.
- **State Persistence:** The server saves bans, mutes, and user tags, so they persist even after a server restart.
- **Custom User Tags:** Admins can assign custom tags to users, which are displayed next to their names. For admins, a custom tag will visually replace the default `[ADMIN]` tag.
- **AI Integration:** Chat with various AI models directly in the client using the `/ai` command.
- **Connection Stability:** A built-in heartbeat system keeps the client connected through idle periods and cleans up dead connections, preventing common timeout issues.
- **Rich Text Formatting:** Use markdown-like syntax to format your messages (`*bold*`, `_italic_`, etc.).
- **Pinned Broadcasts:** Admins can send server-wide announcements that are pinned to the top of the chat window for all users.

## Installation and Usage

### 1. Server Setup

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

### 2. Client Setup

The client is a terminal application that can be run directly from the source or installed globally via NPM.

#### Option A: Install Globally from NPM (Recommended)

Once the package is published to NPM, you can install and run it with two simple commands:

1.  **Install the package globally:**
    ```bash
    npm install -g aadish-server
    ```

2.  **Run the client from anywhere:**
    ```bash
    aadish
    ```

#### Option B: Run from Source

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

---

## Commands

### User Commands

| Command | Alias(es) | Description |
| --- | --- | --- |
| `/nick <name>` | | Change your nickname. |
| `/pm <@user...>` | `/dm` | Send a private message to one or more users. |
| `/ai [--model] <prompt>` | | Ask the AI a question. Optional models: `--gpt`, `--llama`, `--deepseek`, `--qwen`. |
| `/clear` | | Clear the messages in your local view. |
| `/help` | | Toggle the detailed help panel. |
| `/exit` | `/e`, `/quit` | Quit the application. |

### Admin Commands

| Command | Alias(es) | Arguments | Description |
| --- | --- | --- | --- |
| `/login <@user>` | | `@user` | Allows a non-whitelisted user to join the server one time. |
| `/kick <@user...>` | | `@user...`, `[reason]` | Kick one or more users from the chat. |
| `/ban <@user...>` | | `@user...`, `[minutes]`, `[reason]` | Ban users. If no duration, the ban is permanent. |
| `/unban <@user...>` | | `@user...` | Unban one or more users. |
| `/mute <@user...>` | | `@user...`, `[minutes]` | Mute users. Defaults to 5 minutes. |
| `/unmute <@user...>` | | `@user...` | Unmute one or more users. |
| `/tag <@user>` | | `@user`, `--tagname` | Assign a custom tag to a user. Overwrites existing tags. |
| `/removetag <@user...>`| | `@user...` | Remove a user's custom tag. |
| `/broadcast <message>` | `/b` | `message` | Send a broadcast message pinned to the top of the chat. |
| `/clearbroadcast` | | | Clear the pinned broadcast message for all users. |
| `/clearall` | | | Clear the chat history for all connected users. |

### Text Formatting

| Syntax | Example | Renders as |
| --- | --- | --- |
| `*text*` | `*bold*` | **bold** |
| `_text_` | `_italic_` | *italic* |
| `__text__` | `__underline__` | <u>underline</u> |
| `~text~` | `~strikethrough~` | ~~strikethrough~~ |
| `|text|` | `|obfuscated|` | ██████████ |
| `> text` | `> blockquote` | > blockquote |

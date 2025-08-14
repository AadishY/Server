# Akatsuki Chat

This project contains the backend server and a modern desktop client for the Akatsuki Chat service.

## Project Structure

- `/server`: The Python-based WebSocket server.
- `/new_client`: The new desktop client built with Electron and React.

## Installation and Usage

You need to run both the server and the client to use the application.

### 1. Server Setup

The server is built with FastAPI and Uvicorn.

1.  **Navigate to the server directory:**
    ```bash
    cd server
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
    The server will be running at `ws://localhost:8000/ws`.

### 2. Client Setup

The client is an Electron application.

1.  **Navigate to the client directory:**
    ```bash
    cd new_client
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the client in development mode:**
    ```bash
    npm run dev
    ```
    This will start the React development server and launch the Electron application.

### Building the Client

To build a distributable desktop application, run the following command in the `new_client` directory:

```bash
npm run build
```

This will create an executable file in the `new_client/release` directory.

---

## Commands

The client supports the following commands, which can be typed into the message box.

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

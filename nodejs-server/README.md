# Akatsuki Node.js Server

This is the Node.js version of the Akatsuki chat server, designed for easy deployment on platforms like Vercel.

## Deployment to Vercel

Vercel is a platform for hosting web projects. Since this server uses WebSockets, we need to configure it correctly.

### 1. Create a `vercel.json` file

Create a `vercel.json` file in this directory (`nodejs-server`) with the following content:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/ws",
      "dest": "/index.js"
    },
    {
      "src": "/stats",
      "dest": "/index.js"
    },
    {
      "src": "/",
      "dest": "/index.js"
    }
  ]
}
```

This file tells Vercel how to build and route requests to your serverless Node.js function.

### 2. Deploy with the Vercel CLI

1.  **Install the Vercel CLI:**
    ```bash
    npm install -g vercel
    ```

2.  **Log in to your Vercel account:**
    ```bash
    vercel login
    ```

3.  **Deploy the server:**
    Navigate to this directory (`nodejs-server`) in your terminal and run:
    ```bash
    vercel
    ```
    The CLI will guide you through the deployment process. It will provide you with a URL for your deployed server.

### 3. Configure the Client

Once your server is deployed, you will get a URL like `https://your-project-name.vercel.app`.

You need to update the client to connect to this new server. In the `client/src/index.jsx` file, change the `RENDER_URL` to your Vercel deployment's WebSocket URL:

```javascript
// client/src/index.jsx
const RENDER_URL = "wss://your-project-name.vercel.app/ws";
const RENDER_STATS_URL = "https://your-project-name.vercel.app/stats";
```

After updating the client, you can run it, and it will connect to your new Node.js server hosted on Vercel.

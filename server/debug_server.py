import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Debug Echo Server")

connections = set()

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    print(f"New connection. Total connections: {len(connections)}")
    try:
        while True:
            data = await ws.receive_text()
            print(f"Received message: {data}")
            # Echo the message to all connected clients
            for connection in connections:
                await connection.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        print("Client disconnected.")
    finally:
        connections.remove(ws)
        print(f"Connection removed. Total connections: {len(connections)}")

@app.get("/")
async def root():
    return {"message": "Debug server is running"}

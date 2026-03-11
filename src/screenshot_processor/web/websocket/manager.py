from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class WebSocketEvent(BaseModel):
    type: str
    timestamp: str
    data: dict[str, Any]

    @classmethod
    def create(cls, event_type: str, data: dict[str, Any]) -> WebSocketEvent:
        return cls(
            type=event_type,
            timestamp=datetime.now(UTC).isoformat(),
            data=data,
        )


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, WebSocket] = {}
        self.user_metadata: dict[int, dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket, user_id: int, username: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_metadata[user_id] = {
            "username": username,
            "connected_at": datetime.now(UTC).isoformat(),
        }
        logger.info(
            "User connected",
            extra={"user_id": user_id, "username": username, "total_connections": len(self.active_connections)},
        )

        await self.broadcast_except(
            WebSocketEvent.create(
                "user_joined",
                {
                    "user_id": user_id,
                    "username": username,
                    "active_users": len(self.active_connections),
                },
            ),
            exclude_user_id=user_id,
        )

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

        username = None
        if user_id in self.user_metadata:
            username = self.user_metadata[user_id].get("username")
            del self.user_metadata[user_id]

        logger.info(
            "User disconnected",
            extra={"user_id": user_id, "username": username, "total_connections": len(self.active_connections)},
        )

        return username

    async def send_to_user(self, user_id: int, event: WebSocketEvent):
        if user_id in self.active_connections:
            try:
                websocket = self.active_connections[user_id]
                await websocket.send_json(event.model_dump())
            except Exception as e:
                logger.error("Error sending to user", extra={"user_id": user_id, "error": str(e)})
                self.disconnect(user_id)

    async def broadcast(self, event: WebSocketEvent):
        disconnected_users = []

        for user_id, websocket in self.active_connections.items():
            try:
                await websocket.send_json(event.model_dump())
            except Exception as e:
                logger.error("Error broadcasting to user", extra={"user_id": user_id, "error": str(e)})
                disconnected_users.append(user_id)

        for user_id in disconnected_users:
            self.disconnect(user_id)

    async def broadcast_except(self, event: WebSocketEvent, exclude_user_id: int):
        disconnected_users = []

        for user_id, websocket in self.active_connections.items():
            if user_id == exclude_user_id:
                continue

            try:
                await websocket.send_json(event.model_dump())
            except Exception as e:
                logger.error("Error broadcasting to user", extra={"user_id": user_id, "error": str(e)})
                disconnected_users.append(user_id)

        for user_id in disconnected_users:
            self.disconnect(user_id)

    def get_active_users(self) -> list[dict[str, Any]]:
        return [
            {
                "user_id": user_id,
                "username": metadata["username"],
                "connected_at": metadata["connected_at"],
            }
            for user_id, metadata in self.user_metadata.items()
        ]

    def is_user_connected(self, user_id: int) -> bool:
        return user_id in self.active_connections

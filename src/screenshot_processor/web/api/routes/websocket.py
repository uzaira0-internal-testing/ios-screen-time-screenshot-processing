from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt

from screenshot_processor.web.config import get_settings
from screenshot_processor.web.websocket import ConnectionManager

# JWT Algorithm constant
ALGORITHM = "HS256"

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

manager = ConnectionManager()


async def verify_websocket_token(token: str) -> dict | None:
    try:
        settings = get_settings()
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int | None = payload.get("sub")
        username: str | None = payload.get("username")

        if user_id is None or username is None:
            return None

        return {"user_id": int(user_id), "username": username}
    except JWTError:
        return None


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None):
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication token")
        return

    user_data = await verify_websocket_token(token)

    if not user_data:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication token")
        return

    user_id = user_data["user_id"]
    username = user_data["username"]

    await manager.connect(websocket, user_id, username)

    try:
        while True:
            data = await websocket.receive_text()

            if data == "ping":
                await websocket.send_json({"type": "pong", "timestamp": ""})
            else:
                logger.debug(f"Received message from user {user_id}: {data}")

    except WebSocketDisconnect:
        username = manager.disconnect(user_id)
        logger.info(f"User {user_id} ({username}) disconnected normally")

        from screenshot_processor.web.websocket import WebSocketEvent

        await manager.broadcast(
            WebSocketEvent.create(
                "user_left",
                {
                    "user_id": user_id,
                    "username": username,
                    "active_users": len(manager.active_connections),
                },
            )
        )

    except Exception as e:
        logger.error(f"Error in WebSocket connection for user {user_id}: {e}")
        manager.disconnect(user_id)


def get_connection_manager() -> ConnectionManager:
    return manager

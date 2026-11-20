"""Client for the NEXUS API's internal meeting-agent routes (shared secret MEETING_AGENT_TOKEN).

The agent never talks to the database or the AI provider directly: the API keeps company isolation,
speaker names, cost caps and the summary queue in one place.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class NexusApi:
    base_url: str
    token: str
    client: httpx.AsyncClient = field(default_factory=lambda: httpx.AsyncClient(timeout=20))

    def _url(self, room: str, path: str) -> str:
        return f"{self.base_url.rstrip('/')}/internal/meeting-agent/rooms/{room}/{path}"

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def context(self, room: str) -> dict[str, Any]:
        r = await self.client.get(self._url(room, "context"), headers=self._headers)
        r.raise_for_status()
        return r.json()

    async def transcript(self, room: str, lines: list[dict[str, Any]]) -> None:
        for i in range(0, len(lines), 50):
            r = await self.client.post(self._url(room, "transcript"), headers=self._headers, json={"lines": lines[i : i + 50]})
            r.raise_for_status()

    async def ask(self, room: str, question: str, asked_by: str) -> dict[str, Any]:
        r = await self.client.post(self._url(room, "ask"), headers=self._headers, json={"question": question[:2000], "asked_by": asked_by[:200]}, timeout=60)
        r.raise_for_status()
        return r.json()

    async def aclose(self) -> None:
        await self.client.aclose()

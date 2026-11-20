# NEXUS meeting agent (LiveKit Agents worker). Runs on LiveKit Cloud or any machine with Docker:
# it only needs LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET and the variables in .env.example.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 agent
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY nexus_agent ./nexus_agent
# Download the Silero VAD model at build time so the container starts offline-ready.
RUN python -m nexus_agent.agent download-files
USER agent
CMD ["python", "-m", "nexus_agent.agent", "start"]

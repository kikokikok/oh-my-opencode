FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

ENV POSTGRES_USER=letta
ENV POSTGRES_PASSWORD=letta
ENV POSTGRES_DB=letta
ENV PGDATA=/var/lib/postgresql/data

ENV LETTA_PG_URI=postgresql://letta:letta@localhost:5432/letta
ENV OPENAI_API_BASE=http://localhost:4141/v1
ENV OPENAI_API_KEY=dummy

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    sudo \
    supervisor \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

USER vscode
WORKDIR /home/vscode

RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/home/vscode/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH=/home/vscode/.opencode/bin:$PATH

RUN mkdir -p /home/vscode/.config/opencode

COPY .devcontainer/opencode.json /home/vscode/.config/opencode/opencode.json
COPY .devcontainer/oh-my-opencode.json /home/vscode/.config/opencode/oh-my-opencode.json

USER root

RUN chown -R vscode:vscode /home/vscode/.config/opencode

RUN python3 -m venv /opt/letta-venv \
    && /opt/letta-venv/bin/pip install --upgrade pip \
    && /opt/letta-venv/bin/pip install letta

RUN mkdir -p /var/log/supervisor /var/run/postgresql \
    && chown -R postgres:postgres /var/run/postgresql /var/lib/postgresql

COPY start-services.sh /usr/local/bin/start-services.sh
RUN chmod +x /usr/local/bin/start-services.sh

WORKDIR /workspace

EXPOSE 8283 4141

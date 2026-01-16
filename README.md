# TARS — AI Marketing Assistant for Yandex.Direct

🤖 AI-powered marketing assistant for managing Yandex.Direct advertising campaigns via Telegram.

## Features

- 📊 **Daily & Weekly Reports** — Automated analysis with AI-powered insights
- 💬 **Conversational Interface** — Ask questions about your campaigns in natural language
- 🎯 **Smart Recommendations** — AI suggests optimizations with one-click execution
- 📈 **Campaign Analysis** — Deep dive into performance metrics
- 🔄 **Automated Actions** — Execute changes after your approval
- 💾 **Context Memory** — Remembers conversation history and campaign context

## Tech Stack

- **Backend**: Node.js + TypeScript
- **Database**: PostgreSQL
- **AI**: OpenRouter (Claude Sonnet + GPT-4o-mini)
- **Interface**: Telegram Bot
- **Scheduler**: node-cron
- **Deploy**: Docker + docker-compose

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Yandex.Direct API access
- Telegram Bot token
- OpenRouter API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your/tars.git
cd tars
```

2. Copy environment file and configure:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Start with Docker:
```bash
docker-compose up -d
```

4. Run migrations:
```bash
docker-compose exec app npm run migrate
```

### Development

1. Install dependencies:
```bash
npm install
```

2. Start PostgreSQL:
```bash
docker-compose up -d postgres
```

3. Run migrations:
```bash
npm run migrate
```

4. Start in development mode:
```bash
npm run dev
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DB_HOST` | PostgreSQL host | Yes |
| `DB_PORT` | PostgreSQL port | Yes |
| `DB_USER` | Database user | Yes |
| `DB_PASSWORD` | Database password | Yes |
| `DB_NAME` | Database name | Yes |
| `YANDEX_CLIENT_ID` | Yandex OAuth client ID | Yes |
| `YANDEX_CLIENT_SECRET` | Yandex OAuth client secret | Yes |
| `YANDEX_ACCESS_TOKEN` | Yandex API access token | Yes |
| `YANDEX_REFRESH_TOKEN` | Yandex API refresh token | Yes |
| `OPENROUTER_API_KEY` | OpenRouter API key | Yes |
| `AI_PRIMARY_MODEL` | Primary AI model | No |
| `AI_FALLBACK_MODEL` | Fallback AI model | No |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Yes |
| `TELEGRAM_ADMIN_ID` | Your Telegram user ID | Yes |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and menu |
| `/report` | Yesterday's report |
| `/week` | Weekly report |
| `/campaigns` | List campaigns |
| `/ask [question]` | Ask AI a question |
| `/analyze [campaign]` | Deep campaign analysis |
| `/help` | Show help |

## Project Structure

```
tars/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/               # Configuration
│   ├── database/             # Database client & migrations
│   │   ├── migrations/       # SQL migrations
│   │   └── repositories/     # Data access layer
│   ├── modules/
│   │   ├── yandex/          # Yandex Direct API client
│   │   ├── ai/              # AI Engine (OpenRouter)
│   │   ├── context/         # Context Manager
│   │   ├── telegram/        # Telegram Bot
│   │   ├── scheduler/       # Cron jobs
│   │   └── orchestrator/    # Main coordinator
│   └── utils/               # Helpers & logger
├── tests/                   # Test files
├── docker-compose.yml       # Docker configuration
├── Dockerfile              # Docker build
└── package.json            # Dependencies
```

## Scheduled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Morning Report | 8:00 MSK | Daily stats and recommendations |
| Evening Analysis | 20:00 MSK | Quick performance check |
| Weekly Report | Mon 9:00 MSK | Deep weekly analysis |
| Data Sync | Every 6h | Sync data from Yandex |
| Cleanup | 3:00 MSK | Remove expired data |

## Development Phases

- [x] **Phase 1**: Foundation (MVP - Read Only)
  - [x] Project setup
  - [x] Database schema
  - [x] Yandex Direct API integration
  - [x] Basic AI Engine
  - [x] Telegram Bot

- [ ] **Phase 2**: Dialog & Memory
  - [ ] Context Manager
  - [ ] Conversation history
  - [ ] Context switching

- [ ] **Phase 3**: Actions (Write Access)
  - [ ] Execute changes in Yandex.Direct
  - [ ] Action approval flow
  - [ ] Change logging

- [ ] **Phase 4**: Proposals
  - [ ] Campaign proposals
  - [ ] Knowledge base
  - [ ] Advanced analysis

## License

ISC

## Author

Built with ❤️ for Yandex.Direct marketers

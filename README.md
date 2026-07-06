# Cortex AI

<p align="center">
  <img src="https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js" />
  <img src="https://img.shields.io/badge/LangChain-AI%20Agents-111827?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Redis-Rate%20Limiting-DC382D?style=for-the-badge&logo=redis" />
  <img src="https://img.shields.io/badge/Docker-Microservices-2496ED?style=for-the-badge&logo=docker" />
</p>

## Professional Overview

Cortex AI is a full-stack, multi-service GenAI workspace that combines chat, coding assistance, image generation, PDF generation, PDF RAG, vision understanding, presentation generation, billing, and credit-based access control into one product.

The system is built around a gateway-driven microservice architecture. A React + Vite frontend communicates with a Node.js gateway, which routes authenticated requests to specialized backend services for authentication, chat persistence, billing, and AI orchestration. The AI service uses LangChain, multiple model providers, Redis rate limiting, file upload handling, vector search, and external integrations to deliver a product-like AI experience instead of a single-purpose chatbot.

## Key Features

- Multi-agent AI routing for chat, coding, search, PDF, PPT, image, vision, and PDF RAG workflows
- Google authentication with Firebase Admin session management
- Conversation persistence with reusable chat history
- PDF upload and retrieval-augmented answering from document context
- AI image generation with S3-backed download links
- AI-generated PDFs and presentations with downloadable artifacts
- Credit-based billing with plan upgrades and usage deduction
- Redis-backed rate limiting per agent type
- Artifact panel with code preview and live preview support
- Responsive dark UI with speech input support and file attachments

## System Architecture

```mermaid
flowchart LR
  U[User] --> F[React + Vite Frontend]
  F --> G[API Gateway]

  G --> A[Auth Service]
  G --> C[Chat Service]
  G --> B[Billing Service]
  G --> M[Agent Service]

  A --> R[(Redis Session Store)]
  A --> DB1[(MongoDB)]

  C --> DB2[(MongoDB)]
  B --> DB3[(MongoDB)]
  B --> R

  M --> L[LangChain + Multi-Model Routing]
  M --> Q[(Qdrant Vector DB)]
  M --> S[(S3 Storage)]
  M --> T[Tavily Search]
  M --> X[Groq / Gemini / OpenRouter]
  M --> R
```

### How Requests Flow

1. The user logs in through Firebase Google sign-in.
2. The frontend sends the Firebase token to the auth service through the gateway.
3. The auth service verifies the identity token, creates or updates the user, and stores session data in Redis.
4. The user sends a prompt from the chat UI.
5. The gateway forwards the request to the agent service with user context.
6. The agent service routes the prompt to the right AI workflow using LangGraph and specialized agents.
7. The response is persisted in the chat service and returned to the frontend.
8. If the response produces an artifact, the UI renders it in the artifact panel.

## Multi-Agent Architecture

The AI layer is not a single prompt wrapper. It is organized as a routing graph with specialized nodes:

- Router node: decides whether a request should go to chat, search, coding, pdf, ppt, image, vision, or PDF RAG
- Chat agent: general conversational assistant with memory-aware responses
- Search agent: web lookup through Tavily
- Coding agent: code generation and technical help
- PDF agent: structured PDF generation with downloadable output
- PPT agent: slide deck generation with formatted slides
- Image agent: image prompt enhancement plus image generation and S3 upload
- Vision agent: image understanding and OCR-style interpretation
- PDF RAG agent: document ingestion, chunking, embeddings, Qdrant similarity search, and grounded answers

This is the strongest part of the project because it demonstrates orchestration, task specialization, state management, and retrieval-based reasoning.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Redux Toolkit, React Router, Framer Motion, Tailwind CSS, Monaco Editor |
| Backend | Node.js, Express.js, Mongoose, Multer, Helmet, Morgan, CORS |
| AI / Orchestration | LangChain, LangGraph, Google Generative AI, Groq, OpenRouter, Tavily |
| Data | MongoDB, Redis, Qdrant |
| Auth | Firebase Authentication, Firebase Admin |
| Billing | Razorpay |
| Storage | Amazon S3 |
| Deployment | Docker, Docker Compose |

## AI / LLM Technologies Used

- LangGraph for agent routing and conditional workflows
- LangChain message primitives for prompt/history composition
- Gemini for vision and multimodal tasks
- Groq for fast chat/search/coding generation
- OpenRouter for coding-specific model routing
- Tavily for web search augmentation
- Qdrant for vector similarity search in PDF RAG
- Embeddings via Google Generative AI embeddings

## Folder Structure

```text
backend/
  gateway/                  # API gateway and auth-aware proxy layer
  services/
    auth/                   # Firebase auth, sessions, user plan management
    chat/                   # conversation and message persistence
    billing/                # plans, payment verification, credit upgrades
    agent/                  # AI routing, tools, RAG, generation, artifacts
  shared/redis/             # shared Redis client
  docker-compose.yml

frontend/
  src/
    components/             # chat UI, sidebar, billing drawer, artifact panel
    features/               # API clients
    pages/                  # Home page
    redux/                  # app state slices
    hooks/                  # auth/user hook
```

## Screenshots

> Add your own screenshots here after running the app locally.

### Login Screen

![Login Screen](./docs/screenshots/login.png)

### Main Chat Workspace

![Chat Workspace](./docs/screenshots/chat-workspace.png)

### Artifact / Preview Panel

![Artifact Panel](./docs/screenshots/artifact-panel.png)

## Installation Guide

### Prerequisites

- Node.js 18+ or newer
- Docker and Docker Compose
- MongoDB instance
- Redis instance
- Firebase project with Google sign-in enabled
- Razorpay account for billing features
- API keys for Gemini, Groq, OpenRouter, Tavily, and S3 credentials

### 1) Clone the repository

```bash
git clone <your-repo-url>
cd cortex-ai
```

### 2) Install dependencies

Install frontend and each backend service separately:

```bash
cd frontend
npm install

cd ../backend/services/auth
npm install

cd ../chat
npm install

cd ../billing
npm install

cd ../agent
npm install

cd ../../gateway
npm install
```

### 3) Start infrastructure

If you are using Docker Compose, start Redis and any other local dependencies first:

```bash
cd backend
docker compose up -d
```

### 4) Configure environment variables

Create `.env` files for the gateway and each service as needed.

## Environment Variables

### Gateway

- `PORT` - gateway port, default `5000`
- `AUTH_SERVICE` - auth service base URL
- `CHAT_SERVICE` - chat service base URL
- `AGENT_SERVICE` - agent service base URL
- `BILLING_SERVICE` - billing service base URL

### Auth Service

- `PORT` - auth service port
- `MONGODB_URI` - MongoDB connection string
- `REDIS_URL` - Redis connection string
- Firebase Admin credentials or service account configuration

### Chat Service

- `PORT` - chat service port
- `MONGODB_URI` - MongoDB connection string

### Billing Service

- `PORT` - billing service port
- `MONGODB_URI` - MongoDB connection string
- `RAZORPAY_KEY_ID` - Razorpay key ID
- `RAZORPAY_KEY_SECRET` - Razorpay secret key
- `AUTH_SERVICE` - auth service base URL for plan updates

### Agent Service

- `PORT` - agent service port
- `MONGODB_URI` - MongoDB connection string
- `REDIS_URL` - Redis connection string
- `CHAT_SERVICE` - chat service base URL for message persistence
- `GOOGLE_API_KEY` - Gemini / embeddings API key
- `TAVILY_API_KEY` - Tavily search API key
- `S3_BUCKET_NAME` - S3 bucket name
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_REGION` - AWS region

## Running the Project

### Frontend

```bash
cd frontend
npm run dev
```

### Backend services

Start each service in its own terminal:

```bash
cd backend/gateway
npm run dev

cd backend/services/auth
npm run dev

cd backend/services/chat
npm run dev

cd backend/services/billing
npm run dev

cd backend/services/agent
npm run dev
```

## API Endpoints

### Gateway

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Gateway health check |
| GET | `/api/me` | Get current user |
| All | `/api/auth/*` | Proxy to auth service |
| All | `/api/chat/*` | Proxy to chat service |
| All | `/api/agent/*` | Proxy to agent service |
| All | `/api/billing/*` | Proxy to billing service |

### Auth Service

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/login` | Verify Firebase token and create session |
| GET | `/logout` | Destroy session |
| PATCH | `/internal/update-plan` | Update user plan and credits |
| PATCH | `/internal/deduct-credits` | Deduct credits for agent usage |

### Chat Service

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/create-conversation` | Create a new conversation |
| GET | `/get-conversations` | List user conversations |
| POST | `/update-conversation` | Update conversation title |
| POST | `/save-message` | Persist chat message |
| GET | `/get-messages/:id` | Fetch messages for a conversation |

### Billing Service

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/create-order` | Create a Razorpay order |
| POST | `/verify-payment` | Verify payment and update user plan |

### Agent Service

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/chat` | Send prompt, optional file, and get AI response |

## Future Improvements

- Add automated unit, integration, and e2e test coverage
- Add response streaming for a more ChatGPT-like experience
- Add prompt versioning and evaluation metrics for each agent
- Add stronger file validation and prompt-injection defenses
- Add observability with structured logs, traces, and cost metrics
- Add conversation search, pinning, and workspace organization
- Add deployment automation with CI/CD and environment promotion
- Replace placeholder demo flows with production-grade artifact templates

## Challenges Solved

- Built a gateway-based microservice architecture instead of a monolith
- Coordinated multiple AI providers behind a single user experience
- Added retrieval-augmented QA for uploaded PDFs
- Implemented credit and rate-limit controls for expensive AI operations
- Persisted user conversations and messages across sessions
- Managed generated files and preview artifacts in the frontend

## Learning Outcomes

- Microservice communication patterns in Node.js
- Agent routing and orchestration with LangGraph
- Retrieval-augmented generation with vector databases
- Auth/session design using Firebase and Redis
- Billing and quota management for AI products
- Frontend state orchestration for conversational applications

## Why This Project Stands Out

- It is not a basic chatbot; it is a multi-agent AI product with real workflows
- It combines LLMs, RAG, file handling, billing, auth, and persistence
- It has a clear architecture that maps well to real-world SaaS systems
- The artifact panel and generated outputs make the AI capabilities visible to users
- The stack is recruiter-friendly and demonstrates practical engineering depth

## License

This project currently does not include an explicit license.

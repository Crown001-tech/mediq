# MedIQ Monorepo

MedIQ has been separated into clean, decoupled **FRONTEND** and **BACKEND** directories following the **Modular Monolith (MVC)** architecture.

---

## Workspace Structure

```text
mediq/
├── FRONTEND/                             # Next.js Fullstack Client Application
│   ├── src/
│   │   ├── app/                          # Client Pages & Routes (Admin, Doctor, Patient, Auth)
│   │   ├── components/                   # UI & Visual Components
│   │   ├── modules/                      # Domain UI modules
│   │   ├── shared/                       # Shared UI widgets & Supabase client
│   │   ├── lib/
│   │   │   ├── api-client.ts             # Typed REST API Client pointing to Backend
│   │   │   └── supabase.ts               # Browser Supabase client
│   │   └── middleware.ts                 # Next.js route protection & role redirection
│   ├── public/                           # Static Media & Images
│   ├── next.config.ts                    # Next.js config with /api/:path* backend rewrites
│   ├── package.json                      # Next.js, React, Tailwind, Supabase dependencies
│   ├── .env.local                        # Frontend environment variables
│   └── .env.example
│
├── BACKEND/                              # Express Modular Monolith Server (MVC Pattern)
│   ├── src/
│   │   ├── server.ts                     # HTTP Server Entry Point & Lifecycle
│   │   ├── app.ts                        # Express App Config, CORS & Middlewares
│   │   ├── config/
│   │   │   ├── env.ts                    # Environment Variables Loader
│   │   │   └── supabase.ts               # Supabase Admin & Scoped Clients
│   │   ├── common/
│   │   │   ├── middleware/
│   │   │   │   ├── auth.middleware.ts    # JWT & Role Access Controls (Admin, Doctor, Patient)
│   │   │   │   └── error.middleware.ts   # Global Exception & 404 Handlers
│   │   │   ├── utils/
│   │   │   │   ├── response.util.ts      # Standardized REST View / Response Serializer
│   │   │   │   └── string.util.ts        # Jitsi room tokens & formatters
│   │   │   └── types/
│   │   │       └── index.ts              # Database Entity Types & Models
│   │   ├── modules/                      # Modular Monolith MVC Domain Modules:
│   │   │   ├── appointments/             # Model, View, Controller, Routes
│   │   │   ├── notifications/            # Model, View, Controller, Routes
│   │   │   ├── enrollments/              # Model, View, Controller, Routes
│   │   │   ├── admin/                    # Model, View, Controller, Routes
│   │   │   ├── cases/                    # Model, View, Controller, Routes
│   │   │   ├── care-plans/               # Model, View, Controller, Routes
│   │   │   └── identity/                 # Model, View, Controller, Routes
│   │   ├── routes/
│   │   │   └── index.ts                  # Aggregated /api/v1 Router
│   │   └── data/                         # Local JSON persistence stores
│   ├── supabase/
│   │   └── migrations/                   # SQL Migrations, RLS Policies & Schemas
│   ├── package.json                      # Express, TypeScript, TSX, Supabase dependencies
│   ├── tsconfig.json
│   ├── .env                              # Server environment variables
│   ├── .env.example
│   └── README.md
│
├── package.json                          # Root Scripts for Workspace Orchestration
├── .env.example                          # Monorepo environment reference
└── README.md
```

---

## Getting Started

### 1. Install Dependencies

Install dependencies for both frontend and backend:
```bash
# Frontend dependencies
npm install --prefix FRONTEND

# Backend dependencies
npm install --prefix BACKEND
```

---

### 2. Running in Development

From the root directory:

- **Run Frontend Client (Port 3000)**:
  ```bash
  npm run dev:frontend
  # or
  npm run dev
  ```

- **Run Backend Server (Port 5001)**:
  ```bash
  npm run dev:backend
  ```

---

### 3. Building for Production

- **Build Backend**:
  ```bash
  npm run build:backend
  ```

- **Build Frontend**:
  ```bash
  npm run build:frontend
  ```

- **Build Both**:
  ```bash
  npm run build
  ```

---

### 4. Database Setup & Migrations

All SQL migration scripts are located in [BACKEND/supabase/migrations/](file:///c:/Users/USER/Desktop/mediq/BACKEND/supabase/migrations/).
You can run them in your Supabase SQL Editor or push via Supabase CLI:
```bash
npx supabase db push
```

# MedIQ Backend (Modular Monolith MVC)

This directory contains the complete backend API server for MedIQ, architected as a **Modular Monolith** using the **Model-View-Controller (MVC)** architectural pattern with TypeScript and Express.

---

## Architectural Pattern: Modular Monolith (MVC)

Every domain feature is completely encapsulated within its own module in `src/modules/<domain>/` with strict separation of concerns:

```
src/modules/<feature>/
├── <feature>.model.ts        # MODEL: Database access, Supabase queries, entity logic
├── <feature>.view.ts         # VIEW: Response formatting, DTO serialization, view presenters
├── <feature>.controller.ts   # CONTROLLER: Request handling, validation & flow orchestration
└── <feature>.routes.ts       # ROUTE: Endpoint definitions and role middleware
```

---

## Directory Structure

```text
BACKEND/
├── src/
│   ├── config/
│   │   ├── env.ts                   # Environment variables loader
│   │   └── supabase.ts              # Supabase admin and scoped client instances
│   ├── common/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts   # JWT verification & role authorization (admin, doctor, patient)
│   │   │   └── error.middleware.ts  # Global exception handling & 404 router
│   │   ├── utils/
│   │   │   ├── response.util.ts     # Standardized REST response serializer
│   │   │   └── string.util.ts       # Room tokens, formatters, and clean helpers
│   │   └── types/
│   │       └── index.ts             # Centralized database models & TypeScript interfaces
│   ├── modules/
│   │   ├── appointments/            # Video & in-person appointments, Jitsi tokens, profile enrichment
│   │   ├── notifications/           # In-app notifications & read receipts
│   │   ├── enrollments/             # Doctor-patient invite code verification & claiming
│   │   ├── admin/                   # Patient reassignments, roster audits, doctor credentialing
│   │   ├── cases/                   # Clinical cases, triage prioritization, SLA tracking
│   │   ├── care-plans/              # Post-discharge care plans, duration analysis, dose logs
│   │   └── identity/                # User profile retrieval and session inspection
│   ├── routes/
│   │   └── index.ts                 # Aggregated /api/v1 Router
│   ├── data/                        # Local persistent JSON data stores
│   ├── app.ts                       # Express App configuration, CORS & Middlewares
│   └── server.ts                    # HTTP Server Entry Point & Lifecycle
├── supabase/
│   └── migrations/                  # Complete SQL migrations & RLS policies
├── package.json                     # Express, TypeScript, TSX, Supabase dependencies
├── tsconfig.json
├── .env
├── .env.example
└── README.md
```

---

## Domain Modules & API Endpoints

All endpoints are mounted under both `/api/v1` and `/api` (for seamless backwards compatibility with frontend calls):

### 1. Appointments (`/api/v1/appointments`)
- `GET /api/v1/appointments?patient_id=<id>` - Get patient's appointments (enriched with doctor profile)
- `GET /api/v1/appointments?doctor_id=<id>` - Get doctor's appointments (enriched with patient profile)
- `POST /api/v1/appointments` - Create appointment (generates secure 32+ character video room token)
- `PATCH /api/v1/appointments` - Update appointment status or doctor notes

### 2. Notifications (`/api/v1/notifications`)
- `GET /api/v1/notifications?user_id=<id>` - Retrieve notifications for a user (DB + local fallback)
- `POST /api/v1/notifications` - Send an in-app notification
- `PATCH /api/v1/notifications` - Mark all notifications as read for a user

### 3. Enrollments (`/api/v1/enrollments`)
- `GET /api/v1/enrollments/verify?code=<code>` - Validate doctor invite code
- `POST /api/v1/enrollments/claim` - Claim invite code and link patient to doctor

### 4. Administration (`/api/v1/admin`)
- `GET /api/v1/admin/patient-assignments` - Aggregated active doctor-patient assignments roster
- `GET /api/v1/admin/reassign` - Audit history trail of clinical handovers
- `POST /api/v1/admin/reassign` - Reassign patient with multi-party notifications and audit log
- `POST /api/v1/admin/verify-doctor` - Approve, reject, or revoke doctor medical credentials

### 5. Cases (`/api/v1/cases`)
- `GET /api/v1/cases?patient_id=...` - List cases with SLA countdown calculation
- `GET /api/v1/cases/:id` - Retrieve case details with urgency label
- `PATCH /api/v1/cases/:id` - Update case status

### 6. Care Plans (`/api/v1/care-plans`)
- `GET /api/v1/care-plans?patient_id=...` - Active care plans with course duration calculation
- `GET /api/v1/care-plans/:id` - Detailed care plan with medication instructions
- `POST /api/v1/care-plans/log-dose` - Record medication intake log

### 7. Identity & Profiles (`/api/v1/identity`)
- `GET /api/v1/identity/me` - Authenticated user and profile
- `GET /api/v1/identity/profile/:id` - Public profile of user/doctor
- `PATCH /api/v1/identity/profile` - Update profile

---

## Environment Variables (`BACKEND/.env`)

```env
PORT=5001
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

---

## Running the Backend

From the root monorepo directory:
```bash
# Run in development with hot-reload
npm run dev:backend

# Build TypeScript to dist/
npm run build:backend

# Start production server
npm run start:backend
```

Or from within the `BACKEND` directory:
```bash
cd BACKEND
npm run dev
```

---

## Supabase Database Migrations

All SQL migrations are stored in `BACKEND/supabase/migrations/`:
- `20260920_patient_enrollments.sql`
- `20260921_COMPLETE_SYSTEM_MIGRATION.sql`
- `20260921_care_plan_lifecycle.sql`
- `20260921_case_messages.sql`
- `20260922_appointments_system.sql`
- `20260924_priority1_security.sql`

To apply migrations, run them in your Supabase Dashboard **SQL Editor** or use the Supabase CLI:
```bash
npx supabase db push
```

# Bhoomi Nayan

Real-Time National Land Acquisition & Management System — Smart India Hackathon, Problem Statement 26016
(AI, GIS & Data Analytics for Public Administration and Infrastructure Management).

One platform that follows a land acquisition from the day an agency proposes it to the day the land
is handed over. Every notification, objection, award, payment and displaced family is recorded,
mapped and visible on a national dashboard.

The core idea is a **statutory compliance clock**. The LARR Act 2013 and the NH Act 1956 put hard
deadlines on each stage, and missing some of them makes the acquisition lapse. The system tracks
every deadline for every case and warns before one is missed.

## Features

- Proposal → notification → objections → award → payment → possession workflow, for both LARR 2013
  and the NH Act 1956
- Compensation calculator (LARR ss.26–30) with a line-by-line breakdown
- Rehabilitation & resettlement entitlements, grievances and objections
- 3D map (CesiumJS) and parcel maps (Leaflet) with real cadastral boundaries
- Role-based access for 8 stakeholder types, scoped to each user's state or district
- Alerts, MIS reports and exports, and a national analytics dashboard
- Offline-capable field app for surveyors, and a citizen portal with public case tracking
- Delay-risk, compensation and litigation predictions (scikit-learn), with explanations
- Bhoomi Mitra, a chat assistant that answers questions about cases the user is allowed to see
- Interface in English, Hindi, Bengali, Marathi, Tamil and Telugu

## Tech stack

Next.js 16 + TypeScript · PostgreSQL 16 + PostGIS · Prisma · CesiumJS + Leaflet ·
Python FastAPI + scikit-learn · Groq (for the chat assistant) · Docker.

## Getting started

Requirements: Node.js 20+, PostgreSQL 16+ with PostGIS 3.4+, Python 3.11+.

```bash
npm install
cp .env.example .env        # set DATABASE_URL and NEXTAUTH_SECRET
docker compose up -d        # optional: PostGIS + MinIO, if you don't have PostgreSQL locally
npm run db:setup            # schema, PostGIS setup and seed data
npm run dev                 # http://localhost:3000
```

ML service (optional — the app runs without it):

```bash
pip install -r ml-service/requirements.txt
npm run ml:generate && npm run ml:train
npm run ml:serve            # http://localhost:8000
```

The chat assistant needs a `GROQ_API_KEY` in `.env`.

### Demo accounts

Password for all accounts: `Suraksha@Bhoomi2026`

- `collector.agra@bhoominayan.gov.in` and `collector.jaipur@bhoominayan.gov.in` — same role,
  different districts, completely different data
- `morth@bhoominayan.gov.in` — the national view

### Checks

```bash
npm run typecheck
npm run smoke:auth          # sign-in, roles, jurisdiction scoping, audit chain
npm run smoke:workflow      # statutory workflow and deadlines
npm run smoke:compensation  # compensation formula
npm run smoke:security      # security controls, against a running server
npm run walkthrough         # every page, every role, against a running server
```

## Data

- **Administrative geography** — official LGD codes and names; district boundaries from
  OpenStreetMap and [DataMeet](https://github.com/datameet/maps).
- **Cadastral maps** — live from state [Bhu-Naksha](https://bhunaksha.nic.in/bhunaksha/implementationstatus.jsp)
  portals (below).
- **Village context** — [Census 2011](https://www.data.gov.in/catalog/complete-villages-directory-indiastatedistrictsub-district-level-census-2011)
  household counts, used to size affected families.
- **ML training data** — synthetic, because no public dataset of acquisition case outcomes exists.
  The generator is calibrated against the
  [CAG performance audit on land acquisition](https://cag.gov.in/uploads/download_audit_report/2021/8.%20Chapter-3%20Acquisition%20of%20Land-061bc912443f5f3.19286864.pdf)
  (11–46 month stage delays) and [PIB](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1809062&reg=3&lang=2)
  figures; citations are in `ml-service/data/generator.py`.
- **People are synthetic.** Real landowner records are personal data under the DPDP Act 2023, so
  names, families and payments are generated. Geography is real.
- Land records, PFMS payments, e-Gazette, SMS and email are mocked behind adapters, because they need
  government credentials.

### Cadastral integration

Bhu-Naksha has no documented API, but its portals expose open endpoints. The adapter in
`backend/integrations/adapters/` works with 14 of them (12 states, 2 UTs): it reads the
village/plot hierarchy and plot extents, and traces each plot's boundary from the portal's own
single-plot map image, checked against the extent the portal reports. Owner names in those records
are never read or stored. Harvested plots are cached in PostGIS, so the app keeps working when a
state portal is down.

## Security

- Password + OTP sign-in; bcrypt hashing, lockout after 5 failed attempts, no account enumeration
- Every query and page scoped to the user's jurisdiction
- Hash-chained audit log of every change, with before/after values
- Documents encrypted at rest (AES-256-GCM); only the last 4 digits of Aadhaar and masked bank
  account numbers are stored
- Rate limiting on sign-in, OTP, writes and exports; strict security headers and CSP
- Exports watermarked with who took them and when

`npm run smoke:security` checks these against a running server.

## Project layout

```
frontend/     Next.js app — pages and components
backend/      server logic — auth, rbac, workflow, statutory, compensation, gis, integrations, …
prisma/       schema, seed scripts, PostGIS SQL
scripts/      data harvesting, seeders and test suites
ml-service/   FastAPI prediction service and training code
```

Imports use the aliases `@backend/*` and `@frontend/*`. Raw SQL is kept to `backend/gis/`.

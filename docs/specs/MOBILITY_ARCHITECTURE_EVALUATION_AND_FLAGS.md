# MapAnytime Mobility — Architectural Evaluation & Engineering Flags

**Document Status:** Draft / Under Review  
**Date:** 2026-09-09  
**Reference Document:** MapAnytime Mobility — Generic Vehicle Tracking & Dynamic Availability Spec  
**Target Repositories:**
- `mapanytime-api` (Backend services, Redis, Socket.IO, PostgreSQL/Prisma)
- `mapanytime-market-app` (Flutter buyer mobile application, Mapbox GL)
- `mapanytime-market-admin` (Next.js admin configuration dashboard)

---

## 1. Executive Summary & Architectural Verdict

The proposed architecture correctly identifies the key design principle required for MapAnytime's mobility expansion: **vehicle-agnostic domain modeling**. 

Instead of creating siloed subsystems (e.g. `JeepneyTracker`, `TricycleTracker`, `TaxiBooking`), the platform models:
$$\text{Vehicle} \longrightarrow \text{VehicleType} \longrightarrow \text{Operator/Driver}$$

This allows dynamic configuration, runtime extensibility (e.g. adding E-Trikes, UV Express, Bus shuttles via Admin without mobile releases), and decouples user vehicle selection from physical vehicle telemetry.

However, to implement this reliably in production alongside our existing systems, **several critical engineering flags, performance bottlenecks, and lifecycle gaps** must be addressed before writing code.

---

## 2. Strengths of the Proposed Architecture

1. **Decoupled Vehicle Taxonomy**: `VehicleType` as a first-class entity with `metadata` / `configuration` JSON avoids database migration churn when introducing new regional transport modes.
2. **Dynamic UI Rendering on Mobile**: Preventing hardcoded conditionals (`if (type == 'jeepney')`) in Flutter ensures the client remains a presentation engine governed by backend capability flags.
3. **Epistemic Honesty (The 3 Levels of Knowledge)**:
   - **Level 1 (Unknown)**: No assumptions made about user movement.
   - **Level 2 (User Declared)**: User states they are on a Taxi/Jeepney without GPS coupling.
   - **Level 3 (Coupled Telemetry)**: Actual vehicle ID authenticated and tracked in real time.
   This avoids false claims and misleading ETA/route predictions.
4. **Redis Ephemeral Presence**: Using TTL keys (`~60s`) prevents ghost vehicles from remaining on the map when devices lose cellular connection or drivers disconnect.

---

## 3. Engineering Flags & Technical Risk Register

We have cataloged **8 core flags (M1 through M8)** that need architectural alignment and decisions.

| Flag ID | Category | Severity | Topic |
| :--- | :--- | :--- | :--- |
| **M1** | Ingestion Performance | **HIGH** | High-frequency HTTP GPS ingestion vs. persistent connection |
| **M2** | Realtime Fan-Out | **CRITICAL** | Broadcast storm risk & spatial viewport filtering (Socket.IO) |
| **M3** | Security & Auth | **HIGH** | Telemetry ingestion authentication & vehicle spoofing prevention |
| **M4** | Availability Logic | **MEDIUM** | Dynamic availability cold-start & definition complexity |
| **M5** | User State Lifecycle | **MEDIUM** | Level 2 (User Selection) persistence, expiry & state sync |
| **M6** | Data Pipeline | **MEDIUM** | Redis ephemeral cache vs. telemetry history & analytics persistence |
| **M7** | Mobile Map Rendering | **HIGH** | Mapbox Flutter performance with high marker frequency & bearing interpolation |
| **M8** | Domain Model Reuse | **LOW / ARCH** | Unifying `TransportOperator` with existing `Organization` in Prisma |

---

### Flag M1: High-Frequency GPS Ingestion Bottleneck (HTTP vs. Stream)

* **Spec Proposal:** `POST /mobility/tracking/location` via HTTP.
* **Risk:** 
  - Urban transport (e.g., 500 jeepneys + 500 tricycles + taxis) emitting GPS pings every 2–3 seconds results in **500 to 1,000 HTTP requests per second**.
  - Standard Express/HTTP requests incur TLS handshake overhead, header parsing, body parsing, and middleware cycles.
* **Recommendation:**
  - **Phase 1 (MVP):** Support `POST /mobility/tracking/location` with a stripped-down, ultra-fast middleware bypass (no heavy session loading, minimal JWT verification).
  - **Phase 2 (Scale):** Support bidirectional **WebSocket** or **MQTT** ingestion for operator/driver apps so a single persistent TCP connection streams binary or compact JSON packets (`[lat, lng, speed, heading, timestamp]`).

---

### Flag M2: Spatial Viewport Filtering vs. Global Broadcast Storm

* **Spec Proposal:** Redis &rarr; Realtime Event &rarr; WebSocket &rarr; Flutter Mapbox.
* **Risk:**
  - If a vehicle moves in Baguio or Cebu, a user browsing the map in Manila must **not** receive its WebSocket updates.
  - Broadcasting all vehicle locations to all connected mobile clients will saturate client network bandwidth, drain phone battery, and crash Flutter Mapbox.
* **Alignment with Existing Codebase:**
  - `mapanytime-api` already implements a spatial grid cell system in `src/infrastructure/socket/index.ts` (`cell:${latIdx}:${lngIdx}` where `CELL_SIZE = 0.1°` &approx; 11 km).
  - Clients already subscribe to their visible viewport cells (`subscribe` event).
* **Recommendation:**
  - Vehicle location updates must be emitted **only to the spatial grid cell** (or adjacent cells) that the vehicle's coordinates fall into.
  - Redis should use `GEOADD` and `GEOSEARCH` to index active vehicles spatially:
    ```text
    GEOADD mobility:geo:vehicles <lng> <lat> <vehicleId>
    ```
    This allows querying "all active vehicles within $R$ km of user" in $O(\log(N))$ time.

---

### Flag M3: Telemetry Security, Spoofing & Vehicle Authorization

* **Spec Proposal:** External apps specify `{ vehicleId, vehicleType, latitude, longitude, speed, heading }`.
* **Risk:**
  - If an external application sends an arbitrary `vehicleId`, malicious actors could spoof vehicle locations, manipulate availability, or report false positions.
* **Recommendation:**
  - Every external operator/app must be authenticated via **Operator API Keys** or **Driver Access Tokens**.
  - During location ingestion:
    1. Verify the `operatorId` owns the `vehicleId`.
    2. Verify `trackingEnabled == true` and the vehicle is not flagged `SUSPENDED` or `MAINTENANCE`.
    3. Perform sanity checks on GPS data (e.g. speed < 160 km/h, coordinate jump delta within reasonable bounds).

---

### Flag M4: Dynamic Availability Cold Start & Multi-Tier Calculation

* **Spec Proposal:** Availability depends on:
  $$\text{Location} + \text{Coverage} + \text{Live Tracking Status} + \text{Operating Hours} + \text{Route} + \text{Admin Config}$$
* **Risk:**
  - If availability strictly requires an **active live-tracked vehicle** within 2 km, a user opening the app at 6:00 AM may see "No Jeepneys Available" simply because the first morning jeepney has not launched their app yet, even though the jeepney route runs right in front of them.
* **Recommendation:**
  - Introduce a two-tiered availability concept:
    1. **Service Available (`serviceSupported: boolean`)**: Does this vehicle type operate in this territory / route during this time window?
    2. **Live Units Nearby (`liveCount: number`, `nearestEtaSeconds?: number`)**: Are there currently broadcasting vehicles within the radius?
  - Response contract:
    ```json
    {
      "code": "JEEPNEY",
      "name": "Jeepney",
      "icon": "jeepney_icon.png",
      "isServiceActive": true,
      "liveVehiclesNearby": 4,
      "nearestDistanceMeters": 350
    }
    ```

---

### Flag M5: Level 2 (User Transportation Selection) Lifecycle & Storage

* **Spec Proposal:** User selects: `What are you riding? [ Taxi ]`.
* **Risk:**
  - When does this state expire?
  - If a user selects "Taxi" and forgets, will MapAnytime treat them as riding a taxi 3 days later?
* **Recommendation:**
  - **Ephemeral Session**: Store Level 2 selection in Flutter local state (`shared_preferences` / Riverpod state) with a time-to-live (e.g., auto-prompt after 45 minutes: *"Are you still on a Taxi?"* or clear when app is terminated).
  - When walking/stationary detection is available via mobile sensors (activity recognition), auto-clear the selection.

---

### Flag M6: Realtime Cache vs. Historical Telemetry & Analytics

* **Spec Proposal:** Store latest location in Redis with TTL ~60s.
* **Risk:**
  - Redis TTL purges data upon expiry. Without persistence, MapAnytime cannot:
    - Compute route density heatmaps.
    - Resolve customer disputes or safety incidents.
    - Provide historical route playback.
* **Recommendation:**
  - Adopt a **dual-write / stream pattern**:
    - **Hot path (Realtime):** Write to Redis `mobility:vehicle:{id}:location` + emit to Socket.IO.
    - **Cold path (Archival):** Push batch updates via existing RabbitMQ (`src/infrastructure/rabbitmq`) to an asynchronous consumer that writes into PostgreSQL / Timescale partitioned history tables (`VehicleLocationHistory`).

---

### Flag M7: Mapbox Flutter Rendering & Marker Interpolation

* **Spec Proposal:** Display vehicles on Mapbox in Flutter.
* **Risk:**
  - Standard marker redraws in Flutter (adding/removing `PointAnnotation` widgets every second) will stutter, drop frames, and cause memory leaks on mid-range Android devices.
* **Recommendation:**
  - Use **Mapbox SymbolLayer + GeoJSON Source** rather than individual Flutter widget annotations:
    - Single GeoJSON feature collection for all vehicles in the viewport.
    - Update the GeoJSON source data in-place on each socket tick.
  - Implement smooth bearing and coordinate animation (linear interpolation / tween) so vehicles glide between GPS reports rather than jumping abruptly.

---

### Flag M8: Domain Model Integration with Existing Prisma Architecture

* **Spec Proposal:** Add `TransportOperator`, `Vehicle`, `VehicleType`, `TransportDriver`.
* **Observation:**
  - `mapanytime-api` already has an established `Organization` multi-tenancy model (see `prisma/schema.prisma` and `src/modules/organization/`).
* **Recommendation:**
  - A `TransportOperator` can be modeled as an `Organization` with `type = TRANSPORT_OPERATOR`, leveraging existing RBAC, team permissions, and credentials architecture.
  - Drivers can be modeled as `User` with role `DRIVER` attached to the transport organization.
  - Keeps database clean and reuses existing audit logs and security middleware.

---

## 4. Proposed Database Schema Design (Prisma)

```prisma
enum VehicleOperationalStatus {
  ACTIVE
  INACTIVE
  OFFLINE
  ON_TRIP
  AVAILABLE
  UNAVAILABLE
  MAINTENANCE
}

model VehicleType {
  id            String    @id @default(uuid())
  code          String    @unique // e.g. "JEEPNEY", "TRICYCLE", "TAXI", "BUS"
  name          String
  description   String?
  iconUrl       String?
  markerIconUrl String?
  isActive      Boolean   @default(true)
  isPublic      Boolean   @default(true)
  sortOrder     Int       @default(0)
  configuration Json?     // Max capacity, fare formula, default speed, etc.
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  vehicles      Vehicle[]
  routes        TransportRoute[]

  @@index([isActive, sortOrder])
}

model Vehicle {
  id              String                   @id @default(uuid())
  vehicleTypeId   String
  operatorOrgId   String                   // Links to Organization model
  driverUserId    String?                  // Links to User model
  plateNumber     String                   @unique
  vehicleNumber   String?                  // Internal operator number (e.g. "TX-1024")
  trackingEnabled Boolean                  @default(true)
  status          VehicleOperationalStatus @default(OFFLINE)
  metadata        Json?                    // Model, color, capacity, amenities
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt

  vehicleType     VehicleType              @relation(fields: [vehicleTypeId], references: [id])
  operator        Organization             @relation(fields: [operatorOrgId], references: [id])
  driver          User?                    @relation(fields: [driverUserId], references: [id])
  locations       VehicleLocationHistory[]

  @@index([operatorOrgId])
  @@index([vehicleTypeId, status])
}

model VehicleLocationHistory {
  id         String   @id @default(uuid())
  vehicleId  String
  latitude   Float
  longitude  Float
  speed      Float?   // km/h
  heading    Float?   // degrees 0-360
  accuracy   Float?   // meters
  recordedAt DateTime @default(now())

  vehicle    Vehicle  @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([vehicleId, recordedAt(sort: Desc)])
}
```

---

## 5. Suggested Phased Roadmap

| Phase | Scope | Focus |
| :--- | :--- | :--- |
| **Phase 1: Foundation & Models** | Backend (`mapanytime-api`) | Prisma schema, migration, `VehicleType` and `Vehicle` CRUD, seed standard PH types (Jeepney, Tricycle, Taxi). |
| **Phase 2: Redis & Ingestion** | Backend (`mapanytime-api`) | Telemetry ingest endpoint (`POST /mobility/tracking/location`), Redis `GEOADD` + TTL heartbeat, API key auth for operators. |
| **Phase 3: Realtime Fan-out** | Backend (`mapanytime-api`) | Integrate vehicle location events into existing Socket.IO grid cell architecture (`cell:${lat}:${lng}`). |
| **Phase 4: Flutter Dynamic Client** | Mobile (`mapanytime-market-app`) | Dynamic availability API fetch, transport toggle chips, Mapbox GeoJSON symbol layer for smooth vehicle rendering. |
| **Phase 5: Level 2 & 3 UX** | Mobile & Admin | User transport selector sheet ("What are you riding?"), Admin vehicle type management in `mapanytime-market-admin`. |
| **Phase 6: Advanced Mobility** | Enterprise / Scale | Transport routes, stops, ETA calculation, MQTT/WebSocket ingestion pipeline. |

---

## 6. Action Items / Questions for Alignment

1. **Ingestion Channel**: Shall we build HTTP ingestion first for the MVP and design for WebSocket/MQTT in Phase 6?
2. **Organization Model**: Do you confirm reusing `Organization` for `TransportOperator` rather than building an isolated company table?
3. **Availability Radius**: Should the default local search radius for active vehicles be configurable per vehicle type (e.g. 1.5 km for Tricycles, 5 km for Taxis, 10 km for Buses)?
4. **Historical Storage**: Should every location ping be archived to PostgreSQL/TimescaleDB, or only sampled pings (e.g. every 10–15 seconds)?

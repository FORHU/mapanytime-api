# MapAnytime Mobility + God's Eye

## Recommended Architecture & Implementation Roadmap

**Status:** Recommended Architecture
**Purpose:** Establish the implementation direction for MapAnytime Mobility while preserving compatibility with the existing MapAnytime marketplace infrastructure.

---

# 1. Architectural Direction

MapAnytime Mobility should be implemented as a **vehicle-agnostic mobility subsystem** built on top of the existing MapAnytime architecture.

The system must NOT create separate tracking implementations for:

* Jeepneys
* Tricycles
* Taxis
* Buses
* Vans
* UV Express
* E-Trikes
* Future vehicle types

Instead, all transportation modes should use the same generic domain:

```text
Vehicle
   ↓
VehicleType
   ↓
Operator Organization
   ↓
Driver / User
   ↓
Tracking Session
   ↓
Live Vehicle Location
```

Vehicle types are configuration/data rather than hardcoded application logic.

This allows new transportation types to be introduced through the Admin system without requiring a new Flutter release.

---

# 2. God's Eye Architectural Role

**God's Eye should not become a separate tracking architecture.**

It should be the **real-time visibility layer of MapAnytime Mobility**.

```text
                         MAPANYTIME
                             │
              ┌──────────────┴──────────────┐
              │                             │
         MARKETPLACE                    MOBILITY
                                            │
                                    ┌───────┴───────┐
                                    │               │
                              Mobility Domain   God's Eye
                                    │               │
                              Vehicle/Route     Live Vehicle
                              Operator/Driver   Visibility
                                    │               │
                                    └───────┬───────┘
                                            │
                                      Redis + Socket.IO
                                            │
                                         Flutter
                                         Mapbox
```

The responsibility split should be:

### MapAnytime Mobility

Owns:

* Vehicles
* Vehicle types
* Operators
* Drivers
* Tracking permissions
* Operational state
* Routes
* Stops
* Availability
* Historical telemetry

### God's Eye

Owns the real-time visibility experience:

* Live vehicle positions
* Spatial filtering
* Realtime updates
* Vehicle movement visualization
* Map rendering
* Smooth vehicle interpolation

---

# 3. Existing Architecture Reuse

## 3.1 Organization

Do NOT create a separate `TransportOperator` subsystem.

Extend the existing:

```text
Organization
```

to support:

```text
OrganizationType.TRANSPORT_OPERATOR
```

Transport operators will therefore automatically benefit from the existing:

* Multi-tenancy
* RBAC
* User management
* Invitations
* Audit logs
* API credentials
* Organization permissions

Conceptually:

```text
Organization
    │
    └── type = TRANSPORT_OPERATOR
            │
            ├── Users / Drivers
            ├── Vehicles
            ├── Routes
            └── API Credentials
```

This resolves **M8 — Domain Model Reuse**.

---

# 4. Core Domain Model

The initial mobility domain should contain:

```text
VehicleType
Vehicle
VehicleTrackingSession
VehicleLocationHistory
```

with existing:

```text
Organization
User
RBAC
```

being reused.

---

# 5. VehicleType

`VehicleType` should be a first-class configurable entity.

Examples:

```text
JEEPNEY
TRICYCLE
TAXI
BUS
UV_EXPRESS
VAN
E_TRIKE
```

The mobile application must NOT contain logic such as:

```text
if type == jeepney
if type == taxi
if type == tricycle
```

Instead, the backend provides:

```json
{
  "code": "JEEPNEY",
  "name": "Jeepney",
  "iconUrl": "...",
  "markerIconUrl": "...",
  "configuration": {}
}
```

This allows the Admin system to introduce new transportation types dynamically.

---

# 6. Vehicle

A vehicle belongs to:

```text
VehicleType
Organization
optional Driver/User
```

Example:

```text
Vehicle
   ├── VehicleType
   ├── Operator Organization
   ├── Driver
   ├── Tracking Session
   └── Location History
```

Vehicle status should support states such as:

```text
ACTIVE
INACTIVE
OFFLINE
AVAILABLE
UNAVAILABLE
ON_TRIP
MAINTENANCE
SUSPENDED
```

`trackingEnabled` must be independent from operational status.

---

# 7. Tracking Session

A `VehicleTrackingSession` should be introduced rather than relying only on the Vehicle record.

A vehicle may have multiple tracking sessions:

```text
Vehicle
   │
   ├── Tracking Session #1
   │      ├── Driver A
   │      ├── Device/App A
   │      ├── startedAt
   │      └── endedAt
   │
   └── Tracking Session #2
          ├── Driver B
          ├── Device/App B
          ├── startedAt
          └── endedAt
```

This provides:

* Driver accountability
* Device/app identification
* Tracking lifecycle
* Auditability
* Better telemetry ownership
* Future trip/session analytics

---

# 8. M1 — GPS Ingestion

## Phase 1

Use:

```http
POST /mobility/tracking/location
```

Do NOT implement MQTT or WebSocket ingestion initially.

The ingestion endpoint should be lightweight:

```text
GPS
 ↓
Authentication
 ↓
Vehicle Authorization
 ↓
Telemetry Validation
 ↓
Redis
 ↓
Realtime Event
```

Avoid unnecessary:

* Session loading
* Heavy database queries
* Expensive middleware
* Synchronous historical writes

## Future Scale

When the system reaches significantly higher telemetry volume, introduce:

```text
WebSocket / MQTT
```

without changing the underlying Mobility domain model.

Therefore:

```text
Phase 1 = HTTP
Phase 2 = Streaming ingestion
```

---

# 9. M2 — Spatial Realtime Architecture

M2 is the most critical realtime concern.

Never broadcast all vehicle locations to every connected client.

Incorrect:

```text
Vehicle
   ↓
All Socket.IO clients
```

Correct:

```text
Vehicle GPS
    ↓
Redis GEO
    ↓
Spatial Cell
    ↓
Socket.IO Room
    ↓
Users viewing that area
```

The existing MapAnytime spatial socket grid should be reused.

Existing concept:

```text
cell:${lat}:${lng}
```

Vehicle updates should be emitted only to relevant spatial cells.

---

# 10. Redis Live Vehicle State

Redis should act as the **God's Eye live-state layer**.

Example:

```text
mobility:vehicle:{vehicleId}:location
```

Example data:

```json
{
  "lat": 16.4023,
  "lng": 120.5960,
  "speed": 23.4,
  "heading": 182,
  "accuracy": 8,
  "timestamp": 1788940000
}
```

Maintain an additional Redis GEO index:

```text
mobility:geo:vehicles
```

Example:

```text
GEOADD mobility:geo:vehicles <lng> <lat> <vehicleId>
```

Use TTL/heartbeat behavior to automatically remove stale vehicles from the live system.

Recommended initial live-state TTL:

```text
~60 seconds
```

This prevents ghost vehicles.

---

# 11. Spatial Filtering

The existing approximately 11 km grid is a strong starting point.

However, the long-term architecture should combine:

```text
Spatial Grid
+
Viewport Filtering
+
Radius Filtering
+
Vehicle Type Filtering
```

A user should not receive hundreds of irrelevant vehicles simply because they happen to occupy the same coarse grid cell.

The goal is:

> The client receives only the vehicles it can reasonably display.

---

# 12. M3 — Telemetry Security

External applications must never be trusted simply because they provide a `vehicleId`.

Do NOT rely on:

```json
{
  "vehicleId": "abc",
  "operatorId": "xyz"
}
```

as proof of ownership.

Instead:

```text
API Credential
      ↓
Organization
      ↓
Authorized Vehicle
```

During ingestion:

1. Authenticate the application/operator.
2. Resolve the Organization from the credential.
3. Verify the Organization owns the vehicle.
4. Verify `trackingEnabled = true`.
5. Verify the vehicle is not suspended or under maintenance.
6. Validate coordinates.
7. Validate timestamp.
8. Validate speed.
9. Validate heading.
10. Detect unreasonable location jumps.

Example sanity rules:

```text
speed < configured maximum
latitude/longitude valid
timestamp not excessively old
movement delta reasonable
```

This protects the system from vehicle spoofing.

---

# 13. M4 — Two-Tier Availability

Availability must NOT depend entirely on live telemetry.

The backend should distinguish:

### Service Availability

```text
serviceSupported = true
```

Meaning:

> This transportation service operates in this area.

### Live Availability

```text
liveVehiclesNearby = 0
```

Meaning:

> No currently trackable vehicles are nearby.

Example:

```json
{
  "code": "JEEPNEY",
  "name": "Jeepney",
  "isServiceActive": true,
  "liveVehiclesNearby": 0,
  "nearestDistanceMeters": null
}
```

This prevents false statements such as:

```text
"No Jeepneys operate here."
```

when the real situation is simply:

```text
"No Jeepneys are currently broadcasting."
```

---

# 14. M5 — User Transportation Selection

Level 2 user state should remain ephemeral.

Example:

```text
User selects:
"What are you riding?"
        ↓
Taxi
        ↓
Local mobile state
        ↓
Expiration
```

Initial implementation:

* Store locally.
* Apply a TTL.
* Prompt again after expiration.
* Clear when appropriate.

Do NOT make sophisticated activity recognition a Phase 1 dependency.

Future versions may use:

```text
Activity Recognition
GPS Behavior
Trip Detection
```

to automatically update the selection.

---

# 15. M6 — Realtime vs Historical Data

Redis should NOT be the historical database.

Use two paths:

```text
                         ┌── Redis ──→ Socket.IO
                         │             ↓
GPS → API → Validation ──┤           Flutter
                         │
                         └── RabbitMQ → History Worker
                                          ↓
                                     PostgreSQL
```

### Hot Path

Redis:

```text
Latest vehicle position
Vehicle heartbeat
Spatial index
Realtime state
```

### Cold Path

PostgreSQL:

```text
VehicleLocationHistory
```

RabbitMQ should decouple telemetry ingestion from historical persistence.

This enables future:

* Route playback
* Heatmaps
* Vehicle utilization
* Traffic analysis
* Incident investigation
* Mobility analytics

---

# 16. M7 — Flutter Map Rendering

Avoid creating hundreds of Flutter widgets for vehicles.

Do NOT use:

```text
500 vehicles
↓
500 Flutter widgets
```

Prefer:

```text
Mapbox
   ↓
GeoJSON Source
   ↓
Symbol Layer
   ↓
Vehicle Features
```

The application should update the GeoJSON source rather than constantly creating/removing individual Flutter annotations.

Vehicle movement should use interpolation:

```text
GPS Position A
      │
      │ interpolation
      ▼
smooth movement
      │
      ▼
GPS Position B
```

This prevents vehicles from visually jumping every time a GPS packet arrives.

---

# 17. Recommended Prisma Direction

Before implementing the schema, first reconcile the proposed models against the **actual existing Prisma schema**.

The implementation should ultimately resemble:

```text
Organization
     │
     ├── Vehicles
     │      │
     │      ├── VehicleType
     │      ├── Driver
     │      ├── TrackingSessions
     │      └── LocationHistory
     │
     └── Routes
```

The exact Prisma relations, indexes, enums, and naming should be determined after inspecting the existing schema to avoid conflicts.

Do NOT blindly introduce duplicate concepts already present in the system.

---

# 18. Recommended Implementation Roadmap

## PHASE 0 — Architecture Reconciliation

Before writing mobility code:

* Inspect `Organization`
* Inspect `OrganizationType`
* Inspect `User`
* Inspect RBAC
* Inspect API credentials
* Inspect audit logging
* Inspect Redis infrastructure
* Inspect RabbitMQ infrastructure
* Inspect Socket.IO spatial grid
* Inspect existing Prisma conventions

**Goal:** Integrate Mobility instead of creating a competing architecture.

---

## PHASE 1 — Mobility Foundation

Implement:

```text
VehicleType
Vehicle
VehicleTrackingSession
VehicleLocationHistory
```

Integrate with:

```text
Organization
User
RBAC
```

Add Admin CRUD for:

```text
Vehicle Types
Vehicles
Operators
Driver assignments
```

Seed initial Philippine vehicle types:

```text
JEEPNEY
TRICYCLE
TAXI
```

Additional types can be added dynamically.

---

## PHASE 2 — God's Eye Live Tracking

Implement:

```http
POST /mobility/tracking/location
```

Add:

* Operator authentication
* Vehicle authorization
* Telemetry validation
* Redis live state
* Redis GEO index
* TTL heartbeat
* Tracking sessions

Goal:

```text
GPS → API → Redis
```

---

## PHASE 3 — Spatial Realtime

Integrate Mobility into the existing Socket.IO grid.

Implement:

```text
Vehicle
 ↓
Spatial Cell
 ↓
Socket.IO Room
 ↓
Relevant Users
```

Add:

* Viewport subscriptions
* Spatial filtering
* Vehicle-type filtering
* Stale vehicle removal
* Realtime vehicle updates

Goal:

```text
GPS → Redis → Socket.IO → relevant users
```

---

## PHASE 4 — Flutter God's Eye

Implement:

* Dynamic vehicle types
* Dynamic icons
* Availability API
* GeoJSON source
* Symbol layers
* Smooth interpolation
* Vehicle selection/filtering
* Live vehicle display

Goal:

```text
God's Eye
= live mobility map
```

---

## PHASE 5 — Availability & User State

Implement:

```text
serviceSupported
liveVehiclesNearby
nearestDistanceMeters
```

Then add:

```text
"What are you riding?"
```

with temporary Level 2 state.

---

## PHASE 6 — Historical Intelligence

Implement:

```text
RabbitMQ
 ↓
Telemetry Consumer
 ↓
PostgreSQL
```

Add:

* Historical location storage
* Route playback
* Vehicle history
* Heatmaps
* Mobility analytics

---

## PHASE 7 — Route Intelligence

Introduce:

```text
TransportRoute
TransportStop
VehicleRouteAssignment
```

Then:

* Route visualization
* Stop information
* ETA
* Route matching
* Historical route analysis

---

## PHASE 8 — Scale & Advanced Ingestion

Only after the system demonstrates real load:

```text
HTTP ingestion
      ↓
WebSocket / MQTT
```

Add:

* Persistent connections
* Binary/compact telemetry
* Batch processing
* High-volume operators
* Advanced telemetry optimization

---

# 19. Final Priority Ranking

The engineering flags should be addressed in this order:

```text
1. M8 — Domain Model Integration
2. M3 — Telemetry Security
3. M2 — Spatial Realtime
4. M1 — GPS Ingestion
5. M6 — Historical Pipeline
6. M7 — Flutter Rendering
7. M4 — Availability
8. M5 — User State
```

The reason M8 comes first is that the domain foundation affects everything built afterward.

---

# 20. Core Architectural Principle

The entire implementation should follow this principle:

> **MapAnytime Mobility owns the transportation domain; God's Eye owns the live visibility experience.**

Therefore:

```text
MapAnytime Mobility
        │
        ├── Organizations
        ├── Vehicles
        ├── Drivers
        ├── Vehicle Types
        ├── Routes
        ├── Availability
        └── Historical Data
                │
                ▼
             God's Eye
                │
                ├── Redis Live State
                ├── Spatial Filtering
                ├── Socket.IO
                ├── Realtime Updates
                └── Mapbox Visualization
```

This architecture allows MapAnytime to start with:

```text
Jeepneys
Tricycles
Taxis
```

while remaining capable of supporting:

```text
Buses
UV Express
Vans
E-Trikes
Shuttles
Other transport modes
```

without redesigning the mobility subsystem.

**Recommended immediate action:**

> **Start with Phase 0 — Architecture Reconciliation, then Phase 1 — Mobility Foundation. Do not implement MQTT, ETA, route prediction, or advanced AI tracking yet. Establish the domain model, security boundaries, Redis live-state architecture, and existing Socket.IO integration first.**

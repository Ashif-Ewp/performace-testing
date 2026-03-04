# PERFORMANCE TESTING REPORT
## ChartRaiders Backend / API

| Field | Value |
|-------|-------|
| **Document Version** | 1.0 |
| **Date** | 2026-02-19 |
| **Prepared By** | ChartRaiders Engineering Team |
| **Environment** | Production (EC2 - api.chartraiders.com) |
| **Status** | Final |

---

## 1. Executive Summary

This report documents the performance testing conducted on the ChartRaiders backend API infrastructure at `https://api.chartraiders.com`. Testing was performed across three phases (Load, Stress, Spike) over a 21.5-minute combined test run to validate system behavior under expected and peak load conditions, identify bottlenecks, and measure performance SLAs.

**Overall Verdict: FAIL** - The system does not meet the defined performance SLAs under load. Response times are extremely degraded with an overall average of 5,542ms (target: <200ms) and throughput of only 48 req/s (target: >500 req/s). A critical memory leak was discovered on production with 1,699 MB heap used (vs 70 MB on staging after a fresh restart). The server is running as a single Node.js process and requires immediate memory leak investigation, horizontal scaling, and caching optimizations.

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| **Avg Response Time** | < 200ms | 5,542 ms | **FAIL** |
| **P95 Response Time** | < 500ms | 23,269 ms | **FAIL** |
| **P99 Response Time** | < 1000ms | ~40,000+ ms | **FAIL** |
| **Throughput** | > 500 req/s | 47.92 req/s | **FAIL** |
| **Error Rate** | < 1% | 0.26% | **PASS** |
| **Max Concurrent Users** | 500+ | 755 (with severe degradation) | **PARTIAL** |

> **Note:** Baseline response time with 1 VU was 317-399ms (includes ~300ms network latency from test runner to EC2). Server-side processing is ~30-100ms at idle. The severe degradation on production is compounded by a memory leak (1,699 MB heap after 13h uptime).

---

## 2. Scope & Objectives

### 2.1 Scope

The following API endpoints, services, and infrastructure components were tested:

- **Express.js application server** and REST API endpoints (50+ routes across 14 route groups)
- **Socket.IO WebSocket connections** for real-time match data, trading, and chat (`/realtime` namespace)
- **Database query performance** (PostgreSQL via Sequelize ORM, MongoDB for bonus data)
- **Authentication and session management** (JWT-based auth with bcrypt hashing)
- **Redis/DragonflyDB** caching layer and BullMQ job queue performance
- **Nginx** reverse proxy / TLS termination

### 2.2 Objectives

1. Validate API response times under normal (200 VU) and peak (500+ VU) load conditions
2. Determine maximum throughput and concurrent user capacity on EC2 (4 vCPU, 8 GB RAM)
3. Identify performance bottlenecks and resource constraints (CPU, memory, DB connections, event loop)
4. Validate recovery from sudden traffic spikes (10x and 15x surge simulation)
5. Establish baseline metrics for ongoing performance monitoring via APM

---

## 3. Test Environment

| Component | Details |
|-----------|---------|
| **Environment** | Production EC2 (api.chartraiders.com) |
| **AWS Region** | us-east-1 |
| **EC2 Instance Type** | t2.medium — 4 vCPU, 8 GB RAM |
| **Application Server** | Node.js v22.20.0 / Express.js 5.1.0 / Socket.IO 4.8.1 |
| **Database** | PostgreSQL (Sequelize 6.37.7, pool: min 5, max 20) |
| **Secondary DB** | MongoDB Atlas (bonus data, configurations) |
| **Caching** | DragonflyDB (port 16379) + Redis (port 26379) |
| **Job Queue** | BullMQ 5.56.4 (matchMaking, taskworker, backgroundProcessor) |
| **Load Balancer** | Nginx (TLS termination + reverse proxy) |
| **Test Tool** | k6 v0.54.0 (Grafana k6) |
| **Test Runner Location** | Local (Windows, remote to EC2) |
| **APM** | Sentry 10.38.0 + Custom APM middleware |
| **Container** | Docker (Linux container on EC2) |

---

## 4. Test Scenarios

### 4.1 Load Test (Phase 1: 0-6 min)

Simulates expected production traffic patterns to validate system performance under normal operating conditions.

| Parameter | Value |
|-----------|-------|
| **Virtual Users (VUs)** | Ramp: 0 → 50 → 100 → 200 (peak) |
| **Ramp-up Period** | 2 minutes (0→50→100) |
| **Steady State Duration** | 2 minutes at 200 VUs |
| **Total Duration** | 6 minutes |
| **Endpoints per Session** | 9 endpoints + login (10 requests per VU cycle) |

**Endpoints Tested (per user session):**
1. `POST /api/v1/user/login` - Authentication (bcrypt + JWT)
2. `GET /api/v1/user/profile` - Profile fetch
3. `GET /api/v1/charactor-panel/` - Character panel data
4. `GET /api/v1/ticket/user` - User tickets
5. `GET /api/v1/leaderboard/` - Leaderboard
6. `GET /api/v1/notification/` - Notifications
7. `GET /api/v1/shop/case` - Shop cases
8. `GET /api/v1/friend/list` - Friend list
9. `GET /api/v1/history/match/:user_id` - Match history
10. `GET /api/v1/website/account-balance` - Account balance

**Results:**

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Avg Response Time | < 200ms | ~3,500-4,500 ms | **FAIL** |
| P95 Response Time | < 500ms | ~9,000-12,000 ms | **FAIL** |
| Throughput | > 500 req/s | ~30-40 req/s | **FAIL** |
| Error Rate | < 1% | < 0.3% | **PASS** |

> Load test showed acceptable error rates but response times were severely degraded even at low VU counts due to production memory leak (1,699 MB heap). The single Node.js process combined with memory pressure becomes the bottleneck.

---

### 4.2 Stress Test (Phase 2: 6.5-15 min)

Pushes the system beyond expected load to identify breaking points and failure modes.

| Parameter | Value |
|-----------|-------|
| **Virtual Users** | Ramp: 0 → 100 → 300 → 500 → 700 → 0 |
| **Duration** | 8.5 minutes |
| **Endpoints per VU** | 5-8 random endpoints per iteration |
| **Purpose** | Find breaking point |

**Stress Phases & Results:**

| Phase | VUs | Avg (ms) | P95 (ms) | Error % | Status |
|-------|-----|----------|----------|---------|--------|
| Warm-up | 100 | ~3,000 | ~8,000 | < 0.3% | **FAIL** |
| Medium Load | 300 | ~5,500 | ~15,000 | ~0.3% | **FAIL** |
| Target Max | 500 | ~8,000 | ~25,000 | ~0.5% | **FAIL** |
| Beyond Target | 700 | ~12,000+ | ~40,000+ | ~1.0% | **FAIL** |

**Breaking Point: ~200 VUs** - Response times exceed 5s average; P95 climbs above 10s.

**Key Observations:**
- Character panel and leaderboard endpoints are the primary bottlenecks (14,072ms and 13,917ms avg respectively)
- At 700 VUs: login failure rate reached ~0.31% (24 failures out of 7,864 attempts)
- 60-second timeout responses observed at peak load (60,060ms max)
- 591 iterations were dropped (VUs couldn't start new iterations in time)
- Production memory was already at 1,699 MB heap before testing began (memory leak from 13h uptime)

---

### 4.3 Soak / Endurance Test

> **Status:** Not executed in this run (requires dedicated 2-hour execution). Recommended for next testing cycle.

**Post-Test APM Snapshot (production - after 13h uptime + 21.5 min test):**

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Memory RSS | 2,627 MB (Node.js process) | - | **CRITICAL — Memory Leak** |
| Heap Used | 1,699 MB / 2,627 MB total | < 85% | **FAIL** |
| Event Loop Lag | Not captured during peak | < 100ms | **N/A** |
| GC Collections | Not captured during peak | - | **N/A** |
| System Memory | High pressure (8 GB total) | < 85% | **FAIL** |
| DB Pool | 5 total, 5 idle (recovered) | Max 20 | **PASS** |

> **CRITICAL:** Production RSS is 2,627 MB vs 180 MB on staging (14x higher). Heap used is 1,699 MB vs 70 MB on staging (24x higher). This indicates a severe memory leak that worsens with uptime. Staging was tested on a fresh restart (26 min uptime).

---

### 4.4 Spike Test (Phase 3: 15.5-21.5 min)

Simulates sudden traffic surges, such as when a new match round begins.

| Parameter | Value |
|-----------|-------|
| **Baseline** | 50 VUs |
| **Spike 1** | 50 → 500 VUs in 15 seconds (10x surge) |
| **Spike 2** | 50 → 750 VUs in 10 seconds (15x surge) |
| **Recovery Observation** | 1 minute between spikes |
| **Total Duration** | ~6 minutes |

**Results:**

| Phase | Avg (ms) | P95 (ms) | Error % | Recovery Time | Status |
|-------|----------|----------|---------|---------------|--------|
| Baseline (50 VU) | ~2,500 | ~7,000 | < 0.3% | N/A | **FAIL** |
| Spike 1 (500 VU) | ~8,000 | ~25,000 | ~0.5% | ~45-60 sec | **FAIL** |
| Post-Spike 1 | ~3,000 | ~8,000 | < 0.3% | N/A | **RECOVERED** |
| Spike 2 (750 VU) | ~12,000+ | ~40,000+ | ~1.5% | ~60-90 sec | **FAIL** |
| Post-Spike 2 | ~2,500 | ~7,000 | < 0.3% | N/A | **RECOVERED** |

**Key Observations:**
- Server does recover after spikes (no crash or persistent degradation)
- 591 iterations were dropped during spike phases (VUs couldn't start new iterations)
- Recovery time is slower than staging (~45-90 seconds vs 30-60 seconds on staging)
- Memory pressure from the leak significantly amplifies spike impact

---

### 4.5 WebSocket Test

> **Status:** Not executed in this combined run. Available as standalone test in `websocket-test.js`.

---

## 5. Endpoint Performance Breakdown

Aggregated metrics across all test phases (Load + Stress + Spike combined):

| Endpoint | Method | Avg (ms) | P95 (ms) | Max (ms) | Error % | Requests |
|----------|--------|----------|----------|----------|---------|----------|
| `/api/v1/user/login` | POST | 4,038 | 9,439 | 60,001 | 0.31% | 7,864 |
| `/api/v1/user/profile` | GET | 3,947 | 9,702 | 60,001 | 0.28% | 5,453 |
| `/api/v1/charactor-panel/` | GET | 14,072 | 42,739 | 60,060 | 1.46% | 4,725 |
| `/api/v1/charactor-panel/top-trader` | GET | 14,072* | 42,739* | 60,060 | 0% | 1,376 |
| `/api/v1/charactor-panel/match-history` | GET | 14,072* | 42,739* | 60,060 | 0% | 1,515 |
| `/api/v1/charactor-panel/match-statistic` | GET | 14,072* | 42,739* | 60,060 | 0% | 1,584 |
| `/api/v1/leaderboard/` | GET | 13,917 | 37,859 | 60,007 | 1.05% | 4,293 |
| `/api/v1/ticket/user` | GET | 4,160 | 9,569 | 60,000 | 0% | 5,444 |
| `/api/v1/ticket/queue` | GET | 4,160* | 9,569* | 60,000 | 0.03% | 3,644 |
| `/api/v1/notification/` | GET | 2,518 | 8,580 | 60,001 | 0.02% | 4,425 |
| `/api/v1/shop/case` | GET | 3,937 | 9,030 | 10,359 | 0% | 3,299 |
| `/api/v1/shop/item` | GET | 3,937* | 9,030* | 10,359 | 0% | 1,502 |
| `/api/v1/shop/item/featured` | GET | 3,937* | 9,030* | 10,359 | 0% | 1,521 |
| `/api/v1/friend/list` | GET | 3,055 | 8,722 | 19,225 | 0% | 4,336 |
| `/api/v1/friend/request` | GET | 3,055* | 8,722* | 19,225 | 0% | 1,466 |
| `/api/v1/history/match/:id` | GET | 2,605 | 8,463 | 9,635 | 0% | 1,802 |
| `/api/v1/website/account-balance` | GET | 2,978 | 9,348 | 10,386 | 0% | 3,316 |
| `/api/v1/party/my` | GET | 3,629 | 8,834 | 17,358 | 0% | 2,558 |
| `/health` | GET | 1,761 | 7,356 | 45,136 | 0% | 1,930 |

> *Grouped metrics from character_panel_duration / shop_duration / ticket_duration / friend_list_duration aggregate trends.

**Slowest Endpoints (by avg):**
1. `/api/v1/charactor-panel/` - 14,072ms (heavy Sequelize joins + memory pressure)
2. `/api/v1/leaderboard/` - 13,917ms (large dataset aggregation)
3. `/api/v1/ticket/user` - 4,160ms

**Most Error-Prone (by error %):**
1. `/api/v1/charactor-panel/` - 1.46% (69 failures)
2. `/api/v1/leaderboard/` - 1.05% (45 failures)
3. `/api/v1/user/login` - 0.31% (24 failures)

---

## 6. Resource Utilization

Captured via `/apm/advanced` endpoint and `/health` during and after test execution:

| Resource | Value | Threshold | Status |
|----------|-------|-----------|--------|
| **Node.js RSS** | 2,627 MB | - | **CRITICAL** |
| **V8 Heap Used** | 1,699 MB | < 4.3 GB limit | **FAIL — Memory Leak** |
| **System Memory** | 8 GB total (high pressure) | < 85% | **FAIL** |
| **DB Connections (active)** | 5 (pool min) | Max 20 (pool) | **PASS** |
| **DB Query Latency (avg)** | N/A (no slow queries logged) | < 50ms | **N/A** |
| **Event Loop Lag** | Not captured at peak | < 100ms | **N/A** |
| **CPU Load Avg (15 min)** | ~1.67 (of 4 cores) | < 3.2 (80%) | **PASS** |
| **Thread Pool Size** | 4 | 4 (default) | Configured |

**Comparison: Production vs Staging (Fresh Restart)**

| Metric | Production (13h uptime) | Staging (26 min uptime) | Ratio |
|--------|------------------------|------------------------|-------|
| Memory RSS | 2,627 MB | 180 MB | **14.6x** |
| Heap Used | 1,699 MB | 70 MB | **24.3x** |
| Avg Response | 5,542 ms | 2,799 ms | **2.0x** |
| Throughput | 48 req/s | 99 req/s | **0.48x** |
| P95 Response | 23,269 ms | 6,287 ms | **3.7x** |

**Key Observations:**
- **Memory leak confirmed**: Production heap is 1,699 MB after 13h uptime vs 70 MB on a fresh staging instance. This is a 24x difference indicating a severe memory leak.
- Node.js process RSS is 2,627 MB, consuming a large portion of the 8 GB available RAM.
- DB connection pool never saturated (max 20, only 5 acquired) — DB is not the bottleneck.
- CPU load average is moderate (1.67/4) — but Node.js is single-threaded, so only 1 core is utilized.
- The memory leak directly causes the 2x slower response times and 2x lower throughput vs staging.

---

## 7. Issues & Bottlenecks Identified

| # | Issue | Description | Severity | Status |
|---|-------|-------------|----------|--------|
| 1 | **Memory Leak on Production** | Node.js heap grows from ~70 MB to 1,699 MB over 13 hours of uptime. RSS reaches 2,627 MB. This causes progressive performance degradation, making production 2-3x slower than a fresh restart. Likely caused by unclosed event listeners, accumulated cache objects, or Sequelize model instances not being garbage collected. | **Critical** | Open |
| 2 | **Single-threaded Node.js Process** | The application runs as a single Node.js process, utilizing only 1 of 4 available CPU cores. This is a primary bottleneck limiting throughput to ~48 req/s. PM2 cluster mode is configured but not active. | **Critical** | Open |
| 3 | **Character Panel Extremely Slow** | `/api/v1/charactor-panel/` averages 14,072ms on production (vs 3,444ms on staging). P95 reaches 42,739ms. Likely due to complex Sequelize joins fetching equipment, appearance, stats in a single query, amplified by memory pressure. | **Critical** | Open |
| 4 | **Leaderboard Extremely Slow** | `/api/v1/leaderboard/` averages 13,917ms on production (vs 2,798ms on staging). P95 reaches 37,859ms. Large dataset aggregation without caching. | **Critical** | Open |
| 5 | **System Memory Pressure** | With 8 GB total RAM, the Node.js process (2.6 GB) plus Docker containers (PostgreSQL, Redis, Dragonfly) leaves very little headroom. Under sustained load, this risks OOM kills. | **High** | Open |
| 6 | **No Response Caching** | All endpoints query the database on every request. Frequently-accessed data (leaderboard, shop items, featured items) should be cached in Redis/Dragonfly. | **High** | Open |
| 7 | **60-Second Timeout Responses** | Multiple endpoints returned 60,000+ ms responses under peak load, indicating Nginx or Node.js timeout being hit. 591 iterations were dropped during the test. | **Medium** | Open |
| 8 | **No Rate Limiting** | No rate limiting middleware exists. Under DDoS or heavy load, all requests are processed equally with no backpressure mechanism. | **Medium** | Open |
| 9 | **Throughput Below Target** | Achieved 48 req/s vs target of 500 req/s. This is ~10x below target, caused by single-process execution combined with memory leak. | **Critical** | Open |

---

## 8. Recommendations

Based on actual test findings, in order of priority:

1. **Investigate and Fix Memory Leak (CRITICAL)** - Production heap grows to 1,699 MB (24x normal). Immediate action: restart the Node.js process to reclaim memory. Root cause investigation: use `--inspect` with Chrome DevTools heap snapshots to identify leaked objects. Check for unclosed event listeners (Socket.IO), accumulated Sequelize model instances, and BullMQ job references.

2. **Enable PM2 Cluster Mode (CRITICAL)** - The `pm2.config.js` already exists. Enable cluster mode with `instances: 4` to utilize all 4 CPU cores. Expected improvement: 3-4x throughput (48 → 150-200 req/s).

3. **Implement Redis Caching for Hot Endpoints** - Cache leaderboard (30s TTL), character panel (30s TTL), shop items (60s TTL), and featured items (60s TTL) in DragonflyDB. These endpoints are read-heavy and rarely change. Expected: 70-90% latency reduction on cached endpoints.

4. **Optimize Character Panel Queries** - The `/charactor-panel/` endpoint (14,072ms avg) needs query optimization. Use Sequelize `attributes` to select only needed columns, add indexes, and consider splitting into multiple lighter endpoints.

5. **Offload Bcrypt to Worker Threads** - The `bcrypt` library supports native worker threads. Ensure `bcrypt` (not `bcryptjs`) is used, or offload hash comparison to a Node.js `worker_threads` pool to prevent event loop blocking.

6. **Increase Nginx Timeout + Add Connection Limits** - Current config allows 60s timeouts. Add `limit_conn` and `limit_req` directives in Nginx for backpressure. Set `proxy_read_timeout` to 30s and implement graceful 503 responses.

7. **Add Response Compression** - Enable `compression` middleware in Express.js to reduce payload size over the network. Nginx can also handle gzip compression.

8. **Tune PostgreSQL Connection Pool** - Current pool is min:5, max:20. With PM2 cluster mode (4 workers), each worker gets its own pool. Consider setting max to 10 per worker (40 total) and add PgBouncer for connection multiplexing.

9. **Implement Rate Limiting** - Add `express-rate-limit` middleware: 100 req/min for login, 1000 req/min for authenticated endpoints. This prevents cascade failures under spike conditions.

10. **Container Memory Allocation** - Review Docker memory limits. With only 8 GB total RAM, allocate specific memory limits per container to prevent competition: App (3GB), PostgreSQL (3GB), Redis (1GB), Dragonfly (1GB).

---

## 9. Conclusion

Based on the testing results, the ChartRaiders backend API **does not meet** the defined performance SLAs. The system demonstrated **severely insufficient** performance under all load conditions, compounded by a critical memory leak on production.

**Test Summary:**
- **62,053 total requests** processed over 21.5 minutes
- **8,202 complete iterations** across Load, Stress, and Spike phases
- **48 req/s throughput** (target: 500 req/s) — **90% below target**
- **5,542ms average response time** (target: <200ms) — **28x above target**
- **23,269ms P95 response time** (target: <500ms) — **47x above target**
- **0.26% error rate** (target: <1%) — **PASS**
- **591 iterations dropped** (VUs couldn't start new iterations in time)
- Server **recovers after spikes** (45-90 second recovery time)
- **Root cause:** Memory leak (1,699 MB heap) + single-threaded Node.js process

**Critical Actions Required:**

1. **Restart production server** immediately to reclaim memory (1,699 MB → ~70 MB)
2. **Investigate memory leak** using heap snapshots (`--inspect` + Chrome DevTools)
3. **Enable PM2 cluster mode** to utilize all 4 CPU cores (highest impact scaling fix)
4. **Add Redis caching** for leaderboard and character panel endpoints (slowest at 14s avg)
5. **Optimize character panel** Sequelize queries (slowest endpoint at 14,072ms avg)

**Expected improvements after fixes:**
- Throughput: 48 → 400-500+ req/s (PM2 cluster + memory fix + caching)
- Avg Response: 5,542ms → 300-500ms under load (memory fix alone gives ~2x improvement)
- P95 Response: 23,269ms → 800-1,200ms (caching + cluster)
- Error Rate: 0.26% → <0.1% (already passing, will improve further)

---

## 10. Appendix

### A. Test Scripts & Configuration

All performance test scripts are located in `test/performance/`:

| File | Description |
|------|-------------|
| `config.js` | Test configuration (URLs, credentials, thresholds) |
| `helpers.js` | Shared helper functions and custom k6 metrics |
| `full-test.js` | Combined test (Load + Stress + Spike, 21 min) |
| `load-test.js` | Standalone load test scenario (28 min) |
| `stress-test.js` | Standalone stress test scenario (35 min) |
| `soak-test.js` | Soak/endurance test (2 hours) |
| `spike-test.js` | Standalone spike test scenario (20 min) |
| `websocket-test.js` | WebSocket performance test (18 min) |
| `smoke-test.js` | Quick 1-VU validation of all endpoints |
| `seed-test-users.js` | Test user seeding script |
| `run-all-tests.sh` | Test runner script |

### B. Raw Data & Graphs

Test results exported to `test/performance/results/`:
- `prod-full-test-results.json` - Structured production test results with per-endpoint metrics
- `prod-full-test-summary.json` - k6 native summary export (production)
- `full-test-results.json` - Structured staging test results (for comparison)
- `full-test-summary.json` - k6 native summary export (staging)

**APM Monitoring Endpoints (live during tests):**
- APM Dashboard: `https://api.chartraiders.com/apm/dashboard`
- Advanced Metrics: `https://api.chartraiders.com/apm/advanced-dashboard`
- Lightweight Metrics: `https://api.chartraiders.com/apm/metrics/lightweight`
- Queue Monitor: `https://api.chartraiders.com/queues`
- Status Monitor: `https://api.chartraiders.com/monitor`

### C. Server Specifications (from APM)

```
Platform:     Linux (Docker container on EC2)
Node.js:      v22.20.0
CPU:          4x Intel Xeon E5-2686 v4 @ 2.30GHz
Total Memory: 8 GB (t2.medium)
V8 Heap Limit: 4.3 GB
Thread Pool:  4 (default)
```

### D. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-19 | ChartRaiders Engineering | Production test execution against api.chartraiders.com with Load, Stress, Spike phases. Memory leak discovery. Full results documented. |

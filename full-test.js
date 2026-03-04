/**
 * ============================================================
 *  FULL PERFORMANCE TEST SUITE - ChartRaiders Backend API
 * ============================================================
 *  Combines Load, Stress, Spike tests into a single run.
 *  Condensed durations for practical execution (~15 min total).
 *
 *  Target: https://apidev.chartraiders.com
 *  EC2: t2.medium (4 vCPU, 8 GB RAM) + Nginx
 *
 *  Run:
 *    k6 run full-test.js
 * ============================================================
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { API_BASE, HEADERS, TEST_USERS } from "./config.js";

// ── Custom Metrics ──────────────────────────────────────────
const errorRate = new Rate("custom_error_rate");
const loginDuration = new Trend("login_duration", true);
const profileDuration = new Trend("profile_duration", true);
const leaderboardDuration = new Trend("leaderboard_duration", true);
const matchHistoryDuration = new Trend("match_history_duration", true);
const shopDuration = new Trend("shop_duration", true);
const ticketDuration = new Trend("ticket_duration", true);
const notificationDuration = new Trend("notification_duration", true);
const characterPanelDuration = new Trend("character_panel_duration", true);
const friendListDuration = new Trend("friend_list_duration", true);
const healthCheckDuration = new Trend("health_check_duration", true);
const partyDuration = new Trend("party_duration", true);
const balanceDuration = new Trend("balance_duration", true);
const successfulRequests = new Counter("successful_requests");
const failedRequests = new Counter("failed_requests");

// ── k6 Options ──────────────────────────────────────────────
export const options = {
  scenarios: {
    // ─── PHASE 1: LOAD TEST (0-6min) ───────────────────
    load_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },    // Ramp to 50
        { duration: "1m", target: 100 },   // Ramp to 100
        { duration: "2m", target: 200 },   // Ramp to 200 (peak load)
        { duration: "2m", target: 200 },   // Hold at 200
      ],
      gracefulRampDown: "10s",
      exec: "loadScenario",
      startTime: "0s",
    },

    // ─── PHASE 2: STRESS TEST (7-14min) ────────────────
    stress_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },   // Warm-up
        { duration: "1m", target: 300 },   // Push to 300
        { duration: "1m30s", target: 300 },// Hold 300
        { duration: "1m", target: 500 },   // Push to 500
        { duration: "1m30s", target: 500 },// Hold 500 (target max)
        { duration: "1m", target: 700 },   // Beyond target
        { duration: "1m", target: 700 },   // Hold 700
        { duration: "30s", target: 0 },    // Cool-down
      ],
      gracefulRampDown: "15s",
      exec: "stressScenario",
      startTime: "6m30s",
    },

    // ─── PHASE 3: SPIKE TEST (15-20min) ────────────────
    spike_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },    // Baseline
        { duration: "15s", target: 500 },  // SPIKE! 10x surge
        { duration: "1m30s", target: 500 },// Hold spike
        { duration: "30s", target: 50 },   // Drop back
        { duration: "1m", target: 50 },    // Recovery
        { duration: "10s", target: 750 },  // SPIKE 2! 15x
        { duration: "1m", target: 750 },   // Hold
        { duration: "30s", target: 0 },    // Cool-down
      ],
      gracefulRampDown: "10s",
      exec: "spikeScenario",
      startTime: "15m30s",
    },

    // ─── CONTINUOUS: Health monitoring ──────────────────
    health_monitor: {
      executor: "constant-arrival-rate",
      rate: 2,
      timeUnit: "1s",
      duration: "21m",
      preAllocatedVUs: 2,
      maxVUs: 5,
      exec: "healthCheckScenario",
      startTime: "0s",
    },
  },

  // Thresholds (adjusted for ~300ms network latency to EC2)
  thresholds: {
    http_req_duration: [
      "avg<800",     // avg < 800ms (includes ~300ms network)
      "p(95)<1500",  // p95 < 1.5s
      "p(99)<3000",  // p99 < 3s
    ],
    custom_error_rate: ["rate<0.05"],           // < 5% errors
    login_duration: ["avg<800", "p(95)<1500"],
    profile_duration: ["avg<700", "p(95)<1200"],
    leaderboard_duration: ["avg<700", "p(95)<1500"],
    character_panel_duration: ["avg<800", "p(95)<1500"],
    shop_duration: ["avg<700", "p(95)<1200"],
    ticket_duration: ["avg<700", "p(95)<1200"],
    notification_duration: ["avg<600", "p(95)<1200"],
    friend_list_duration: ["avg<700", "p(95)<1200"],
    health_check_duration: ["avg<600", "p(95)<1000"],
  },
};

// ── Helper: Login ───────────────────────────────────────────
function login(vuId) {
  const user = TEST_USERS[vuId % TEST_USERS.length];
  const res = http.post(
    `${API_BASE}/user/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: HEADERS, tags: { name: "POST /api/v1/user/login" } }
  );
  loginDuration.add(res.timings.duration);

  const ok = check(res, {
    "login 200": (r) => r.status === 200,
    "login has token": (r) => {
      try { return JSON.parse(r.body).data.login_token !== undefined; }
      catch { return false; }
    },
  });
  errorRate.add(!ok);
  if (ok) {
    successfulRequests.add(1);
    try {
      const b = JSON.parse(res.body);
      return { token: b.data.login_token, userId: b.data.user_id };
    } catch { return null; }
  }
  failedRequests.add(1);
  return null;
}

// ── Helper: GET ─────────────────────────────────────────────
function apiGet(path, token, trend, tag) {
  const h = token ? { ...HEADERS, Authorization: `Bearer ${token}` } : HEADERS;
  const res = http.get(`${API_BASE}${path}`, { headers: h, tags: { name: tag || `GET ${path}` } });
  if (trend) trend.add(res.timings.duration);
  const ok = check(res, { [`${tag} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  errorRate.add(!ok);
  ok ? successfulRequests.add(1) : failedRequests.add(1);
  return res;
}

// ── Scenario: Load Test ─────────────────────────────────────
export function loadScenario() {
  const auth = login(__VU);
  if (!auth) { sleep(1); return; }

  apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile");
  sleep(0.5);
  apiGet("/charactor-panel/", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel");
  sleep(0.5);
  apiGet("/ticket/user", auth.token, ticketDuration, "GET /api/v1/ticket/user");
  sleep(0.5);
  apiGet("/leaderboard/", auth.token, leaderboardDuration, "GET /api/v1/leaderboard");
  sleep(0.5);
  apiGet("/notification/", auth.token, notificationDuration, "GET /api/v1/notification");
  sleep(0.5);
  apiGet("/shop/case", auth.token, shopDuration, "GET /api/v1/shop/case");
  sleep(0.5);
  apiGet("/friend/list", auth.token, friendListDuration, "GET /api/v1/friend/list");
  sleep(0.5);
  apiGet(`/history/match/${auth.userId}`, auth.token, matchHistoryDuration, "GET /api/v1/history/match/:id");
  sleep(0.5);
  apiGet("/website/account-balance", auth.token, balanceDuration, "GET /api/v1/website/account-balance");
  sleep(1);
}

// ── Scenario: Stress Test ───────────────────────────────────
export function stressScenario() {
  const auth = login(__VU);
  if (!auth) { sleep(0.5); return; }

  const endpoints = [
    ["/user/profile", profileDuration, "GET /api/v1/user/profile"],
    ["/charactor-panel/", characterPanelDuration, "GET /api/v1/charactor-panel"],
    ["/charactor-panel/top-trader", characterPanelDuration, "GET /api/v1/charactor-panel/top-trader"],
    ["/charactor-panel/match-history", matchHistoryDuration, "GET /api/v1/charactor-panel/match-history"],
    ["/charactor-panel/match-statistic", characterPanelDuration, "GET /api/v1/charactor-panel/match-statistic"],
    ["/leaderboard/", leaderboardDuration, "GET /api/v1/leaderboard"],
    ["/ticket/user", ticketDuration, "GET /api/v1/ticket/user"],
    ["/ticket/queue", ticketDuration, "GET /api/v1/ticket/queue"],
    ["/notification/", notificationDuration, "GET /api/v1/notification"],
    ["/shop/case", shopDuration, "GET /api/v1/shop/case"],
    ["/shop/item", shopDuration, "GET /api/v1/shop/item"],
    ["/shop/item/featured", shopDuration, "GET /api/v1/shop/item/featured"],
    ["/friend/list", friendListDuration, "GET /api/v1/friend/list"],
    ["/friend/request", friendListDuration, "GET /api/v1/friend/request"],
    ["/website/account-balance", balanceDuration, "GET /api/v1/website/account-balance"],
    ["/party/my", partyDuration, "GET /api/v1/party/my"],
  ];

  // Hit 5-8 random endpoints per iteration
  const count = Math.floor(Math.random() * 4) + 5;
  for (let i = 0; i < count; i++) {
    const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
    apiGet(ep[0], auth.token, ep[1], ep[2]);
    sleep(0.2);
  }
}

// ── Scenario: Spike Test ────────────────────────────────────
export function spikeScenario() {
  const auth = login(__VU);
  if (!auth) { sleep(0.3); return; }

  // Rapid page loads simulating match-start rush
  apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile");
  apiGet("/ticket/user", auth.token, ticketDuration, "GET /api/v1/ticket/user");
  apiGet("/ticket/queue", auth.token, ticketDuration, "GET /api/v1/ticket/queue");
  apiGet("/charactor-panel/", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel");
  apiGet("/leaderboard/", auth.token, leaderboardDuration, "GET /api/v1/leaderboard");
  apiGet("/notification/", auth.token, notificationDuration, "GET /api/v1/notification");
  apiGet("/friend/list", auth.token, friendListDuration, "GET /api/v1/friend/list");
  apiGet("/party/my", auth.token, partyDuration, "GET /api/v1/party/my");
  sleep(0.5);
}

// ── Scenario: Health Monitoring ─────────────────────────────
export function healthCheckScenario() {
  const res = http.get(`${API_BASE.replace("/api/v1", "")}/health`, {
    headers: HEADERS, tags: { name: "GET /health" },
  });
  healthCheckDuration.add(res.timings.duration);
  check(res, { "health 200": (r) => r.status === 200 });
}

// ── Summary Export ──────────────────────────────────────────
export function handleSummary(data) {
  // Build structured results
  const results = {
    timestamp: new Date().toISOString(),
    target: API_BASE,
    environment: "EC2 t2.medium (4 vCPU, 8GB) + Nginx",
    overall: {
      total_requests: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
      total_duration_s: data.state ? data.state.testRunDurationMs / 1000 : 0,
      rps: data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0,
    },
    response_times: {
      avg_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : 0,
      min_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.min : 0,
      med_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.med : 0,
      max_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.max : 0,
      p90_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(90)"] : 0,
      p95_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(95)"] : 0,
      p99_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(99)"] : 0,
    },
    error_rate: data.metrics.custom_error_rate ? data.metrics.custom_error_rate.values.rate : 0,
    checks_passed: data.metrics.checks ? data.metrics.checks.values.passes : 0,
    checks_failed: data.metrics.checks ? data.metrics.checks.values.fails : 0,
    endpoint_metrics: {},
    thresholds_results: {},
  };

  // Per-endpoint metrics
  const endpointMetrics = {
    "login": "login_duration",
    "profile": "profile_duration",
    "leaderboard": "leaderboard_duration",
    "match_history": "match_history_duration",
    "shop": "shop_duration",
    "ticket": "ticket_duration",
    "notification": "notification_duration",
    "character_panel": "character_panel_duration",
    "friend_list": "friend_list_duration",
    "health_check": "health_check_duration",
    "party": "party_duration",
    "balance": "balance_duration",
  };

  for (const [name, metricKey] of Object.entries(endpointMetrics)) {
    if (data.metrics[metricKey]) {
      results.endpoint_metrics[name] = {
        avg_ms: Math.round(data.metrics[metricKey].values.avg * 100) / 100,
        min_ms: Math.round(data.metrics[metricKey].values.min * 100) / 100,
        med_ms: Math.round(data.metrics[metricKey].values.med * 100) / 100,
        max_ms: Math.round(data.metrics[metricKey].values.max * 100) / 100,
        p90_ms: Math.round(data.metrics[metricKey].values["p(90)"] * 100) / 100,
        p95_ms: Math.round(data.metrics[metricKey].values["p(95)"] * 100) / 100,
        p99_ms: Math.round(data.metrics[metricKey].values["p(99)"] * 100) / 100,
        count: data.metrics[metricKey].values.count || 0,
      };
    }
  }

  // Threshold results
  if (data.thresholds) {
    for (const [key, val] of Object.entries(data.thresholds)) {
      results.thresholds_results[key] = val.ok !== undefined ? (val.ok ? "PASS" : "FAIL") : "UNKNOWN";
    }
  }

  return {
    "results/full-test-results.json": JSON.stringify(results, null, 2),
    stdout: generateTextReport(results, data),
  };
}

function generateTextReport(results, rawData) {
  let out = "\n";
  out += "╔══════════════════════════════════════════════════════════════╗\n";
  out += "║       CHARTRAIDERS PERFORMANCE TEST RESULTS                ║\n";
  out += "╠══════════════════════════════════════════════════════════════╣\n";
  out += `║  Target:  ${results.target.padEnd(49)}║\n`;
  out += `║  Env:     ${results.environment.padEnd(49)}║\n`;
  out += `║  Date:    ${results.timestamp.substring(0, 19).padEnd(49)}║\n`;
  out += "╠══════════════════════════════════════════════════════════════╣\n";
  out += "║  OVERALL METRICS                                           ║\n";
  out += "╠══════════════════════════════════════════════════════════════╣\n";
  out += `║  Total Requests:   ${String(results.overall.total_requests).padEnd(40)}║\n`;
  out += `║  Throughput:       ${(Math.round(results.overall.rps * 100) / 100 + " req/s").padEnd(40)}║\n`;
  out += `║  Avg Response:     ${(Math.round(results.response_times.avg_ms) + " ms").padEnd(40)}║\n`;
  out += `║  P95 Response:     ${(Math.round(results.response_times.p95_ms) + " ms").padEnd(40)}║\n`;
  out += `║  P99 Response:     ${(Math.round(results.response_times.p99_ms) + " ms").padEnd(40)}║\n`;
  out += `║  Max Response:     ${(Math.round(results.response_times.max_ms) + " ms").padEnd(40)}║\n`;
  out += `║  Error Rate:       ${((results.error_rate * 100).toFixed(2) + "%").padEnd(40)}║\n`;
  out += `║  Checks Passed:    ${String(results.checks_passed).padEnd(40)}║\n`;
  out += `║  Checks Failed:    ${String(results.checks_failed).padEnd(40)}║\n`;
  out += "╠══════════════════════════════════════════════════════════════╣\n";
  out += "║  ENDPOINT BREAKDOWN                                        ║\n";
  out += "╠══════════════════════════════════════════════════════════════╣\n";

  for (const [name, m] of Object.entries(results.endpoint_metrics)) {
    out += `║  ${name.padEnd(18)} avg:${String(Math.round(m.avg_ms)).padStart(5)}ms  p95:${String(Math.round(m.p95_ms)).padStart(5)}ms  cnt:${String(m.count).padStart(6)} ║\n`;
  }

  out += "╠══════════════════════════════════════════════════════════════╣\n";
  out += "║  THRESHOLD RESULTS                                         ║\n";
  out += "╠══════════════════════════════════════════════════════════════╣\n";

  for (const [key, status] of Object.entries(results.thresholds_results)) {
    const icon = status === "PASS" ? "✓" : "✗";
    out += `║  ${icon} ${key.padEnd(45)} ${status.padEnd(10)}║\n`;
  }

  out += "╚══════════════════════════════════════════════════════════════╝\n";
  return out;
}

/**
 * ============================================================
 *  LOAD TEST - ChartRaiders Backend API
 * ============================================================
 *  Simulates expected production traffic patterns to validate
 *  system performance under normal operating conditions.
 *
 *  EC2: t2.medium (4 vCPU, 8 GB RAM)
 *
 *  Configuration:
 *    - Virtual Users: Ramp 0 → 50 → 100 → 200 → 0
 *    - Ramp-up Period: 5 minutes
 *    - Steady State: 15 minutes at 200 VUs
 *    - Cool-down: 3 minutes
 *    - Target: ~500 req/s at peak
 *
 *  Run:
 *    k6 run --env BASE_URL=http://<ec2-ip>:8000 load-test.js
 * ============================================================
 */

import { sleep } from "k6";
import {
  errorRate,
  login,
  apiGet,
  healthCheck,
  thinkTime,
  simulateUserSession,
  loginDuration,
  profileDuration,
  leaderboardDuration,
  matchHistoryDuration,
  shopDuration,
  ticketDuration,
  notificationDuration,
  characterPanelDuration,
  friendListDuration,
  healthCheckDuration,
} from "./helpers.js";

export const options = {
  scenarios: {
    // Scenario 1: Gradual ramp-up of user sessions
    user_sessions: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },   // Ramp to 50 VUs in 2 min
        { duration: "3m", target: 100 },   // Ramp to 100 VUs in 3 min
        { duration: "5m", target: 200 },   // Ramp to 200 VUs in 5 min (peak)
        { duration: "15m", target: 200 },  // Hold 200 VUs for 15 min (steady state)
        { duration: "3m", target: 0 },     // Ramp down to 0 in 3 min
      ],
      gracefulRampDown: "30s",
      exec: "userSessionScenario",
    },

    // Scenario 2: Constant health check probes
    health_checks: {
      executor: "constant-arrival-rate",
      rate: 10,                            // 10 req/s for health checks
      timeUnit: "1s",
      duration: "28m",
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: "healthCheckScenario",
    },

    // Scenario 3: API-only burst (high-frequency endpoint hits)
    api_burst: {
      executor: "constant-arrival-rate",
      rate: 100,                           // 100 req/s constant
      timeUnit: "1s",
      duration: "15m",
      startTime: "5m",                     // Start after ramp-up
      preAllocatedVUs: 50,
      maxVUs: 150,
      exec: "apiBurstScenario",
    },
  },

  thresholds: {
    // Overall response time SLAs
    http_req_duration: [
      "avg<200",    // Avg response < 200ms
      "p(95)<500",  // P95 < 500ms
      "p(99)<1000", // P99 < 1000ms
    ],

    // Error rate SLA
    custom_error_rate: ["rate<0.01"], // < 1% error rate

    // Per-endpoint thresholds
    login_duration: ["avg<300", "p(95)<600"],
    profile_duration: ["avg<150", "p(95)<400"],
    leaderboard_duration: ["avg<250", "p(95)<600"],
    match_history_duration: ["avg<200", "p(95)<500"],
    shop_duration: ["avg<150", "p(95)<400"],
    ticket_duration: ["avg<150", "p(95)<400"],
    notification_duration: ["avg<100", "p(95)<300"],
    character_panel_duration: ["avg<200", "p(95)<500"],
    friend_list_duration: ["avg<150", "p(95)<400"],
    health_check_duration: ["avg<50", "p(95)<100"],

    // Throughput (requests per second)
    http_reqs: ["rate>500"],
  },
};

// Scenario 1: Full user session simulation
export function userSessionScenario() {
  simulateUserSession(__VU);
}

// Scenario 2: Health check monitoring
export function healthCheckScenario() {
  healthCheck();
}

// Scenario 3: High-frequency API hits (simulates heavy browsing)
export function apiBurstScenario() {
  const auth = login(__VU);
  if (!auth) return;

  // Rapid-fire endpoint calls with minimal think time
  const endpoints = [
    { path: "/leaderboard/", trend: leaderboardDuration, tag: "GET /api/v1/leaderboard" },
    { path: "/shop/case", trend: shopDuration, tag: "GET /api/v1/shop/case" },
    { path: "/shop/item/featured", trend: shopDuration, tag: "GET /api/v1/shop/item/featured" },
    { path: "/notification/", trend: notificationDuration, tag: "GET /api/v1/notification" },
    { path: "/ticket/user", trend: ticketDuration, tag: "GET /api/v1/ticket/user" },
    { path: "/charactor-panel/", trend: characterPanelDuration, tag: "GET /api/v1/charactor-panel" },
    { path: "/user/profile", trend: profileDuration, tag: "GET /api/v1/user/profile" },
    { path: "/friend/list", trend: friendListDuration, tag: "GET /api/v1/friend/list" },
  ];

  // Pick a random endpoint
  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  apiGet(ep.path, auth.token, ep.trend, ep.tag);

  sleep(0.1); // Minimal delay between burst requests
}

// Default function (if run without scenarios)
export default function () {
  simulateUserSession(__VU);
}

// Summary handler for JSON output
export function handleSummary(data) {
  return {
    "results/load-test-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}

function textSummary(data, opts) {
  // k6 built-in summary will handle this
  return "";
}

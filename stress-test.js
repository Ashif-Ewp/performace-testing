/**
 * ============================================================
 *  STRESS TEST - ChartRaiders Backend API
 * ============================================================
 *  Pushes the system beyond expected load to identify breaking
 *  points and failure modes on EC2 t2.medium (4 vCPU, 8 GB RAM).
 *
 *  Configuration:
 *    - Virtual Users: Ramp 0 → 100 → 300 → 500 → 700 → 1000 → 0
 *    - Total Duration: ~35 minutes
 *    - Purpose: Find the breaking point where error rate > 1%
 *               or response times exceed SLA
 *
 *  Run:
 *    k6 run --env BASE_URL=http://<ec2-ip>:8000 stress-test.js
 * ============================================================
 */

import { sleep } from "k6";
import {
  errorRate,
  login,
  apiGet,
  apiPost,
  healthCheck,
  thinkTime,
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
    // Main stress scenario: ramp beyond capacity
    stress_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 },   // Warm-up to 100 VUs
        { duration: "3m", target: 100 },   // Hold at 100 VUs (baseline)
        { duration: "3m", target: 300 },   // Increase to 300 VUs
        { duration: "5m", target: 300 },   // Hold at 300 VUs
        { duration: "3m", target: 500 },   // Push to 500 VUs (target max)
        { duration: "5m", target: 500 },   // Hold at 500 VUs
        { duration: "3m", target: 700 },   // Beyond target: 700 VUs
        { duration: "3m", target: 700 },   // Hold at 700 VUs
        { duration: "2m", target: 1000 },  // Breaking point test: 1000 VUs
        { duration: "3m", target: 1000 },  // Hold at 1000 VUs
        { duration: "3m", target: 0 },     // Cool-down
      ],
      gracefulRampDown: "60s",
      exec: "stressScenario",
    },

    // Concurrent login flood
    login_flood: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      stages: [
        { duration: "5m", target: 10 },    // 10 logins/s baseline
        { duration: "5m", target: 50 },    // 50 logins/s
        { duration: "5m", target: 100 },   // 100 logins/s (stress)
        { duration: "5m", target: 200 },   // 200 logins/s (extreme)
        { duration: "5m", target: 10 },    // Recovery
      ],
      preAllocatedVUs: 100,
      maxVUs: 500,
      startTime: "2m",
      exec: "loginFloodScenario",
    },
  },

  thresholds: {
    // Relaxed thresholds for stress test (we expect some degradation)
    http_req_duration: [
      "avg<500",     // Avg < 500ms under stress
      "p(95)<2000",  // P95 < 2s under stress
      "p(99)<5000",  // P99 < 5s under stress
    ],
    custom_error_rate: ["rate<0.05"], // < 5% error rate (stress tolerance)

    // Per-endpoint (relaxed for stress)
    login_duration: ["avg<500", "p(95)<1500"],
    leaderboard_duration: ["avg<500", "p(95)<1500"],
    health_check_duration: ["avg<200", "p(95)<500"],
  },
};

// Main stress scenario - full user journey under heavy load
export function stressScenario() {
  const auth = login(__VU);
  if (!auth) {
    sleep(1);
    return;
  }

  // Simulate heavy user activity
  const actions = [
    () => apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile"),
    () => apiGet("/charactor-panel/", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel"),
    () => apiGet("/charactor-panel/top-trader", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel/top-trader"),
    () => apiGet("/charactor-panel/match-history", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel/match-history"),
    () => apiGet("/charactor-panel/match-statistic", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel/match-statistic"),
    () => apiGet("/leaderboard/", auth.token, leaderboardDuration, "GET /api/v1/leaderboard"),
    () => apiGet("/ticket/user", auth.token, ticketDuration, "GET /api/v1/ticket/user"),
    () => apiGet("/ticket/queue", auth.token, ticketDuration, "GET /api/v1/ticket/queue"),
    () => apiGet("/notification/", auth.token, notificationDuration, "GET /api/v1/notification"),
    () => apiGet("/shop/case", auth.token, shopDuration, "GET /api/v1/shop/case"),
    () => apiGet("/shop/item", auth.token, shopDuration, "GET /api/v1/shop/item"),
    () => apiGet("/shop/item/featured", auth.token, shopDuration, "GET /api/v1/shop/item/featured"),
    () => apiGet("/shop/raider-pass", auth.token, shopDuration, "GET /api/v1/shop/raider-pass"),
    () => apiGet("/friend/list", auth.token, friendListDuration, "GET /api/v1/friend/list"),
    () => apiGet("/friend/request", auth.token, friendListDuration, "GET /api/v1/friend/request"),
    () => apiGet("/website/account-balance", auth.token, null, "GET /api/v1/website/account-balance"),
    () => apiGet("/website/account-balance-history", auth.token, null, "GET /api/v1/website/account-balance-history"),
  ];

  // Execute 5-8 random actions per VU iteration
  const numActions = Math.floor(Math.random() * 4) + 5;
  for (let i = 0; i < numActions; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    action();
    sleep(Math.random() * 0.5 + 0.1); // Minimal think time under stress
  }
}

// Login flood scenario - hammer the auth endpoint
export function loginFloodScenario() {
  login(__VU);
  sleep(0.1);
}

export default function () {
  stressScenario();
}

export function handleSummary(data) {
  return {
    "results/stress-test-summary.json": JSON.stringify(data, null, 2),
  };
}

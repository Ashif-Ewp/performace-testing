/**
 * ============================================================
 *  SPIKE TEST - ChartRaiders Backend API
 * ============================================================
 *  Simulates sudden traffic surges, such as when a new match
 *  round begins or a popular event drives concurrent logins.
 *
 *  EC2: t2.medium (4 vCPU, 8 GB RAM)
 *
 *  Configuration:
 *    - Base load: 50 VUs
 *    - Spike: 0 → 500 VUs in 30 seconds (10x surge)
 *    - Recovery period: 3 minutes
 *    - Multiple spikes to test recovery
 *
 *  Run:
 *    k6 run --env BASE_URL=http://<ec2-ip>:8000 spike-test.js
 * ============================================================
 */

import { sleep } from "k6";
import {
  errorRate,
  login,
  apiGet,
  apiPost,
  healthCheck,
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
    // Spike scenario: sudden traffic surge pattern
    traffic_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        // Phase 1: Establish baseline
        { duration: "2m", target: 50 },    // Ramp to baseline 50 VUs
        { duration: "3m", target: 50 },    // Hold baseline for 3 min

        // Phase 2: SPIKE 1 - Match start event (10x surge)
        { duration: "30s", target: 500 },  // Sudden spike to 500 VUs!
        { duration: "2m", target: 500 },   // Hold spike for 2 min
        { duration: "1m", target: 50 },    // Drop back to baseline

        // Phase 3: Recovery observation
        { duration: "3m", target: 50 },    // Monitor recovery at baseline

        // Phase 4: SPIKE 2 - Second wave (simulates cascade)
        { duration: "15s", target: 750 },  // Even harder spike to 750!
        { duration: "1m", target: 750 },   // Hold briefly
        { duration: "1m", target: 50 },    // Quick drop

        // Phase 5: Final recovery
        { duration: "3m", target: 50 },    // Recovery observation
        { duration: "2m", target: 0 },     // Cool-down
      ],
      gracefulRampDown: "30s",
      exec: "spikeScenario",
    },

    // Concurrent login spike (simulates everyone logging in at once)
    login_spike: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      stages: [
        { duration: "2m", target: 5 },     // Baseline: 5 logins/s
        { duration: "3m", target: 5 },     // Hold baseline

        // SPIKE: Everyone logs in at once
        { duration: "10s", target: 200 },  // Spike to 200 logins/s!
        { duration: "1m", target: 200 },   // Hold
        { duration: "30s", target: 5 },    // Back to normal

        { duration: "3m", target: 5 },     // Recovery

        // Second login spike
        { duration: "10s", target: 300 },  // Even bigger spike!
        { duration: "30s", target: 300 },  // Hold briefly
        { duration: "30s", target: 5 },    // Recovery

        { duration: "3m", target: 5 },     // Final recovery
        { duration: "1m", target: 0 },     // Cool-down
      ],
      preAllocatedVUs: 100,
      maxVUs: 500,
      exec: "loginSpikeScenario",
    },

    // Continuous health monitoring during spikes
    health_monitor: {
      executor: "constant-arrival-rate",
      rate: 5,
      timeUnit: "1s",
      duration: "20m",
      preAllocatedVUs: 3,
      maxVUs: 10,
      exec: "healthMonitorScenario",
    },
  },

  thresholds: {
    // Spike test: slightly relaxed for spike periods, strict for recovery
    http_req_duration: [
      "avg<400",     // Avg < 400ms (spikes increase average)
      "p(95)<1500",  // P95 < 1.5s during spikes
      "p(99)<3000",  // P99 < 3s during spikes
    ],
    custom_error_rate: ["rate<0.03"], // < 3% error rate (spike tolerance)

    // Login should still work during spikes
    login_duration: ["avg<500", "p(95)<2000"],

    // Health check should always be fast
    health_check_duration: ["avg<100", "p(95)<300"],
  },
};

// Main spike scenario - simulates users flooding the platform
export function spikeScenario() {
  const auth = login(__VU);
  if (!auth) {
    sleep(0.5);
    return;
  }

  // Simulates the rush when a new match starts:
  // Users check tickets, join queue, view leaderboard

  // 1. Check profile and balance
  apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile");
  sleep(0.2);

  // 2. Check available tickets (everyone wants to join)
  apiGet("/ticket/user", auth.token, ticketDuration, "GET /api/v1/ticket/user");
  sleep(0.2);

  // 3. Check queue status
  apiGet("/ticket/queue", auth.token, ticketDuration, "GET /api/v1/ticket/queue");
  sleep(0.2);

  // 4. View character panel (equipment check before match)
  apiGet("/charactor-panel/", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel");
  sleep(0.2);

  // 5. Check leaderboard (competitive check)
  apiGet("/leaderboard/", auth.token, leaderboardDuration, "GET /api/v1/leaderboard");
  sleep(0.2);

  // 6. View notifications
  apiGet("/notification/", auth.token, notificationDuration, "GET /api/v1/notification");
  sleep(0.2);

  // 7. Check match history
  apiGet("/charactor-panel/match-history", auth.token, matchHistoryDuration, "GET /api/v1/charactor-panel/match-history");
  sleep(0.2);

  // 8. View friends for party invites
  apiGet("/friend/list", auth.token, friendListDuration, "GET /api/v1/friend/list");
  sleep(0.3);

  // 9. Check party status
  apiGet("/party/my", auth.token, null, "GET /api/v1/party/my");
  sleep(0.2);

  // 10. View shop (while waiting for match)
  apiGet("/shop/case", auth.token, shopDuration, "GET /api/v1/shop/case");

  // Brief pause between full cycles
  sleep(Math.random() * 2 + 0.5);
}

// Login spike scenario - mass authentication attempts
export function loginSpikeScenario() {
  const auth = login(__VU);
  if (auth) {
    // Quick profile fetch after login
    apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile");
  }
  sleep(0.1);
}

// Health monitoring during spike events
export function healthMonitorScenario() {
  healthCheck();
}

export default function () {
  spikeScenario();
}

export function handleSummary(data) {
  return {
    "results/spike-test-summary.json": JSON.stringify(data, null, 2),
  };
}

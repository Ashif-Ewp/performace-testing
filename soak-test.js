/**
 * ============================================================
 *  SOAK / ENDURANCE TEST - ChartRaiders Backend API
 * ============================================================
 *  Validates system stability over an extended period to detect
 *  memory leaks, connection pool exhaustion, or gradual degradation.
 *
 *  EC2: t2.medium (4 vCPU, 8 GB RAM)
 *
 *  Configuration:
 *    - Virtual Users: 100 sustained
 *    - Duration: 2 hours (120 minutes)
 *    - Purpose: Detect memory leaks, DB connection pool exhaustion,
 *               event loop blocking, and gradual degradation
 *
 *  Run:
 *    k6 run --env BASE_URL=http://<ec2-ip>:8000 soak-test.js
 * ============================================================
 */

import { sleep } from "k6";
import {
  errorRate,
  login,
  apiGet,
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
import { API_BASE, HEADERS } from "./config.js";
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

// Soak-specific metrics
const apmResponseTime = new Trend("apm_response_time", true);

export const options = {
  scenarios: {
    // Sustained user load for 2 hours
    sustained_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5m", target: 100 },    // Ramp up to 100 VUs
        { duration: "110m", target: 100 },   // Hold 100 VUs for ~2 hours
        { duration: "5m", target: 0 },       // Cool-down
      ],
      gracefulRampDown: "30s",
      exec: "soakScenario",
    },

    // Periodic health & metrics monitoring
    monitoring: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "120m",
      preAllocatedVUs: 2,
      maxVUs: 5,
      exec: "monitoringScenario",
    },

    // Periodic APM metric collection
    apm_collection: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "10s",           // Every 10 seconds
      duration: "120m",
      preAllocatedVUs: 1,
      maxVUs: 3,
      exec: "apmCollectionScenario",
    },
  },

  thresholds: {
    // Soak test: same SLAs as normal load, should not degrade
    http_req_duration: [
      "avg<200",
      "p(95)<500",
      "p(99)<1000",
    ],
    custom_error_rate: ["rate<0.01"],

    // Per-endpoint (should remain stable throughout soak)
    login_duration: ["avg<300", "p(95)<600"],
    profile_duration: ["avg<150", "p(95)<400"],
    leaderboard_duration: ["avg<250", "p(95)<600"],
    health_check_duration: ["avg<50", "p(95)<100"],
    apm_response_time: ["avg<500", "p(95)<1000"],
  },
};

// Main soak scenario - realistic user sessions repeated over time
export function soakScenario() {
  const auth = login(__VU);
  if (!auth) {
    sleep(2);
    return;
  }

  // Full user journey cycle
  const journey = [
    { path: "/user/profile", trend: profileDuration, tag: "GET /api/v1/user/profile" },
    { path: "/charactor-panel/", trend: characterPanelDuration, tag: "GET /api/v1/charactor-panel" },
    { path: "/charactor-panel/match-history", trend: characterPanelDuration, tag: "GET /api/v1/charactor-panel/match-history" },
    { path: "/ticket/user", trend: ticketDuration, tag: "GET /api/v1/ticket/user" },
    { path: "/leaderboard/", trend: leaderboardDuration, tag: "GET /api/v1/leaderboard" },
    { path: "/notification/", trend: notificationDuration, tag: "GET /api/v1/notification" },
    { path: "/shop/case", trend: shopDuration, tag: "GET /api/v1/shop/case" },
    { path: "/shop/item/featured", trend: shopDuration, tag: "GET /api/v1/shop/item/featured" },
    { path: "/friend/list", trend: friendListDuration, tag: "GET /api/v1/friend/list" },
    { path: "/website/account-balance", trend: null, tag: "GET /api/v1/website/account-balance" },
  ];

  // Execute full journey
  for (const step of journey) {
    apiGet(step.path, auth.token, step.trend, step.tag);
    thinkTime(1, 3); // Realistic think time between pages
  }

  // Simulate idle browsing period
  thinkTime(5, 15);

  // Second pass - revisit some pages (typical user behavior)
  const revisits = journey.filter(() => Math.random() > 0.6);
  for (const step of revisits) {
    apiGet(step.path, auth.token, step.trend, step.tag);
    thinkTime(2, 5);
  }
}

// Monitoring scenario - periodic health checks
export function monitoringScenario() {
  healthCheck();
}

// APM collection - track server metrics during soak
export function apmCollectionScenario() {
  const baseUrl = API_BASE.replace("/api/v1", "");

  const res = http.get(`${baseUrl}/apm/metrics/lightweight`, {
    headers: HEADERS,
    tags: { name: "GET /apm/metrics/lightweight" },
  });

  apmResponseTime.add(res.timings.duration);

  check(res, {
    "APM metrics available": (r) => r.status === 200,
  });

  // Also check advanced metrics periodically
  if (__ITER % 6 === 0) {
    // Every ~60s, check detailed metrics
    const advRes = http.get(`${baseUrl}/apm/advanced`, {
      headers: HEADERS,
      tags: { name: "GET /apm/advanced" },
    });

    if (advRes.status === 200) {
      try {
        const metrics = JSON.parse(advRes.body);
        // Log memory usage for leak detection
        if (metrics.process && metrics.process.memory) {
          console.log(
            `[SOAK MONITOR] Memory RSS: ${Math.round(
              metrics.process.memory.rss / 1024 / 1024
            )}MB, Heap Used: ${Math.round(
              metrics.process.memory.heapUsed / 1024 / 1024
            )}MB, External: ${Math.round(
              metrics.process.memory.external / 1024 / 1024
            )}MB`
          );
        }
        if (metrics.eventLoop) {
          console.log(
            `[SOAK MONITOR] Event Loop Lag: ${metrics.eventLoop.lag}ms`
          );
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
}

export default function () {
  soakScenario();
}

export function handleSummary(data) {
  return {
    "results/soak-test-summary.json": JSON.stringify(data, null, 2),
  };
}

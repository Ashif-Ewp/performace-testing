import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { API_BASE, HEADERS, TEST_USERS } from "./config.js";

// Custom metrics
export const errorRate = new Rate("custom_error_rate");
export const loginDuration = new Trend("login_duration", true);
export const profileDuration = new Trend("profile_duration", true);
export const leaderboardDuration = new Trend("leaderboard_duration", true);
export const matchHistoryDuration = new Trend("match_history_duration", true);
export const shopDuration = new Trend("shop_duration", true);
export const ticketDuration = new Trend("ticket_duration", true);
export const notificationDuration = new Trend("notification_duration", true);
export const characterPanelDuration = new Trend("character_panel_duration", true);
export const friendListDuration = new Trend("friend_list_duration", true);
export const healthCheckDuration = new Trend("health_check_duration", true);
export const successfulRequests = new Counter("successful_requests");
export const failedRequests = new Counter("failed_requests");

// Login and get auth token
export function login(userIndex) {
  const user = TEST_USERS[userIndex % TEST_USERS.length];
  const payload = JSON.stringify({
    email: user.email,
    password: user.password,
  });

  const res = http.post(`${API_BASE}/user/login`, payload, {
    headers: HEADERS,
    tags: { name: "POST /api/v1/user/login" },
  });

  loginDuration.add(res.timings.duration);

  const success = check(res, {
    "login status is 200": (r) => r.status === 200,
    "login has token": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.login_token;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);

  if (success) {
    successfulRequests.add(1);
    try {
      const body = JSON.parse(res.body);
      return {
        token: body.data.login_token,
        userId: body.data.user_id || null,
      };
    } catch {
      return null;
    }
  } else {
    failedRequests.add(1);
    return null;
  }
}

// GET request helper with metrics
export function apiGet(path, token, metricTrend, tagName) {
  const headers = token
    ? { ...HEADERS, Authorization: `Bearer ${token}` }
    : HEADERS;

  const res = http.get(`${API_BASE}${path}`, {
    headers,
    tags: { name: tagName || `GET ${path}` },
  });

  if (metricTrend) {
    metricTrend.add(res.timings.duration);
  }

  const success = check(res, {
    [`${tagName || path} status is 2xx`]: (r) =>
      r.status >= 200 && r.status < 300,
  });

  errorRate.add(!success);
  if (success) {
    successfulRequests.add(1);
  } else {
    failedRequests.add(1);
  }

  return res;
}

// POST request helper with metrics
export function apiPost(path, body, token, metricTrend, tagName) {
  const headers = token
    ? { ...HEADERS, Authorization: `Bearer ${token}` }
    : HEADERS;

  const res = http.post(`${API_BASE}${path}`, JSON.stringify(body), {
    headers,
    tags: { name: tagName || `POST ${path}` },
  });

  if (metricTrend) {
    metricTrend.add(res.timings.duration);
  }

  const success = check(res, {
    [`${tagName || path} status is 2xx`]: (r) =>
      r.status >= 200 && r.status < 300,
  });

  errorRate.add(!success);
  if (success) {
    successfulRequests.add(1);
  } else {
    failedRequests.add(1);
  }

  return res;
}

// Health check
export function healthCheck() {
  const res = http.get(`${API_BASE.replace("/api/v1", "")}/health`, {
    headers: HEADERS,
    tags: { name: "GET /health" },
  });

  healthCheckDuration.add(res.timings.duration);

  const success = check(res, {
    "health check status is 200": (r) => r.status === 200,
  });

  errorRate.add(!success);
  return res;
}

// Simulate realistic user behavior with think time
export function thinkTime(min = 1, max = 3) {
  sleep(Math.random() * (max - min) + min);
}

// Simulate a full user session
export function simulateUserSession(vuId) {
  // 1. Login
  const auth = login(vuId);
  if (!auth) return;

  thinkTime(1, 2);

  // 2. Get profile
  apiGet("/user/profile", auth.token, profileDuration, "GET /api/v1/user/profile");
  thinkTime(0.5, 1);

  // 3. Get character panel
  apiGet("/charactor-panel/", auth.token, characterPanelDuration, "GET /api/v1/charactor-panel");
  thinkTime(0.5, 1);

  // 4. Get tickets
  apiGet("/ticket/user", auth.token, ticketDuration, "GET /api/v1/ticket/user");
  thinkTime(0.5, 1);

  // 5. Check leaderboard
  apiGet("/leaderboard/", auth.token, leaderboardDuration, "GET /api/v1/leaderboard");
  thinkTime(1, 2);

  // 6. Check notifications
  apiGet("/notification/", auth.token, notificationDuration, "GET /api/v1/notification");
  thinkTime(0.5, 1);

  // 7. Check shop
  apiGet("/shop/case", auth.token, shopDuration, "GET /api/v1/shop/case");
  thinkTime(0.5, 1);

  // 8. Check friend list
  apiGet("/friend/list", auth.token, friendListDuration, "GET /api/v1/friend/list");
  thinkTime(0.5, 1);

  // 9. Get match history
  if (auth.userId) {
    apiGet(
      `/history/match/${auth.userId}`,
      auth.token,
      matchHistoryDuration,
      "GET /api/v1/history/match/:user_id"
    );
  }

  thinkTime(1, 3);
}

/**
 * SMOKE TEST - Quick validation that all endpoints work
 * Run this first before the full test suite
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { API_BASE, HEADERS, TEST_USERS } from "./config.js";

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  // 1. Health check
  console.log("--- Testing /health ---");
  let res = http.get(`${API_BASE.replace("/api/v1", "")}/health`, { headers: HEADERS });
  check(res, { "health 200": (r) => r.status === 200 });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 2. Login
  console.log("--- Testing POST /user/login ---");
  const user = TEST_USERS[0];
  res = http.post(`${API_BASE}/user/login`, JSON.stringify({
    email: user.email,
    password: user.password,
  }), { headers: HEADERS });
  check(res, { "login 200": (r) => r.status === 200 });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  let token = null;
  let userId = null;
  try {
    const body = JSON.parse(res.body);
    token = body.data.login_token;
    userId = body.data.user_id;
    console.log(`  Token: ${token ? "OK" : "MISSING"}, UserId: ${userId}`);
  } catch (e) {
    console.log(`  ERROR parsing login response: ${res.body}`);
    return;
  }

  const authHeaders = { ...HEADERS, Authorization: `Bearer ${token}` };

  // 3. Profile
  console.log("--- Testing GET /user/profile ---");
  res = http.get(`${API_BASE}/user/profile`, { headers: authHeaders });
  check(res, { "profile 200": (r) => r.status === 200 });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 4. Character Panel
  console.log("--- Testing GET /charactor-panel/ ---");
  res = http.get(`${API_BASE}/charactor-panel/`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 5. Leaderboard
  console.log("--- Testing GET /leaderboard/ ---");
  res = http.get(`${API_BASE}/leaderboard/`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 6. Tickets
  console.log("--- Testing GET /ticket/user ---");
  res = http.get(`${API_BASE}/ticket/user`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 7. Notifications
  console.log("--- Testing GET /notification/ ---");
  res = http.get(`${API_BASE}/notification/`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 8. Shop
  console.log("--- Testing GET /shop/case ---");
  res = http.get(`${API_BASE}/shop/case`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 9. Friend list
  console.log("--- Testing GET /friend/list ---");
  res = http.get(`${API_BASE}/friend/list`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 10. Match History
  console.log(`--- Testing GET /history/match/${userId} ---`);
  res = http.get(`${API_BASE}/history/match/${userId}`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 11. Account balance
  console.log("--- Testing GET /website/account-balance ---");
  res = http.get(`${API_BASE}/website/account-balance`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  // 12. Party
  console.log("--- Testing GET /party/my ---");
  res = http.get(`${API_BASE}/party/my`, { headers: authHeaders });
  console.log(`  Status: ${res.status}, Duration: ${res.timings.duration}ms`);

  console.log("\n=== SMOKE TEST COMPLETE ===");
}

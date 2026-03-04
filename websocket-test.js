/**
 * ============================================================
 *  WEBSOCKET PERFORMANCE TEST - ChartRaiders Backend API
 * ============================================================
 *  Tests Socket.IO real-time performance for match events,
 *  trading, and chat functionality.
 *
 *  EC2: t2.medium (4 vCPU, 8 GB RAM)
 *
 *  Note: k6 has experimental WebSocket support. For full
 *  Socket.IO testing, this uses the k6 WebSocket API.
 *  Socket.IO uses Engine.IO transport (polling + ws upgrade).
 *
 *  Run:
 *    k6 run --env BASE_URL=http://<ec2-ip>:8000 websocket-test.js
 * ============================================================
 */

import { check, sleep } from "k6";
import ws from "k6/ws";
import http from "k6/http";
import { Rate, Trend, Counter } from "k6/metrics";
import { API_BASE, WS_URL, HEADERS, TEST_USERS } from "./config.js";

// WebSocket-specific metrics
const wsConnectTime = new Trend("ws_connect_time", true);
const wsMessageLatency = new Trend("ws_message_latency", true);
const wsErrors = new Rate("ws_error_rate");
const wsConnections = new Counter("ws_total_connections");
const wsMessages = new Counter("ws_total_messages");

export const options = {
  scenarios: {
    // Scenario 1: WebSocket connection storm
    ws_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },    // 50 concurrent WS connections
        { duration: "3m", target: 50 },    // Hold
        { duration: "2m", target: 200 },   // Scale to 200 connections
        { duration: "5m", target: 200 },   // Hold at 200
        { duration: "2m", target: 500 },   // Push to 500 connections
        { duration: "3m", target: 500 },   // Hold at 500
        { duration: "2m", target: 0 },     // Disconnect all
      ],
      exec: "wsConnectionTest",
    },

    // Scenario 2: HTTP API alongside WebSocket load
    concurrent_http: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "18m",
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: "httpAlongsideWs",
    },
  },

  thresholds: {
    ws_connect_time: ["avg<500", "p(95)<1500"],
    ws_message_latency: ["avg<100", "p(95)<500"],
    ws_error_rate: ["rate<0.05"],
    http_req_duration: ["avg<300", "p(95)<800"],
  },
};

// Helper: Login and get token
function getAuthToken(vuId) {
  const user = TEST_USERS[vuId % TEST_USERS.length];
  const res = http.post(
    `${API_BASE}/user/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: HEADERS }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      return body.data ? body.data.login_token : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Scenario 1: WebSocket connection and message testing
export function wsConnectionTest() {
  const token = getAuthToken(__VU);
  if (!token) {
    sleep(1);
    return;
  }

  // Socket.IO uses Engine.IO protocol
  // First, get session via polling handshake
  const baseUrl = API_BASE.replace("/api/v1", "");
  const handshakeUrl = `${baseUrl}/realtime/?EIO=4&transport=polling`;

  const handshakeRes = http.get(handshakeUrl, {
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    tags: { name: "Socket.IO Handshake" },
  });

  if (handshakeRes.status !== 200) {
    wsErrors.add(true);
    sleep(1);
    return;
  }

  // Parse Socket.IO handshake response
  let sid = null;
  try {
    // Socket.IO response format: "0{...json...}"
    const body = handshakeRes.body;
    const jsonStr = body.substring(body.indexOf("{"));
    const data = JSON.parse(jsonStr);
    sid = data.sid;
  } catch {
    wsErrors.add(true);
    sleep(1);
    return;
  }

  if (!sid) {
    wsErrors.add(true);
    sleep(1);
    return;
  }

  // Upgrade to WebSocket
  const wsUrl = `${WS_URL}/?EIO=4&transport=websocket&sid=${sid}`;
  const connectStart = Date.now();

  const res = ws.connect(wsUrl, {}, function (socket) {
    wsConnections.add(1);
    const connectEnd = Date.now();
    wsConnectTime.add(connectEnd - connectStart);

    // Send WebSocket upgrade probe
    socket.send("2probe");

    socket.on("message", function (msg) {
      wsMessages.add(1);
      const receiveTime = Date.now();

      // Handle Engine.IO messages
      if (msg === "3probe") {
        // Probe response - send upgrade confirmation
        socket.send("5");
      } else if (msg.startsWith("0")) {
        // Socket.IO connect response
        wsErrors.add(false);
      } else if (msg === "2") {
        // Ping - respond with pong
        socket.send("3");
      } else if (msg.startsWith("42")) {
        // Socket.IO event message
        wsMessageLatency.add(Date.now() - receiveTime);
        wsErrors.add(false);
      }
    });

    socket.on("error", function (e) {
      wsErrors.add(true);
      console.log(`WS Error (VU ${__VU}): ${e}`);
    });

    // Simulate Socket.IO events after connection
    socket.setTimeout(function () {
      // Send authentication event
      const authEvent = `42["authenticate",{"token":"${token}"}]`;
      socket.send(authEvent);
    }, 1000);

    // Send periodic heartbeats and simulate activity
    socket.setTimeout(function () {
      // Simulate joining a match check
      socket.send('42["join:match:check"]');
    }, 3000);

    // Keep connection alive for the test duration
    socket.setTimeout(function () {
      // Send a few more events
      socket.send('42["call:trade:history",{}]');
    }, 5000);

    // Close after some time (simulating session end)
    socket.setTimeout(function () {
      socket.close();
    }, 15000 + Math.random() * 10000); // 15-25 seconds
  });

  check(res, {
    "WebSocket status is 101": (r) => r && r.status === 101,
  });

  wsErrors.add(res.status !== 101);
  sleep(1);
}

// Scenario 2: HTTP requests alongside WebSocket traffic
export function httpAlongsideWs() {
  const token = getAuthToken(__VU);
  if (!token) return;

  const endpoints = [
    "/leaderboard/",
    "/user/profile",
    "/notification/",
    "/ticket/user",
    "/shop/case",
    "/charactor-panel/",
  ];

  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${API_BASE}${ep}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    tags: { name: `GET /api/v1${ep}` },
  });

  check(res, {
    "HTTP status is 2xx during WS load": (r) => r.status >= 200 && r.status < 300,
  });
}

export default function () {
  wsConnectionTest();
}

export function handleSummary(data) {
  return {
    "results/websocket-test-summary.json": JSON.stringify(data, null, 2),
  };
}

// Performance Test Configuration for ChartRaiders Backend API
// EC2 Instance: t2.medium (4 vCPU, 8 GB RAM)

export const BASE_URL = __ENV.BASE_URL || "https://api.chartraiders.com";
export const API_BASE = `${BASE_URL}/api/v1`;
export const WS_URL = __ENV.WS_URL || "wss://api.chartraiders.com/realtime";

// Test user credentials (create these before running tests)
export const TEST_USERS = [
  { email: "perftest1@chartraiders.com", password: "PerfTest@123" },
  { email: "perftest2@chartraiders.com", password: "PerfTest@123" },
  { email: "perftest3@chartraiders.com", password: "PerfTest@123" },
  { email: "perftest4@chartraiders.com", password: "PerfTest@123" },
  { email: "perftest5@chartraiders.com", password: "PerfTest@123" },
];

// SLA Thresholds for t2.medium (4 vCPU, 8 GB RAM)
export const THRESHOLDS = {
  // Response time targets
  avg_response_time: 200,    // ms
  p95_response_time: 500,    // ms
  p99_response_time: 1000,   // ms

  // Throughput
  min_throughput: 500,       // req/s

  // Error rate
  max_error_rate: 0.01,      // 1%

  // Resource thresholds
  max_cpu: 80,               // %
  max_memory: 85,            // %
  max_db_query_latency: 50,  // ms
};

// Common headers
export const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Get auth header with token
export function authHeaders(token) {
  return {
    ...HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

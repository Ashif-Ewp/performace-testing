/**
 * Seed Test Users for Performance Testing
 *
 * Run this script before executing performance tests to create
 * the test user accounts needed for authentication.
 *
 * Usage:
 *   node test/performance/seed-test-users.js
 *
 * Environment:
 *   BASE_URL - API base URL (default: http://localhost:8000)
 */

const { BASE_URL, API_BASE } = require("./url");

const TEST_USERS = [
  {
    username: "perftest1",
    email: "perftest1@chartraiders.com",
    password: "PerfTest@123",
  },
  {
    username: "perftest2",
    email: "perftest2@chartraiders.com",
    password: "PerfTest@123",
  },
  {
    username: "perftest3",
    email: "perftest3@chartraiders.com",
    password: "PerfTest@123",
  },
  {
    username: "perftest4",
    email: "perftest4@chartraiders.com",
    password: "PerfTest@123",
  },
  {
    username: "perftest5",
    email: "perftest5@chartraiders.com",
    password: "PerfTest@123",
  },
];

async function createUser(user) {
  try {
    const response = await fetch(`${API_BASE}/user/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`[OK] Created user: ${user.email}`);
    } else if (
      data.message &&
      data.message.toLowerCase().includes("already")
    ) {
      console.log(`[SKIP] User already exists: ${user.email}`);
    } else {
      console.log(
        `[WARN] Failed to create ${user.email}: ${data.message || response.status}`
      );
    }
  } catch (error) {
    console.error(`[ERROR] Failed to create ${user.email}: ${error.message}`);
  }
}

async function verifyLogin(user) {
  try {
    const response = await fetch(`${API_BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
      }),
    });

    const data = await response.json();

    if (response.ok && data.data && data.data.token) {
      console.log(`[OK] Login verified: ${user.email}`);
      return true;
    } else {
      console.log(
        `[FAIL] Login failed for ${user.email}: ${data.message || "Unknown error"}`
      );
      return false;
    }
  } catch (error) {
    console.error(`[ERROR] Login test failed for ${user.email}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("============================================================");
  console.log("  ChartRaiders Performance Test - User Seeding");
  console.log(`  Target: ${API_BASE}`);
  console.log("============================================================\n");

  // Check server health
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    if (!healthRes.ok) {
      console.error(`Server health check failed: HTTP ${healthRes.status}`);
      process.exit(1);
    }
    console.log("[OK] Server is healthy\n");
  } catch (error) {
    console.error(`Cannot connect to server at ${BASE_URL}: ${error.message}`);
    process.exit(1);
  }

  // Create users
  console.log("--- Creating test users ---");
  for (const user of TEST_USERS) {
    await createUser(user);
  }

  console.log("\n--- Verifying logins ---");
  let successCount = 0;
  for (const user of TEST_USERS) {
    const ok = await verifyLogin(user);
    if (ok) successCount++;
  }

  console.log(`\n============================================================`);
  console.log(`  Results: ${successCount}/${TEST_USERS.length} users ready`);
  if (successCount === TEST_USERS.length) {
    console.log("  Status: ALL READY - You can now run performance tests!");
  } else {
    console.log("  Status: SOME USERS FAILED - Check errors above");
    console.log("  You may need to register users manually or check the API");
  }
  console.log("============================================================");
}

main().catch(console.error);

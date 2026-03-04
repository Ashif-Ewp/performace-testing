#!/bin/bash
# ============================================================
#  ChartRaiders Performance Test Runner
#  EC2: t2.medium (4 vCPU, 8 GB RAM)
# ============================================================
#
#  Prerequisites:
#    1. Install k6: https://k6.io/docs/getting-started/installation/
#       - Windows: choco install k6 OR winget install k6
#       - Linux:   sudo apt install k6  OR snap install k6
#       - macOS:   brew install k6
#
#    2. Set your EC2 public IP or load balancer URL:
#       export BASE_URL=http://<your-ec2-ip>:8000
#       export WS_URL=ws://<your-ec2-ip>:8000
#
#    3. Create test users (run seed-test-users.js first):
#       node test/performance/seed-test-users.js
#
#  Usage:
#    ./run-all-tests.sh [test-type]
#
#    test-type: load | stress | soak | spike | websocket | all
#
# ============================================================

set -e

# Configuration
BASE_URL="${BASE_URL:-https://api.chartraiders.com}"
WS_URL="${WS_URL:-wss://api.chartraiders.com/realtime}"
RESULTS_DIR="results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  ChartRaiders Performance Test Suite${NC}"
echo -e "${BLUE}  Target: ${BASE_URL}${NC}"
echo -e "${BLUE}  Time:   $(date)${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}ERROR: k6 is not installed.${NC}"
    echo "Install k6: https://k6.io/docs/getting-started/installation/"
    echo "  Windows: choco install k6"
    echo "  Linux:   sudo apt install k6"
    echo "  macOS:   brew install k6"
    exit 1
fi

# Health check before running tests
echo -e "${YELLOW}Running health check...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
    echo -e "${RED}ERROR: Server health check failed (HTTP ${HTTP_STATUS})${NC}"
    echo "Make sure your server is running at ${BASE_URL}"
    exit 1
fi
echo -e "${GREEN}Health check passed!${NC}"
echo ""

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2
    local description=$3

    echo -e "${BLUE}------------------------------------------------------------${NC}"
    echo -e "${BLUE}  Running: ${description}${NC}"
    echo -e "${BLUE}  File:    ${test_file}${NC}"
    echo -e "${BLUE}  Started: $(date)${NC}"
    echo -e "${BLUE}------------------------------------------------------------${NC}"

    k6 run \
        --env BASE_URL="${BASE_URL}" \
        --env WS_URL="${WS_URL}" \
        --out json="${RESULTS_DIR}/${test_name}_${TIMESTAMP}.json" \
        --summary-export="${RESULTS_DIR}/${test_name}_summary_${TIMESTAMP}.json" \
        "${test_file}"

    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}  PASSED: ${description}${NC}"
    else
        echo -e "${RED}  FAILED: ${description} (exit code: ${exit_code})${NC}"
    fi

    echo -e "${BLUE}  Finished: $(date)${NC}"
    echo ""

    return $exit_code
}

# Parse test type argument
TEST_TYPE="${1:-all}"

case "$TEST_TYPE" in
    load)
        run_test "load" "load-test.js" "Load Test (Normal Traffic)"
        ;;

    stress)
        run_test "stress" "stress-test.js" "Stress Test (Beyond Expected Load)"
        ;;

    soak)
        run_test "soak" "soak-test.js" "Soak/Endurance Test (2-Hour Stability)"
        ;;

    spike)
        run_test "spike" "spike-test.js" "Spike Test (Sudden Traffic Surge)"
        ;;

    websocket)
        run_test "websocket" "websocket-test.js" "WebSocket Performance Test"
        ;;

    all)
        echo -e "${YELLOW}Running all performance tests sequentially...${NC}"
        echo -e "${YELLOW}Estimated total time: ~3.5 hours${NC}"
        echo ""

        # Run tests in order of increasing intensity
        run_test "load" "load-test.js" "1/5: Load Test (Normal Traffic)" || true
        sleep 30  # Cool-down between tests

        run_test "spike" "spike-test.js" "2/5: Spike Test (Traffic Surge)" || true
        sleep 30

        run_test "stress" "stress-test.js" "3/5: Stress Test (Beyond Capacity)" || true
        sleep 60  # Longer cool-down after stress

        run_test "websocket" "websocket-test.js" "4/5: WebSocket Performance" || true
        sleep 30

        run_test "soak" "soak-test.js" "5/5: Soak Test (2-Hour Endurance)" || true

        echo -e "${GREEN}============================================================${NC}"
        echo -e "${GREEN}  All tests completed!${NC}"
        echo -e "${GREEN}  Results saved to: ${RESULTS_DIR}/${NC}"
        echo -e "${GREEN}============================================================${NC}"
        ;;

    *)
        echo "Usage: $0 [load|stress|soak|spike|websocket|all]"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}Results directory: ${RESULTS_DIR}/${NC}"
echo -e "${BLUE}Summary files: ${RESULTS_DIR}/*_summary_${TIMESTAMP}.json${NC}"

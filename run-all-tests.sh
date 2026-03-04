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

# Check if k6 is installed, auto-install if not
if ! command -v k6 &> /dev/null; then
    echo -e "${YELLOW}k6 is not installed. Attempting auto-install...${NC}"

    OS="$(uname -s)"
    case "$OS" in
        Linux)
            if command -v apt-get &> /dev/null; then
                echo -e "${BLUE}Detected Debian/Ubuntu — installing via apt...${NC}"
                sudo gpg -k
                sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
                echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
                sudo apt-get update
                sudo apt-get install -y k6
            elif command -v yum &> /dev/null; then
                echo -e "${BLUE}Detected RHEL/CentOS — installing via yum...${NC}"
                sudo yum install -y https://dl.k6.io/rpm/repo.rpm
                sudo yum install -y k6
            elif command -v dnf &> /dev/null; then
                echo -e "${BLUE}Detected Fedora — installing via dnf...${NC}"
                sudo dnf install -y https://dl.k6.io/rpm/repo.rpm
                sudo dnf install -y k6
            elif command -v snap &> /dev/null; then
                echo -e "${BLUE}Installing via snap...${NC}"
                sudo snap install k6
            else
                echo -e "${RED}ERROR: Could not detect package manager. Install k6 manually:${NC}"
                echo "  https://k6.io/docs/getting-started/installation/"
                exit 1
            fi
            ;;
        Darwin)
            if command -v brew &> /dev/null; then
                echo -e "${BLUE}Detected macOS — installing via Homebrew...${NC}"
                brew install k6
            else
                echo -e "${RED}ERROR: Homebrew not found. Install it first or install k6 manually:${NC}"
                echo "  https://k6.io/docs/getting-started/installation/"
                exit 1
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            if command -v choco &> /dev/null; then
                echo -e "${BLUE}Detected Windows (Git Bash) — installing via Chocolatey...${NC}" 
                choco install k6 -y
            elif command -v winget &> /dev/null; then
                echo -e "${BLUE}Detected Windows (Git Bash) — installing via winget...${NC}"
                winget install k6 --accept-package-agreements --accept-source-agreements
            elif command -v scoop &> /dev/null; then
                echo -e "${BLUE}Detected Windows (Git Bash) — installing via Scoop...${NC}"
                scoop install k6
            else
                echo -e "${RED}ERROR: No package manager found. Install one of these first:${NC}"
                echo "  Chocolatey: https://chocolatey.org/install"
                echo "  winget:     comes with Windows 10/11"
                echo "  Scoop:      https://scoop.sh"
                echo "  Or install k6 manually: https://k6.io/docs/getting-started/installation/"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}ERROR: Unsupported OS ($OS). Install k6 manually:${NC}"
            echo "  https://k6.io/docs/getting-started/installation/"
            exit 1
            ;;
    esac

    # Verify installation
    if ! command -v k6 &> /dev/null; then
        echo -e "${RED}ERROR: k6 installation failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}k6 installed successfully! Version: $(k6 version)${NC}"
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
    smoke)
        run_test "smoke" "smoke-test.js" "Smoke Test (Quick Validation)"
        ;;

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

    full)
        run_test "full" "full-test.js" "Full Test Suite (Load + Stress + Spike Combined)"
        ;;

    all)
        echo -e "${YELLOW}Running all performance tests sequentially...${NC}"
        echo -e "${YELLOW}Estimated total time: ~4 hours${NC}"
        echo ""

        # Start with smoke test for quick validation
        run_test "smoke" "smoke-test.js" "1/7: Smoke Test (Quick Validation)" || true
        sleep 10

        # Run tests in order of increasing intensity
        run_test "load" "load-test.js" "2/7: Load Test (Normal Traffic)" || true
        sleep 30  # Cool-down between tests

        run_test "spike" "spike-test.js" "3/7: Spike Test (Traffic Surge)" || true
        sleep 30

        run_test "stress" "stress-test.js" "4/7: Stress Test (Beyond Capacity)" || true
        sleep 60  # Longer cool-down after stress

        run_test "full" "full-test.js" "5/7: Full Test (Load+Stress+Spike Combined)" || true
        sleep 30

        run_test "websocket" "websocket-test.js" "6/7: WebSocket Performance" || true
        sleep 30

        run_test "soak" "soak-test.js" "7/7: Soak Test (2-Hour Endurance)" || true

        echo -e "${GREEN}============================================================${NC}"
        echo -e "${GREEN}  All tests completed!${NC}"
        echo -e "${GREEN}  Results saved to: ${RESULTS_DIR}/${NC}"
        echo -e "${GREEN}============================================================${NC}"
        ;;

    *)
        echo "Usage: $0 [smoke|load|stress|soak|spike|websocket|full|all]"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}Results directory: ${RESULTS_DIR}/${NC}"
echo -e "${BLUE}Summary files: ${RESULTS_DIR}/*_summary_${TIMESTAMP}.json${NC}"

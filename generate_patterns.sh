#!/etc/profiles/per-user/paul/bin/bash
# ABOUTME: Professional Mac desktop pattern generator with robust error handling and parallel processing
# ABOUTME: Generates patterns in multiple formats, resolutions, and layouts using modern software engineering practices

set -euo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================

# Version information
readonly VERSION="2.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# Default configuration
declare -A CONFIG=(
    [PATTERN_COUNT]=38
    [BASE_SIZE]=8
    [VERBOSE]=1
    [DRY_RUN]=0
    [INCREMENTAL]=0
    [VERIFY]=0
    [MAX_RETRIES]=2
    [RETRY_DELAY]=1
    [LOG_TO_FILE]=0
)

# Directory configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
readonly SCRIPT_DIR
readonly PATTERNS_DIR="${SCRIPT_DIR}/patterns"
readonly DEFAULT_OUTPUT_DIR="${SCRIPT_DIR}/assets"

# Format and layout configuration
readonly FORMATS=(pbm gif png ico avif webp tiff)
readonly SCALES=(1 2 4 8)
readonly SPRITE_LAYOUTS=("1x38" "38x1" "19x2" "2x19")

# Hardware configuration
MAX_JOBS="${MAX_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
readonly MAX_JOBS

# Runtime state
declare -A RUNTIME_STATE=(
    [START_TIME]=$SECONDS
    [TOTAL_JOBS]=0
    [COMPLETED_JOBS]=0
    [FAILED_JOBS]=0
    [PHASE]="initialization"
    [LOG_FILE]=""
)

# Temporary files
PROGRESS_FILE=$(mktemp)
readonly PROGRESS_FILE
LOG_FILE=""

# =============================================================================
# LOGGING AND OUTPUT
# =============================================================================

# Color constants
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# Logging functions
log_to_file() {
    local message="$1"
    local level="${2:-INFO}"

    if [[ "${CONFIG[LOG_TO_FILE]}" -eq 1 && -n "$LOG_FILE" ]]; then
        printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$message" >> "$LOG_FILE"
    fi
}

log_info() {
    local message="$*"
    log_to_file "$message" "INFO"

    if [[ "${CONFIG[VERBOSE]}" -ge 1 ]]; then
        printf "${GREEN}[%s]${NC} %s\n" "$(date '+%H:%M:%S')" "$message"
    fi
}

log_warn() {
    local message="$*"
    log_to_file "$message" "WARN"

    printf "${YELLOW}[%s] WARNING:${NC} %s\n" "$(date '+%H:%M:%S')" "$message" >&2
}

log_error() {
    local message="$*"
    log_to_file "$message" "ERROR"

    printf "${RED}[%s] ERROR:${NC} %s\n" "$(date '+%H:%M:%S')" "$message" >&2
}

log_debug() {
    local message="$*"
    log_to_file "$message" "DEBUG"

    if [[ "${CONFIG[VERBOSE]}" -ge 2 ]]; then
        printf "${PURPLE}[%s] DEBUG:${NC} %s\n" "$(date '+%H:%M:%S')" "$message"
    fi
}

log_trace() {
    local message="$*"
    log_to_file "$message" "TRACE"

    if [[ "${CONFIG[VERBOSE]}" -ge 3 ]]; then
        printf "${CYAN}[%s] TRACE:${NC} %s\n" "$(date '+%H:%M:%S')" "$message"
    fi
}

# Progress tracking with ETA
update_progress() {
    local phase="${1:-${RUNTIME_STATE[PHASE]}}"
    local increment="${2:-1}"

    RUNTIME_STATE[COMPLETED_JOBS]=$((RUNTIME_STATE[COMPLETED_JOBS] + increment))

    local current="${RUNTIME_STATE[COMPLETED_JOBS]}"
    local total="${RUNTIME_STATE[TOTAL_JOBS]}"
    local elapsed=$((SECONDS - RUNTIME_STATE[START_TIME]))

    if [[ $current -gt 0 && $elapsed -gt 0 ]]; then
        local rate=$((current * 100 / elapsed))  # jobs per 100 seconds
        local remaining=$((total - current))
        local eta=$((remaining * 100 / (rate + 1)))

        local percentage
        percentage=$(printf "%.1f" "$(echo "scale=1; $current * 100.0 / $total" | bc -l)")

        printf "\r${BLUE}[%s]${NC} %d/%d (${percentage}%%) - ${elapsed}s elapsed, ~${eta}s remaining" \
            "$phase" "$current" "$total" >&2
    else
        printf "\r${BLUE}[%s]${NC} %d/%d" "$phase" "$current" "$total" >&2
    fi

    log_to_file "Progress: $current/$total ($phase)"
}

# =============================================================================
# ERROR HANDLING AND VALIDATION
# =============================================================================

# Exit codes
readonly EXIT_SUCCESS=0
readonly EXIT_CONFIG_ERROR=1
readonly EXIT_DEPENDENCY_ERROR=2
readonly EXIT_INPUT_ERROR=3
# shellcheck disable=SC2034  # May be used in future features
readonly EXIT_OUTPUT_ERROR=4
readonly EXIT_PROCESSING_ERROR=5
readonly EXIT_INTERRUPT=130

# Cleanup function
cleanup() {
    local exit_code=$?

    log_debug "Cleanup started (exit code: $exit_code)"

    # Kill background jobs
    jobs -p | xargs -r kill -TERM 2>/dev/null || true

    # Clean up temporary files
    rm -f "$PROGRESS_FILE"

    # Final progress update
    if [[ "${RUNTIME_STATE[TOTAL_JOBS]}" -gt 0 ]]; then
        echo >&2  # New line after progress

        if [[ "${RUNTIME_STATE[FAILED_JOBS]}" -gt 0 ]]; then
            log_warn "Completed with ${RUNTIME_STATE[FAILED_JOBS]} failed jobs"
        fi

        local elapsed=$((SECONDS - RUNTIME_STATE[START_TIME]))
        log_info "Total runtime: ${elapsed}s"
    fi

    log_debug "Cleanup completed"
    exit $exit_code
}

# Signal handlers
handle_interrupt() {
    log_warn "Received interrupt signal, cleaning up..."
    RUNTIME_STATE[PHASE]="interrupted"
    exit $EXIT_INTERRUPT
}

# Set up signal handling
trap cleanup EXIT
trap handle_interrupt INT TERM

# Dependency validation
check_dependencies() {
    log_debug "Checking dependencies"

    local missing_deps=()
    local required_commands=(magick bc find sort wc)

    # Check for required commands
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing_deps+=("$cmd")
        fi
    done

    # Check ImageMagick version
    if command -v magick >/dev/null 2>&1; then
        local version="unknown"
        version=$(magick --version 2>/dev/null | head -n1 | sed 's/.*ImageMagick \([0-9]\+\).*/\1/' || echo "unknown")
        if [[ "$version" != "unknown" ]] && [[ "$version" =~ ^[0-9]+$ ]] && [[ "$version" -lt 7 ]]; then
            log_error "ImageMagick 7.x required, found version $version"
            return $EXIT_DEPENDENCY_ERROR
        fi
        log_debug "ImageMagick version check passed: $version.x"
    fi

    # Report missing dependencies
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_error "Please install the missing tools and try again"
        return $EXIT_DEPENDENCY_ERROR
    fi

    log_debug "All dependencies satisfied"
    return $EXIT_SUCCESS
}

# Input validation
validate_inputs() {
    local pattern_dir="$1"

    log_debug "Validating inputs"

    # Check patterns directory
    if [[ ! -d "$pattern_dir" ]]; then
        log_error "Patterns directory not found: $pattern_dir"
        return $EXIT_INPUT_ERROR
    fi

    # Count and validate pattern files
    local pattern_files
    mapfile -t pattern_files < <(find "$pattern_dir" -name "pattern_*.pbm" -type f | sort)

    if [[ ${#pattern_files[@]} -eq 0 ]]; then
        log_error "No pattern files found in $pattern_dir"
        return $EXIT_INPUT_ERROR
    fi

    if [[ ${#pattern_files[@]} -ne "${CONFIG[PATTERN_COUNT]}" ]]; then
        log_warn "Expected ${CONFIG[PATTERN_COUNT]} patterns, found ${#pattern_files[@]}"
        CONFIG[PATTERN_COUNT]=${#pattern_files[@]}
    fi

    # Validate pattern file format (check for PBM magic number)
    for file in "${pattern_files[@]}"; do
        if ! head -n1 "$file" | grep -q "^P1"; then
            log_error "Invalid pattern file format: $file (not a valid PBM file)"
            return $EXIT_INPUT_ERROR
        fi
    done

    log_debug "Input validation completed: ${#pattern_files[@]} valid pattern files"
    return $EXIT_SUCCESS
}

# Format validation
validate_format() {
    local format="$1"

    case "$format" in
        pbm|gif|png|avif|webp|tiff) return 0 ;;
        ico)
            log_debug "ICO format: sprite sheets will be skipped"
            return 0
            ;;
        *)
            log_error "Unsupported format: $format"
            return 1
            ;;
    esac
}

# =============================================================================
# JOB MANAGEMENT SYSTEM
# =============================================================================

# Job queue implementation
declare -a JOB_QUEUE=()
declare -A ACTIVE_JOBS=()

# Add job to queue
enqueue_job() {
    local job_id="$1"
    local job_command="$2"
    local job_type="${3:-default}"

    JOB_QUEUE+=("$job_id:$job_command:$job_type")
    log_trace "Enqueued job: $job_id ($job_type)"
}

# Execute jobs with proper concurrency control
execute_job_queue() {
    local max_concurrent="${1:-$MAX_JOBS}"
    # shellcheck disable=SC2034  # Reserved for future timeout implementation
    local job_timeout="${2:-300}"  # 5 minutes default

    log_debug "Starting job execution with $max_concurrent concurrent jobs"

    while [[ ${#JOB_QUEUE[@]} -gt 0 || ${#ACTIVE_JOBS[@]} -gt 0 ]]; do
        # Start new jobs if we have queue space and job queue
        while [[ ${#ACTIVE_JOBS[@]} -lt $max_concurrent && ${#JOB_QUEUE[@]} -gt 0 ]]; do
            local job_spec="${JOB_QUEUE[0]}"
            JOB_QUEUE=("${JOB_QUEUE[@]:1}")  # Remove first element

            IFS=':' read -r job_id job_command job_type <<< "$job_spec"

            log_trace "Starting job: $job_id"

            # Start job in background
            (
                eval "$job_command"
                echo "$job_id:$?:$(date +%s)" > "/tmp/job_result_$$_$job_id"
            ) &

            local pid=$!
            ACTIVE_JOBS["$pid"]="$job_id:$job_type:$(date +%s)"
        done

        # Check for completed jobs
        for pid in "${!ACTIVE_JOBS[@]}"; do
            if ! kill -0 "$pid" 2>/dev/null; then
                # Job completed
                IFS=':' read -r job_id job_type start_time <<< "${ACTIVE_JOBS[$pid]}"

                # Read result
                local result_file="/tmp/job_result_$$_$job_id"
                if [[ -f "$result_file" ]]; then
                    local result
                    result=$(cat "$result_file")
                    # shellcheck disable=SC2034  # result_job_id used for validation
                    IFS=':' read -r result_job_id exit_code end_time <<< "$result"

                    local duration=$((end_time - start_time))

                    if [[ "$exit_code" -eq 0 ]]; then
                        log_trace "Job completed successfully: $job_id (${duration}s)"
                        update_progress "$job_type"
                    else
                        log_warn "Job failed: $job_id (exit code: $exit_code)"
                        RUNTIME_STATE[FAILED_JOBS]=$((RUNTIME_STATE[FAILED_JOBS] + 1))
                    fi

                    rm -f "$result_file"
                else
                    log_warn "Job result not found: $job_id"
                    RUNTIME_STATE[FAILED_JOBS]=$((RUNTIME_STATE[FAILED_JOBS] + 1))
                fi

                unset "ACTIVE_JOBS[$pid]"
            fi
        done

        # Small delay to prevent busy waiting
        sleep 0.1
    done

    log_debug "All jobs completed"
}

# =============================================================================
# CORE PROCESSING FUNCTIONS
# =============================================================================

# Calculate total jobs based on configuration
calculate_total_jobs() {
    local pattern_count="${CONFIG[PATTERN_COUNT]}"
    local format_count=${#FORMATS[@]}
    local scale_count=${#SCALES[@]}
    local layout_count=${#SPRITE_LAYOUTS[@]}

    # Individual file conversions (exclude PBM and ICO)
    # PBM = 1, ICO = 1, so actual conversion formats = format_count - 2
    local conversion_formats=$((format_count - 1))  # Exclude PBM 
    local individual_jobs=$((pattern_count * conversion_formats * scale_count))

    # Sprite sheets (exclude PBM and ICO formats)
    local sprite_formats=$((conversion_formats - 1))  # Also exclude ICO
    local sprite_jobs=$((sprite_formats * scale_count * layout_count))

    # PBM copy jobs
    local pbm_jobs=$pattern_count

    # Archive jobs (1 PBM + 6 formats × 4 resolutions each)
    local archive_jobs=$((1 + conversion_formats * scale_count))

    RUNTIME_STATE[TOTAL_JOBS]=$((individual_jobs + sprite_jobs + pbm_jobs + archive_jobs))

    log_debug "Total jobs calculated: ${RUNTIME_STATE[TOTAL_JOBS]}"
}

# File processing with retry logic
process_with_retry() {
    local operation="$1"
    local max_retries="${CONFIG[MAX_RETRIES]}"
    local retry_delay="${CONFIG[RETRY_DELAY]}"
    local attempt=0

    while [[ $attempt -le $max_retries ]]; do
        if [[ "${CONFIG[DRY_RUN]}" -eq 1 ]]; then
            log_info "[DRY RUN] Would execute: $operation"
            return 0
        fi

        log_trace "Attempt $((attempt + 1)): $operation"

        if eval "$operation"; then
            return 0
        fi

        attempt=$((attempt + 1))
        if [[ $attempt -le $max_retries ]]; then
            log_debug "Retry $attempt/$max_retries after ${retry_delay}s: $operation"
            sleep "$retry_delay"
        fi
    done

    log_error "Failed after $max_retries retries: $operation"
    return 1
}

# Convert single pattern with validation
convert_pattern() {
    local pattern_file="$1"
    local format="$2"
    local scale="$3"
    local output_dir="$4"

    log_trace "Converting pattern: $(basename "$pattern_file") -> $format @ ${scale}x"

    # Validate format
    if ! validate_format "$format"; then
        return 1
    fi

    # Extract pattern number
    local pattern_num
    pattern_num=$(basename "$pattern_file" .pbm | sed 's/pattern_//')

    local size=$((CONFIG[BASE_SIZE] * scale))
    local output_file="${output_dir}/pattern_${pattern_num}_${size}x${size}.${format}"

    # Skip if incremental mode and file exists
    if [[ "${CONFIG[INCREMENTAL]}" -eq 1 && -f "$output_file" ]]; then
        log_trace "Skipping existing file: $output_file"
        return 0
    fi

    # Ensure output directory exists
    mkdir -p "$output_dir"

    # Perform conversion
    local convert_cmd="magick '$pattern_file' -filter point -resize '${size}x${size}' '$output_file'"

    if ! process_with_retry "$convert_cmd"; then
        return 1
    fi

    # Verify output if requested
    if [[ "${CONFIG[VERIFY]}" -eq 1 ]] && ! verify_image_file "$output_file" "$size"; then
        log_error "Output verification failed: $output_file"
        return 1
    fi

    log_trace "Successfully converted: $output_file"
    return 0
}

# Verify generated image file
verify_image_file() {
    local file="$1"
    local expected_size="$2"

    if [[ ! -f "$file" ]]; then
        log_error "Output file not created: $file"
        return 1
    fi

    # Check file size (should be > 0)
    if [[ ! -s "$file" ]]; then
        log_error "Output file is empty: $file"
        return 1
    fi

    # Verify image dimensions using identify
    if command -v identify >/dev/null 2>&1; then
        local dimensions
        dimensions=$(identify -format "%wx%h" "$file" 2>/dev/null || echo "")
        if [[ "$dimensions" != "${expected_size}x${expected_size}" ]]; then
            log_warn "Unexpected dimensions for $file: got '$dimensions', expected '${expected_size}x${expected_size}'"
        fi
    fi

    return 0
}

# Create sprite sheet with proper error handling
create_sprite_sheet() {
    local format="$1"
    local scale="$2"
    local layout="$3"
    local input_dir="$4"
    local output_dir="$5"

    # Skip sprite sheets for ICO format
    if [[ "$format" == "ico" ]]; then
        log_trace "Skipping sprite sheet for ICO format"
        return 0
    fi

    log_trace "Creating sprite sheet: $format @ ${scale}x ($layout)"

    local size=$((CONFIG[BASE_SIZE] * scale))
    local sprite_file="${output_dir}/sprites_${scale}x${scale}_${layout}.${format}"

    # Skip if incremental mode and file exists
    if [[ "${CONFIG[INCREMENTAL]}" -eq 1 && -f "$sprite_file" ]]; then
        log_trace "Skipping existing sprite sheet: $sprite_file"
        return 0
    fi

    # Parse layout dimensions
    local cols=${layout#*x}
    local rows=${layout%x*}

    # Create list of input files
    local temp_list
    temp_list=$(mktemp)

    local i
    for ((i=0; i<CONFIG[PATTERN_COUNT]; i++)); do
        printf -v pattern_num "%02d" "$i"
        echo "${input_dir}/pattern_${pattern_num}_${size}x${size}.${format}"
    done > "$temp_list"

    # Verify all input files exist
    local verification_failed=0
    while IFS= read -r input_file; do
        if [[ ! -f "$input_file" ]]; then
            log_error "Missing input file for sprite sheet: $input_file"
            verification_failed=1
        fi
    done < "$temp_list"

    if [[ $verification_failed -eq 1 ]]; then
        rm -f "$temp_list"
        return 1
    fi

    # Create sprite sheet
    local montage_cmd="magick montage -tile '${cols}x${rows}' -geometry '${size}x${size}+0+0' -background white @'$temp_list' '$sprite_file'"

    local success=0
    if process_with_retry "$montage_cmd"; then
        success=1
    fi

    rm -f "$temp_list"

    if [[ $success -eq 1 ]]; then
        log_trace "Successfully created sprite sheet: $sprite_file"
        return 0
    else
        return 1
    fi
}

# Process all patterns for a given format - individual files only
process_format_individual() {
    local format="$1"
    local -n pattern_files_ref=$2
    local output_base_dir="$3"

    log_debug "Processing individual files for format: $format"

    # Skip PBM format as it will be handled separately by copy_original_patterns
    if [[ "$format" == "pbm" ]]; then
        log_debug "Skipping PBM format conversion (handled by copy operation)"
        return 0
    fi

    local format_dir="${output_base_dir}/${format}"

    # Generate individual files for each scale
    for scale in "${SCALES[@]}"; do
        local scale_dir="${format_dir}/${scale}x"

        # Enqueue individual file conversion jobs
        for pattern_file in "${pattern_files_ref[@]}"; do
            local job_id
            job_id="convert_${format}_${scale}_$(basename "$pattern_file")"
            local job_cmd="convert_pattern '$pattern_file' '$format' '$scale' '$scale_dir'"
            enqueue_job "$job_id" "$job_cmd" "convert"
        done
    done
}

# Process sprite sheets for a given format - after individual files complete
process_format_sprites() {
    local format="$1"
    local output_base_dir="$2"

    log_debug "Processing sprite sheets for format: $format"

    # Skip PBM format as it doesn't need sprite sheets
    if [[ "$format" == "pbm" ]]; then
        log_debug "Skipping PBM sprite sheets (not applicable)"
        return 0
    fi

    local format_dir="${output_base_dir}/${format}"

    # Generate sprite sheets for each scale
    for scale in "${SCALES[@]}"; do
        local scale_dir="${format_dir}/${scale}x"

        # Enqueue sprite sheet creation jobs
        for layout in "${SPRITE_LAYOUTS[@]}"; do
            local job_id="sprite_${format}_${scale}_${layout}"
            local job_cmd="create_sprite_sheet '$format' '$scale' '$layout' '$scale_dir' '$scale_dir'"
            enqueue_job "$job_id" "$job_cmd" "sprite"
        done
    done
}

# Copy original PBM files
copy_original_patterns() {
    local -n pattern_files_ref=$1
    local output_dir="$2"

    log_debug "Copying original pattern files"

    local pbm_dir="${output_dir}/pbm"
    mkdir -p "$pbm_dir"

    for pattern_file in "${pattern_files_ref[@]}"; do
        local job_id
        job_id="copy_$(basename "$pattern_file")"
        local job_cmd="cp '$pattern_file' '$pbm_dir/'"
        enqueue_job "$job_id" "$job_cmd" "copy"
    done
}

# Create format/resolution specific archives
create_archives() {
    local output_dir="$1"

    log_debug "Creating format/resolution specific archives"

    local archive_dir="${output_dir}/archives"
    mkdir -p "$archive_dir"

    # Change to output directory for relative paths
    local original_pwd="$PWD"
    cd "$output_dir"

    # Create PBM archive (only one resolution)
    local job_id="archive_pbm"
    local job_cmd="create_format_resolution_archive 'pbm' '' '$archive_dir' '$output_dir'"
    enqueue_job "$job_id" "$job_cmd" "archive"

    # Create archives for each format and resolution combination
    for format in "${FORMATS[@]}"; do
        # Skip PBM as it's handled separately
        if [[ "$format" == "pbm" ]]; then
            continue
        fi

        for scale in "${SCALES[@]}"; do
            local size=$((CONFIG[BASE_SIZE] * scale))
            local job_id="archive_${format}_${size}x${size}"
            local job_cmd="create_format_resolution_archive '$format' '${scale}x' '$archive_dir' '$output_dir'"
            enqueue_job "$job_id" "$job_cmd" "archive"
        done
    done

    cd "$original_pwd"
}

# Archive creation helper
create_format_resolution_archive() {
    local format="$1"
    local resolution="$2"  # e.g., "1x", "2x", "4x", "8x" or empty for PBM
    local archive_dir="$3"
    local output_dir="$4"

    # Change to the output directory to work with relative paths
    cd "$output_dir"

    if [[ "$format" == "pbm" ]]; then
        # Special case for PBM - all files are in pbm/ directory
        local pattern_count
        pattern_count=$(find pbm -name "pattern_*.pbm" -type f 2>/dev/null | wc -l)
        if [[ "$pattern_count" -gt 0 ]]; then
            find pbm -name "pattern_*.pbm" -type f | xargs zip -j "${archive_dir}/pbm.zip" -q
        else
            log_warn "No PBM pattern files found for archive creation"
            return 1
        fi
    else
        # For other formats, create resolution-specific archives
        local size=$((CONFIG[BASE_SIZE] * ${resolution%x}))
        local source_dir="${format}/${resolution}"
        
        # Only include pattern files, exclude sprite sheets
        local pattern_count
        pattern_count=$(find "${source_dir}" -name "pattern_*.${format}" -type f 2>/dev/null | wc -l)
        if [[ "$pattern_count" -gt 0 ]]; then
            find "${source_dir}" -name "pattern_*.${format}" -type f | xargs zip -j "${archive_dir}/${format}_${size}x${size}.zip" -q
        else
            log_warn "No pattern files found in ${source_dir} for ${format} archive creation"
            return 1
        fi
    fi
}

# =============================================================================
# COMMAND LINE INTERFACE
# =============================================================================

# Usage information
show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] [OUTPUT_DIR]

Generate Mac desktop patterns in multiple formats and resolutions.

OPTIONS:
    -h, --help          Show this help message
    -v, --verbose       Increase verbosity (can be used multiple times)
    -q, --quiet         Quiet mode (minimal output)
    -d, --dry-run       Show what would be done without executing
    -i, --incremental   Skip existing files (incremental build)
    -V, --verify        Verify generated files
    -j, --jobs N        Number of parallel jobs (default: $MAX_JOBS)
    -f, --formats LIST  Comma-separated list of formats (default: all)
    -s, --scales LIST   Comma-separated list of scales (default: all)
    -l, --log FILE      Log to file
    -c, --config FILE   Load configuration from file
    --version           Show version information
    --self-test         Run self-test with validation

FORMATS:
    ${FORMATS[*]}

SCALES:
    ${SCALES[*]} (multipliers of base 8x8 pixel size)

EXAMPLES:
    $SCRIPT_NAME                          # Generate all formats to ./assets
    $SCRIPT_NAME /path/to/output          # Generate to custom directory
    $SCRIPT_NAME -v -v --verify           # Verbose mode with verification
    $SCRIPT_NAME -f png,gif -s 1,2        # Only PNG/GIF at 1x/2x scales
    $SCRIPT_NAME --dry-run                # Preview what would be generated
    $SCRIPT_NAME -j 8 --incremental       # 8 jobs, skip existing files

EOF
}

# Version information
show_version() {
    echo "$SCRIPT_NAME version $VERSION"
    echo "ImageMagick version: $(magick --version 2>/dev/null | head -n1 | sed 's/Version: //' || echo 'Not found')"
    echo "Running on: $(uname -s) $(uname -r)"
    echo "CPU cores available: $MAX_JOBS"
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit $EXIT_SUCCESS
                ;;
            -v|--verbose)
                CONFIG[VERBOSE]=$((CONFIG[VERBOSE] + 1))
                shift
                ;;
            -q|--quiet)
                CONFIG[VERBOSE]=0
                shift
                ;;
            -d|--dry-run)
                CONFIG[DRY_RUN]=1
                shift
                ;;
            -i|--incremental)
                CONFIG[INCREMENTAL]=1
                shift
                ;;
            -V|--verify)
                CONFIG[VERIFY]=1
                shift
                ;;
            -j|--jobs)
                if [[ -n "$2" && "$2" =~ ^[0-9]+$ ]]; then
                    MAX_JOBS="$2"
                    shift 2
                else
                    log_error "Invalid job count: $2"
                    exit $EXIT_CONFIG_ERROR
                fi
                ;;
            -f|--formats)
                if [[ -n "$2" ]]; then
                    IFS=',' read -ra FORMATS <<< "$2"
                    shift 2
                else
                    log_error "Formats list required"
                    exit $EXIT_CONFIG_ERROR
                fi
                ;;
            -s|--scales)
                if [[ -n "$2" ]]; then
                    IFS=',' read -ra SCALES <<< "$2"
                    shift 2
                else
                    log_error "Scales list required"
                    exit $EXIT_CONFIG_ERROR
                fi
                ;;
            -l|--log)
                if [[ -n "$2" ]]; then
                    LOG_FILE="$2"
                    CONFIG[LOG_TO_FILE]=1
                    shift 2
                else
                    log_error "Log file path required"
                    exit $EXIT_CONFIG_ERROR
                fi
                ;;
            -c|--config)
                if [[ -n "$2" && -f "$2" ]]; then
                    # shellcheck source=/dev/null
                    source "$2"
                    shift 2
                else
                    log_error "Config file not found: $2"
                    exit $EXIT_CONFIG_ERROR
                fi
                ;;
            --version)
                show_version
                exit $EXIT_SUCCESS
                ;;
            --self-test)
                run_self_test
                exit $?
                ;;
            -*)
                log_error "Unknown option: $1"
                show_usage >&2
                exit $EXIT_CONFIG_ERROR
                ;;
            *)
                # Positional argument (output directory)
                if [[ -z "${OUTPUT_DIR:-}" ]]; then
                    OUTPUT_DIR="$1"
                else
                    log_error "Multiple output directories specified"
                    exit $EXIT_CONFIG_ERROR
                fi
                shift
                ;;
        esac
    done

    # Set default output directory if not specified
    OUTPUT_DIR="${OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
}

# Self-test functionality
run_self_test() {
    log_info "Running self-test..."

    # Check dependencies
    if ! check_dependencies; then
        log_error "Self-test failed: missing dependencies"
        return $EXIT_DEPENDENCY_ERROR
    fi

    # Validate input patterns
    if ! validate_inputs "$PATTERNS_DIR"; then
        log_error "Self-test failed: invalid input patterns"
        return $EXIT_INPUT_ERROR
    fi

    # Test format validation
    for format in "${FORMATS[@]}"; do
        if ! validate_format "$format"; then
            log_error "Self-test failed: invalid format $format"
            return $EXIT_CONFIG_ERROR
        fi
    done

    # Test with dry-run mode
    local original_config="${CONFIG[DRY_RUN]}"
    CONFIG[DRY_RUN]=1
    CONFIG[VERBOSE]=2

    log_info "Testing with dry-run mode..."
    if ! main_processing "/tmp/selftest_$$"; then
        log_error "Self-test failed: dry-run processing error"
        CONFIG[DRY_RUN]="$original_config"
        return $EXIT_PROCESSING_ERROR
    fi

    CONFIG[DRY_RUN]="$original_config"
    log_info "Self-test completed successfully"
    return $EXIT_SUCCESS
}

# =============================================================================
# MAIN PROCESSING LOGIC
# =============================================================================

# Main processing function
main_processing() {
    local output_dir="$1"

    log_info "Starting Mac Desktop Pattern Generation v$VERSION"
    log_info "Output directory: $output_dir"
    log_info "Parallel jobs: $MAX_JOBS"
    log_info "Formats: ${FORMATS[*]}"
    log_info "Scales: ${SCALES[*]}"

    if [[ "${CONFIG[DRY_RUN]}" -eq 1 ]]; then
        log_info "DRY RUN MODE - No files will be created"
    fi

    if [[ "${CONFIG[INCREMENTAL]}" -eq 1 ]]; then
        log_info "INCREMENTAL MODE - Existing files will be skipped"
    fi

    # Validate inputs
    if ! validate_inputs "$PATTERNS_DIR"; then
        return $EXIT_INPUT_ERROR
    fi

    # Get pattern files
    local pattern_files
    mapfile -t pattern_files < <(find "$PATTERNS_DIR" -name "pattern_*.pbm" -type f | sort)

    log_info "Found ${#pattern_files[@]} pattern files"

    # Prepare output directory
    if [[ "${CONFIG[DRY_RUN]}" -eq 0 ]]; then
        if [[ -d "$output_dir" && "${CONFIG[INCREMENTAL]}" -eq 0 ]]; then
            log_info "Cleaning existing output directory"
            rm -rf "$output_dir"
        fi
        mkdir -p "$output_dir"
    fi

    # Calculate total work
    calculate_total_jobs
    log_info "Total jobs to process: ${RUNTIME_STATE[TOTAL_JOBS]}"

    # Phase 1a: Generate individual files
    RUNTIME_STATE[PHASE]="converting"
    log_info "Phase 1a: Processing individual files..."

    for format in "${FORMATS[@]}"; do
        process_format_individual "$format" pattern_files "$output_dir"
    done

    # Execute individual file conversion jobs
    log_info "Executing ${#JOB_QUEUE[@]} individual file conversion jobs..."
    execute_job_queue "$MAX_JOBS"

    # Phase 1b: Generate sprite sheets (after individual files complete)
    RUNTIME_STATE[PHASE]="sprites"
    log_info "Phase 1b: Processing sprite sheets..."

    for format in "${FORMATS[@]}"; do
        process_format_sprites "$format" "$output_dir"
    done

    # Execute sprite sheet creation jobs
    log_info "Executing ${#JOB_QUEUE[@]} sprite sheet creation jobs..."
    execute_job_queue "$MAX_JOBS"

    # Phase 2: Copy original patterns
    RUNTIME_STATE[PHASE]="copying"
    log_info "Phase 2: Copying original patterns..."
    copy_original_patterns pattern_files "$output_dir"

    # Execute copy jobs
    log_info "Executing ${#JOB_QUEUE[@]} copy jobs..."
    execute_job_queue "$MAX_JOBS"

    # Phase 3: Create archives
    RUNTIME_STATE[PHASE]="archiving"
    log_info "Phase 3: Creating archives..."
    create_archives "$output_dir"

    # Execute archive jobs
    log_info "Executing ${#JOB_QUEUE[@]} archive jobs..."
    execute_job_queue "$MAX_JOBS"

    echo >&2  # New line after progress

    # Generate summary
    if [[ "${CONFIG[DRY_RUN]}" -eq 0 ]]; then
        generate_summary "$output_dir"
    fi

    # Check for failures
    if [[ "${RUNTIME_STATE[FAILED_JOBS]}" -gt 0 ]]; then
        log_warn "Completed with ${RUNTIME_STATE[FAILED_JOBS]} failed jobs"
        return $EXIT_PROCESSING_ERROR
    fi

    log_info "Pattern generation completed successfully!"
    return $EXIT_SUCCESS
}

# Generate summary report
generate_summary() {
    local output_dir="$1"

    log_info "Generation Summary:"

    # Count generated files
    local individual_count
    individual_count=$(find "$output_dir" -name "pattern_*.*" -not -path "*/archives/*" | wc -l)
    log_info "  Individual files: $individual_count"

    local sprite_count
    sprite_count=$(find "$output_dir" -name "sprites_*.*" -not -path "*/archives/*" 2>/dev/null | wc -l)
    log_info "  Sprite sheets: $sprite_count"

    local archive_count
    archive_count=$(find "$output_dir/archives" -type f 2>/dev/null | wc -l)
    log_info "  Archives: $archive_count"

    log_info "  Output directory: $output_dir"

    # Show directory sizes
    if [[ "${CONFIG[VERBOSE]}" -ge 1 ]]; then
        log_info "Directory sizes:"
        du -sh "$output_dir"/* 2>/dev/null | sort -hr | while read -r size dir; do
            log_info "  $size  $(basename "$dir")"
        done
    fi

    # Performance statistics
    local elapsed=$((SECONDS - RUNTIME_STATE[START_TIME]))
    local jobs_per_sec=0
    if [[ $elapsed -gt 0 ]]; then
        jobs_per_sec=$((RUNTIME_STATE[COMPLETED_JOBS] / elapsed))
    fi

    log_info "Performance:"
    log_info "  Total runtime: ${elapsed}s"
    log_info "  Jobs completed: ${RUNTIME_STATE[COMPLETED_JOBS]}"
    log_info "  Average rate: ${jobs_per_sec} jobs/sec"
}

# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

main() {
    # Initialize logging
    if [[ "${CONFIG[LOG_TO_FILE]}" -eq 1 && -n "$LOG_FILE" ]]; then
        touch "$LOG_FILE" || {
            log_error "Cannot create log file: $LOG_FILE"
            exit $EXIT_CONFIG_ERROR
        }
        log_debug "Logging to file: $LOG_FILE"
    fi

    # Parse command line arguments
    parse_arguments "$@"

    # Check dependencies
    if ! check_dependencies; then
        exit $EXIT_DEPENDENCY_ERROR
    fi

    # Run main processing
    main_processing "$OUTPUT_DIR"
    local exit_code=$?

    return $exit_code
}

# Execute main function only if script is run directly
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
    main "$@"
fi

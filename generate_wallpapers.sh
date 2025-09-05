#!/bin/bash

# ABOUTME: Simple wallpaper generator for classic Mac 8x8 patterns
# ABOUTME: Creates tiled wallpapers at common resolutions with fixed tile sizes

set -euo pipefail

# Configuration
PATTERN_DIR="patterns"
OUTPUT_DIR="www/wallpapers"

# Parallel processing settings
MAX_JOBS=0  # Always auto-detect
PROGRESS_FILE=""
JOB_COUNTER_FILE=""
INCREMENTAL=false

# Common resolutions
RESOLUTIONS="1920x1080 2560x1440 3840x2160 1290x2796 2048x2732"

# Fixed tile sizes (multiples of 8)
TILE_SIZES="16 32 64"


# Detect CPU cores
detect_cpu_cores() {
    local cores
    if command -v nproc &> /dev/null; then
        cores=$(nproc)
    elif [[ -r /proc/cpuinfo ]]; then
        cores=$(grep -c ^processor /proc/cpuinfo)
    elif command -v sysctl &> /dev/null; then
        cores=$(sysctl -n hw.ncpu 2>/dev/null || echo "1")
    else
        cores=1
    fi
    echo "$cores"
}

# Check dependencies
check_dependencies() {
    if ! command -v magick &> /dev/null; then
        echo "Error: ImageMagick (magick) is required but not installed"
        exit 1
    fi

    # Auto-detect optimal job count
    local cores
    cores=$(detect_cpu_cores)
    # Use 75% of cores, minimum 1, maximum 12
    MAX_JOBS=$(( cores * 3 / 4 ))
    if [[ "$MAX_JOBS" -lt 1 ]]; then
        MAX_JOBS=1
    elif [[ "$MAX_JOBS" -gt 12 ]]; then
        MAX_JOBS=12
    fi

    echo "Using $MAX_JOBS parallel jobs"
}

# Initialize progress tracking
init_progress() {
    local total=$1
    PROGRESS_FILE=$(mktemp)
    JOB_COUNTER_FILE=$(mktemp)
    echo "0" > "$PROGRESS_FILE"
    echo "$total" > "${PROGRESS_FILE}.total"
    echo "0" > "$JOB_COUNTER_FILE"
    
    # Clean up on exit
    trap 'cleanup_progress' EXIT INT TERM
}

# Clean up progress files and kill background jobs
cleanup_progress() {
    # Kill any remaining background jobs
    local job_pids
    job_pids=$(jobs -p)
    if [[ -n "$job_pids" ]]; then
        printf "\nCleaning up background jobs...\n"
        # shellcheck disable=SC2086
        kill $job_pids 2>/dev/null || true
        wait 2>/dev/null || true
    fi
    
    [[ -f "$PROGRESS_FILE" ]] && rm -f "$PROGRESS_FILE" "${PROGRESS_FILE}.total"
    [[ -f "$JOB_COUNTER_FILE" ]] && rm -f "$JOB_COUNTER_FILE"
}

# Update progress counter (simple version without flock for macOS compatibility)
update_progress() {
    if [[ -n "$PROGRESS_FILE" ]]; then
        local current total
        current=$(cat "$PROGRESS_FILE" 2>/dev/null || echo "0")
        total=$(cat "${PROGRESS_FILE}.total" 2>/dev/null || echo "1")
        current=$((current + 1))
        echo "$current" > "$PROGRESS_FILE"
        local percentage
        if command -v bc &> /dev/null; then
            percentage=$(echo "scale=1; $current * 100 / $total" | bc -l 2>/dev/null)
        else
            percentage=$(( current * 100 / total ))
        fi
        printf "\rProgress: %d/%d (%s%%) " "$current" "$total" "$percentage"
        if [[ "$current" -eq "$total" ]]; then
            echo ""  # New line when complete
        fi
    fi
}

# Generate single wallpaper
generate_wallpaper() {
    local pattern_file=$1
    local resolution=$2
    local tile_size=$3
    local variant=$4
    local variant_ops=$5

    local pattern_name
    pattern_name=$(basename "$pattern_file" .pbm)

    local output_file="${OUTPUT_DIR}/${pattern_name}_${resolution}_${tile_size}px${variant}.png"

    # Skip if file exists and incremental mode is enabled
    if [[ "$INCREMENTAL" = true && -f "$output_file" ]]; then
        update_progress
        return 0
    fi
    
    echo "Generating: $output_file"

    # Build ImageMagick command properly handling empty variant_ops
    local magick_cmd=(
        magick "$pattern_file"
        -filter point
        -resize "${tile_size}x${tile_size}"
    )
    
    # Add variant operations if specified
    if [[ -n "$variant_ops" ]]; then
        read -ra variant_array <<< "$variant_ops"
        magick_cmd+=("${variant_array[@]}")
    fi
    
    magick_cmd+=(
        -write mpr:tile +delete
        -size "$resolution"
        tile:mpr:tile
        "$output_file"
    )
    
    "${magick_cmd[@]}"
    
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        echo "Error: Failed to generate $output_file" >&2
        return $exit_code
    fi
    
    update_progress
}

# Track job failures
FAILED_JOBS=0
ERROR_LOG=""

# Generate wallpaper with job control and error handling
generate_wallpaper_job() {
    local pattern_file=$1
    local resolution=$2  
    local tile_size=$3
    local variant=$4
    local variant_ops=$5
    
    # Run in background with job control
    (
        if ! generate_wallpaper "$pattern_file" "$resolution" "$tile_size" "$variant" "$variant_ops"; then
            FAILED_JOBS=$((FAILED_JOBS + 1))
            local pattern_name
            pattern_name=$(basename "$pattern_file" .pbm)
            echo "FAILED: ${pattern_name}_${resolution}_${tile_size}px${variant}.png" >> "$ERROR_LOG"
            exit 1
        fi
    ) &
    
    # Track active jobs and wait if at limit
    local active_jobs
    active_jobs=$(jobs -r | wc -l)
    while [[ "$active_jobs" -ge "$MAX_JOBS" ]]; do
        sleep 0.2
        # Wait for jobs to complete (compatible version)
        jobs > /dev/null  # Update job status
        active_jobs=$(jobs -r | wc -l)
    done
}

# Generate preview sheet
generate_preview() {
    echo "Generating pattern preview sheet..."

    local temp_tiles=()

    # Use all patterns for preview - simpler approach
    local pattern_files_array=()
    local temp_file
    temp_file=$(mktemp)
    find "$PATTERN_DIR" -name "pattern_*.pbm" | sort > "$temp_file"
    while IFS= read -r pattern_file; do
        pattern_files_array+=("$pattern_file")
    done < "$temp_file"
    rm -f "$temp_file"

    # Create temp tiles for montage
    local i=0
    for pattern_file in "${pattern_files_array[@]}"; do
        local temp_tile="${OUTPUT_DIR}/temp_${i}.png"
        local pattern_name
        pattern_name=$(basename "$pattern_file" .pbm)

        # Create a simple tile (without text labels to avoid font issues)
        magick "$pattern_file" \
            -filter point \
            -resize "64x64" \
            -bordercolor white \
            -border 4x4 \
            "$temp_tile"

        temp_tiles+=("$temp_tile")
        ((i++))
    done

    # Create montage using file list to avoid array expansion issues
    echo "Creating montage with ${#temp_tiles[@]} tiles"
    if [[ ${#temp_tiles[@]} -gt 0 ]]; then
        local temp_list
        temp_list=$(mktemp)
        printf '%s\n' "${temp_tiles[@]}" > "$temp_list"
        magick @"$temp_list" \
            -tile 4x \
            -geometry +4+4 \
            -background white \
            "${OUTPUT_DIR}/pattern_preview.png"
        rm -f "$temp_list"
    else
        echo "No temp tiles found to create montage"
    fi

    # Cleanup temp files
    rm -f "${temp_tiles[@]}"

    echo "Preview saved to: ${OUTPUT_DIR}/pattern_preview.png"
}

# Create ZIP archives
create_archives() {
    echo "Creating ZIP archives..."

    cd "$OUTPUT_DIR" || exit 1

    # Archive by resolution
    for res in $RESOLUTIONS; do
        local archive_name="wallpapers_${res}.zip"
        local files
        files=$(find . -name "*_${res}_*.png" | sort)

        if [[ -n "$files" ]]; then
            echo "Creating $archive_name..."
            echo "$files" | zip -@ "$archive_name" > /dev/null
        fi
    done

    # Archive by tile size
    for size in $TILE_SIZES; do
        local archive_name="wallpapers_${size}px_tiles.zip"
        local files
        files=$(find . -name "*_${size}px*.png" | sort)

        if [[ -n "$files" ]]; then
            echo "Creating $archive_name..."
            echo "$files" | zip -@ "$archive_name" > /dev/null
        fi
    done

    # Create complete archive
    echo "Creating complete archive..."
    zip -r "all_wallpapers.zip" ./*.png > /dev/null

    cd - > /dev/null
}

# Print usage
print_usage() {
    cat << EOF
Usage: $0 [options]

Generate wallpapers from classic Mac 8x8 patterns using ImageMagick.

Options:
    -h, --help          Show this help message
    -p, --patterns DIR  Pattern directory (default: patterns)
    -o, --output DIR    Output directory (default: wallpapers)
    --preview-only      Only generate preview sheet
    --no-archives       Skip creating ZIP archives
    --incremental       Skip existing files (faster regeneration)

Resolutions: $RESOLUTIONS
Tile sizes: $TILE_SIZES pixels

Generates wallpapers for all patterns in both normal and inverted colors.
Uses optimal parallel processing based on your CPU cores.
EOF
}

# Main function
main() {
    local preview_only=false
    local no_archives=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                print_usage
                exit 0
                ;;
            -p|--patterns)
                PATTERN_DIR="$2"
                shift 2
                ;;
            -o|--output)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            --incremental)
                INCREMENTAL=true
                shift
                ;;
            --preview-only)
                preview_only=true
                shift
                ;;
            --no-archives)
                no_archives=true
                shift
                ;;
            *)
                echo "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
    done

    check_dependencies
    

    if [[ ! -d "$PATTERN_DIR" ]]; then
        echo "Error: Pattern directory '$PATTERN_DIR' does not exist"
        exit 1
    fi

    mkdir -p "$OUTPUT_DIR"

    # Generate preview and exit if requested
    if [[ "$preview_only" = true ]]; then
        generate_preview
        exit 0
    fi

    # Use all patterns - convert to array for batch processing
    local pattern_files_array=()
    while IFS= read -r pattern_file; do
        pattern_files_array+=("$pattern_file")
    done < <(find "$PATTERN_DIR" -name "pattern_*.pbm" | sort)

    if [[ ${#pattern_files_array[@]} -eq 0 ]]; then
        echo "Error: No pattern files found"
        exit 1
    fi

    local pattern_count
    pattern_count=${#pattern_files_array[@]}
    local resolution_count
    resolution_count=$(echo "$RESOLUTIONS" | wc -w)
    local tile_count
    tile_count=$(echo "$TILE_SIZES" | wc -w)
    local variant_count=2  # Always generate both normal and inverted

    local total_wallpapers=$((pattern_count * resolution_count * tile_count * variant_count))

    echo "Generating $total_wallpapers wallpapers..."
    echo "Patterns: $pattern_count | Resolutions: $resolution_count | Tile sizes: $tile_count | Variants: $variant_count"
    echo "Using $MAX_JOBS parallel jobs"
    if [[ "$INCREMENTAL" = true ]]; then
        echo "Incremental mode: existing files will be skipped"
    fi
    echo

    
    # Initialize progress tracking and error logging
    init_progress "$total_wallpapers"
    ERROR_LOG=$(mktemp)
    FAILED_JOBS=0
    
    local start_time
    start_time=$(date +%s)

    # Process patterns in batches to avoid bash job table overflow
    local batch_size=5  # 5 patterns per batch (5 × 30 jobs = 150 jobs max)
    local batch_count=$(( (pattern_count + batch_size - 1) / batch_size ))
    
    echo "Processing in $batch_count batches of up to $batch_size patterns each..."
    
    for (( batch=0; batch<batch_count; batch++ )); do
        local start_idx=$((batch * batch_size))
        local end_idx=$(((batch + 1) * batch_size))
        if [[ $end_idx -gt $pattern_count ]]; then
            end_idx=$pattern_count
        fi
        
        local batch_patterns=("${pattern_files_array[@]:$start_idx:$((end_idx - start_idx))}")
        local current_batch_size=$((end_idx - start_idx))
        
        echo "Processing batch $((batch + 1))/$batch_count ($current_batch_size patterns)..."
        
        # Generate all combinations for this batch in parallel
        for pattern_file in "${batch_patterns[@]}"; do
            for resolution in $RESOLUTIONS; do
                for tile_size in $TILE_SIZES; do
                    # Original colors
                    generate_wallpaper_job "$pattern_file" "$resolution" "$tile_size" "" ""

                    # Inverted colors
                    generate_wallpaper_job "$pattern_file" "$resolution" "$tile_size" "_inverted" "-negate"
                done
            done
        done
        
        # Wait for all jobs in this batch to complete before starting next batch
        echo "Waiting for batch $((batch + 1)) to complete..."
        wait
        echo "Batch $((batch + 1)) completed."
    done
    
    local end_time duration
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    
    # Report results
    local successful_count failed_count
    if [[ -f "$ERROR_LOG" ]]; then
        failed_count=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo "0")
    else
        failed_count=0
    fi
    successful_count=$((total_wallpapers - failed_count))
    
    echo "Generation completed in ${duration} seconds"
    echo "Successful: $successful_count/$total_wallpapers"
    
    if [[ "$failed_count" -gt 0 ]]; then
        echo "Failed: $failed_count wallpapers"
        if [[ -f "$ERROR_LOG" && -s "$ERROR_LOG" ]]; then
            echo "Failed files:"
            cat "$ERROR_LOG"
        fi
    fi
    
    # Clean up error log
    [[ -f "$ERROR_LOG" ]] && rm -f "$ERROR_LOG"

    generate_preview

    if [[ "$no_archives" = false ]]; then
        create_archives
    fi

    local actual_count
    actual_count=$(find "$OUTPUT_DIR" -name "*.png" -not -name "pattern_preview.png" | wc -l)

    echo
    echo "Wallpaper generation complete!"
    echo "Generated: $actual_count wallpapers"
    echo "Output directory: $OUTPUT_DIR"
}

main "$@"

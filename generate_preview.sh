#!/bin/bash
set -euo pipefail

SCALE=4
CROPW=19
CROPH=16
TMPDIR=$(mktemp -t mac.XXXXXX -d)

cleanup() {
    test -d "$TMPDIR" && rm -rf "$TMPDIR"
}

trap cleanup EXIT

# make a 3x3 for each pattern, then crop it
for i in {0..37}; do
    patnum=$(printf "%02d" "$i")
    res=$((SCALE * 8))
    dim="${res}x${res}"
    outfile="${TMPDIR}/pat_${patnum}.png"
    magick montage \
        $(yes "assets/png/${SCALE}x/pattern_${patnum}_${dim}.png" | head -n9) \
        -tile 3x3 -geometry +0+0 \
        "$outfile"

    cropw=$((SCALE * CROPW))
    croph=$((SCALE * CROPH))
    magick mogrify -crop "${cropw}x${croph}+0+0" +repage "$outfile"
done

magick montage "$TMPDIR"/pat_*.png -tile 19x2 -geometry +0+0 \
    -border 1 -bordercolor black \
    "$TMPDIR/preview.png"

mv "$TMPDIR/preview.png" preview.png

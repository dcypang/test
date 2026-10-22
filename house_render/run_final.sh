#!/usr/bin/env bash
# Progressive 6000 spp render: 24 chunks x 250 samples with disjoint sample offsets.
# Resumable: finished chunks are skipped. After every chunk a progress PNG is written.
set -u
cd "$(dirname "$0")"
PY=${PY:-python}
CHUNK=250
TOTAL=6000
mkdir -p chunks
for ((off = 0; off < TOTAL; off += CHUNK)); do
  f=$(printf "chunks/chunk_%04d.exr" "$off")
  [ -f "$f" ] && continue
  "$PY" render.py house.blend "$f.tmp.exr" --samples "$CHUNK" --offset "$off" >> chunks/render.log 2>&1 && mv "$f.tmp.exr" "$f"
  n=$(ls chunks/chunk_*.exr 2>/dev/null | grep -vc tmp)
  "$PY" tonemap.py progress.png chunks/chunk_*[0-9].exr >> chunks/render.log 2>&1
  echo "$(date -u +%H:%M:%S) chunks=$n samples=$((n * CHUNK))" >> chunks/progress.txt
done
"$PY" tonemap.py house_6000spp.png chunks/chunk_*[0-9].exr --save-exr house_6000spp.exr >> chunks/render.log 2>&1
echo "$(date -u +%H:%M:%S) DONE" >> chunks/progress.txt

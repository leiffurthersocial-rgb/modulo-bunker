#!/usr/bin/env bash
# Reports HTTP reachability of every host the project depends on.
# Usage: bash scripts/check-network.sh
hosts=(github.com registry.npmjs.org api.vercel.com vercel.com
  api.polyhaven.com dl.polyhaven.org ambientcg.com quaternius.com kenney.nl sketchfab.com api.sketchfab.com
  freesound.org pixabay.com fonts.googleapis.com fonts.gstatic.com huggingface.co
  threejs.org rapier.rs gltf-transform.dev)
for h in "${hosts[@]}"; do
  code=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "https://$h/" 2>/dev/null)
  if [ "$code" = "000" ]; then status="BLOCKED/unreachable"; else status="reachable (HTTP $code)"; fi
  printf '%-24s %s\n' "$h" "$status"
done

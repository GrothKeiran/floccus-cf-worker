#!/usr/bin/env bash
# Source from the project root; never sends test caches to the host home directory.
export PATH="$PWD/.cache/bin:$PATH"
export COREPACK_HOME="$PWD/.cache/corepack"
export npm_config_cache="$PWD/.cache/npm"
export XDG_CACHE_HOME="$PWD/.cache/xdg"
export XDG_CONFIG_HOME="$PWD/.cache/config"
export XDG_DATA_HOME="$PWD/.cache/data"
export TMPDIR="$PWD/.cache/tmp"
export WRANGLER_SEND_METRICS=false
export WRANGLER_LOG_PATH="$PWD/.cache/wrangler/logs"
mkdir -p "$TMPDIR" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$WRANGLER_LOG_PATH"

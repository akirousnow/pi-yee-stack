#!/usr/bin/env bash
# Publish every Yee Stack package to npm, in dependency order.
#
#   bash scripts/publish.sh 123456   # with a fresh OTP from your authenticator
#   bash scripts/publish.sh          # prompts for the OTP; Enter alone = no OTP
#
# No OTP is needed when the CLI already holds a token that may publish
# (npm login --auth-type=web, or a token with 2FA bypass).
#
# Idempotent: a version that is already on the registry is skipped, so a run
# that stops on an expired OTP can simply be repeated with a new code.
set -u

cd "$(dirname "$0")/.." || exit 1

OTP="${1:-}"
if [ -z "$OTP" ] && [ -t 0 ]; then
  read -r -s -p "npm OTP (Enter for none): " OTP
  echo
fi
if [ -n "$OTP" ] && ! printf '%s' "$OTP" | grep -Eq '^[0-9]{6}$'; then
  echo "OTP must be 6 digits" >&2
  exit 2
fi

publish_args() {
  # $1 = workspace name
  if [ -n "$OTP" ]; then
    printf '%s\n' -w "$1" --access public --otp="$OTP"
  else
    printf '%s\n' -w "$1" --access public
  fi
}

dir_of() {
  case "$1" in
    yee-stack-core)    echo packages/core ;;
    yee-stack-wish)    echo packages/features/wish ;;
    yee-stack-ask)     echo packages/features/ask ;;
    yee-stack-browser) echo packages/features/browser ;;
    yee-stack-dsh)     echo packages/dsh ;;
    pi-yee-stack)      echo packages/pi ;;
  esac
}

PACKAGES=(
  yee-stack-core
  yee-stack-wish
  yee-stack-ask
  yee-stack-browser
  yee-stack-dsh
  pi-yee-stack
)

for pkg in "${PACKAGES[@]}"; do
  dir="$(dir_of "$pkg")"
  version="$(node -p "require('./$dir/package.json').version")"

  if npm view "$pkg@$version" version >/dev/null 2>&1; then
    printf '%-20s %-8s already published, skipped\n' "$pkg" "$version"
    continue
  fi

  log="$(mktemp)"
  mapfile -t args < <(publish_args "$pkg")
  if npm publish "${args[@]}" >"$log" 2>&1; then
    printf '%-20s %-8s published\n' "$pkg" "$version"
    rm -f "$log"
  else
    printf '%-20s %-8s FAILED\n' "$pkg" "$version"
    grep -E 'npm error' "$log" | head -4
    rm -f "$log"
    echo
    echo "Stopped at $pkg. Get a new OTP and run this script again; published packages are skipped."
    exit 1
  fi
done

echo
echo "All packages are on npm."

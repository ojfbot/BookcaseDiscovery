#!/bin/sh
# `swift test` for this package. On a Mac with only the Command Line Tools (no Xcode.app) SwiftPM does not
# put the Swift Testing macro plugin on the compiler's path, so the tests fail to build; this passes it
# explicitly. With Xcode installed the same flag is harmless.
set -eu
cd "$(dirname "$0")"
plugins="$(dirname "$(xcrun -f swift)")/../lib/swift/host/plugins/testing"
if [ -d "$plugins" ]; then
  exec swift test -Xswiftc -plugin-path -Xswiftc "$plugins" "$@"
fi
exec swift test "$@"

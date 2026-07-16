#!/bin/bash

REAL_PATH=$(readlink -f "${BASH_SOURCE[0]}")
SCRIPT_DIR=$(dirname "$REAL_PATH")

echo "Starting to run $SCRIPT_DIR..."

source "$SCRIPT_DIR/venv/bin/activate"

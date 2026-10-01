#!/usr/bin/env bash
# Builds Gymli Check-in for the Windows reception PC (works from Linux, macOS or Windows).
# Output: apps/checkin/dist/GymliCheckin  → copy this folder to the PC with install.ps1
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/GymliCheckin
dotnet publish src/Gymli.Checkin.App -c Release -r win-x64 --self-contained true -o dist/GymliCheckin
cp scripts/install.ps1 dist/GymliCheckin/
echo "Built dist/GymliCheckin — copy it to the reception PC and run install.ps1 as Administrator."

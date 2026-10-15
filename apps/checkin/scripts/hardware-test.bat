@echo off
rem Checks the fingerprint reader and the gate relay. Close Gymli Check-in and the old gym system first.
"%~dp0Gymli.Checkin.exe" --hardware-test

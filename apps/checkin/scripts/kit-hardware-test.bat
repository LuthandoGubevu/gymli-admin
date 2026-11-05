@echo off
rem Checks the fingerprint scanner and the gate relay. Nothing is saved or sent.
"%~dp0GymliCheckin\Gymli.Checkin.exe" --hardware-test

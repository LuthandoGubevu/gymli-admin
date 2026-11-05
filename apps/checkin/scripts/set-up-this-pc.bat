@echo off
rem Sets up this PC as the gym's check-in PC. Windows asks for Administrator: click Yes.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0GymliCheckin\setup-gym-pc.ps1\"'"

@echo off
cd /d "%~dp0"
echo Installing database drivers (first run only)...
python -m pip install -q -r requirements.txt
python server.py
pause

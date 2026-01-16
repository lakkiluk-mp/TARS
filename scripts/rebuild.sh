#!/bin/bash
# Quick rebuild and restart script for TARS

echo "🔨 Building TARS..."
docker compose build app

echo "🚀 Restarting TARS..."
docker compose up -d app

echo "📋 Showing logs (Ctrl+C to exit)..."
docker compose logs -f app

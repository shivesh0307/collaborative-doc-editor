#!/bin/bash

# CollabEdit - Quick Start Script
# This script starts both backend and frontend services

set -e

echo "🚀 Starting CollabEdit - Collaborative Document Editor"
echo "=================================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command_exists docker; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command_exists docker-compose; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ All prerequisites are available"

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Start backend services
echo ""
echo "🐳 Starting backend services (Redis, Spring Boot, Nginx)..."
cd "$SCRIPT_DIR"
docker compose down --remove-orphans 2>/dev/null || true
docker compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for backend services to be ready..."
sleep 10

# Check if services are running
if ! docker ps | grep -q "collab_nginx\|app1\|app2\|app3\|collab_redis"; then
    echo "❌ Backend services failed to start. Check Docker logs:"
    docker compose logs
    exit 1
fi

echo "✅ Backend services are running"

# Install frontend dependencies if needed
echo ""
echo "📦 Setting up frontend..."
cd "$SCRIPT_DIR/editor-client"

if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Start frontend in background
echo ""
echo "⚛️ Starting React frontend..."
npm run dev &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

echo ""
echo "🎉 CollabEdit is now running!"
echo "================================"
echo "Frontend: http://localhost:5173/"
echo "Backend:  http://localhost:80/"
echo ""
echo "📖 Usage:"
echo "1. Open http://localhost:5173/ in your browser"
echo "2. Enter a document name (e.g., 'demo', 'test-doc')"
echo "3. Start editing!"
echo "4. Open the same document in another browser tab to test collaboration"
echo ""
echo "🛑 To stop all services:"
echo "Press Ctrl+C to stop the frontend"
echo "Run: docker compose down"
echo ""
echo "📊 Monitor services:"
echo "- Frontend logs: Check the terminal output above"
echo "- Backend logs:  docker logs app1"
echo "- All services:  docker ps"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $FRONTEND_PID 2>/dev/null || true
    cd "$SCRIPT_DIR"
    docker compose down
    echo "✅ All services stopped"
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Wait for frontend process
wait $FRONTEND_PID